// Liga do Dino – estrutura inicial (sem integração de pagamento por enquanto)

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { cartolaMarketStatus, cartolaSearchTeams, type CartolaTeamSearchItem } from "@/lib/cartola";

const Index = () => {
  const { toast } = useToast();
  const { user } = useSession();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CartolaTeamSearchItem | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);

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

  const searchQuery = useQuery({
    queryKey: ["cartola", "search", q],
    queryFn: () => cartolaSearchTeams(q),
    enabled: false,
  });

  async function handleSearch() {
    setSelected(null);
    setParticipantId(null);
    if (!q.trim()) {
      toast({ title: "Digite o nome do seu time" });
      return;
    }
    try {
      await searchQuery.refetch();
    } catch {
      toast({ title: "Falha ao buscar times" });
    }
  }

  async function handleConfirmTeam() {
    if (!user) {
      toast({ title: "Entre para continuar" });
      return;
    }
    if (!selected) return;
    if (!league?.id) {
      toast({ title: "Liga não configurada" });
      return;
    }

    const shield = selected.url_escudo_svg ?? selected.url_escudo_png ?? null;
    const payload = {
      user_id: user.id,
      league_id: league.id,
      team_name: selected.nome,
      team_slug: selected.slug ?? null,
      cartola_team_id: selected.time_id,
      team_shield_url: shield,
    };

    const { data, error } = await supabase
      .from("participants")
      .insert(payload)
      .select("id")
      .maybeSingle();

    if (error) {
      toast({ title: "Não consegui salvar seu time", description: error.message });
      return;
    }
    setParticipantId(data?.id ?? null);
    toast({ title: "Time confirmado", description: "Agora você pode simular o pagamento da rodada." });
  }

  async function handleSimulatePayment() {
    if (!user) return;
    if (!participantId) {
      toast({ title: "Confirme seu time primeiro" });
      return;
    }
    if (!currentRound) {
      toast({ title: "Não consegui detectar a rodada atual" });
      return;
    }

    const { error } = await supabase.from("payments").insert({
      user_id: user.id,
      participant_id: participantId,
      round_number: currentRound,
      amount_cents: 1000,
      status: "approved",
    });

    if (error) {
      toast({ title: "Falha ao simular pagamento", description: error.message });
      return;
    }

    toast({ title: "Pagamento aprovado (simulado)", description: "Ranking liberado para esta rodada." });
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary/15 ring-1 ring-border" aria-hidden />
          <div className="leading-tight">
            <p className="text-sm text-muted-foreground">Daily Fantasy • Cartola FC</p>
            <h1 className="text-xl font-semibold tracking-tight">Liga do Dino</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild>
              <Link to="/ranking">Ranking Ao Vivo</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link to="/auth">Entrar</Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <section className="grid gap-6 md:grid-cols-[1.3fr_0.7fr] md:items-stretch">
          <Card className="relative overflow-hidden p-8">
            <div className="pointer-events-none absolute inset-0 opacity-60 [background:radial-gradient(circle_at_20%_10%,hsl(var(--primary)/0.22),transparent_55%),radial-gradient(circle_at_90%_30%,hsl(var(--primary)/0.18),transparent_50%)]" />
            <div className="relative">
              <p className="text-sm text-muted-foreground">Ranking Ao Vivo • Tiro Curto</p>
              <h2 className="mt-2 text-4xl font-semibold tracking-tight md:text-5xl">
                Garanta sua vaga e brigue pelo topo.
              </h2>
              <p className="mt-4 max-w-2xl text-base text-muted-foreground">
                Fluxo completo para testar estrutura: busca de time via proxy + confirmação + pagamento simulado.
                O Ranking puxa os pontos ao vivo.
              </p>

              <div className="mt-6 grid gap-4">
                {!user ? (
                  <Card className="p-5">
                    <p className="text-sm text-muted-foreground">
                      Para testar o fluxo real (e liberar o ranking), você precisa entrar.
                    </p>
                    <div className="mt-3">
                      <Button asChild>
                        <Link to="/auth">Entrar / Criar conta</Link>
                      </Button>
                    </div>
                  </Card>
                ) : (
                  <Card className="p-5">
                    <div className="flex flex-col gap-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-medium">Buscar Time</p>
                          <p className="text-xs text-muted-foreground">
                            Rodada atual: {currentRound ?? "..."}
                          </p>
                        </div>
                        <Button variant="secondary" asChild>
                          <Link to="/ranking">Ir para o Ranking</Link>
                        </Button>
                      </div>

                      <Separator />

                      <div className="grid gap-2">
                        <Label htmlFor="team">Digite o nome do seu time</Label>
                        <div className="flex gap-2">
                          <Input
                            id="team"
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Ex: Dino FC"
                          />
                          <Button onClick={handleSearch} disabled={searchQuery.isFetching}>
                            Buscar
                          </Button>
                        </div>
                      </div>

                      {searchQuery.data?.length ? (
                        <div className="grid gap-2">
                          <p className="text-xs text-muted-foreground">Selecione seu time:</p>
                          <div className="grid gap-2">
                            {searchQuery.data.slice(0, 6).map((t) => (
                              <button
                                key={t.time_id}
                                type="button"
                                onClick={() => {
                                  setSelected(t);
                                  setParticipantId(null);
                                }}
                                className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left ring-1 transition ${
                                  selected?.time_id === t.time_id
                                    ? "bg-primary/10 ring-primary/30"
                                    : "bg-card ring-border hover:bg-muted/40"
                                }`}
                              >
                                <span className="min-w-0">
                                  <span className="block truncate text-sm font-medium">{t.nome}</span>
                                  <span className="block truncate text-xs text-muted-foreground">{t.nome_cartola}</span>
                                </span>
                                <span className="text-xs text-muted-foreground">Esse sou eu</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {selected ? (
                        <Card className="p-4">
                          <p className="text-sm font-medium">Confirme seu time</p>
                          <p className="mt-1 text-sm text-muted-foreground">
                            {selected.nome} • ID {selected.time_id}
                          </p>
                          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                            <Button onClick={handleConfirmTeam}>Confirmar</Button>
                            <Button variant="secondary" onClick={handleSimulatePayment} disabled={!participantId}>
                              Simular Pagamento (R$ 10,00)
                            </Button>
                          </div>
                          {!participantId ? (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Dica: primeiro confirme o time, depois simule o pagamento.
                            </p>
                          ) : (
                            <p className="mt-2 text-xs text-muted-foreground">
                              Pagamento simulado habilita o ranking para a rodada atual.
                            </p>
                          )}
                        </Card>
                      ) : null}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <h3 className="text-base font-semibold">Estrutura do fluxo</h3>
            <ol className="mt-4 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  1
                </span>
                <div>
                  <p className="font-medium">Buscar time</p>
                  <p className="text-muted-foreground">Busca via backend e lista de times.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  2
                </span>
                <div>
                  <p className="font-medium">Validar</p>
                  <p className="text-muted-foreground">Seleciona “Esse sou eu” e confirma.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  3
                </span>
                <div>
                  <p className="font-medium">Pagar Pix</p>
                  <p className="text-muted-foreground">Agora está como pagamento simulado para testes.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  4
                </span>
                <div>
                  <p className="font-medium">Ranking Ao Vivo</p>
                  <p className="text-muted-foreground">Tabela com destaque do Top 3.</p>
                </div>
              </li>
            </ol>
          </Card>
        </section>
      </main>
    </div>
  );
};

export default Index;
