import { Link } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { AnimatedNumber } from "@/components/AnimatedNumber";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/useSession";
import { cartolaMarketStatus, cartolaTeamScore } from "@/lib/cartola";
import { extractCartolaTeamPoints } from "@/lib/cartolaPoints";
import { fetchPaidParticipants, type LeaderboardParticipant } from "@/lib/leaderboard";
import { supabase } from "@/integrations/supabase/client";

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

function isPaidResponse(data: any): data is { paid: boolean; participants: LeaderboardParticipant[] } {
  return data && typeof data === "object" && typeof data.paid === "boolean" && Array.isArray(data.participants);
}

const Ranking = () => {
  const { user } = useSession();
  const { toast } = useToast();
  const [reconciling, setReconciling] = useState(false);
  const [lastPendingPaymentId, setLastPendingPaymentId] = useState<string | null>(null);
  const hasAutoReconciledRef = useRef(false);

  const { data: market } = useQuery({
    queryKey: ["cartola", "market_status"],
    queryFn: cartolaMarketStatus,
    staleTime: 60_000,
    enabled: true,
  });

  const currentRound = useMemo(() => {
    const r = Number((market as any)?.rodada_atual ?? (market as any)?.rodadaAtual);
    return Number.isFinite(r) && r > 0 ? r : null;
  }, [market]);

  // A liga é opcional aqui. Para permitir acesso público, evitamos depender da leitura do banco
  // (que pode exigir login). Se você quiser filtrar por liga no futuro, podemos reintroduzir isso.
  const leagueId: string | null = null;

  const participantsQuery = useQuery({
    queryKey: ["leaderboard", "participants", currentRound, leagueId],
    queryFn: async () => {
      if (!currentRound) return { paid: false, participants: [] };
      return await fetchPaidParticipants({ round: currentRound, leagueId });
    },
    enabled: !!currentRound,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const paidInfo = useMemo(() => {
    if (!participantsQuery.data) return { paid: false, participants: [] as LeaderboardParticipant[] };
    if (isPaidResponse(participantsQuery.data)) return participantsQuery.data;
    // safety fallback (shouldn't happen)
    return { paid: false, participants: [] as LeaderboardParticipant[] };
  }, [participantsQuery.data]);

  async function reconcilePendingPayment() {
    if (!user || !currentRound) return;
    setReconciling(true);
    try {
      // 1) Pega o pagamento mais recente que ainda não está aprovado (RLS limita ao próprio usuário)
      const { data: pending, error: pendingErr } = await supabase
        .from("payments")
        .select("id,status")
        .eq("user_id", user.id)
        .eq("round_number", currentRound)
        .neq("status", "approved")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pendingErr) {
        toast({ title: "Falha ao checar pagamento", description: pendingErr.message });
        return;
      }

      if (!pending?.id) {
        setLastPendingPaymentId(null);
        return;
      }

      setLastPendingPaymentId(String(pending.id));

      // 2) Força refresh no backend (consulta o provedor e atualiza status/pix no banco)
      const { data, error } = await supabase.functions.invoke("mercado-pago-pix-bulk", {
        body: { paymentId: String(pending.id), round: currentRound },
      });

      if (error) {
        toast({ title: "Falha ao verificar no provedor", description: error.message });
        return;
      }

      const nextStatus = String((data as any)?.status ?? pending.status ?? "pending");
      if (nextStatus === "approved") {
        toast({ title: "PAGAMENTO CONFIRMADO", description: "Acesso liberado para a rodada." });
      } else {
        toast({ title: "Pagamento ainda pendente", description: "Se você acabou de pagar, pode levar alguns segundos." });
      }

      await participantsQuery.refetch();
    } finally {
      setReconciling(false);
    }
  }

  // Auto-reconcilia 1x ao abrir o ranking logado (evita depender só de webhook)
  useEffect(() => {
    if (!user || !currentRound) return;
    if (!participantsQuery.isSuccess) return;
    if (paidInfo.paid) return;
    if (hasAutoReconciledRef.current) return;
    hasAutoReconciledRef.current = true;
    void reconcilePendingPayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentRound, participantsQuery.isSuccess, paidInfo.paid]);

  const scoresQuery = useQuery({
    queryKey: ["leaderboard", "scores", currentRound, leagueId, paidInfo.participants.map((p) => p.id).join(",")],
    queryFn: async () => {
      const participants = paidInfo.participants;
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
    enabled: !!currentRound && paidInfo.paid && paidInfo.participants.length > 0,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const publicEntries = useMemo(() => {
    // Quando não está pago (ou não está logado), mostramos só a lista, sem pontuação.
    const sorted = [...paidInfo.participants].sort((a, b) => a.team_name.localeCompare(b.team_name));
    return sorted;
  }, [paidInfo.participants]);

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="leading-tight">
          <p className="text-xs tracking-wide text-muted-foreground">Dashboard • Ranking Ao Vivo</p>
          <h1 className="font-display text-2xl font-semibold tracking-[0.22em]">RANKING AO VIVO</h1>
        </div>
        <Button variant="secondary" asChild className="rounded-none cut-corners skew-wrap">
          <Link to="/">
            <span className="skew-inner">VOLTAR</span>
          </Link>
        </Button>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <Card className="glass-noise glass-glow stadium-glow scanlines cut-corners overflow-hidden rounded-3xl animate-enter">
          <div className="flex flex-col gap-2 p-6 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-display text-xl font-semibold tracking-[0.18em]">RANKING AO VIVO</h2>
              <p className="text-sm text-muted-foreground">Rodada: {currentRound ?? "..."} • Auto-refresh 60s.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                className="rounded-none cut-corners skew-wrap"
                onClick={() => {
                  void participantsQuery.refetch().catch(() => undefined);
                  void scoresQuery.refetch().catch(() => undefined);
                }}
                disabled={participantsQuery.isFetching || scoresQuery.isFetching}
              >
                <span className="skew-inner">ATUALIZAR AGORA</span>
              </Button>
            </div>
          </div>

          <Separator />

          <div className="p-6">
            {participantsQuery.isSuccess && !paidInfo.paid ? (
              <Card className="glass-noise scanlines cut-corners rounded-2xl p-5">
                <p className="font-display text-base font-semibold tracking-[0.12em]">PONTUAÇÃO BLOQUEADA</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  A lista de participantes é pública, mas a pontuação ao vivo só aparece para quem pagou a rodada.
                  {user ? "" : " Entre/crie uma conta para participar."}
                </p>
                {user ? (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <Button
                      variant="secondary"
                      className="rounded-none cut-corners skew-wrap"
                      onClick={() => void reconcilePendingPayment()}
                      disabled={reconciling}
                    >
                      <span className="skew-inner">JÁ PAGUEI • VERIFICAR</span>
                    </Button>
                    {lastPendingPaymentId ? (
                      <p className="text-xs text-muted-foreground">
                        Pagamento pendente detectado: <span className="text-foreground">{lastPendingPaymentId}</span>
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">Nenhum pagamento pendente encontrado nesta rodada.</p>
                    )}
                  </div>
                ) : null}
                <div className="mt-4">
                  <Button asChild className="rounded-none cut-corners skew-wrap animate-neon-pulse">
                    <Link to="/">
                      <span className="skew-inner">GERAR PIX AGORA</span>
                    </Link>
                  </Button>
                </div>
              </Card>
            ) : null}

            <div className="grid grid-cols-[70px_1fr_120px] gap-3 text-xs text-muted-foreground tracking-[0.18em]">
              <div>POS</div>
              <div>TIME</div>
              <div className="text-right">PONTOS</div>
            </div>

            <div className="mt-4 space-y-3">
              {paidInfo.paid && scoresQuery.isLoading ? (
                <Card className="glass-noise scanlines cut-corners rounded-2xl p-4">
                  <p className="text-sm text-muted-foreground">Carregando ranking…</p>
                </Card>
              ) : paidInfo.paid && (scoresQuery.data?.length ?? 0) === 0 ? (
                <Card className="glass-noise scanlines cut-corners rounded-2xl p-4">
                  <p className="text-sm font-medium">Sem participantes pagos nesta rodada</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Volte para a Home, selecione seu time e clique em “QUERO PARTICIPAR”.
                  </p>
                </Card>
              ) : !paidInfo.paid && (publicEntries.length ?? 0) === 0 ? (
                <Card className="glass-noise scanlines cut-corners rounded-2xl p-4">
                  <p className="text-sm font-medium">Ainda não há participantes nesta rodada</p>
                </Card>
              ) : null}

              {(paidInfo.paid ? (scoresQuery.data ?? []) : publicEntries.map((p) => ({ participant: p, points: 0 })))
                .map((entry, idx) => (
                <div
                  key={`${entry.participant.id}-${idx}`}
                  className={`glass-noise scanlines cut-corners grid grid-cols-[70px_1fr_120px] items-center gap-3 rounded-2xl px-4 py-3 transition hover:translate-y-[-1px] ${podiumClass(
                    idx
                  )}`}
                >
                  <div className="flex items-center gap-2">
                    <div className="text-sm font-semibold tabular-nums">#{idx + 1}</div>
                    <span
                      className={`inline-flex h-6 items-center rounded-full px-2 text-[10px] font-semibold tracking-wide ring-1 ${
                        idx === 0
                          ? "bg-primary/15 text-foreground ring-primary/30"
                          : idx === 1
                            ? "bg-muted/70 text-muted-foreground ring-border"
                            : idx === 2
                              ? "bg-accent/15 text-foreground ring-border"
                              : "bg-muted/40 text-muted-foreground ring-border"
                      }`}
                    >
                      {idx === 0 ? "GOLD" : idx === 1 ? "SILVER" : idx === 2 ? "BRONZE" : ""}
                    </span>
                  </div>

                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-xl bg-muted ring-1 ring-border">
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
                      <p className="truncate text-sm font-semibold">{entry.participant.team_name}</p>
                      <p className="text-xs text-muted-foreground">ID Cartola: {entry.participant.cartola_team_id}</p>
                    </div>
                  </div>

                  <div className="text-right text-lg font-semibold tabular-nums text-glow">
                    {paidInfo.paid ? <AnimatedNumber value={Number(entry.points ?? 0)} decimals={2} /> : <span>—</span>}
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
