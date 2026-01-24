import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

type MockEntry = {
  teamName: string;
  points: number;
  shieldUrl?: string;
};

const mock: MockEntry[] = [
  { teamName: "Dino FC", points: 78.65 },
  { teamName: "Neon Raptors", points: 72.1 },
  { teamName: "Tiro Curto SC", points: 69.9 },
  { teamName: "Cartoleiros BR", points: 63.25 },
  { teamName: "Ataque Jurássico", points: 59.8 },
];

function podiumClass(index: number) {
  // Sem cores hardcoded: usa tokens semânticos
  if (index === 0) return "bg-primary/10 ring-1 ring-primary/30";
  if (index === 1) return "bg-muted/60 ring-1 ring-border";
  if (index === 2) return "bg-accent/20 ring-1 ring-border";
  return "bg-card ring-1 ring-border";
}

const Ranking = () => {
  return (
    <div className="min-h-screen bg-background">
      <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-6">
        <div className="leading-tight">
          <p className="text-sm text-muted-foreground">Ranking Ao Vivo (teste)</p>
          <h1 className="text-2xl font-semibold tracking-tight">Liga do Dino</h1>
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
                Estrutura de UI com dados mockados (sem pagamento/sem validação ainda).
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="secondary" disabled>
                Pagamento via Pix (em breve)
              </Button>
              <Button disabled>Atualizar (em breve)</Button>
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
              {mock.map((entry, idx) => (
                <div
                  key={`${entry.teamName}-${idx}`}
                  className={`grid grid-cols-[60px_1fr_100px] items-center gap-3 rounded-xl px-4 py-3 ${podiumClass(
                    idx
                  )}`}
                >
                  <div className="text-sm font-semibold tabular-nums">#{idx + 1}</div>

                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
                      {/* escudo mockado: manter sem assets por enquanto */}
                      <div
                        className="h-full w-full [background:radial-gradient(circle_at_30%_20%,hsl(var(--primary)/0.18),transparent_60%)]"
                        aria-hidden
                      />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{entry.teamName}</p>
                      <p className="text-xs text-muted-foreground">Rodada atual (teste)</p>
                    </div>
                  </div>

                  <div className="text-right text-sm font-semibold tabular-nums">
                    {entry.points.toFixed(2)}
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
