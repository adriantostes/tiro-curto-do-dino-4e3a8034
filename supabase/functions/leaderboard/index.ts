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
  round: number;
  leagueId?: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") ?? "";

    // User-scoped client (to identify caller)
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userErr } = await userClient.auth.getUser();
    if (userErr || !userData?.user) {
      return json({ error: "Não autenticado" }, { status: 401 });
    }

    const { round, leagueId } = (await req.json()) as Body;
    if (!round || round < 1) return json({ error: "Rodada inválida" }, { status: 400 });

    // Check if caller is paid for this round (reuses existing DB function)
    const { data: isPaid, error: paidErr } = await userClient.rpc("is_paid_user_for_round", {
      _user_id: userData.user.id,
      _round: round,
    });

    if (paidErr) {
      console.error("leaderboard paid check error", paidErr);
      return json({ error: "Falha ao validar pagamento" }, { status: 500 });
    }
    if (!isPaid) return json({ error: "Pagamento não aprovado para a rodada" }, { status: 403 });

    // Service client (to read all approved participants)
    const serviceClient = createClient(supabaseUrl, serviceKey);

    const { data: payments, error: payErr } = await serviceClient
      .from("payments")
      .select("participant_id")
      .eq("status", "approved")
      .eq("round_number", round)
      .not("participant_id", "is", null);

    if (payErr) {
      console.error("leaderboard payments error", payErr);
      return json({ error: "Falha ao carregar participantes pagos" }, { status: 500 });
    }

    const ids = Array.from(new Set((payments ?? []).map((p) => p.participant_id).filter(Boolean)));
    if (ids.length === 0) return json({ participants: [] }, { status: 200 });

    let query = serviceClient
      .from("participants")
      .select("id, team_name, team_slug, cartola_team_id, team_shield_url, league_id")
      .in("id", ids);

    if (leagueId) query = query.eq("league_id", leagueId);

    const { data: participants, error: partErr } = await query;
    if (partErr) {
      console.error("leaderboard participants error", partErr);
      return json({ error: "Falha ao carregar participantes" }, { status: 500 });
    }

    return json({ participants: participants ?? [] }, { status: 200 });
  } catch (e) {
    console.error("leaderboard exception", e);
    return json({ error: "Erro interno" }, { status: 500 });
  }
});
