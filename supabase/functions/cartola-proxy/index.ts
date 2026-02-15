const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Body =
  | { action: "search_teams"; q: string }
  | { action: "team_score"; teamId: number; round?: number }
  | { action: "market_status" };

function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...(init.headers ?? {}),
    },
  });
}

Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = (await req.json()) as Body;

    let url = "";
    if (body.action === "search_teams") {
      const q = encodeURIComponent(body.q ?? "");
      url = `https://api.cartola.globo.com/times?q=${q}`;
    } else if (body.action === "team_score") {
      const round = Number((body as any).round);
      // Preferimos buscar por rodada para evitar inconsistências de campos e cache.
      // Ex: /time/id/{teamId}/{round}
      url = Number.isFinite(round) && round > 0
        ? `https://api.cartola.globo.com/time/id/${body.teamId}/${round}`
        : `https://api.cartola.globo.com/time/id/${body.teamId}`;
    } else if (body.action === "market_status") {
      url = `https://api.cartola.globo.com/mercado/status`;
    } else {
      return json({ error: "Ação inválida" }, { status: 400 });
    }

    // Cache busting (upstream/proxies). Mantém compatível com endpoints que já têm querystring.
    const cacheBuster = `t=${Date.now()}`;
    url = url.includes("?") ? `${url}&${cacheBuster}` : `${url}?${cacheBuster}`;

    const res = await fetch(url, {
      cache: "no-store",
      headers: {
        // Header crítico para evitar bloqueio
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        Accept: "application/json,text/plain,*/*",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const text = await res.text();
    if (!res.ok) {
      console.error("cartola-proxy error", res.status, text);
      return json({ error: "Falha ao consultar Cartola", status: res.status }, { status: 502 });
    }

    // A API retorna JSON; repassamos como JSON
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": "application/json; charset=utf-8",
        ...corsHeaders,
      },
    });
  } catch (e) {
    console.error("cartola-proxy exception", e);
    return json({ error: "Erro interno" }, { status: 500 });
  }
});
