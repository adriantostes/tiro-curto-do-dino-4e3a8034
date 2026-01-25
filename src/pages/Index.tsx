// Liga do Dino – estrutura inicial (sem integração de pagamento por enquanto)

import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/useSession";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { cartolaMarketStatus, cartolaSearchTeams, type CartolaTeamSearchItem } from "@/lib/cartola";
import dinoHero from "@/assets/dino-hero-user-transparent.png";
import ligaDoDinoLogo from "@/assets/liga-do-dino-logo-256.png";
import { QRCodeCanvas } from "qrcode.react";

type CartItem = {
  participantId: string;
  team: CartolaTeamSearchItem;
};

const Index = () => {
  const { toast } = useToast();
  const { user } = useSession();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<CartolaTeamSearchItem | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [joining, setJoining] = useState(false);
  const [pixOpen, setPixOpen] = useState(false);
  const [pixCopyPaste, setPixCopyPaste] = useState<string | null>(null);
  const [pixStatus, setPixStatus] = useState<string | null>(null);
  const [checkingPix, setCheckingPix] = useState(false);
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);

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

  async function ensureParticipantForSelected() {
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

    const { data, error } = await supabase.from("participants").insert(payload).select("id").maybeSingle();

    if (error) {
      // Unicidade global por liga+time: se já existir, mostramos uma mensagem melhor.
      // (evita parecer "bug" quando alguém tenta cadastrar um time já usado)
      if ((error as any)?.code === "23505") {
        // Se o time já é deste usuário, recupera o id e segue o fluxo.
        const { data: existing, error: existingErr } = await supabase
          .from("participants")
          .select("id")
          .eq("league_id", league.id)
          .eq("cartola_team_id", selected.time_id)
          .eq("user_id", user.id)
          .limit(1)
          .maybeSingle();

        if (!existingErr && existing?.id) {
          return existing.id as string;
        }

        toast({
          title: "Time já escolhido",
          description: "Esse time já foi cadastrado por outra pessoa na liga. Escolha outro.",
        });
        return;
      }

      toast({ title: "Não consegui salvar seu time", description: error.message });
      return;
    }

    return (data?.id ?? null) as string | null;
  }

  async function handleAddToCart() {
    if (!user) {
      toast({ title: "Entre para continuar" });
      navigate("/auth");
      return;
    }
    if (!selected) {
      toast({ title: "Selecione seu time primeiro" });
      return;
    }

    const existsInCart = cart.some((c) => c.team.time_id === selected.time_id);
    if (existsInCart) {
      toast({ title: "Esse time já está no carrinho" });
      return;
    }

    setJoining(true);
    try {
      const participantId = await ensureParticipantForSelected();
      if (!participantId) {
        toast({ title: "Não consegui confirmar seu time" });
        return;
      }

      setCart((prev) => [...prev, { participantId, team: selected }]);
      toast({ title: "Adicionado ao carrinho" });
      setSelected(null);
      setQ("");
    } finally {
      setJoining(false);
    }
  }

  const cartTotalCents = useMemo(() => cart.length * 1000, [cart.length]);
  const cartTotalLabel = useMemo(() => {
    const value = cartTotalCents / 100;
    return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }, [cartTotalCents]);

  async function handleCheckout() {
    if (!user) {
      toast({ title: "Entre para continuar" });
      navigate("/auth");
      return;
    }
    if (!currentRound) {
      toast({ title: "Não consegui detectar a rodada atual" });
      return;
    }
    if (cart.length === 0) {
      toast({ title: "Seu carrinho está vazio" });
      return;
    }

    setJoining(true);
    try {
      const participantIds = cart.map((c) => c.participantId);
      const { data, error } = await supabase.functions.invoke("mercado-pago-pix-bulk", {
        body: { participantIds, round: currentRound },
      });

      if (error) {
        toast({ title: "Falha ao gerar PIX", description: error.message });
        return;
      }

      const status = (data as any)?.status ?? "pending";
      const pix = (data as any)?.pixCopyPaste ?? null;
      const paymentId = (data as any)?.paymentId ?? null;
      const excluded = ((data as any)?.excludedParticipantIds ?? []) as string[];

      if (excluded.length) {
        setCart((prev) => prev.filter((c) => !excluded.includes(c.participantId)));
      }

      if (status === "approved") {
        toast({ title: "Tudo certo", description: "Os times do carrinho já estavam pagos nesta rodada." });
        navigate("/ranking");
        return;
      }

      setActivePaymentId(paymentId);
      setPixCopyPaste(pix);
      setPixStatus(status);
      setPixOpen(true);
      toast({ title: "PIX gerado", description: "Pague para liberar o Ranking Ao Vivo." });
    } finally {
      setJoining(false);
    }
  }

  async function checkPaymentStatus() {
    if (!user || !currentRound || !activePaymentId) return;
    setCheckingPix(true);
    try {
      // Ask backend to refresh payment status from provider and return the latest state.
      const { data, error } = await supabase.functions.invoke("mercado-pago-pix-bulk", {
        body: { paymentId: activePaymentId, round: currentRound },
      });
      if (error) return;

      const status = (data as any)?.status as string | undefined;
      const pix = (data as any)?.pixCopyPaste as string | undefined;
      if (pix && pix !== pixCopyPaste) setPixCopyPaste(pix);
      if (status && status !== pixStatus) setPixStatus(status);

      if (status === "approved") {
        toast({ title: "PAGAMENTO CONFIRMADO", description: "Seu time foi liberado no Ranking Ao Vivo." });
        // garante que o ranking refaça fetch com o novo status
        await queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
      }
    } finally {
      setCheckingPix(false);
    }
  }

  // Polling leve enquanto o modal está aberto e o status ainda é pending
  useEffect(() => {
    if (!pixOpen) return;
    if (!user || !currentRound || !activePaymentId) return;
    if (pixStatus === "approved") return;

    const id = window.setInterval(() => {
      void checkPaymentStatus();
    }, 3500);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pixOpen, pixStatus, user?.id, currentRound, activePaymentId]);

  return (
    <div className="min-h-screen bg-background overflow-x-hidden">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 sm:h-11 sm:w-11 place-items-center rounded-2xl bg-primary/10 ring-1 ring-primary/25 overflow-hidden">
            <img
              src={ligaDoDinoLogo}
              alt="Logo Liga do Dino"
              className="h-[44px] w-[44px] object-contain"
              width={44}
              height={44}
              decoding="async"
              loading="eager"
            />
          </div>
          <div className="leading-tight">
            <p className="text-[10px] sm:text-xs tracking-wide text-muted-foreground">Cartola FC</p>
              <p className="font-display text-sm sm:text-lg font-semibold tracking-[0.14em] sm:tracking-[0.24em]">
                MELHOR DA RODADA DO DINO
              </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {user ? (
            <Button asChild size="sm" className="text-xs sm:text-sm">
              <Link to="/ranking">RANKING AO VIVO</Link>
            </Button>
          ) : (
            <Button asChild size="sm" className="text-xs sm:text-sm">
              <Link to="/auth">ENTRAR</Link>
            </Button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-12 sm:px-6 sm:pb-16">
        <section className="relative overflow-x-hidden overflow-y-visible rounded-2xl sm:rounded-3xl p-5 sm:p-8 md:p-10 glass-noise glass-glow stadium-glow scanlines cut-corners animate-enter">
          {/* Clip only the background glow (NOT the content), so inputs/buttons don't look cut on mobile */}
          <div
            className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl sm:rounded-3xl opacity-70 [background:radial-gradient(80%_55%_at_15%_15%,hsl(var(--primary)/0.24),transparent_60%),radial-gradient(60%_50%_at_85%_25%,hsl(var(--primary)/0.18),transparent_55%)]"
            aria-hidden
          />

            <div className="relative grid gap-6 sm:gap-8 md:grid-cols-[1.05fr_0.95fr] md:items-center animate-hud-flicker">
            <header>
              <h1 className="font-display font-extrabold leading-[0.98] whitespace-normal sm:whitespace-nowrap text-[clamp(1.15rem,4.8vw,3.5rem)] tracking-[0.06em] sm:tracking-[0.18em]">
                MELHOR DA RODADA DO DINO
              </h1>
              <p className="mt-3 sm:mt-4 max-w-xl text-sm sm:text-base text-muted-foreground">
                Selecione seu time, garanta sua vaga e acompanhe o{" "}
                <span className="text-foreground">Ranking Ao Vivo</span> em tempo real.
              </p>

              <div className="mt-6 sm:mt-7 grid gap-4 sm:gap-3 min-w-0">
                <Label htmlFor="team" className="text-sm sm:text-base">
                  Digite o nome do seu time
                </Label>
                <div className="flex w-full min-w-0 flex-col gap-4 sm:gap-3 sm:flex-row">
                  <div className="glass w-full min-w-0 overflow-hidden rounded-2xl px-4 min-h-[56px] flex items-center">
                    <Input
                      id="team"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Digite o nome do seu time"
                      className="h-14 w-full border-0 bg-transparent px-0 py-0 text-base leading-tight focus-visible:ring-0 focus-visible:ring-offset-0"
                    />
                  </div>
                  <Button
                    onClick={handleSearch}
                    disabled={searchQuery.isFetching}
                    className="min-h-[56px] h-auto w-full shrink-0 rounded-none cut-corners skew-wrap px-6 text-base font-semibold tracking-[0.16em] focus-visible:ring-0 focus-visible:ring-offset-0 sm:w-auto"
                  >
                    <span className="skew-inner">BUSCAR</span>
                  </Button>
                </div>

                <p className="text-xs sm:text-sm text-muted-foreground">
                  Rodada atual: <span className="text-foreground">{currentRound ?? "..."}</span>
                </p>
              </div>

              {!user ? (
                <div className="mt-5 sm:mt-6 glass rounded-2xl p-4 sm:p-5">
                  <p className="text-xs sm:text-sm text-muted-foreground">
                    Para testar o fluxo completo (e liberar o ranking), entre com sua conta.
                  </p>
                  <div className="mt-3 sm:mt-4">
                    <Button asChild className="rounded-2xl w-full sm:w-auto min-h-[50px]">
                      <Link to="/auth">ENTRAR / CRIAR CONTA</Link>
                    </Button>
                  </div>
                </div>
              ) : null}
            </header>

            <div className="relative md:justify-self-end">
              <div className="pointer-events-none absolute -inset-10 rounded-[2.8rem] opacity-60 [background:radial-gradient(circle_at_60%_30%,hsl(var(--primary)/0.28),transparent_62%)]" />
              <img
                src={dinoHero}
                alt="Mascote dinossauro 3D do Tiro Curto do Dino"
                width={1344}
                height={768}
                decoding="async"
                fetchPriority="high"
                loading="eager"
                className="relative z-20 mx-auto w-[380px] max-w-full object-contain sm:w-[520px] sm:-translate-y-10 md:w-[760px] md:max-w-[52vw] md:translate-x-20 md:-translate-y-16 md:scale-[1.18] animate-float drop-shadow-[0_56px_170px_hsl(var(--primary)/0.24)]"
              />
            </div>
          </div>
        </section>

        <section className="mt-8 grid gap-6 md:grid-cols-[1.15fr_0.85fr]">
          <Card className="glass-noise glass-glow stadium-glow scanlines cut-corners rounded-3xl p-6 md:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="font-display text-2xl font-semibold tracking-[0.14em]">Selecione seu time</h2>
                <p className="mt-1 text-sm text-muted-foreground">Encontre seu time e garanta sua vaga na rodada.</p>
              </div>
              <Button
                variant="secondary"
                asChild
                className="w-full sm:w-auto rounded-none cut-corners skew-wrap text-xs sm:text-sm"
              >
                <Link to="/ranking">
                  <span className="skew-inner">VER RANKING</span>
                </Link>
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
                        }}
                        className={`glass-noise cut-corners rounded-2xl px-4 py-3 text-left transition hover:translate-y-[-1px] ${
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
                <Card className="glass-noise glass-glow stadium-glow scanlines cut-corners rounded-3xl p-5">
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
                      onClick={handleAddToCart}
                      disabled={joining}
                      className="h-12 w-full sm:w-auto rounded-none cut-corners skew-wrap px-4 sm:px-6 font-semibold text-xs sm:text-sm tracking-[0.08em] sm:tracking-[0.14em] animate-neon-pulse"
                    >
                      <span className="skew-inner block w-full whitespace-nowrap text-center leading-none">
                        <span className="inline sm:hidden">ADICIONAR</span>
                        <span className="hidden sm:inline">ADICIONAR AO CARRINHO</span>{" "}
                        <span className="text-glow">(R$ 10,00)</span>
                      </span>
                    </Button>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    Você pode adicionar vários times e pagar tudo de uma vez no checkout.
                  </p>
                </Card>
              </div>
            ) : null}

            {cart.length ? (
              <div className="mt-6 animate-enter">
                <Card className="glass-noise glass-glow stadium-glow scanlines cut-corners rounded-3xl p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-display text-base font-semibold tracking-[0.14em]">CARRINHO</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {cart.length} time(s) • Total: <span className="text-foreground">{cartTotalLabel}</span>
                      </p>
                    </div>
                    <Button
                      onClick={handleCheckout}
                      disabled={joining}
                      className="h-12 rounded-none cut-corners skew-wrap px-6 font-semibold tracking-[0.14em] animate-neon-pulse"
                    >
                      <span className="skew-inner">FINALIZAR E PAGAR</span>
                    </Button>
                  </div>

                  <Separator className="my-4" />

                  <div className="grid gap-2">
                    {cart.map((item) => (
                      <div
                        key={item.participantId}
                        className="glass-noise scanlines cut-corners flex items-center justify-between gap-3 rounded-2xl px-4 py-3 ring-1 ring-border/60"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{item.team.nome}</p>
                          <p className="truncate text-xs text-muted-foreground">ID {item.team.time_id}</p>
                        </div>
                        <Button
                          variant="secondary"
                          size="sm"
                          className="rounded-none cut-corners skew-wrap"
                          onClick={() => setCart((prev) => prev.filter((c) => c.participantId !== item.participantId))}
                        >
                          <span className="skew-inner">REMOVER</span>
                        </Button>
                      </div>
                    ))}
                  </div>
                </Card>
              </div>
            ) : null}
          </Card>

          <Card className="glass-noise glass-glow scanlines cut-corners rounded-3xl p-6 md:p-8">
            <h3 className="font-display text-xl font-semibold tracking-[0.14em]">Como funciona</h3>
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
                  <p className="text-muted-foreground">Geramos o PIX (R$ 10,00) e liberamos após aprovação.</p>
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

      <Dialog open={pixOpen} onOpenChange={setPixOpen}>
        <DialogContent
          className="glass-noise glass-glow stadium-glow scanlines cut-corners max-w-md rounded-3xl"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="font-display tracking-[0.18em]">PAGUE COM PIX</DialogTitle>
            <DialogDescription>
              Status: <span className="text-foreground">{pixStatus ?? "pending"}</span>
            </DialogDescription>
          </DialogHeader>

          {pixStatus === "approved" ? (
            <div className="grid gap-3">
              <div className="glass-noise scanlines cut-corners rounded-2xl p-4">
                <p className="font-display text-lg font-extrabold tracking-[0.14em] text-glow">PAGAMENTO CONFIRMADO</p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Seu time já está liberado. Entre no Ranking Ao Vivo para ver sua posição.
                </p>
              </div>
            </div>
          ) : pixCopyPaste ? (
            <div className="grid gap-4">
              <div className="mx-auto rounded-2xl bg-background p-3 ring-1 ring-border">
                <QRCodeCanvas value={pixCopyPaste} size={220} includeMargin />
              </div>

              <div className="grid gap-2">
                <Label className="text-sm">Pix copia e cola</Label>
                <div className="glass rounded-2xl p-3 ring-1 ring-border/60">
                  <p className="break-all text-xs text-muted-foreground">{pixCopyPaste}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Não consegui carregar o código PIX.</p>
          )}

          <DialogFooter className="gap-2 sm:gap-3">
            <Button
              variant="secondary"
                className="rounded-none cut-corners skew-wrap"
              onClick={async () => {
                if (!pixCopyPaste) return;
                try {
                  await navigator.clipboard.writeText(pixCopyPaste);
                  toast({ title: "Copiado" });
                } catch {
                  toast({ title: "Não consegui copiar", description: "Copie manualmente o código PIX." });
                }
              }}
              disabled={!pixCopyPaste}
            >
                <span className="skew-inner">COPIAR CÓDIGO</span>
            </Button>

            <Button
              variant="secondary"
              className="rounded-none cut-corners skew-wrap"
              onClick={() => void checkPaymentStatus()}
              disabled={checkingPix || pixStatus === "approved"}
            >
              <span className="skew-inner">JÁ PAGUEI</span>
            </Button>

            <Button
                className="rounded-none cut-corners skew-wrap animate-neon-pulse"
              onClick={() => {
                setPixOpen(false);
                navigate("/ranking");
              }}
            >
                <span className="skew-inner">VER RANKING</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
