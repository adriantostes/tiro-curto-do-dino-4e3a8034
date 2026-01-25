import { createClient } from "npm:@supabase/supabase-js@2.91.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

type Body =
  | {
      round: number;
      participantIds: string[];
    }
  | {
      round: number;
      paymentId: string;
    };

async function fetchMpPayment(mpAccessToken: string, transactionId: string) {
  const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${transactionId}`, {
    headers: { Authorization: `Bearer ${mpAccessToken}` },
  });
  const mpJson = await mpRes.json().catch(() => null);
  return { ok: mpRes.ok, status: mpRes.status, json: mpJson };
}

function mpStatusToApp(status: string | null | undefined) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected" || s === "cancelled" || s === "refunded" || s === "charged_back") return "rejected";
  return "pending";
}

function uniq(arr: string[]) {
  return Array.from(new Set(arr.filter(Boolean)));
}

async function getAlreadyPaidParticipantIds(opts: {
  // Tipagem do client em Edge Functions pode variar por build; usamos `any` aqui para evitar atritos.
  serviceClient: any;
  userId: string;
  round: number;
  participantIds: string[];
}) {
  const { serviceClient, userId, round, participantIds } = opts;
  if (participantIds.length === 0) return [] as string[];

  // 1) Legado: payments.participant_id
  const { data: legacyRows, error: legacyErr } = await serviceClient
    .from("payments")
    .select("participant_id")
    .eq("user_id", userId)
    .eq("round_number", round)
    .eq("status", "approved")
    .in("participant_id", participantIds);

  if (legacyErr) console.error("mercado-pago-pix-bulk legacy lookup error", legacyErr);

  const legacy = (legacyRows ?? [])
    .map((r: any) => (r?.participant_id ? String(r.participant_id) : null))
    .filter(Boolean) as string[];

  // 2) Novo: payment_items -> payments
  const { data: itemRows, error: itemErr } = await serviceClient
    .from("payment_items")
    .select("participant_id, payments!inner(status, round_number, user_id)")
    .eq("round_number", round)
    .in("participant_id", participantIds)
    .eq("payments.user_id", userId)
    .eq("payments.status", "approved")
    .eq("payments.round_number", round);

  if (itemErr) console.error("mercado-pago-pix-bulk items lookup error", itemErr);

  const fromItems = (itemRows ?? [])
    .map((r: any) => (r?.participant_id ? String(r.participant_id) : null))
    .filter(Boolean) as string[];

  return uniq([...legacy, ...fromItems]);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey =
      Deno.env.get("SUPABASE_ANON_KEY") ??
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ??
      Deno.env.get("SUPABASE_ANON_PUBLIC_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")!;

    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
    if (!anonKey) throw new Error("Missing SUPABASE_ANON_KEY");
    if (!serviceKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Não autenticado" }, { status: 401 });
    const userId = userData.user.id;

    const body = (await req.json()) as Body;
    if (!body?.round || body.round < 1) return json({ error: "Rodada inválida" }, { status: 400 });

    // Refresh flow
    if ((body as any).paymentId) {
      const paymentId = String((body as any).paymentId);
      const { data: payment, error: payErr } = await userClient
        .from("payments")
        .select("id, status, transaction_id, pix_copy_paste")
        .eq("id", paymentId)
        .eq("round_number", body.round)
        .maybeSingle();

      if (payErr) return json({ error: "Falha ao carregar pagamento" }, { status: 500 });
      if (!payment) return json({ error: "Pagamento não encontrado" }, { status: 404 });

      const transactionId = String((payment as any).transaction_id ?? "");
      if (!transactionId) {
        return json(
          { paymentId: payment.id, status: payment.status, pixCopyPaste: (payment as any).pix_copy_paste ?? null },
          { status: 200 }
        );
      }

      const mp = await fetchMpPayment(mpAccessToken, transactionId);
      if (mp.ok) {
        const nextStatus = mpStatusToApp(mp.json?.status);
        const nextPix = (mp.json?.point_of_interaction?.transaction_data?.qr_code as string | undefined) ?? null;

        if (nextStatus !== payment.status || (nextPix && nextPix !== (payment as any).pix_copy_paste)) {
          await serviceClient
            .from("payments")
            .update({ status: nextStatus, pix_copy_paste: nextPix ?? (payment as any).pix_copy_paste })
            .eq("id", payment.id);

          return json(
            {
              paymentId: payment.id,
              status: nextStatus,
              transactionId,
              pixCopyPaste: nextPix ?? (payment as any).pix_copy_paste,
            },
            { status: 200 }
          );
        }
      } else {
        console.warn("mercado-pago-pix-bulk refresh failed", mp.status, mp.json);
      }

      return json(
        {
          paymentId: payment.id,
          status: payment.status,
          transactionId,
          pixCopyPaste: (payment as any).pix_copy_paste ?? null,
        },
        { status: 200 }
      );
    }

    // Create flow
    const participantIds = uniq(((body as any).participantIds ?? []) as string[]);
    if (participantIds.length === 0) return json({ error: "participantIds obrigatório" }, { status: 400 });

    // Validate participants belong to user (RLS)
    const { data: participants, error: partErr } = await userClient
      .from("participants")
      .select("id")
      .in("id", participantIds);

    if (partErr) return json({ error: "Falha ao validar participantes" }, { status: 500 });
    const foundIds = new Set((participants ?? []).map((p: any) => String(p.id)));
    if (participantIds.some((id) => !foundIds.has(id))) {
      return json({ error: "Um ou mais participantes inválidos" }, { status: 400 });
    }

    const alreadyPaid = await getAlreadyPaidParticipantIds({ serviceClient, userId, round: body.round, participantIds });
    const toCharge = participantIds.filter((id) => !alreadyPaid.includes(id));

    if (toCharge.length === 0) {
      return json(
        { status: "approved", excludedParticipantIds: alreadyPaid, message: "Todos os times já estão pagos." },
        { status: 200 }
      );
    }

    const amount = 10 * toCharge.length;
    const amountCents = 1000 * toCharge.length;
    const idempotencyKey = crypto.randomUUID();
    const externalReference = `liga-do-dino:${userId}:${body.round}:${idempotencyKey}`;

    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description: `Liga do Dino • Rodada ${body.round} • ${toCharge.length} time(s)`,
        payment_method_id: "pix",
        payer: {
          email: userData.user.email ?? `user-${userId}@liga-do-dino.local`,
        },
        external_reference: externalReference,
      }),
    });

    const mpJson = await mpRes.json().catch(() => null);
    if (!mpRes.ok) {
      console.error("mercado-pago-pix-bulk create error", mpRes.status, mpJson);
      return json({ error: "Falha ao criar pagamento PIX" }, { status: 502 });
    }

    const transactionId = String(mpJson?.id ?? "");
    const pixCopyPaste = mpJson?.point_of_interaction?.transaction_data?.qr_code as string | undefined;
    const status = mpStatusToApp(mpJson?.status);

    if (!transactionId || !pixCopyPaste) {
      console.error("mercado-pago-pix-bulk missing fields", mpJson);
      return json({ error: "Resposta inválida do Mercado Pago" }, { status: 502 });
    }

    const { data: inserted, error: insErr } = await serviceClient
      .from("payments")
      .insert({
        user_id: userId,
        round_number: body.round,
        amount_cents: amountCents,
        status,
        transaction_id: transactionId,
        pix_copy_paste: pixCopyPaste,
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      console.error("mercado-pago-pix-bulk insert payment error", insErr);
      return json({ error: "Falha ao salvar pagamento" }, { status: 500 });
    }

    const paymentId = inserted?.id as string | undefined;
    if (!paymentId) return json({ error: "Falha ao salvar pagamento" }, { status: 500 });

    const itemsPayload = toCharge.map((participantId) => ({
      payment_id: paymentId,
      participant_id: participantId,
      round_number: body.round,
    }));

    const { error: itemsErr } = await serviceClient.from("payment_items").insert(itemsPayload);
    if (itemsErr) console.error("mercado-pago-pix-bulk insert items error", itemsErr);

    return json(
      {
        paymentId,
        status,
        transactionId,
        pixCopyPaste,
        excludedParticipantIds: alreadyPaid,
        chargedParticipantIds: toCharge,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("mercado-pago-pix-bulk exception", e);
    return json({ error: "Erro interno" }, { status: 500 });
  }
});
