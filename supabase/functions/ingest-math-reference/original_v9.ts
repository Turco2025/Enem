/* CÓPIA GUARDADA — é o código que esteve no ar na ingest-math-reference (versão 9,
   publicada em 04/09/2026) até ser desligada em 13/10/2026. NÃO é publicado: o
   index.ts ao lado é que responde. Ficou aqui só para não se perder. Para usar de
   novo, acrescentar a trava "só o servidor chama" (ver review-math-question) antes
   de publicar. */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* UTILITÁRIO DE INGESTÃO — carrega trechos dos livros de referência de
   matemática (com embedding) em public.math_reference_chunks. Usado só por
   mim (Claude/professor) para popular a base do "revisor de matemática" da
   generate-question; não é chamado pelo app cliente. Recebe os trechos já
   extraídos e divididos (texto puro), gera o embedding de cada um via API da
   OpenAI (reaproveita o mesmo OPENAI_API_KEY já configurado nos secrets deste
   projeto Supabase para a generate-image) e insere tudo na tabela. */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = "text-embedding-3-small";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenAI embeddings HTTP ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const items = (data.data || []).slice().sort((a: any, b: any) => a.index - b.index);
  return items.map((d: any) => d.embedding);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado. Use POST." }, 405);
  }
  if (!OPENAI_API_KEY) {
    return jsonResponse({ error: "Falta a variável de ambiente OPENAI_API_KEY nos secrets deste projeto Supabase." }, 500);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "JSON inválido." }, 400); }

  const chunks = Array.isArray(body?.chunks) ? body.chunks : [];
  if (!chunks.length) {
    return jsonResponse({ error: "Nenhum chunk enviado (campo 'chunks' vazio ou ausente)." }, 400);
  }
  if (chunks.length > 100) {
    return jsonResponse({ error: "Máximo de 100 chunks por chamada." }, 400);
  }
  for (const c of chunks) {
    if (!c || typeof c.conteudo !== "string" || !c.conteudo.trim()) {
      return jsonResponse({ error: "Todo chunk precisa de um campo 'conteudo' (string não vazia)." }, 400);
    }
    if (!c.livro || !c.arquivo) {
      return jsonResponse({ error: "Todo chunk precisa dos campos 'livro' e 'arquivo'." }, 400);
    }
  }

  try {
    const embeddings = await embedBatch(chunks.map((c: any) => String(c.conteudo)));
    const rows = chunks.map((c: any, i: number) => ({
      livro: String(c.livro),
      arquivo: String(c.arquivo),
      chunk_index: Number(c.chunk_index ?? i),
      pagina_aprox: c.pagina_aprox != null ? Number(c.pagina_aprox) : null,
      conteudo: String(c.conteudo),
      embedding: embeddings[i],
    }));
    const { error } = await supabase.from("math_reference_chunks").insert(rows);
    if (error) throw new Error(error.message);
    return jsonResponse({ inserted: rows.length });
  } catch (err) {
    return jsonResponse({ error: `Erro na ingestão: ${String((err as any)?.message || err)}` }, 502);
  }
});
