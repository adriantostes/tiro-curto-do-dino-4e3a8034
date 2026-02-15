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
  reservationId: string;
  team: CartolaTeamSearchItem;
  expiresAt?: string | null;
};

function friendlyFunctionError(fnName: string, err: any) {
  const msg = String(err?.message ?? err ?? "");
  const status = (err as any)?.context?.status ?? (err as any)?.status;
  // Common Supabase SDK messages are not user-friendly; map them.
  if (String(status) === "404") {
    return `A função ${fnName} não está publicada no Supabase (404).`;
  }
  if (msg.toLowerCase().includes("failed to send a request to the edge function")) {
    return `Não consegui acessar a função ${fnName}. Geralmente é porque ela ainda não foi publicada no Supabase.`;
  }
  return msg || `Erro ao chamar a função ${fnName}.`;
}

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
  const [pixExpiresAt, setPixExpiresAt] = useState<string | null>(null);
  const [pixTick, setPixTick] = useState(0);
  const [checkingPix, setCheckingPix] = useState(false);
  const [activePaymentId, setActivePaymentId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [lastPendingPaymentId, setLastPendingPaymentId] = useState<string | null>(null);
  const [addingTeamId, setAddingTeamId] = useState<number | null>(null);

  const pixTimeLeftMs = useMemo(() => {
    if (!pixExpiresAt) return null;
    const t = new Date(pixExpiresAt).getTime();
    if (!Number.isFinite(t)) return null;
    return Math.max(0, t - Date.now());
  }, [pixExpiresAt, pixTick]);

  const pixTimeLeftLabel = useMemo(() => {
    if (pixTimeLeftMs == null) return null;
    const totalSeconds = Math.ceil(pixTimeLeftMs / 1000);
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
    const ss = String(totalSeconds % 60).padStart(2, "0");
    return `${mm}:${ss}`;
  }, [pixTimeLeftMs]);

  const pixProgressPct = useMemo(() => {
    if (pixTimeLeftMs == null) return null;
    const total = 10 * 60_000;
    const pct = (pixTimeLeftMs / total) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [pixTimeLeftMs]);

  // Re-render countdown each second while modal is open
  useEffect(() => {
    if (!pixOpen) return;
    if (!pixExpiresAt) return;
    const id = window.setInterval(() => {
      setPixTick((t) => t + 1);
    }, 1000);
    return () => window.clearInterval(id);
  }, [pixOpen, pixExpiresAt]);

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

  async function addTeamToCart(team: CartolaTeamSearchItem) {
    if (!user) {
      toast({ title: "Entre para continuar" });
      navigate("/auth");
      return;
    }
    if (!league?.id) {
      toast({ title: "Aguarde um instante", description: "Carregando dados da liga..." });
      return;
    }

    const existsInCart = cart.some((c) => c.team.time_id === team.time_id);
    if (existsInCart) {
      toast({ title: "Esse time já está no carrinho" });
      return;
    }

    setAddingTeamId(team.time_id);
    try {
      const shield = team.url_escudo_svg ?? team.url_escudo_png ?? null;
      const { data, error } = await supabase.functions.invoke("team-reserve", {
        body: {
          action: "reserve",
          leagueId: league.id,
          team: {
            cartola_team_id: team.time_id,
            team_name: team.nome,
            team_slug: team.slug ?? null,
      team_shield_url: shield,
          },
          ttlMinutes: 10,
        },
      });

    if (error) {
        toast({
          title: "Não consegui reservar esse time",
          description: friendlyFunctionError("team-reserve", error),
        });
        return;
      }

      const reservationId = String((data as any)?.reservationId ?? "");
      const expiresAt = ((data as any)?.expiresAt as string | undefined) ?? null;
      if (!reservationId) {
        toast({ title: "Não consegui reservar esse time" });
      return;
    }

      setCart((prev) => [...prev, { reservationId, team, expiresAt }]);
      toast({ title: "Adicionado ao boletim", description: "Reserva válida por 10 minutos." });
    } finally {
      setAddingTeamId(null);
    }
  }

  async function handleAddToCart() {
    if (!selected) {
      toast({ title: "Selecione seu time primeiro" });
      return;
    }
    await addTeamToCart(selected);
    setSelected(null);
  }

  async function removeFromCart(item: CartItem) {
    // Best-effort: release reservation on server so other people can choose the team
    try {
      if (user && league?.id) {
        await supabase.functions.invoke("team-reserve", {
          body: { action: "release", leagueId: league.id, cartolaTeamId: item.team.time_id },
        });
      }
    } finally {
      setCart((prev) => prev.filter((c) => c.reservationId !== item.reservationId));
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
    if (!league?.id) {
      toast({ title: "Aguarde um instante", description: "Carregando dados da liga..." });
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
      const { data, error } = await supabase.functions.invoke("mercado-pago-pix-bulk", {
        body: { reservationIds: cart.map((c) => c.reservationId), leagueId: league.id, round: currentRound },
      });

      if (error) {
        toast({ title: "Falha ao gerar PIX", description: error.message });
        return;
      }

      const status = (data as any)?.status ?? "pending";
      const pix = (data as any)?.pixCopyPaste ?? null;
      const paymentId = (data as any)?.paymentId ?? null;
      const expiresAt = ((data as any)?.expiresAt as string | undefined) ?? null;

      if (status === "approved") {
        toast({ title: "Tudo certo", description: "Pagamento confirmado." });
        navigate("/ranking");
        return;
      }

      setActivePaymentId(paymentId);
      setPixCopyPaste(pix);
      setPixStatus(status);
      setPixExpiresAt(expiresAt);
      setPixOpen(true);
      toast({ title: "PIX gerado", description: "Você tem 10 minutos para pagar." });
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
      const expiresAt = (data as any)?.expiresAt as string | undefined;
      if (pix && pix !== pixCopyPaste) setPixCopyPaste(pix);
      if (status && status !== pixStatus) setPixStatus(status);
      if (expiresAt && expiresAt !== pixExpiresAt) setPixExpiresAt(expiresAt);

      if (status === "approved") {
        toast({ title: "PAGAMENTO CONFIRMADO", description: "Seu time foi liberado no Ranking Ao Vivo." });
        // garante que o ranking refaça fetch com o novo status
        await queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        // Se quiser ir direto, descomente:
        // navigate("/ranking");
      }
    } finally {
      setCheckingPix(false);
    }
  }

  async function reconcilePendingPayment() {
    if (!user || !currentRound) return;
    setReconciling(true);
    try {
      // Busca o pagamento mais recente que ainda não está aprovado (RLS já limita ao usuário)
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

      const { data, error } = await supabase.functions.invoke("mercado-pago-pix-bulk", {
        body: { paymentId: String(pending.id), round: currentRound },
      });

      if (error) {
        toast({ title: "Falha ao verificar no provedor", description: error.message });
        return;
      }

      const nextStatus = String((data as any)?.status ?? pending.status ?? "pending");
      const nextPix = ((data as any)?.pixCopyPaste as string | undefined) ?? null;
      const nextExpiresAt = ((data as any)?.expiresAt as string | undefined) ?? null;
      setActivePaymentId(String(pending.id));
      setPixStatus(nextStatus);
      if (nextPix) setPixCopyPaste(nextPix);
      if (nextExpiresAt) setPixExpiresAt(nextExpiresAt);

      if (nextStatus === "approved") {
        toast({ title: "PAGAMENTO CONFIRMADO", description: "Acesso liberado para a rodada." });
        await queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
        navigate("/ranking");
      } else {
        // Reabre o modal com o pix (caso o usuário tenha fechado e precise pagar/copiar de novo)
        setPixOpen(true);
        toast({ title: "Pagamento ainda pendente", description: "Se você acabou de pagar, pode levar alguns segundos." });
      }
    } finally {
      setReconciling(false);
    }
  }

  // Auto-reconcilia 1x ao abrir a Home logado (evita depender só do webhook/modal)
  useEffect(() => {
    if (!user || !currentRound) return;
    // roda apenas uma vez por user+rodada
    const key = `ldd:reconcile:${user.id}:${currentRound}`;
    if (window.sessionStorage.getItem(key)) return;
    window.sessionStorage.setItem(key, "1");
    void reconcilePendingPayment();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, currentRound]);

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
    <div className="min-h-screen bg-[#060606] text-white overflow-x-hidden font-sans">
      <header className="sticky top-0 z-50 w-full bg-[#0a0a0a] border-b border-white/5 shadow-2xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <div className="relative h-9 w-9 bg-primary flex items-center justify-center rounded-br-xl rounded-tl-xl transform -skew-x-12 shadow-[0_0_20px_rgba(34,197,94,0.4)]">
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6 text-black fill-current transform skew-x-12"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path d="M22,10V6.5c0-1.93-1.57-3.5-3.5-3.5H5.5C3.57,3,2,4.57,2,6.5V10c1.1,0,2,0.9,2,2s-0.9,2-2,2v3.5c0,1.93,1.57,3.5,3.5,3.5h13 c1.93,0,3.5-1.57,3.5-3.5V14c-1.1,0-2-0.9-2-2S20.9,10,22,10z M11,17h-2v-2h2V17z M11,13h-2v-2h2V13z M11,9h-2V7h2V9z M16,17h-2v-2h2 V17z M16,13h-2v-2h2V13z M16,9h-2V7h2V9z" />
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
          </div>
        </div>

          <nav className="flex items-center gap-3">
          {user ? (
              <Button asChild variant="ghost" className="text-xs font-bold hover:bg-white/5">
                <Link to="/ranking">RANKING</Link>
            </Button>
          ) : (
              <div className="flex items-center gap-2">
                <Button asChild variant="ghost" className="text-xs font-bold text-gray-400 hover:text-white">
                  <Link to="/auth">Login</Link>
                </Button>
                <Button asChild size="sm" className="bg-primary text-black font-bold hover:bg-primary/90 rounded-sm px-5">
                  <Link to="/auth">REGISTRAR</Link>
            </Button>
              </div>
          )}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 pt-6 pb-28 sm:px-6 md:pb-6">
        <div className="mb-6 overflow-hidden rounded-xl border border-white/10 shadow-2xl">
          <img
            src="https://i.imgur.com/IdTBtor.jpeg"
            alt="Banner Melhor da Rodada do Dino"
            className="w-full h-auto object-cover"
          />
        </div>

        <section className="relative mb-8 overflow-hidden rounded-xl bg-gradient-to-br from-[#121212] to-[#080808] border border-white/5 flex flex-col md:flex-row items-center md:min-h-[450px]">
          <div className="absolute top-0 right-0 w-1/2 h-full bg-primary/5 blur-[120px] pointer-events-none"></div>

          <div className="relative w-full pt-8 flex justify-center md:pt-0 md:absolute md:right-0 md:bottom-0 md:h-full md:w-1/2 md:justify-end pointer-events-none">
            <img
              src={dinoHero}
              alt="Dino Mascote"
              className="h-40 w-auto object-contain drop-shadow-[0_0_30px_rgba(34,197,94,0.4)] animate-float sm:h-48 md:h-[95%] md:mr-6"
            />
          </div>

          <div className="relative z-10 flex flex-col gap-5 p-6 sm:p-10 md:w-2/3">
            <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 ring-1 ring-primary/30 w-fit mx-auto md:mx-0">
              <span className="h-2 w-2 animate-pulse rounded-full bg-primary"></span>
              <span className="text-[10px] font-bold uppercase tracking-wider text-primary">
                Rodada Aberta - Participe Agora
              </span>
            </div>

            <h2 className="text-4xl font-black leading-[0.9] tracking-tighter sm:text-6xl md:text-7xl uppercase italic text-center md:text-left">
              MELHOR DA <br />
              <span className="text-primary drop-shadow-[0_0_15px_rgba(34,197,94,0.3)]">RODADA DO DINO</span>
            </h2>

            <p className="max-w-md text-sm text-gray-400 sm:text-base font-medium text-center md:text-left mx-auto md:mx-0">
              Nossa liga de tiro curto entre amigos! Escolha seu time, entre na disputa e veja quem garante a resenha no topo
              do ranking em tempo real.
            </p>

            <div className="flex flex-col gap-4 sm:flex-row mt-2">
              <div className="flex-1 bg-[#1a1a1a] rounded-xl border border-white/10 p-1.5 flex items-center shadow-2xl relative z-20">
                    <Input
                      id="team"
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                  placeholder="Nome do seu time..."
                  className="h-11 border-0 bg-transparent text-white focus-visible:ring-0 focus-visible:ring-offset-0 font-bold placeholder:text-gray-600 px-3 min-w-0 flex-1"
                />
                <Button onClick={handleSearch} className="h-11 bg-primary text-black font-black hover:bg-primary/80 px-6 italic shrink-0 rounded-lg">
                  BUSCAR
                    </Button>
                  </div>
                </div>

            <div className="flex items-center justify-center md:justify-start gap-6 mt-2 relative z-20">
              <div className="flex flex-col items-center md:items-start">
                <span className="text-[10px] uppercase text-gray-500 font-bold tracking-widest">Rodada Atual</span>
                <span className="text-2xl font-black text-white italic">#{currentRound ?? "--"}</span>
              </div>
              <div className="h-10 w-[1px] bg-white/10"></div>
              <div className="flex flex-col items-center md:items-start">
                <span className="text-[10px] uppercase text-gray-500 font-bold tracking-widest">Taxa de Entrada</span>
                <span className="text-2xl font-black text-primary italic">R$ 10,00</span>
            </div>
          </div>
          </div>

          
        </section>

        <div className="grid gap-6 md:grid-cols-3 items-start">
          <div className="md:col-span-2 space-y-6">
            <Card className="bg-[#121212] border-white/5 p-6 rounded-xl">
              <div className="mb-6 flex items-center justify-between">
              <div>
                  <h3 className="text-lg font-bold uppercase italic tracking-wider">Selecione seu Time</h3>
                  <p className="text-xs text-gray-500 uppercase font-bold tracking-tight">Busque e adicione ao seu boletim</p>
                </div>
                <div className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold text-primary ring-1 ring-primary/20 uppercase">
                  Ao Vivo
              </div>
            </div>

            {searchQuery.data?.length ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  {searchQuery.data.slice(0, 10).map((t) => {
                    const isInCart = cart.some(c => c.team.time_id === t.time_id);
                    return (
                      <div
                        key={t.time_id}
                        className={`group relative flex items-center gap-3 rounded-xl border p-3 transition-all ${
                          isInCart
                            ? "border-primary/50 bg-primary/5"
                            : "border-white/5 bg-[#1a1a1a] hover:border-white/20 hover:bg-[#222]"
                        }`}
                      >
                        <div className="h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-[#0a0a0a] p-1.5 ring-1 ring-white/10 group-hover:ring-primary/40">
                          <img src={t.url_escudo_svg ?? t.url_escudo_png} alt="" className="h-full w-full object-contain" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-black text-white uppercase italic">{t.nome}</p>
                          <p className="truncate text-[9px] font-bold uppercase text-gray-500 tracking-tight">{t.nome_cartola}</p>
                          </div>
                        <Button
                          size="sm"
                          disabled={isInCart || addingTeamId === t.time_id}
                          onClick={() => void addTeamToCart(t)}
                          className={`h-8 px-3 text-[10px] font-black uppercase italic tracking-widest transition-all ${
                            isInCart 
                            ? "bg-primary/20 text-primary border border-primary/20" 
                            : "bg-primary text-black hover:scale-105"
                          }`}
                        >
                          {isInCart ? "SALVO" : addingTeamId === t.time_id ? "..." : "ADD"}
                        </Button>
                        </div>
                    );
                  })}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-10 text-center border-2 border-dashed border-white/5 rounded-xl">
                  <div className="mb-3 text-gray-600">
                    <svg className="h-10 w-10 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
              </div>
                  <p className="text-sm font-bold text-gray-500 uppercase">Busque seu time para começar</p>
              </div>
            )}
            </Card>
          </div>

          <div className="space-y-6">
            {/* Carrinho como "Bet Slip" na lateral */}
            {cart.length > 0 ? (
              <Card
                id="bet-slip"
                className="bg-[#121212] border-primary/30 p-5 rounded-xl ring-1 ring-primary/20 sticky top-20 shadow-[0_0_40px_rgba(0,0,0,0.5)] animate-enter"
              >
                <div className="mb-5 flex items-center justify-between">
                  <div>
                    <h3 className="text-sm font-black uppercase italic text-primary tracking-widest">MEU BOLETIM</h3>
                    <p className="text-[10px] text-gray-500 uppercase font-bold tracking-tight">{cart.length} {cart.length === 1 ? "seleção" : "seleções"}</p>
                      </div>
                  <div className="text-right">
                    <p className="text-[9px] uppercase font-bold text-gray-600">Total</p>
                    <p className="text-xl font-black text-white italic">{cartTotalLabel}</p>
                      </div>
                    </div>

                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                  {cart.map((item) => (
                    <div key={item.reservationId} className="group flex items-center justify-between rounded-lg bg-[#1a1a1a] border border-white/5 p-3 hover:border-white/10 transition-colors">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="h-7 w-7 rounded bg-black/40 p-1 shrink-0">
                          <img src={item.team.url_escudo_svg ?? item.team.url_escudo_png} alt="" className="h-full w-full object-contain" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-[11px] font-black text-white uppercase italic truncate">{item.team.nome}</p>
                        </div>
                      </div>
                      <button
                        className="text-[9px] font-black text-gray-600 hover:text-red-500 uppercase italic tracking-tighter"
                        onClick={() => void removeFromCart(item)}
                      >
                        REMOVER
                      </button>
                  </div>
                  ))}
              </div>

                <div className="mt-5 space-y-3">
                    <Button
                      onClick={handleCheckout}
                      disabled={joining}
                    className="w-full bg-primary text-black font-black hover:bg-primary/90 h-14 rounded-lg uppercase tracking-widest italic text-base shadow-[0_0_20px_rgba(34,197,94,0.3)] group"
                    >
                    {joining ? "PROCESSANDO..." : "FINALIZAR E PAGAR"}
                    </Button>

                  {user && (
                      <Button
                      variant="ghost"
                      className="w-full border border-white/5 hover:bg-white/5 text-[10px] font-black uppercase italic h-10 tracking-widest text-gray-500"
                      onClick={reconcilePendingPayment}
                    >
                      JÁ PAGUEI • VERIFICAR
                      </Button>
                      )}
                    </div>
              </Card>
            ) : (
              <Card className="bg-[#121212] border-white/5 p-6 rounded-xl text-center py-12">
                <div className="h-12 w-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-4 border border-white/5">
                  <svg className="h-6 w-6 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 11V7a4 4 0 00-8 0v4M5 9h14l1 12H4L5 9z" />
                  </svg>
                </div>
                <h3 className="text-xs font-black uppercase italic text-gray-600 tracking-widest mb-1">BOLETIM VAZIO</h3>
                <p className="text-[10px] text-gray-700 font-bold uppercase">Selecione um time para começar</p>
              </Card>
            )}

            <Card className="bg-[#121212] border-white/5 p-6 rounded-xl">
              <h3 className="text-sm font-bold uppercase italic text-primary mb-4 tracking-widest">Como Funciona</h3>
              <div className="space-y-6">
                {[
                  { step: "01", title: "ESCALAÇÃO", desc: "Busque seu time oficial do Cartola pelo nome." },
                  { step: "02", title: "DEPÓSITO", desc: "Faça o pagamento da taxa de R$ 10 via PIX." },
                  { step: "03", title: "AO VIVO", desc: "Acompanhe sua pontuação em tempo real no ranking." },
                ].map((item, i) => (
                  <div key={i} className="flex gap-4">
                    <span className="text-xl font-black italic text-white/10 leading-none">{item.step}</span>
                    <div>
                      <h4 className="text-xs font-black uppercase italic mb-1">{item.title}</h4>
                      <p className="text-xs text-gray-500 font-bold leading-relaxed tracking-tight">{item.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </Card>

            <Card className="bg-gradient-to-br from-[#121212] to-primary/5 border-primary/10 p-6 rounded-xl">
              <h3 className="text-sm font-bold uppercase italic text-white mb-2 tracking-widest text-center">Próximo Ranking</h3>
              <div className="text-center py-4">
                <p className="text-4xl font-black text-primary italic leading-none mb-2">AO VIVO</p>
                <p className="text-[10px] text-gray-500 font-black uppercase tracking-[0.2em] mb-4">Atualização Instantânea</p>
                <Button asChild className="w-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-black uppercase italic tracking-widest py-6">
                  <Link to="/ranking">Ver Leaderboard</Link>
                </Button>
              </div>
          </Card>
          </div>
        </div>
      </main>

      {/* Barra fixa no mobile: deixa a finalização clara e sempre acessível */}
      {cart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
          <div className="mx-auto max-w-7xl px-4 pb-4">
            <div className="rounded-2xl border border-white/10 bg-[#0a0a0a]/95 backdrop-blur shadow-2xl p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[9px] font-black uppercase tracking-[0.25em] text-gray-600">Boletim</p>
                  <p className="text-sm font-black italic truncate">
                    {cart.length} {cart.length === 1 ? "time" : "times"} • <span className="text-primary">{cartTotalLabel}</span>
                  </p>
                </div>
                <Button
                  onClick={handleCheckout}
                  disabled={joining}
                  className="bg-primary text-black font-black hover:bg-primary/90 h-12 px-5 rounded-xl uppercase italic tracking-widest shadow-[0_0_20px_rgba(34,197,94,0.3)]"
                >
                  FINALIZAR
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

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
          <div className="flex flex-col gap-2">
            <p className="text-[10px] font-black uppercase text-gray-700 tracking-[0.4em]">© 2026 MELHOR DA RODADA DO DINO</p>
            <p className="text-[9px] font-bold text-gray-800 uppercase tracking-widest">Aposte com Responsabilidade • 18+</p>
                </div>
                </div>
      </footer>

      <Dialog open={pixOpen} onOpenChange={setPixOpen}>
        <DialogContent
          className="max-w-md rounded-3xl border border-white/10 bg-[#0a0a0a] text-white shadow-2xl"
          onEscapeKeyDown={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <div className="flex items-start justify-between gap-3">
              <div>
                <DialogTitle className="text-xl font-black italic uppercase tracking-widest">PAGUE COM PIX</DialogTitle>
                <DialogDescription className="text-xs font-bold uppercase tracking-widest text-gray-500">
                  Status: <span className="text-white">{pixStatus ?? "pending"}</span>
            </DialogDescription>
              </div>
              {pixTimeLeftLabel ? (
                <div className="shrink-0 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.22em] text-primary">
                  EXPIRA EM {pixTimeLeftLabel}
                </div>
              ) : null}
            </div>
            {pixProgressPct != null ? (
              <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/5">
                <div
                  className="h-full bg-primary transition-[width] duration-500"
                  style={{ width: `${pixProgressPct}%` }}
                />
              </div>
            ) : null}
          </DialogHeader>

          {pixStatus === "approved" ? (
            <div className="grid gap-3">
              <div className="rounded-2xl border border-primary/20 bg-primary/5 p-4">
                <p className="text-lg font-black uppercase italic tracking-wider text-primary">PAGAMENTO CONFIRMADO</p>
                <p className="mt-2 text-sm font-medium text-gray-400">
                  Acesso liberado. Você já pode ver sua posição no ranking.
                </p>
              </div>
            </div>
          ) : pixCopyPaste ? (
            <div className="grid gap-4">
              <div className="mx-auto rounded-2xl bg-white p-3 ring-1 ring-white/10">
                <QRCodeCanvas value={pixCopyPaste} size={220} includeMargin />
              </div>

              {pixTimeLeftMs === 0 ? (
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3">
                  <p className="text-[10px] font-black uppercase tracking-[0.22em] text-red-400">
                    PIX EXPIRADO • GERE UM NOVO
                  </p>
                </div>
              ) : null}

              <div className="grid gap-2">
                <Label className="text-[10px] font-black uppercase tracking-[0.22em] text-gray-500">PIX COPIA E COLA</Label>
                <div className="rounded-2xl border border-white/10 bg-black/40 p-3">
                  <p className="break-all text-xs font-medium text-gray-300">{pixCopyPaste}</p>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-gray-400">Não consegui carregar o código PIX.</p>
          )}

          <DialogFooter className="gap-2 sm:gap-3">
            <Button
              variant="secondary"
              className="h-12 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-black uppercase italic tracking-widest hover:bg-white/10"
              onClick={async () => {
                if (!pixCopyPaste) return;
                try {
                  await navigator.clipboard.writeText(pixCopyPaste);
                  toast({ title: "Copiado" });
                } catch {
                  toast({ title: "Não consegui copiar", description: "Copie manualmente o código PIX." });
                }
              }}
              disabled={!pixCopyPaste || pixTimeLeftMs === 0}
            >
              COPIAR
            </Button>

            <Button
              variant="secondary"
              className="h-12 flex-1 rounded-xl border border-white/10 bg-white/5 text-xs font-black uppercase italic tracking-widest hover:bg-white/10"
              onClick={() => void checkPaymentStatus()}
              disabled={checkingPix || pixStatus === "approved"}
            >
              {checkingPix ? "VERIFICANDO..." : "JÁ PAGUEI"}
            </Button>

            <Button
              className="h-12 flex-1 rounded-xl bg-primary text-black text-xs font-black uppercase italic tracking-widest hover:bg-primary/90 shadow-[0_0_20px_rgba(34,197,94,0.25)]"
              onClick={() => {
                setPixOpen(false);
                navigate("/ranking");
              }}
            >
              VER RANKING
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Index;
