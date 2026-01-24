import { supabase } from "@/integrations/supabase/client";

export type LeaderboardParticipant = {
  id: string;
  team_name: string;
  team_slug: string | null;
  cartola_team_id: number;
  team_shield_url: string | null;
  league_id: string | null;
};

export async function fetchPaidParticipants(params: { round: number; leagueId?: string | null }) {
  const { data, error } = await supabase.functions.invoke("leaderboard", {
    body: {
      round: params.round,
      leagueId: params.leagueId ?? null,
    },
  });
  if (error) throw error;

  const participants = (data as any)?.participants as LeaderboardParticipant[] | undefined;
  return participants ?? [];
}
