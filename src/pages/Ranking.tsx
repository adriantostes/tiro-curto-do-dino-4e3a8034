import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { cartolaMarketStatus, cartolaTeamScore } from "@/lib/cartola";
import { extractCartolaTeamPoints } from "@/lib/cartolaPoints";
import { fetchPaidParticipants, type LeaderboardParticipant } from "@/lib/leaderboard";

function podiumClass(index: number) {
  // Sem cores hardcoded: usa tokens semânticos
  if (index === 0) return "bg-primary/10 ring-1 ring-primary/30";
  if (index === 1) return "bg-muted/60 ring-1 ring-border";
  if (index === 2) return "bg-accent/20 ring-1 ring-border";
  return "bg-card ring-1 ring-border";
}

type LiveEntry = {
  participant: LeaderboardParticipant;
  points: number;
};

const Ranking = () => {
  const { user } = useSession();

  const { data: market } = useQuery({
    queryKey: ["cartola", "market_status"],
    queryFn: cartolaMarketStatus,
    staleTime: 60_000,
    enabled: !!user,
  });

  const currentRound = useMemo(() => {
    const r = Number((market as any)?.rodada_atual ?? (market as any)?.rodadaAtual);
    return Number.isFinite(r) && r > 0 ? r : null;
  }, [market]);

  const { data: league } = useQuery({
    queryKey: ["leagues", "active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("leagues").select("id,name").limit(1).maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
  });

  const participantsQuery = useQuery({
    queryKey: ["leaderboard", "participants", currentRound, league?.id],
    queryFn: async () => {
      if (!currentRound) return [];
      return await fetchPaidParticipants({ round: currentRound, leagueId: league?.id ?? null });
    },
    enabled: !!user && !!currentRound,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const scoresQuery = useQuery({
    queryKey: ["leaderboard", "scores", currentRound, league?.id, participantsQuery.data?.map((p) => p.id).join(",")],
    queryFn: async () => {
      const participants = participantsQuery.data ?? [];
      if (!currentRound || participants.length === 0) return [] as LiveEntry[];

      const results = await Promise.all(
        participants.map(async (p): Promise<LiveEntry> => {
          try {
            const score = await cartolaTeamScore(Number(p.cartola_team_id));
            const points = extractCartolaTeamPoints(score);
            return { participant: p, points };
          } catch {
            return { participant: p, points: 0 };
          }
        })
      );

      return results.sort((a, b) => b.points - a.points);
    },
    enabled: !!user && !!currentRound && (participantsQuery.data?.length ?? 0) > 0,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="leading-tight">
          <p className="text-sm text-muted-foreground">Ranking Ao Vivo</p>
          <h1 className="text-2xl font-semibold tracking-tight">{league?.name ?? "Liga do Dino"}</h1>
        </div>
        <Button variant="secondary" asChild>
          <Link to="/">Voltar</Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <Card className="overflow-hidden">
          <div className="flex flex-col gap-2 p-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-lg font-semibold">Ranking Ao Vivo</h2>
              <p className="text-sm text-muted-foreground">
                Rodada: {currentRound ?? "..."} • Atualiza automaticamente a cada 60s.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  participantsQuery.refetch();
                  scoresQuery.refetch();
                }}
                disabled={participantsQuery.isFetching || scoresQuery.isFetching}
              >
                Atualizar agora
              </Button>
            </div>
          </div>

          <Separator />

          <div className="p-6">
            <div className="grid grid-cols-[60px_1fr_100px] gap-3 text-xs text-muted-foreground">
              <div>POS</div>
              <div>TIME</div>
              <div className="text-right">PONTOS</div>
            </div>

            <div className="mt-3 space-y-3">
              {scoresQuery.isLoading ? (
                <Card className="p-4">
                  <p className="text-sm text-muted-foreground">Carregando ranking…</p>
                </Card>
              ) : (scoresQuery.data?.length ?? 0) === 0 ? (
                <Card className="p-4">
                  <p className="text-sm font-medium">Sem participantes pagos nesta rodada</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Volte para a Home, confirme o time e simule o pagamento para liberar o ranking.
                  </p>
                </Card>
              ) : null}

              {(scoresQuery.data ?? []).map((entry, idx) => (
                <div
                  key={`${entry.participant.id}-${idx}`}
                  className={`grid grid-cols-[60px_1fr_100px] items-center gap-3 rounded-xl px-4 py-3 ${podiumClass(
                    idx
                  )}`}
                >
                  <div className="text-sm font-semibold tabular-nums">#{idx + 1}</div>

                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
                      {entry.participant.team_shield_url ? (
                        <img
                          src={entry.participant.team_shield_url}
                          alt={`Escudo ${entry.participant.team_name}`}
                          loading="lazy"
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div
                          className="h-full w-full [background:radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.18),transparent_60%)]"
                          aria-hidden
                        />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{entry.participant.team_name}</p>
                      <p className="text-xs text-muted-foreground">ID Cartola: {entry.participant.cartola_team_id}</p>
                    </div>
                  </div>

                  <div className="text-right text-sm font-semibold tabular-nums">
                    {Number(entry.points ?? 0).toFixed(2)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </main>
    </div>
  );
};

export default Ranking;
