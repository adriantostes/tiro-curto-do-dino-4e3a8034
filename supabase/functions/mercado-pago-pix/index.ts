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

type Body = {
  participantId: string;
  round: number;
};

function mpStatusToApp(status: string | null | undefined) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected" || s === "cancelled" || s === "refunded" || s === "charged_back") return "rejected";
  return "pending";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")!;

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "Não autenticado" }, { status: 401 });

    const body = (await req.json()) as Body;
    if (!body?.participantId) return json({ error: "participantId obrigatório" }, { status: 400 });
    if (!body?.round || body.round < 1) return json({ error: "Rodada inválida" }, { status: 400 });

    // Validate participant belongs to user
    const { data: participant, error: partErr } = await userClient
      .from("participants")
      .select("id, team_name")
      .eq("id", body.participantId)
      .maybeSingle();

    if (partErr) return json({ error: "Falha ao validar participante" }, { status: 500 });
    if (!participant) return json({ error: "Participante não encontrado" }, { status: 404 });

    // Optional: if there's already a pending payment for this user/round, return it
    const { data: existing } = await userClient
      .from("payments")
      .select("id, status, transaction_id, pix_copy_paste")
      .eq("participant_id", body.participantId)
      .eq("round_number", body.round)
      .in("status", ["pending", "approved"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existing?.id && existing.transaction_id && existing.pix_copy_paste) {
      return json(
        {
          paymentId: existing.id,
          status: existing.status,
          transactionId: existing.transaction_id,
          pixCopyPaste: existing.pix_copy_paste,
        },
        { status: 200 }
      );
    }

    const amount = 10; // R$ 10,00
    const externalReference = `tiro-curto-do-dino:${userData.user.id}:${body.participantId}:${body.round}`;

    // Create PIX payment in Mercado Pago
    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_amount: amount,
        description: `Tiro Curto do Dino • Rodada ${body.round} • ${participant.team_name}`,
        payment_method_id: "pix",
        payer: {
          email: userData.user.email ?? `user-${userData.user.id}@tiro-curto-do-dino.local`,
        },
        external_reference: externalReference,
      }),
    });

    const mpJson = await mpRes.json().catch(() => null);
    if (!mpRes.ok) {
      console.error("mercado-pago-pix create error", mpRes.status, mpJson);
      return json({ error: "Falha ao criar pagamento PIX" }, { status: 502 });
    }

    const transactionId = String(mpJson?.id ?? "");
    const pixCopyPaste = mpJson?.point_of_interaction?.transaction_data?.qr_code as string | undefined;
    const status = mpStatusToApp(mpJson?.status);

    if (!transactionId || !pixCopyPaste) {
      console.error("mercado-pago-pix missing fields", mpJson);
      return json({ error: "Resposta inválida do Mercado Pago" }, { status: 502 });
    }

    // Store reference in DB (NO base64 images in DB)
    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data: inserted, error: insErr } = await serviceClient
      .from("payments")
      .insert({
        user_id: userData.user.id,
        participant_id: body.participantId,
        round_number: body.round,
        amount_cents: 1000,
        status,
        transaction_id: transactionId,
        pix_copy_paste: pixCopyPaste,
      })
      .select("id")
      .maybeSingle();

    if (insErr) {
      console.error("mercado-pago-pix insert error", insErr);
      return json({ error: "Falha ao salvar pagamento" }, { status: 500 });
    }

    return json(
      {
        paymentId: inserted?.id,
        status,
        transactionId,
        pixCopyPaste,
      },
      { status: 200 }
    );
  } catch (e) {
    console.error("mercado-pago-pix exception", e);
    return json({ error: "Erro interno" }, { status: 500 });
  }
});
