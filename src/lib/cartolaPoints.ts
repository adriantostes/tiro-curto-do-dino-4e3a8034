export function extractCartolaTeamPoints(payload: any): number {
  // Se o time não foi escalado ainda, retorna 0
  if (payload?.mensagem && typeof payload.mensagem === "string") {
    const msg = String(payload.mensagem).toLowerCase();
    if (msg.includes("não foi escalado") || msg.includes("nao foi escalado")) {
      return 0;
    }
  }

  const parseNumberLoose = (v: unknown): number | null => {
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return null;
      // pt-BR: "12,34" (e às vezes "1.234,56")
      const normalized = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
      const n = Number(normalized);
      return Number.isFinite(n) ? n : null;
    }
    return null;
  };

  // A API do Cartola muda nomes de campos; priorizamos SEMPRE a pontuação da rodada.
  // Importante: evitar pegar "pontos_campeonato" por engano (isso deixa o ranking "errado").
  const candidates: unknown[] = [
    payload?.pontos_rodada,
    payload?.pontosRodada,
    payload?.time?.pontos_rodada,
    payload?.time?.pontosRodada,
    payload?.pontos, // fallback (em alguns endpoints é a pontuação da rodada)
    payload?.time?.pontos,
    payload?.pontuacao,
    payload?.time?.pontuacao,
  ];

  for (const v of candidates) {
    const n = parseNumberLoose(v);
    if (n != null) return n;
  }

  // fallback: busca recursiva por uma chave "pontos" numérica
  try {
    const stack: any[] = [payload];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object") continue;
      // Primeiro, tentamos chaves de rodada.
      const roundPoints =
        parseNumberLoose((cur as any).pontos_rodada) ??
        parseNumberLoose((cur as any).pontosRodada);
      if (roundPoints != null) return roundPoints;

      const anyPoints = parseNumberLoose((cur as any).pontos) ?? parseNumberLoose((cur as any).pontuacao);
      if (anyPoints != null) return anyPoints;
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
