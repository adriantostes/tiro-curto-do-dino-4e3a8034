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
      leagueId: string;
      reservationIds: string[];
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

async function finalizeApprovedPayment(opts: {
  serviceClient: any;
  paymentId: string;
  userId: string;
  round: number;
}) {
  const { serviceClient, paymentId, userId, round } = opts;

  const { data: reservations, error: resErr } = await serviceClient
    .from("team_reservations")
    .select("id, league_id, cartola_team_id, team_name, team_slug, team_shield_url")
    .eq("payment_id", paymentId)
    .eq("user_id", userId);

  if (resErr) {
    console.error("finalizeApprovedPayment reservations error", resErr);
    return;
  }
  if (!reservations?.length) return;

  const participantsPayload = reservations.map((r: any) => ({
    user_id: userId,
    league_id: r.league_id,
    cartola_team_id: r.cartola_team_id,
    team_name: r.team_name,
    team_slug: r.team_slug ?? null,
    team_shield_url: r.team_shield_url ?? null,
  }));

  const { data: insertedParticipants, error: partErr } = await serviceClient
    .from("participants")
    .insert(participantsPayload)
    .select("id, cartola_team_id, league_id");

  if (partErr) {
    console.error("finalizeApprovedPayment insert participants error", partErr);
    return;
  }

  const participantIdByKey = new Map<string, string>();
  for (const p of insertedParticipants ?? []) {
    participantIdByKey.set(`${p.league_id}:${p.cartola_team_id}`, String(p.id));
  }

  const itemsPayload = (reservations ?? [])
    .map((r: any) => {
      const participantId = participantIdByKey.get(`${r.league_id}:${r.cartola_team_id}`);
      if (!participantId) return null;
      return { payment_id: paymentId, participant_id: participantId, round_number: round };
    })
    .filter(Boolean);

  if (itemsPayload.length) {
    const { error: itemsErr } = await serviceClient.from("payment_items").insert(itemsPayload);
    if (itemsErr) console.error("finalizeApprovedPayment insert payment_items error", itemsErr);
  }

  const { error: delErr } = await serviceClient.from("team_reservations").delete().eq("payment_id", paymentId).eq("user_id", userId);
  if (delErr) console.error("finalizeApprovedPayment delete reservations error", delErr);
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
        .select("id, status, transaction_id, pix_copy_paste, expires_at")
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

      // Expire locally if past expires_at (keeps UX consistent even if MP takes time)
      const expiresAt = (payment as any).expires_at ? new Date(String((payment as any).expires_at)) : null;
      if (expiresAt && Date.now() > expiresAt.getTime() && String(payment.status) === "pending") {
        await serviceClient.from("payments").update({ status: "rejected" }).eq("id", payment.id);
        await serviceClient.from("team_reservations").delete().eq("payment_id", payment.id);
        return json(
          { paymentId: payment.id, status: "rejected", transactionId, pixCopyPaste: (payment as any).pix_copy_paste ?? null },
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

          if (nextStatus === "approved") {
            await finalizeApprovedPayment({ serviceClient, paymentId: String(payment.id), userId, round: body.round });
          }

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

      if (String(payment.status) === "approved") {
        await finalizeApprovedPayment({ serviceClient, paymentId: String(payment.id), userId, round: body.round });
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

    // Create flow (preferred: reservationIds)
    const reservationIds = uniq(((body as any).reservationIds ?? []) as string[]);
    const leagueId = String((body as any).leagueId ?? "");
    const participantIds = uniq(((body as any).participantIds ?? []) as string[]);

    if (reservationIds.length === 0 && participantIds.length === 0) {
      return json({ error: "reservationIds ou participantIds obrigatório" }, { status: 400 });
    }

    let alreadyPaid: string[] = [];
    let toChargeParticipantIds: string[] = [];
    let amountItemsCount = 0;

    if (reservationIds.length > 0) {
      if (!leagueId) return json({ error: "leagueId obrigatório" }, { status: 400 });

      // Cleanup expired reservations not tied to a payment (best-effort)
      await serviceClient
        .from("team_reservations")
        .delete()
        .eq("league_id", leagueId)
        .is("payment_id", null)
        .lt("expires_at", new Date().toISOString());

      const { data: reservations, error: resErr } = await userClient
        .from("team_reservations")
        .select("id, expires_at, payment_id")
        .in("id", reservationIds)
        .eq("league_id", leagueId)
        .eq("user_id", userId);

      if (resErr) return json({ error: "Falha ao validar reservas" }, { status: 500 });

      const found = new Set((reservations ?? []).map((r: any) => String(r.id)));
      if (reservationIds.some((id) => !found.has(id))) return json({ error: "Uma ou mais reservas inválidas" }, { status: 400 });

      const nowIso = new Date().toISOString();
      const invalid = (reservations ?? []).find((r: any) => (r.expires_at && String(r.expires_at) < nowIso) || r.payment_id);
      if (invalid) return json({ error: "Uma ou mais reservas expiraram. Refaça a seleção." }, { status: 400 });

      amountItemsCount = reservationIds.length;
    } else {
      // Legacy: participantIds
      const { data: participants, error: partErr } = await userClient.from("participants").select("id").in("id", participantIds);

      if (partErr) return json({ error: "Falha ao validar participantes" }, { status: 500 });
      const foundIds = new Set((participants ?? []).map((p: any) => String(p.id)));
      if (participantIds.some((id) => !foundIds.has(id))) return json({ error: "Um ou mais participantes inválidos" }, { status: 400 });

      alreadyPaid = await getAlreadyPaidParticipantIds({ serviceClient, userId, round: body.round, participantIds });
      toChargeParticipantIds = participantIds.filter((id) => !alreadyPaid.includes(id));

      if (toChargeParticipantIds.length === 0) {
        return json(
          { status: "approved", excludedParticipantIds: alreadyPaid, message: "Todos os times já estão pagos." },
          { status: 200 }
        );
      }

      amountItemsCount = toChargeParticipantIds.length;
    }

    const expiresAt = new Date(Date.now() + 10 * 60_000);
    const amount = 10 * amountItemsCount;
    const amountCents = 1000 * amountItemsCount;
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
        description: `Melhor da Rodada do Dino • Rodada ${body.round} • ${amountItemsCount} time(s)`,
        payment_method_id: "pix",
        payer: {
          email: userData.user.email ?? `user-${userId}@liga-do-dino.local`,
        },
        external_reference: externalReference,
        date_of_expiration: expiresAt.toISOString(),
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
        expires_at: expiresAt.toISOString(),
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      console.error("mercado-pago-pix-bulk insert payment error", insErr);
      return json({ error: "Falha ao salvar pagamento" }, { status: 500 });
    }

    const paymentId = inserted?.id as string | undefined;
    if (!paymentId) return json({ error: "Falha ao salvar pagamento" }, { status: 500 });

    if (reservationIds.length > 0) {
      // Attach reservations to payment; participants/payment_items will be created on approval
      const { error: updErr } = await serviceClient
        .from("team_reservations")
        .update({ payment_id: paymentId, expires_at: expiresAt.toISOString() })
        .in("id", reservationIds)
        .eq("user_id", userId)
        .eq("league_id", leagueId)
        .is("payment_id", null);
      if (updErr) console.error("mercado-pago-pix-bulk attach reservations error", updErr);
    } else {
      const itemsPayload = toChargeParticipantIds.map((participantId) => ({
        payment_id: paymentId,
        participant_id: participantId,
        round_number: body.round,
      }));

      const { error: itemsErr } = await serviceClient.from("payment_items").insert(itemsPayload);
      if (itemsErr) console.error("mercado-pago-pix-bulk insert items error", itemsErr);
    }

    return json(
      {
        paymentId,
        status,
        transactionId,
        pixCopyPaste,
        expiresAt: expiresAt.toISOString(),
        excludedParticipantIds: alreadyPaid,
        chargedParticipantIds: reservationIds.length > 0 ? [] : toChargeParticipantIds,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("mercado-pago-pix-bulk exception", e);
    return json({ error: "Erro interno" }, { status: 500 });
  }
});
