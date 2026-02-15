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

  // rodada_atual da API do Cartola = a rodada que o mercado está vendendo.
  // Pagamentos são registrados com round_number = rodada_atual.
  // currentRound: usado para buscar participantes pagos (deve bater com o round_number do pagamento).
  const currentRound = useMemo(() => {
    const r = Number((market as any)?.rodada_atual ?? (market as any)?.rodadaAtual);
    return Number.isFinite(r) && r > 0 ? r : null;
  }, [market]);

  // scoreRound: a rodada cujos PONTOS devemos buscar na API do Cartola.
  // Quando o mercado está aberto e a bola NÃO está rolando, a rodada_atual ainda não foi jogada.
  // Nesse caso, buscamos os pontos da rodada ANTERIOR (a última que foi jogada).
  // Regra:
  //   - bola_rolando = true  → pontos ao vivo da rodada_atual
  //   - mercado aberto (status 1/2) + bola parada → rodada_atual - 1 (última jogada)
  //   - mercado fechado (status 6) + bola parada → rodada_atual (já encerrada)
  const scoreRound = useMemo(() => {
    const r = Number((market as any)?.rodada_atual ?? (market as any)?.rodadaAtual);
    if (!Number.isFinite(r) || r < 1) return null;

    const bolaRolando = Boolean((market as any)?.bola_rolando ?? (market as any)?.bolaRolando);
    const statusMercado = Number((market as any)?.status_mercado ?? (market as any)?.statusMercado ?? 0);

    if (bolaRolando) return r;

    if (statusMercado === 1 || statusMercado === 2) {
      return r > 1 ? r - 1 : r;
    }

    return r;
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
    queryKey: ["leaderboard", "scores", scoreRound, leagueId, paidInfo.participants.map((p) => p.id).join(",")],
    queryFn: async () => {
      const participants = paidInfo.participants;
      if (!scoreRound || participants.length === 0) return [] as LiveEntry[];

      // OTIMIZAÇÃO: Processa em batches paralelos para evitar sobrecarga
      const BATCH_SIZE = 8;
      const batches: LiveEntry[] = [];

      for (let i = 0; i < participants.length; i += BATCH_SIZE) {
        const chunk = participants.slice(i, i + BATCH_SIZE);
        const chunkResults = await Promise.all(
          chunk.map(async (p): Promise<LiveEntry> => {
            try {
              const score = await cartolaTeamScore(Number(p.cartola_team_id), scoreRound);
              const points = extractCartolaTeamPoints(score);
              return { participant: p, points: Number.isFinite(points) ? points : 0 };
            } catch (err) {
              console.warn(`Falha ao buscar pontos do time ${p.cartola_team_id}:`, err);
              return { participant: p, points: 0 };
            }
          })
        );
        batches.push(...chunkResults);
      }

      return batches.sort((a, b) => b.points - a.points);
    },
    enabled: !!scoreRound && paidInfo.paid && paidInfo.participants.length > 0,
    staleTime: 30_000, // Cache ainda mais agressivo (30s) - reduz refetches
    refetchInterval: 45_000, // Polling mais leve (45s)
    gcTime: 600_000, // Mantém dados em cache por 10min
    placeholderData: (previousData) => previousData, // Mostra dados anteriores enquanto atualiza
  });

  const publicEntries = useMemo(() => {
    // Quando não está pago (ou não está logado), mostramos só a lista, sem pontuação.
    const sorted = [...paidInfo.participants].sort((a, b) => a.team_name.localeCompare(b.team_name));
    return sorted;
  }, [paidInfo.participants]);

  // Mescla participantes com pontuações quando disponíveis
  const displayEntries = useMemo(() => {
    if (!paidInfo.paid) {
      // Modo público: lista alfabética sem pontos
      return publicEntries.map((p) => ({ participant: p, points: 0 }));
    }

    if (scoresQuery.isLoading && !scoresQuery.data) {
      // Primeira carga: mostra participantes com pontos em 0 (skeleton)
      return paidInfo.participants.map((p) => ({ participant: p, points: 0 }));
    }

    // Dados carregados: mostra pontuação real
    return scoresQuery.data ?? [];
  }, [paidInfo.paid, paidInfo.participants, publicEntries, scoresQuery.data, scoresQuery.isLoading]);

  return (
    <div className="min-h-screen bg-[#060606] text-white font-sans">
      {/* Top Bar estilo Bet365/Betano (Consistente com a Index) */}
      <header className="sticky top-0 z-50 w-full bg-[#0a0a0a] border-b border-white/5 shadow-2xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="flex items-center gap-2 group">
              <div className="relative h-9 w-9 bg-primary flex items-center justify-center rounded-br-xl rounded-tl-xl transform -skew-x-12 shadow-[0_0_20px_rgba(34,197,94,0.4)]">
                <svg viewBox="0 0 24 24" className="h-6 w-6 text-black fill-current transform skew-x-12" xmlns="http://www.w3.org/2000/svg">
                  <path d="M22,10V6.5c0-1.93-1.57-3.5-3.5-3.5H5.5C3.57,3,2,4.57,2,6.5V10c1.1,0,2,0.9,2,2s-0.9,2-2,2v3.5c0,1.93,1.57,3.5,3.5,3.5h13 c1.93,0,3.5-1.57,3.5-3.5V14c-1.1,0-2-0.9-2-2S20.9,10,22,10z M11,17h-2v-2h2V17z M11,13h-2v-2h2V13z M11,9h-2V7h2V9z M16,17h-2v-2h2 V17z M16,13h-2v-2h2V13z M16,9h-2V7h2V9z"/>
                </svg>
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-[10px] sm:text-xs font-black italic tracking-tight text-white/90">
                  MELHOR DA
                </span>
                <span className="text-[10px] sm:text-xs font-black italic tracking-tight text-primary">
                  RODADA DO DINO
                </span>
              </div>
            </Link>
          </div>

          <Button variant="ghost" asChild className="text-xs font-bold text-gray-400 hover:text-white">
            <Link to="/">VOLTAR</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 ring-1 ring-primary/30 mb-3">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary"></span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">Live Leaderboard</span>
            </div>
            <h2 className="text-3xl font-black uppercase italic tracking-tighter sm:text-4xl">RANKING AO VIVO</h2>
            <p className="text-sm font-bold text-gray-500 uppercase tracking-tight">
              Rodada: <span className="text-white">#{currentRound ?? "--"}</span>
              {scoreRound && scoreRound !== currentRound && (
                <> • Pontos da Rodada <span className="text-primary">#{scoreRound}</span></>
              )}
              {scoreRound && scoreRound === currentRound && <> • Atualização Instantânea</>}
            </p>
          </div>
          <Button
            onClick={() => {
              void participantsQuery.refetch().catch(() => undefined);
              void scoresQuery.refetch().catch(() => undefined);
            }}
            disabled={participantsQuery.isFetching || scoresQuery.isFetching}
            className="bg-[#1a1a1a] border border-white/10 hover:bg-[#222] text-xs font-black uppercase italic tracking-widest h-12 px-8"
          >
            {participantsQuery.isFetching || scoresQuery.isFetching ? "ATUALIZANDO..." : "ATUALIZAR AGORA"}
          </Button>
        </div>

        <div className="grid gap-6">
          {!paidInfo.paid && participantsQuery.isSuccess && (
            <Card className="bg-gradient-to-br from-[#1a1a1a] to-[#0a0a0a] border-primary/20 p-8 text-center ring-1 ring-primary/20">
              <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/30">
                <svg className="h-8 w-8 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <h3 className="text-xl font-black uppercase italic mb-2">PONTUAÇÃO BLOQUEADA</h3>
              <p className="mx-auto max-w-md text-sm font-bold text-gray-500 uppercase leading-relaxed mb-6">
                A lista de participantes é pública, mas a pontuação ao vivo só aparece para quem pagou a rodada.
              </p>
              
              <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
                {user ? (
                  <Button
                    onClick={() => void reconcilePendingPayment()}
                    disabled={reconciling}
                    variant="outline"
                    className="border-white/10 text-xs font-black uppercase h-12 px-8 italic"
                  >
                    JÁ PAGUEI • VERIFICAR
                  </Button>
                ) : null}
                <Button asChild className="bg-primary text-black font-black hover:bg-primary/90 h-12 px-8 uppercase italic tracking-widest shadow-[0_0_20px_rgba(34,197,94,0.3)]">
                  <Link to="/">GERAR PIX AGORA</Link>
                </Button>
              </div>
              
              {user && lastPendingPaymentId && (
                <p className="mt-4 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
                  Pagamento pendente detectado: <span className="text-primary">{lastPendingPaymentId}</span>
                </p>
              )}
            </Card>
          )}

          <div className="space-y-3">
            {/* Header da Tabela */}
            <div className="grid grid-cols-[60px_minmax(0,1fr)_100px] gap-4 px-6 text-[10px] font-black uppercase tracking-[0.2em] text-gray-600 sm:grid-cols-[80px_minmax(0,1fr)_140px]">
              <div>POS</div>
              <div>TIME / COMPETIDOR</div>
              <div className="text-right">PONTOS</div>
            </div>

            {participantsQuery.isLoading ? (
              <div className="flex items-center justify-center py-20">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              </div>
            ) : displayEntries.length === 0 ? (
              <Card className="bg-[#121212] border-white/5 py-16 text-center">
                <p className="text-sm font-bold text-gray-600 uppercase tracking-widest">Nenhum participante nesta rodada</p>
              </Card>
            ) : (
              displayEntries.map((entry, idx) => {
                const isFirst = idx === 0;
                const isSecond = idx === 1;
                const isThird = idx === 2;
                const isLoadingPoints = paidInfo.paid && scoresQuery.isLoading && !scoresQuery.data;

                return (
                  <div
                    key={`${entry.participant.id}-${idx}`}
                    className={`group relative grid grid-cols-[60px_minmax(0,1fr)_100px] items-center gap-4 rounded-xl border p-4 transition-all hover:scale-[1.01] sm:grid-cols-[80px_minmax(0,1fr)_140px] ${
                      isFirst 
                      ? "bg-gradient-to-r from-primary/20 to-transparent border-primary/40 ring-1 ring-primary/20" 
                      : "bg-[#121212] border-white/5 hover:bg-[#1a1a1a] hover:border-white/10"
                    }`}
                  >
                    <div className="flex flex-col items-start pl-2">
                      <span className={`text-2xl font-black italic italic leading-none ${isFirst ? "text-primary" : "text-white/40"}`}>
                        #{idx + 1}
                      </span>
                      {isFirst && <span className="mt-1 text-[8px] font-black text-primary uppercase tracking-tighter">Leader</span>}
                    </div>

                    <div className="flex items-center gap-4">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-black/40 p-2 ring-1 ring-white/10">
                        {entry.participant.team_shield_url ? (
                          <img
                            src={entry.participant.team_shield_url}
                            alt=""
                            className="h-full w-full object-contain"
                          />
                        ) : (
                          <div className="h-full w-full bg-gradient-to-br from-white/5 to-white/10" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className={`truncate text-sm font-black uppercase italic ${isFirst ? "text-primary" : "text-white"}`}>
                          {entry.participant.team_name}
                        </p>
                        <p className="truncate text-[10px] font-bold uppercase text-gray-500 tracking-tight">
                          ID: {entry.participant.cartola_team_id}
                        </p>
                      </div>
                    </div>

                    <div className="text-right">
                      {!paidInfo.paid ? (
                        <span className="text-xl font-black text-white/10 italic">LOCKED</span>
                      ) : isLoadingPoints ? (
                        <div className="flex justify-end">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        </div>
                      ) : (
                        <div className={`text-2xl font-black italic leading-none ${isFirst ? "text-primary drop-shadow-[0_0_10px_rgba(34,197,94,0.4)]" : "text-white"}`}>
                          <AnimatedNumber value={Number(entry.points ?? 0)} decimals={2} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </main>

      {/* Footer consistente com a Home */}
      <footer className="mt-12 bg-[#060606] border-t border-white/5 py-12 px-4 text-center">
        <div className="max-w-7xl mx-auto flex flex-col items-center gap-6">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 bg-primary/20 rounded-sm flex items-center justify-center">
              <div className="h-3 w-3 bg-primary rounded-full"></div>
            </div>
            <span className="text-sm font-black italic tracking-tighter text-white">
              MELHOR DA RODADA DO <span className="text-primary">DINO</span>
            </span>
          </div>
          <p className="text-[10px] font-black uppercase text-gray-700 tracking-[0.4em]">© 2026 MELHOR DA RODADA DO DINO</p>
        </div>
      </footer>
    </div>
  );
};

export default Ranking;
