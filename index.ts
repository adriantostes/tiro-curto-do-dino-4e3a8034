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
    const externalReference = (mpJson?.external_reference as string | undefined) ?? null;

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data: updatedByTx, error } = await serviceClient
      .from("payments")
      .update({
        status,
        pix_copy_paste: pixCopyPaste ?? null,
        transaction_id: transactionId,
      })
      .eq("transaction_id", transactionId)
      .select("id");

    if (error) {
      console.error("mercado-pago-webhook update error", error);
    }

    if (!updatedByTx?.length && externalReference) {
      const { error: fallbackErr } = await serviceClient
        .from("payments")
        .update({
          status,
          pix_copy_paste: pixCopyPaste ?? null,
          transaction_id: transactionId,
        })
        .eq("external_reference", externalReference);

      if (fallbackErr) {
        console.error("mercado-pago-webhook fallback update error", fallbackErr);
      }
    }

    return json({ ok: true }, { status: 200 });
  } catch (e) {
    console.error("mercado-pago-webhook exception", e);
    // Always 200 to avoid retries storms; we rely on polling + later webhooks
    return json({ ok: false }, { status: 200 });
  }
});
