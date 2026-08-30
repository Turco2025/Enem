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
const IMAGE_QUALITY = Deno.env.get("OPENAI_IMAGE_QUALITY") || "high";
const MAX_DAILY_IMAGES = Number(Deno.env.get("MAX_DAILY_IMAGES") || "200");

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

  let body: { prompt?: string; size?: string };
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

  // Limite diário de segurança para proteger os créditos da conta OpenAI
  // conectada, já que esta função fica publicamente acessível pelo app.
  try {
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
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: IMAGE_MODEL,
        prompt,
        size,
        quality: IMAGE_QUALITY,
        n: 1,
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return jsonResponse({
        error: `Falha ao gerar imagem na OpenAI (status ${res.status}): ${errText.slice(0, 500)}`,
      }, 502);
    }

    const data = await res.json();
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

    return jsonResponse({ imageDataUrl });
  } catch (err) {
    return jsonResponse({ error: `Erro inesperado no backend: ${String(err)}` }, 500);
  }
});
