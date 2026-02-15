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

function mpStatusToApp(status: string | null | undefined) {
  const s = String(status ?? "").toLowerCase();
  if (s === "approved") return "approved";
  if (s === "rejected" || s === "cancelled" || s === "refunded" || s === "charged_back") return "rejected";
  return "pending";
}

async function finalizeApprovedPayment(opts: { serviceClient: any; paymentId: string; userId: string; round: number }) {
  const { serviceClient, paymentId, userId, round } = opts;

  const { data: reservations, error: resErr } = await serviceClient
    .from("team_reservations")
    .select("id, league_id, cartola_team_id, team_name, team_slug, team_shield_url")
    .eq("payment_id", paymentId)
    .eq("user_id", userId);

  if (resErr) {
    console.error("webhook finalizeApprovedPayment reservations error", resErr);
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
    console.error("webhook finalizeApprovedPayment insert participants error", partErr);
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
    if (itemsErr) console.error("webhook finalizeApprovedPayment insert payment_items error", itemsErr);
  }

  const { error: delErr } = await serviceClient.from("team_reservations").delete().eq("payment_id", paymentId).eq("user_id", userId);
  if (delErr) console.error("webhook finalizeApprovedPayment delete reservations error", delErr);
}

type WebhookBody = {
  action?: string;
  type?: string;
  data?: { id?: number | string };
  id?: number | string;
};

/**
 * Public webhook endpoint.
 * We don't trust the payload alone: we fetch the payment details from Mercado Pago using our token.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN")!;

    const body = (await req.json().catch(() => ({}))) as WebhookBody;
    const paymentId = body?.data?.id ?? body?.id;

    if (!paymentId) {
      console.warn("mercado-pago-webhook: missing payment id", body);
      return json({ ok: true }, { status: 200 });
    }

    // Fetch authoritative payment status from Mercado Pago
    const mpRes = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
      headers: { Authorization: `Bearer ${mpAccessToken}` },
    });

    const mpJson = await mpRes.json().catch(() => null);
    if (!mpRes.ok) {
      console.error("mercado-pago-webhook fetch error", mpRes.status, mpJson);
      return json({ ok: false }, { status: 200 });
    }

    const status = mpStatusToApp(mpJson?.status);
    const transactionId = String(mpJson?.id ?? paymentId);
    const pixCopyPaste = mpJson?.point_of_interaction?.transaction_data?.qr_code as string | undefined;
    const externalReference = String(mpJson?.external_reference ?? "");

    const serviceClient = createClient(supabaseUrl, serviceKey);

    // Find the payment row in our DB (transaction_id preferred; fallback to external_reference)
    let paymentRow: any = null;
    {
      const { data } = await serviceClient
        .from("payments")
        .select("id, user_id, round_number, expires_at")
        .eq("transaction_id", transactionId)
        .limit(1)
        .maybeSingle();
      paymentRow = data ?? null;
    }
    if (!paymentRow && externalReference) {
      const { data } = await serviceClient
        .from("payments")
        .select("id, user_id, round_number, expires_at")
        .eq("external_reference", externalReference)
        .limit(1)
        .maybeSingle();
      paymentRow = data ?? null;
    }

    if (paymentRow?.id) {
      // Expire if late
      const expiresAt = paymentRow.expires_at ? new Date(String(paymentRow.expires_at)) : null;
      if (expiresAt && Date.now() > expiresAt.getTime() && status === "approved") {
        await serviceClient.from("payments").update({ status: "rejected" }).eq("id", paymentRow.id);
        await serviceClient.from("team_reservations").delete().eq("payment_id", paymentRow.id);
        return json({ ok: true }, { status: 200 });
      }

      await serviceClient
        .from("payments")
        .update({
          status,
          pix_copy_paste: pixCopyPaste ?? null,
          transaction_id: transactionId,
        })
        .eq("id", paymentRow.id);

      if (status === "approved") {
        await finalizeApprovedPayment({
          serviceClient,
          paymentId: String(paymentRow.id),
          userId: String(paymentRow.user_id),
          round: Number(paymentRow.round_number),
        });
      } else if (status === "rejected") {
        await serviceClient.from("team_reservations").delete().eq("payment_id", paymentRow.id);
      }
    } else {
      console.warn("mercado-pago-webhook: payment row not found for transaction/external_reference", {
        transactionId,
        externalReference,
      });
    }

    return json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("mercado-pago-webhook exception", e);
    // Always 200 to avoid retries storms; we rely on polling + later webhooks
    return json({ ok: false }, { status: 200 });
  }
});
