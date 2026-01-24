export function extractCartolaTeamPoints(payload: any): number {
  // A API do Cartola muda nomes de campos; aqui tentamos vários caminhos conhecidos.
  const candidates: unknown[] = [
    payload?.pontos,
    payload?.pontos_rodada,
    payload?.pontosRodada,
    payload?.time?.pontos,
    payload?.time?.pontos_rodada,
    payload?.time?.pontosRodada,
    payload?.pontos_campeonato,
    payload?.pontosCampeonato,
  ];

  for (const v of candidates) {
    const n = typeof v === "string" ? Number(v) : (v as number);
    if (Number.isFinite(n)) return n;
  }

  // fallback: busca recursiva por uma chave "pontos" numérica
  try {
    const stack: any[] = [payload];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      if (typeof cur.pontos === "number" && Number.isFinite(cur.pontos)) return cur.pontos;
      for (const k of Object.keys(cur)) {
        const next = (cur as any)[k];
        if (next && typeof next === "object") stack.push(next);
      }
    }
  } catch {
    // ignore
  }

  return 0;
}
