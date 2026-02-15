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

type ReserveTeam = {
  cartola_team_id: number;
  team_name: string;
  team_slug?: string | null;
  team_shield_url?: string | null;
};

type Body =
  | { action: "reserve"; leagueId: string; team: ReserveTeam; ttlMinutes?: number }
  | { action: "release"; leagueId: string; cartolaTeamId: number }
  | { action: "list"; leagueId: string };

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
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

    const body = (await req.json().catch(() => ({}))) as Body;
    if (!body?.leagueId) return json({ error: "leagueId obrigatório" }, { status: 400 });

    // Best-effort cleanup: remove expired reservations that are not tied to a payment
    const now = new Date();
    await serviceClient
      .from("team_reservations")
      .delete()
      .eq("league_id", body.leagueId)
      .is("payment_id", null)
      .lt("expires_at", now.toISOString());

    if (body.action === "list") {
      const { data, error } = await userClient
        .from("team_reservations")
        .select("id, cartola_team_id, team_name, team_slug, team_shield_url, expires_at, payment_id")
        .eq("league_id", body.leagueId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ reservations: data ?? [] }, { status: 200 });
    }

    if (body.action === "release") {
      const { error } = await userClient
        .from("team_reservations")
        .delete()
        .eq("league_id", body.leagueId)
        .eq("user_id", userId)
        .eq("cartola_team_id", Number(body.cartolaTeamId))
        .is("payment_id", null);

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ ok: true }, { status: 200 });
    }

    if (body.action !== "reserve") return json({ error: "action inválida" }, { status: 400 });

    const ttlMinutes = Math.min(Math.max(Number(body.ttlMinutes ?? 10), 1), 60);
    const expiresAt = addMinutes(now, ttlMinutes).toISOString();

    const team = body.team;
    if (!team?.cartola_team_id || !team?.team_name) return json({ error: "team inválido" }, { status: 400 });

    // If the team is already a paid participant, block immediately
    const { data: taken, error: takenErr } = await serviceClient
      .from("participants")
      .select("id")
      .eq("league_id", body.leagueId)
      .eq("cartola_team_id", Number(team.cartola_team_id))
      .limit(1)
      .maybeSingle();

    if (takenErr) return json({ error: "Falha ao validar time" }, { status: 500 });
    if (taken?.id) {
      return json({ error: "Time já foi escolhido por outra pessoa." }, { status: 409 });
    }

    // Try to reserve
    const { data: inserted, error: insErr } = await userClient
      .from("team_reservations")
      .insert({
        user_id: userId,
        league_id: body.leagueId,
        cartola_team_id: Number(team.cartola_team_id),
        team_name: team.team_name,
        team_slug: team.team_slug ?? null,
        team_shield_url: team.team_shield_url ?? null,
        expires_at: expiresAt,
      })
      .select("id, expires_at")
      .maybeSingle();

    if (!insErr && inserted?.id) {
      return json({ reservationId: inserted.id, expiresAt: inserted.expires_at }, { status: 200 });
    }

    // If conflict (already reserved), check if it belongs to the same user and is still editable
    const { data: existing } = await serviceClient
      .from("team_reservations")
      .select("id, user_id, expires_at, payment_id")
      .eq("league_id", body.leagueId)
      .eq("cartola_team_id", Number(team.cartola_team_id))
      .limit(1)
      .maybeSingle();

    if (!existing?.id) {
      return json({ error: insErr?.message ?? "Não foi possível reservar" }, { status: 500 });
    }

    if (String(existing.user_id) === String(userId) && !existing.payment_id) {
      // extend reservation
      const { data: updated, error: updErr } = await userClient
        .from("team_reservations")
        .update({ expires_at: expiresAt, team_name: team.team_name, team_slug: team.team_slug ?? null, team_shield_url: team.team_shield_url ?? null })
        .eq("id", existing.id)
        .select("id, expires_at")
        .maybeSingle();
      if (updErr) return json({ error: updErr.message }, { status: 500 });
      return json({ reservationId: updated?.id ?? existing.id, expiresAt: updated?.expires_at ?? expiresAt }, { status: 200 });
    }

    return json({ error: "Time indisponível no momento. Tente outro." }, { status: 409 });
  } catch (e) {
    console.error("team-reserve exception", e);
    return json({ error: "Erro interno" }, { status: 500 });
  }
});

