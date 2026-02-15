import { supabase } from "@/integrations/supabase/client";

export type CartolaTeamSearchItem = {
  time_id: number;
  nome: string;
  nome_cartola: string;
  slug: string;
  url_escudo_svg?: string;
  url_escudo_png?: string;
};

export async function cartolaMarketStatus() {
  const { data, error } = await supabase.functions.invoke("cartola-proxy", {
    body: { action: "market_status" },
  });
  if (error) throw error;
  return data as any;
}

export async function cartolaSearchTeams(q: string) {
  const { data, error } = await supabase.functions.invoke("cartola-proxy", {
    body: { action: "search_teams", q },
  });
  if (error) throw error;
  return (data as CartolaTeamSearchItem[]) ?? [];
}

export async function cartolaTeamScore(teamId: number, round?: number | null) {
  const { data, error } = await supabase.functions.invoke("cartola-proxy", {
    body: { action: "team_score", teamId, round: round ?? undefined },
  });
  if (error) throw error;
  return data as any;
}
