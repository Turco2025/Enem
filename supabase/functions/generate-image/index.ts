import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// Usa a API oficial da OpenAI, modelo GPT Image 2 ("ChatGPT").
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const IMAGE_MODEL = Deno.env.get("OPENAI_IMAGE_MODEL") || "gpt-image-2";
// SEM TETO DIÁRIO (decisão do professor): ausente, 0 ou negativo = ilimitado.
// Para reativar um limite depois, basta definir MAX_DAILY_IMAGES com um número
// positivo nos secrets do projeto Supabase — não é preciso reimplantar a função.
const MAX_DAILY_IMAGES = Number(Deno.env.get("MAX_DAILY_IMAGES") || "0");

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado." }, 405);
  }

  if (!OPENAI_API_KEY) {
    return jsonResponse({
      error:
        "Backend não configurado: falta a variável de ambiente OPENAI_API_KEY nos secrets deste projeto Supabase.",
    }, 500);
  }

  let body: {
    prompt?: string; size?: string; quality?: string;
    outputFormat?: string; outputCompression?: number;
  };
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "JSON inválido." }, 400);
  }

  const prompt = (body.prompt || "").toString().trim();
  if (!prompt) {
    return jsonResponse({ error: "Campo 'prompt' é obrigatório." }, 400);
  }
  const size = body.size || "1536x1024";

  /* QUALIDADE FIXA EM "low" — decisão do professor, travada aqui no servidor.
     Antes a qualidade vinha por requisição (o app tinha um seletor por figura
     que permitia "medium"/"high"); agora ela é sempre "low", não importa o
     que o corpo da requisição peça — o campo "quality", se vier, é ignorado.
     Trocar isso exige mexer neste arquivo, não um clique na interface.        */
  const quality = "low";

  /* FORMATO DE SAÍDA. O padrão continua PNG — é o que o aplicativo sempre
     recebeu, e trocar sozinho mudaria o peso de todo PDF já gerado. Pedindo
     "webp" com compressão, a mesma imagem chega várias vezes menor, o que
     encurta o download e enxuga o PDF sem alterar o que a OpenAI cobra (o
     preço é pelos tokens da imagem, não pelos bytes que trafegam).           */
  const FORMATOS = ["png", "jpeg", "webp"];
  const formatoPedido = (body.outputFormat || "").toString().trim().toLowerCase();
  const outputFormatPedido = FORMATOS.includes(formatoPedido) ? formatoPedido : null;
  const compressao = Number(body.outputCompression);
  const outputCompression = (outputFormatPedido && outputFormatPedido !== "png" &&
    Number.isFinite(compressao) && compressao >= 1 && compressao <= 100)
    ? Math.round(compressao) : null;

  // Limite diário opcional (desligado por padrão). Quando MAX_DAILY_IMAGES não
  // está definido, nada é consultado nem bloqueado — a geração é ilimitada.
  if (Number.isFinite(MAX_DAILY_IMAGES) && MAX_DAILY_IMAGES > 0) try {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count, error: countErr } = await supabase
      .from("image_generation_log")
      .select("id", { count: "exact", head: true })
      .gte("created_at", since);
    if (!countErr && typeof count === "number" && count >= MAX_DAILY_IMAGES) {
      return jsonResponse({
        error: `Limite diário de ${MAX_DAILY_IMAGES} imagens atingido. Tente novamente amanhã, ou aumente MAX_DAILY_IMAGES nas configurações do backend.`,
      }, 429);
    }
  } catch (_e) {
    // Se o log falhar por algum motivo, não bloqueia a geração de imagem.
  }

  try {
    // OBS: a API de imagens da OpenAI para o gpt-image-2 (e gpt-image-1) já
    // devolve a imagem em base64 por padrão — o parâmetro "response_format"
    // NÃO é mais aceito por esse endpoint e causa erro 400 "Unknown parameter"
    // se enviado. Por isso ele foi removido do corpo da requisição abaixo.
    const corpo: Record<string, unknown> = {
      model: IMAGE_MODEL,
      prompt,
      size,
      quality,
      n: 1,
    };
    if (outputFormatPedido) corpo.output_format = outputFormatPedido;
    if (outputCompression !== null) corpo.output_compression = outputCompression;

    /* Uma imagem em qualidade alta leva mais de um minuto para ficar pronta, e
       até agora esta função chamava a OpenAI sem relógio e sem segunda chance:
       qualquer soluço de rede devolvia erro ao professor — e a imagem que a
       OpenAI já tinha começado a produzir seria cobrada assim mesmo. Agora há
       um limite de 240 s por tentativa e até 3 tentativas, com espera crescente
       entre elas, no mesmo padrão da função de questões.                      */
    const inicio = Date.now();
    let data: any = null;
    let ultimoErro = "";
    for (let tentativa = 1; tentativa <= 3; tentativa++) {
      const controller = new AbortController();
      const relogio = setTimeout(() => controller.abort(), 240_000);
      try {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${OPENAI_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(corpo),
          signal: controller.signal,
        });
        clearTimeout(relogio);
        if (res.ok) { data = await res.json(); break; }
        const errText = await res.text();
        // 429 e 5xx passam; 400 é erro de pedido e não melhora tentando de novo.
        const vaiMelhorar = res.status === 429 || res.status >= 500;
        ultimoErro = `status ${res.status}: ${errText.slice(0, 400)}`;
        if (!vaiMelhorar || tentativa === 3) {
          return jsonResponse({ error: `Falha ao gerar imagem na OpenAI (${ultimoErro})` }, 502);
        }
      } catch (err) {
        clearTimeout(relogio);
        const abortou = (err as any)?.name === "AbortError";
        ultimoErro = abortou ? "a OpenAI passou de 240 s sem responder" : String(err);
        if (tentativa === 3) {
          return jsonResponse({ error: `Falha ao gerar imagem (${ultimoErro}) após 3 tentativas.` }, 502);
        }
      }
      await new Promise((r) => setTimeout(r, 2000 * tentativa));
    }
    if (!data) {
      return jsonResponse({ error: `Falha ao gerar imagem (${ultimoErro}).` }, 502);
    }
    const segundos = Math.round((Date.now() - inicio) / 1000);
    const b64 = data.data && data.data[0] && data.data[0].b64_json;
    if (!b64) {
      return jsonResponse({ error: "A resposta da OpenAI não trouxe a imagem (b64_json ausente).", raw: data }, 502);
    }
    const outputFormat = data.output_format || "png";
    const imageDataUrl = `data:image/${outputFormat};base64,${b64}`;

    try {
      await supabase.from("image_generation_log").insert({ prompt: prompt.slice(0, 500) });
    } catch (_e) {
      // best-effort logging
    }

    /* O custo da imagem é verificável, não estimado: a OpenAI devolve, em
       "usage", quantos tokens de texto entraram e quantos tokens de imagem
       saíram. Multiplicando pelos preços vigentes (US$ 5 e US$ 30 por milhão)
       sai o preço real daquela imagem — dá para comparar qualidades sem
       depender de tabela publicada.                                          */
    const uso = data.usage || {};
    const tokensEntrada = Number(uso.input_tokens) || 0;
    const tokensSaida = Number(uso.output_tokens) || 0;
    const custoUSD = Number(((tokensEntrada * 5 + tokensSaida * 30) / 1e6).toFixed(5));

    return jsonResponse({
      imageDataUrl,
      uso: {
        qualidade: quality,
        tamanho: size,
        formato: outputFormat,
        segundos,
        tokensEntrada,
        tokensSaida,
        custoUSD,
        bytesImagem: Math.round(b64.length * 3 / 4),
      },
    });
  } catch (err) {
    return jsonResponse({ error: `Erro inesperado no backend: ${String(err)}` }, 500);
  }
});
