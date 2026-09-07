import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/* REVISOR DE MATEMÁTICA — agente separado do gerador de questões do ENEM
   (generate-question). Único trabalho: auditar a CORREÇÃO MATEMÁTICA (contas,
   fórmulas, unidades, coerência entre resolução comentada e gabarito) de uma
   questão de matemática já pronta, usando como lastro exclusivo os trechos
   recuperados de public.math_reference_chunks (63 livros didáticos indexados
   por embedding). NÃO revisa pedagogia/estilo/formato — isso já é feito pela
   validação existente na generate-question.

   Regra inegociável: só corrige o que estiver fundamentado em trecho
   efetivamente recuperado do banco de referência. Sem cobertura relevante,
   ou sem certeza de que o trecho recuperado endereça o ponto em dúvida, a
   questão volta INALTERADA. Ver skills/revisor-matematica/SKILL.md.

   Chamado internamente pela generate-question (mesmo projeto Supabase) só
   quando area === "matematica". Nunca é chamado pelo app diretamente. Reusa
   os secrets já configurados neste projeto — nenhuma credencial nova:
   OPENAI_API_KEY (embeddings, mesma chave da generate-image/ingest-math-
   reference) e ANTHROPIC_API_KEY (mesma chave da generate-question). */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
const EMBEDDING_MODEL = "text-embedding-3-small";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const MODEL = "claude-sonnet-5";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const supabase = createClient(supabaseUrl, supabaseServiceKey);

// Gate de cobertura: exige pelo menos MIN_CHUNKS trechos com similaridade
// >= MATCH_THRESHOLD para considerar que há lastro suficiente para revisar.
const MATCH_COUNT = 8;
const MATCH_THRESHOLD = 0.25;
const MIN_CHUNKS = 2;

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

function campoRevisavel(q: any) {
  return {
    textoBase: String(q?.textoBase ?? ""),
    comando: String(q?.comando ?? ""),
    alternativas: (q?.alternativas && typeof q.alternativas === "object") ? q.alternativas : {},
    gabarito: String(q?.gabarito ?? ""),
    resolucaoComentada: String(q?.resolucaoComentada ?? ""),
  };
}

