// Liga do Dino – estrutura inicial (sem integração de pagamento por enquanto)

import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const Index = () => {
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
          <Button asChild>
            <Link to="/ranking">Entrar na Rodada</Link>
          </Button>
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
                Por enquanto é só estrutura pra teste: busca/validação e pagamento ficam como “Em breve”.
                O Ranking já aparece com dados mockados.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row">
                <Button size="lg" asChild>
                  <Link to="/ranking">Ver Ranking (teste)</Link>
                </Button>
                <Button size="lg" variant="secondary" disabled>
                  Pagamento via Pix (em breve)
                </Button>
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
                  <p className="text-muted-foreground">Digite o nome e confirme escudo/nome (em breve).</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  2
                </span>
                <div>
                  <p className="font-medium">Validar</p>
                  <p className="text-muted-foreground">Confirmação do time via backend (em breve).</p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted text-muted-foreground ring-1 ring-border">
                  3
                </span>
                <div>
                  <p className="font-medium">Pagar Pix</p>
                  <p className="text-muted-foreground">Checkout e QR Code (em breve).</p>
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
