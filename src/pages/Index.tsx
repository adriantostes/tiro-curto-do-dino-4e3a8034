// Liga do Dino – estrutura inicial (sem integração de pagamento por enquanto)

import { Link, useNavigate } from "react-router-dom";
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
import dinoHero from "@/assets/dino-hero-cutout.png";
import { useChromaKeyImage } from "@/hooks/useChromaKeyImage";

const Index = () => {
  const { toast } = useToast();
  const { user } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CartolaTeamSearchItem | null>(null);
  const [participantId, setParticipantId] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const { src: dinoSrc } = useChromaKeyImage(dinoHero, {
    // remove black-ish background when the asset doesn't ship with alpha
    key: { r: 0, g: 0, b: 0 },
    threshold: 28,
    feather: 54,
  });

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

  async function handleJoin() {
    if (!user) {
      toast({ title: "Entre para continuar" });
      navigate("/auth");
      return;
    }
    if (!selected) {
      toast({ title: "Selecione seu time primeiro" });
      return;
    }
    if (!currentRound) {
      toast({ title: "Não consegui detectar a rodada atual" });
      return;
    }

    setJoining(true);
    try {
      if (!participantId) {
        await handleConfirmTeam();
      }
      // handleConfirmTeam setState is async; buscamos participantId da DB se ainda não estiver no state
      let pid = participantId;
      if (!pid) {
        const { data } = await supabase
          .from("participants")
          .select("id")
          .eq("user_id", user.id)
          .eq("cartola_team_id", selected.time_id)
          .limit(1)
          .maybeSingle();
        pid = data?.id ?? null;
        setParticipantId(pid);
      }
      if (!pid) {
        toast({ title: "Não consegui confirmar seu time" });
        return;
      }

      const { error } = await supabase.from("payments").insert({
        user_id: user.id,
        participant_id: pid,
        round_number: currentRound,
        amount_cents: 1000,
        status: "approved",
      });
      if (error) {
        toast({ title: "Falha ao simular pagamento", description: error.message });
        return;
      }

      toast({ title: "Vaga garantida (simulado)", description: "Ranking liberado para esta rodada." });
      navigate("/ranking");
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 ring-1 ring-primary/25">
            <div className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden />
          </div>
          <div className="leading-tight">
            <p className="text-xs tracking-wide text-muted-foreground">Daily Fantasy • Cartola FC</p>
            <p className="font-display text-lg font-semibold tracking-widest">LIGA DO DINO</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild>
              <Link to="/ranking">RANKING AO VIVO</Link>
            </Button>
          ) : (
            <Button asChild>
              <Link to="/auth">ENTRAR</Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-6 pb-16">
        <section className="relative overflow-visible rounded-3xl p-6 md:p-10 glass glass-glow animate-enter">
          <div
            className="pointer-events-none absolute inset-0 opacity-70 [background:radial-gradient(80%_55%_at_15%_15%,hsl(var(--primary)/0.24),transparent_60%),radial-gradient(60%_50%_at_85%_25%,hsl(var(--primary)/0.18),transparent_55%)]"
            aria-hidden
          />

            <div className="relative grid gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-center">
            <header>
              <h1 className="font-display text-5xl font-bold leading-[0.95] tracking-widest md:text-6xl">
                LIGA DO DINO
              </h1>
              <p className="mt-4 max-w-xl text-base text-muted-foreground">
                Selecione seu time, garanta sua vaga e acompanhe o <span className="text-foreground">Ranking Ao Vivo</span>
                em tempo real.
              </p>

              <div className="mt-7 grid gap-3">
                <Label htmlFor="team" className="text-sm">
                  Digite o nome do seu time
                </Label>
                <div className="flex flex-col gap-3 sm:flex-row">
                  <div className="glass w-full rounded-2xl px-4 py-3">
                    <Input
                      id="team"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Digite o nome do seu time"
                      className="border-0 bg-transparent px-0 focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>
                  <Button
                    onClick={handleSearch}
                    disabled={searchQuery.isFetching}
                    className="h-12 rounded-2xl px-6 font-semibold tracking-wide"
                  >
                    BUSCAR
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Rodada atual: <span className="text-foreground">{currentRound ?? "..."}</span>
                </p>
              </div>

              {!user ? (
                <div className="mt-6 glass rounded-2xl p-5">
                  <p className="text-sm text-muted-foreground">
                    Para testar o fluxo completo (e liberar o ranking), entre com sua conta.
                  </p>
                  <div className="mt-3">
                    <Button asChild className="rounded-2xl">
                      <Link to="/auth">ENTRAR / CRIAR CONTA</Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </header>

            <div className="relative md:justify-self-end">
              <div className="pointer-events-none absolute -inset-10 rounded-[2.8rem] opacity-60 [background:radial-gradient(circle_at_60%_30%,hsl(var(--primary)/0.28),transparent_62%)]" />
              <img
                src={dinoSrc}
                alt="Mascote dinossauro 3D da Liga do Dino"
                loading="lazy"
                className="relative z-10 mx-auto w-[640px] max-w-[98vw] translate-x-6 translate-y-10 scale-[1.18] md:translate-x-14 md:translate-y-14 md:scale-[1.28] drop-shadow-[0_56px_170px_hsl(var(--primary)/0.24)]"
              />
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-[1.15fr_0.85fr]">
          <Card className="glass rounded-3xl p-6 md:p-8">
            <div className="flex items-end justify-between gap-4">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-wide">Selecione seu time</h2>
                <p className="mt-1 text-sm text-muted-foreground">Busca via backend (sem CORS/bloqueio) com visual premium.</p>
              </div>
              <Button variant="secondary" asChild className="rounded-2xl">
                <Link to="/ranking">VER RANKING</Link>
              </Button>
            </div>

            <Separator className="my-5" />

            {searchQuery.data?.length ? (
              <div className="grid gap-3">
                <p className="text-xs text-muted-foreground">Resultados (selecione o seu):</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {searchQuery.data.slice(0, 8).map((t) => {
                    const isSelected = selected?.time_id === t.time_id;
                    return (
                      <button
                        key={t.time_id}
                        type="button"
                        onClick={() => {
                          setSelected(t);
                          setParticipantId(null);
                        }}
                        className={`glass rounded-2xl px-4 py-3 text-left transition hover:translate-y-[-1px] ${
                          isSelected ? "ring-2 ring-primary/40" : "ring-1 ring-border/60"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold">{t.nome}</p>
                            <p className="truncate text-xs text-muted-foreground">{t.nome_cartola}</p>
                          </div>
                          <span className="text-xs text-muted-foreground">ID {t.time_id}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <p className="text-sm text-muted-foreground">Faça a busca para ver os times aqui.</p>
              </div>
            )}

            {selected ? (
              <div className="mt-6 animate-enter">
                <Card className="glass rounded-3xl p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-center gap-4">
                      <div className="h-14 w-14 overflow-hidden rounded-2xl bg-muted ring-1 ring-border">
                        {selected.url_escudo_png || selected.url_escudo_svg ? (
                          <img
                            src={selected.url_escudo_svg ?? selected.url_escudo_png}
                            alt={`Escudo ${selected.nome}`}
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
                        <p className="truncate text-base font-semibold">{selected.nome}</p>
                        <p className="truncate text-sm text-muted-foreground">{selected.nome_cartola}</p>
                      </div>
                    </div>

                    <Button
                      onClick={handleJoin}
                      disabled={joining}
                      className="h-12 rounded-2xl px-6 font-semibold tracking-wide"
                    >
                      QUERO PARTICIPAR (R$ 10,00)
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Para teste: este botão confirma seu time e aprova o pagamento automaticamente.
                  </p>
                </Card>
              </div>
            ) : null}
          </Card>

          <Card className="glass rounded-3xl p-6 md:p-8">
            <h3 className="font-display text-xl font-semibold tracking-wide">Como funciona</h3>
            <ol className="mt-5 space-y-3 text-sm">
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  1
                </span>
                <div>
                  <p className="font-medium">Buscar time</p>
                  <p className="text-muted-foreground">Digite o nome e selecione o seu.</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  2
                </span>
                <div>
                  <p className="font-medium">Confirmar + pagar</p>
                  <p className="text-muted-foreground">No teste, o Pix é simulado (R$ 10,00).</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  3
                </span>
                <div>
                  <p className="font-medium">Ranking Ao Vivo</p>
                  <p className="text-muted-foreground">Somente pagantes da rodada aparecem no dashboard.</p>
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