async function embedText(text: string): Promise<number[]> {
  const resp = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "authorization": `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: [text] }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenAI embeddings HTTP ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const item = (data.data || [])[0];
  if (!item?.embedding) throw new Error("OpenAI embeddings: resposta sem embedding.");
  return item.embedding;
}

function buildQueryText(q: any): string {
  const partes = [
    q?.disciplina || "",
    q?.objetoConhecimento || "",
    q?.habilidade?.texto || "",
    q?.tema || "",
    q?.textoBase || "",
    q?.comando || "",
    q?.resolucaoComentada || "",
  ].filter(Boolean);
  return partes.join("\n").slice(0, 6000);
}

const FERRAMENTA_REVISAO = {
  name: "entregar_revisao",
  description: "Entrega o veredito da revisão matemática e os campos finais (mantidos ou corrigidos) que de fato serão usados.",
  input_schema: {
    type: "object",
    properties: {
      alterado: { type: "boolean" },
      resumo: { type: "string" },
      textoBase: { type: "string" },
      comando: { type: "string" },
      alternativas: { type: "object" },
      gabarito: { type: "string" },
      resolucaoComentada: { type: "string" },
    },
    required: ["alterado", "resumo", "textoBase", "comando", "alternativas", "gabarito", "resolucaoComentada"],
  },
};

function buildSystemPrompt(): string {
  return `Você é o Revisor de Matemática: um auditor cuja ÚNICA tarefa é verificar se a MATEMÁTICA de uma questão já pronta está correta — contas, fórmulas, unidades, coerência entre a resolução comentada e o gabarito. Você NÃO revisa pedagogia, estilo, formato ENEM, habilidade da Matriz ou qualidade dos distratores — isso já foi validado antes de a questão chegar até você.

REGRA INEGOCIÁVEL: você só pode alterar algo se a correção estiver fundamentada em um dos trechos de referência fornecidos abaixo. Se os trechos não abordarem especificamente o ponto que está em dúvida, ou se você não tiver certeza absoluta de que há um erro matemático real, devolva a questão exatamente como recebeu (alterado: false) e explique no resumo por que não havia lastro suficiente para corrigir. NUNCA corrija por "achismo" ou por preferência de estilo de resolução — apenas erro matemático real e comprovável.

Ao corrigir, altere o MÍNIMO necessário: normalmente apenas a resolucaoComentada e/ou o gabarito (quando o gabarito não corresponde ao resultado correto) e, só se estritamente necessário, o texto de uma alternativa. Nunca reescreva a questão inteira. Sempre devolva os cinco campos (textoBase, comando, alternativas, gabarito, resolucaoComentada) por completo, alterados ou idênticos aos originais.

Responda SEMPRE usando a ferramenta entregar_revisao — nunca em texto livre.`;
}

function buildUserPrompt(q: any, trechos: any[]): string {
  const campos = campoRevisavel(q);
  const trechosTxt = trechos.map((t, i) =>
    `[Trecho ${i + 1} — livro ${t.livro}, pág. ~${t.pagina_aprox ?? "?"}, similaridade ${t.similarity.toFixed(3)}]\n${t.conteudo}`
  ).join("\n\n");

  return `QUESTÃO A AUDITAR
Disciplina: ${q?.disciplina || ""}
Tema: ${q?.tema || ""}
Objeto de conhecimento: ${q?.objetoConhecimento || ""}
Habilidade: ${q?.habilidade?.codigo || ""} — ${q?.habilidade?.texto || ""}

Texto-base:
${campos.textoBase}

Comando:
${campos.comando}

Alternativas:
${JSON.stringify(campos.alternativas, null, 2)}

Gabarito informado: ${campos.gabarito}

Resolução comentada:
${campos.resolucaoComentada}

TRECHOS RECUPERADOS DO BANCO DE REFERÊNCIA (use como lastro exclusivo para qualquer correção)
${trechosTxt}

Verifique: a resolução comentada bate matematicamente? O gabarito corresponde ao resultado correto? Alguma fórmula/propriedade foi aplicada de forma incorreta, à luz dos trechos acima? Se sim e houver lastro claro nos trechos, corrija o mínimo necessário. Se não houver erro real, ou os trechos não sustentarem uma correção específica, devolva tudo inalterado.`;
}

async function callClaudeForReview(system: string, userMsg: string): Promise<any> {
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 4000,
      system,
      thinking: { type: "disabled" },
      messages: [{ role: "user", content: userMsg }],
      tools: [FERRAMENTA_REVISAO],
      tool_choice: { type: "tool", name: "entregar_revisao" },
    }),
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`Anthropic HTTP ${resp.status}: ${errText.slice(0, 300)}`);
  }
  const data = await resp.json();
  const toolUse = (data.content || []).find((b: any) => b.type === "tool_use" && b.name === "entregar_revisao");
  if (!toolUse?.input) throw new Error("Resposta do Claude sem tool_use de entregar_revisao.");
  return toolUse.input;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Método não suportado. Use POST." }, 405);
  }

  let body: any;
  try { body = await req.json(); } catch { return jsonResponse({ error: "JSON inválido." }, 400); }

  const question = body?.question;
  if (!question || typeof question !== "object") {
    return jsonResponse({ error: "Campo 'question' ausente ou inválido." }, 400);
  }

  // Falha segura: qualquer erro interno devolve a questão original inalterada
  // em vez de propagar o erro — este agente nunca pode bloquear a entrega.
  try {
    if (!OPENAI_API_KEY || !ANTHROPIC_API_KEY) {
      return jsonResponse({
        question,
        coberturaEncontrada: false,
        alterado: false,
        resumo: "Revisor de matemática não configurado (falta OPENAI_API_KEY ou ANTHROPIC_API_KEY) — questão mantida sem alterações.",
      });
    }

    const queryText = buildQueryText(question);
    if (!queryText.trim()) {
      return jsonResponse({ question, coberturaEncontrada: false, alterado: false, resumo: "Questão sem conteúdo suficiente para busca — mantida sem alterações." });
    }

    const queryEmbedding = await embedText(queryText);

    const { data: trechos, error: rpcError } = await supabase.rpc("match_math_reference_chunks", {
      query_embedding: queryEmbedding,
      match_count: MATCH_COUNT,
      match_threshold: MATCH_THRESHOLD,
    });
    if (rpcError) throw new Error(`RPC match_math_reference_chunks: ${rpcError.message}`);

    const chunks = Array.isArray(trechos) ? trechos : [];
    if (chunks.length < MIN_CHUNKS) {
      return jsonResponse({
        question,
        coberturaEncontrada: false,
        alterado: false,
        resumo: `Nenhuma cobertura relevante encontrada na base de referência (${chunks.length} trecho(s) acima do limiar) — questão mantida sem alterações.`,
      });
    }

    const system = buildSystemPrompt();
    const userMsg = buildUserPrompt(question, chunks);
    const revisao = await callClaudeForReview(system, userMsg);

    const alterado = revisao?.alterado === true;
    const questionFinal = alterado
      ? {
          ...question,
          textoBase: revisao.textoBase ?? question.textoBase,
          comando: revisao.comando ?? question.comando,
          alternativas: revisao.alternativas ?? question.alternativas,
          gabarito: revisao.gabarito ?? question.gabarito,
          resolucaoComentada: revisao.resolucaoComentada ?? question.resolucaoComentada,
        }
      : question;

    return jsonResponse({
      question: questionFinal,
      coberturaEncontrada: true,
      alterado,
      resumo: String(revisao?.resumo || ""),
      referencias: chunks.map((c: any) => ({ livro: c.livro, pagina_aprox: c.pagina_aprox, similarity: c.similarity })),
    });
  } catch (err) {
    return jsonResponse({
      question,
      coberturaEncontrada: false,
      alterado: false,
      resumo: `Erro interno no revisor de matemática — questão mantida sem alterações: ${String((err as any)?.message || err)}`,
    });
  }
});
