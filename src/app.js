/* ===================== Gerador Inteligente de Simulados ENEM ===================== */

const AREA_META = {
  linguagens: { label: "Linguagens, Códigos e suas Tecnologias", icon: "📖", desc: "Português, literatura, artes, educação física, línguas estrangeiras",
    disciplinas: ["Língua Portuguesa","Literatura","Artes","Educação Física","Língua Estrangeira (Inglês/Espanhol)"] },
  humanas: { label: "Ciências Humanas e suas Tecnologias", icon: "🏛️", desc: "História, geografia, filosofia, sociologia",
    disciplinas: ["História","Geografia","Filosofia","Sociologia"] },
  natureza: { label: "Ciências da Natureza e suas Tecnologias", icon: "🧬", desc: "Biologia, física, química",
    disciplinas: ["Biologia","Física","Química"] },
  matematica: { label: "Matemática e suas Tecnologias", icon: "📐", desc: "Números, álgebra, geometria, estatística e probabilidade",
    disciplinas: ["Matemática"] },
};

// Backend próprio (Supabase Edge Function) que chama a API de imagens da OpenAI
// (GPT Image 1 / "ChatGPT") com segurança, mantendo a chave fora do navegador do professor.
const IMAGE_BACKEND_URL = "https://gkceyrkdmnhgqimmrsre.supabase.co/functions/v1/generate-image";

// Backend próprio (Supabase Edge Function) que chama a API da Anthropic (Claude) com
// segurança — a chave de API fica guardada só nos secrets do servidor, nunca no
// navegador do professor, e nunca é pedida ao abrir o app.
const QUESTION_BACKEND_URL = "https://gkceyrkdmnhgqimmrsre.supabase.co/functions/v1/generate-question";

let state = {
  area: null,
  disciplina: null,
  qty: 1,
  questions: [],
  apiKey: "",
  model: "claude-sonnet-5",
  viewMode: "professor",
};

/* ---------------- Geração de imagem (Higgsfield / GPT Image 2 via backend) ---------------- */
async function generateImageViaBackend(promptText){
  const res = await fetch(IMAGE_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: `Ilustração educacional realista para uma questão de vestibular (estilo ENEM). Sem texto, legendas ou marcas d'água sobrepostas na imagem. Cena: ${promptText}`,
      size: "1536x1024",
    }),
  });
  let data = {};
  try{ data = await res.json(); }catch(e){ /* resposta não-JSON */ }
  if(!res.ok || data.error){
    throw new Error(data.error || `Erro HTTP ${res.status} ao gerar imagem.`);
  }
  if(!data.imageDataUrl){
    throw new Error("O backend não retornou a imagem.");
  }
  return data.imageDataUrl;
}

let uidCounter = 1;
function uid(){ return "q" + (uidCounter++); }

/* ---------------- Armazenamento local (opcional, à prova de falhas) ----------------
   Algumas telas de pré-visualização (ex.: pré-visualização de artefatos) bloqueiam
   localStorage. Por isso todo acesso é protegido — se falhar, o app simplesmente
   volta a pedir a chave a cada sessão, sem quebrar nada. */
const STORAGE_KEYS = { apiKey: "enem_simulados_api_key", model: "enem_simulados_model" };
function safeStorageGet(key){
  try{ return window.localStorage.getItem(key); }catch(e){ return null; }
}
function safeStorageSet(key, value){
  try{ window.localStorage.setItem(key, value); return true; }catch(e){ return false; }
}
function safeStorageRemove(key){
  try{ window.localStorage.removeItem(key); }catch(e){ /* ignora */ }
}

/* ---------------- Toasts ---------------- */
function toast(msg, type){
  type = type || "info";
  const box = document.getElementById("toastBox");
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 300); }, 4200);
}

/* ---------------- Area / Disciplina ---------------- */
function renderAreaGrid(){
  const grid = document.getElementById("areaGrid");
  grid.innerHTML = "";
  Object.keys(AREA_META).forEach(key => {
    const m = AREA_META[key];
    const tile = document.createElement("div");
    tile.className = "area-tile" + (state.area === key ? " sel" : "");
    tile.dataset.area = key;
    tile.innerHTML = `<span class="ic">${m.icon}</span><h3>${m.label}</h3><p>${m.desc}</p>`;
    tile.addEventListener("click", () => selectArea(key));
    grid.appendChild(tile);
  });
}

function selectArea(key){
  state.area = key;
  state.disciplina = AREA_META[key].disciplinas[0];
  renderAreaGrid();
  renderDisciplinaChips();
  renderQuestionBlocks();
}

function renderDisciplinaChips(){
  const wrap = document.getElementById("disciplinaChips");
  wrap.innerHTML = "";
  if(!state.area){ wrap.innerHTML = `<span class="hint">Selecione uma área do conhecimento primeiro.</span>`; return; }
  AREA_META[state.area].disciplinas.forEach(d => {
    const chip = document.createElement("div");
    chip.className = "chip" + (state.disciplina === d ? " sel" : "");
    chip.textContent = d;
    chip.addEventListener("click", () => { state.disciplina = d; renderDisciplinaChips(); });
    wrap.appendChild(chip);
  });
}

/* ---------------- Quantity stepper ---------------- */
function setQty(n){
  n = Math.max(1, Math.min(20, n));
  state.qty = n;
  document.getElementById("qtyVal").textContent = n;
  syncQuestionsArrayLength();
  renderQuestionBlocks();
}

function syncQuestionsArrayLength(){
  while(state.questions.length < state.qty){
    state.questions.push({
      id: uid(), tema: "", dificuldade: "Médio", recurso: "nenhum",
      competenciaNum: null, habilidadeCod: null, instrucoesVisual: "",
      status: "idle", errorMsg: "", data: null, approved: false,
    });
  }
  while(state.questions.length > state.qty){ state.questions.pop(); }
}

/* ---------------- Matrix helpers ---------------- */
function getAreaMatriz(){
  if(!state.area) return null;
  return APP_DATA.matriz[state.area];
}
function findCompetencia(numero){
  const m = getAreaMatriz(); if(!m) return null;
  return m.competencias.find(c => c.numero === numero) || null;
}
function findHabilidade(codigo){
  const m = getAreaMatriz(); if(!m) return null;
  for(const c of m.competencias){ const h = c.habilidades.find(h => h.codigo === codigo); if(h) return {competencia: c, habilidade: h}; }
  return null;
}

function populateCompetenciaSelect(sel, current){
  const m = getAreaMatriz();
  sel.innerHTML = "";
  const optAuto = document.createElement("option");
  optAuto.value = ""; optAuto.textContent = "Selecionar automaticamente (recomendado)";
  sel.appendChild(optAuto);
  if(!m) return;
  m.competencias.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.numero;
    opt.textContent = `Competência ${c.numero} — ${truncate(c.texto, 70)}`;
    if(current === c.numero) opt.selected = true;
    sel.appendChild(opt);
  });
}

function populateHabilidadeSelect(sel, competenciaNum, current){
  const m = getAreaMatriz();
  sel.innerHTML = "";
  const optAuto = document.createElement("option");
  optAuto.value = ""; optAuto.textContent = "Selecionar automaticamente (recomendado)";
  sel.appendChild(optAuto);
  if(!m) return;
  const comps = competenciaNum ? m.competencias.filter(c => c.numero === competenciaNum) : m.competencias;
  comps.forEach(c => {
    const grp = document.createElement("optgroup");
    grp.label = `Competência ${c.numero}`;
    c.habilidades.forEach(h => {
      const opt = document.createElement("option");
      opt.value = h.codigo;
      opt.textContent = `${h.codigo} — ${truncate(h.texto, 65)}`;
      if(current === h.codigo) opt.selected = true;
      grp.appendChild(opt);
    });
    sel.appendChild(grp);
  });
}

function truncate(s, n){ return s.length > n ? s.slice(0, n - 1) + "…" : s; }

/* ---------------- Question config blocks (form) ---------------- */
function renderQuestionBlocks(){
  const wrap = document.getElementById("questionBlocks");
  wrap.innerHTML = "";
  if(!state.area){ wrap.innerHTML = `<p class="hint">Selecione a área do conhecimento para configurar as questões.</p>`; return; }
  syncQuestionsArrayLength();
  state.questions.forEach((q, idx) => wrap.appendChild(buildQuestionBlock(q, idx)));
}

function buildQuestionBlock(q, idx){
  const el = document.createElement("div");
  el.className = "qblock";
  el.innerHTML = `
    <div class="qb-head">
      <div class="qb-num"><span class="dot">${idx+1}</span> Questão ${idx+1}</div>
    </div>
    <label class="field-label">Tema / conteúdo desta questão</label>
    <textarea class="in-tema" placeholder="Ex.: sistema circulatório — regulação da pressão arterial durante o exercício">${q.tema}</textarea>
    <div class="qgrid" style="margin-top:12px;">
      <div>
        <label class="field-label">Nível de dificuldade</label>
        <div class="diff-row">
          ${["Fácil","Médio","Difícil"].map(d => `<div class="diff-opt${q.dificuldade===d?" sel":""}" data-d="${d}">${d}</div>`).join("")}
        </div>
      </div>
      <div>
        <label class="field-label">Recurso visual</label>
        <div class="resource-row">
          ${resOpt("nenhum","🚫","Sem recurso",q.recurso)}
          ${resOpt("imagem","🖼️","Imagem",q.recurso)}
          ${resOpt("grafico","📊","Gráfico",q.recurso)}
          ${resOpt("tabela","📋","Tabela",q.recurso)}
        </div>
      </div>
      <div></div>
    </div>
    <div class="visual-instr-block" style="margin-top:12px;${q.recurso==="nenhum"?"display:none;":""}">
      <label class="field-label">Instruções opcionais para a criação d${q.recurso==="imagem"?"a imagem":q.recurso==="tabela"?"a tabela":"o gráfico"}</label>
      <textarea class="in-instr-visual" placeholder="Ex.: mostre o coração em corte transversal, com as quatro câmaras nomeadas; use um gráfico de linha em vez de barras; destaque a coluna de 2020...">${escapeHtml(q.instrucoesVisual||"")}</textarea>
    </div>
    <div class="qgrid2">
      <div>
        <label class="field-label">Competência de área (opcional)</label>
        <select class="in-competencia"></select>
      </div>
      <div>
        <label class="field-label">Habilidade (opcional)</label>
        <select class="in-habilidade"></select>
      </div>
    </div>
  `;

  function resOpt(val, icon, label, current){
    return `<div class="res-opt${current===val?" sel":""}" data-r="${val}"><span class="ic">${icon}</span>${label}</div>`;
  }

  const instrBlock = el.querySelector(".visual-instr-block");
  const instrLabel = instrBlock.querySelector(".field-label");

  el.querySelector(".in-tema").addEventListener("input", e => { q.tema = e.target.value; });
  el.querySelector(".in-instr-visual").addEventListener("input", e => { q.instrucoesVisual = e.target.value; });
  el.querySelectorAll(".diff-opt").forEach(d => d.addEventListener("click", () => {
    q.dificuldade = d.dataset.d;
    el.querySelectorAll(".diff-opt").forEach(x => x.classList.toggle("sel", x === d));
  }));
  el.querySelectorAll(".res-opt").forEach(r => r.addEventListener("click", () => {
    q.recurso = r.dataset.r;
    el.querySelectorAll(".res-opt").forEach(x => x.classList.toggle("sel", x === r));
    instrBlock.style.display = q.recurso === "nenhum" ? "none" : "";
    instrLabel.textContent = `Instruções opcionais para a criação d${q.recurso==="imagem"?"a imagem":q.recurso==="tabela"?"a tabela":"o gráfico"}`;
  }));

  const compSel = el.querySelector(".in-competencia");
  const habSel = el.querySelector(".in-habilidade");
  populateCompetenciaSelect(compSel, q.competenciaNum);
  populateHabilidadeSelect(habSel, q.competenciaNum, q.habilidadeCod);
  compSel.addEventListener("change", () => {
    q.competenciaNum = compSel.value ? parseInt(compSel.value) : null;
    q.habilidadeCod = null;
    populateHabilidadeSelect(habSel, q.competenciaNum, null);
  });
  habSel.addEventListener("change", () => {
    q.habilidadeCod = habSel.value || null;
    if(q.habilidadeCod && !q.competenciaNum){
      const found = findHabilidade(q.habilidadeCod);
      if(found){ q.competenciaNum = found.competencia.numero; populateCompetenciaSelect(compSel, q.competenciaNum); }
    }
  });

  return el;
}

/* ---------------- Prompt building ---------------- */
function buildSystemPrompt(){
  return APP_DATA.universalModel + "\n\n" + APP_DATA.areaContext[state.area];
}

const RECURSO_INSTRUCOES = {
  nenhum: `Recurso visual: NENHUM. Não inclua gráfico, tabela ou imagem. Explore a situação-problema apenas por meio do texto-suporte. Deixe o campo "visual" como null e "recurso" como "nenhum".`,
  imagem: `Recurso visual: IMAGEM. A questão deve depender de uma imagem/ilustração pedagogicamente necessária (nunca meramente decorativa) para ser respondida corretamente — por exemplo: esquema anatômico, diagrama de processo, mapa, representação de fenômeno, estrutura, infográfico. Preencha "recurso":"imagem" e "visual" com: {"tipo":"imagem","descricao":"<legenda em português explicando o que a imagem mostra e por que ela é necessária para resolver a questão>","promptImagem":"<descrição em INGLÊS, detalhada, objetiva, no estilo de ilustração científica/educacional plana, limpa, sem nenhum texto ou letra embutida na imagem, adequada para um gerador de imagens>"}. O enunciado e o comando devem fazer referência explícita ao que aparece na imagem.`,
  grafico: `Recurso visual: GRÁFICO. A questão deve depender de um gráfico com dados numéricos plausíveis e coerentes (cientificamente ou matematicamente consistentes com o texto-suporte), efetivamente necessários para resolver a questão — não apenas decorativos. Preencha "recurso":"grafico" e "visual" com: {"tipo":"grafico","chartType":"bar" ou "line" ou "pie","titulo":"...","labels":["...","..."],"datasets":[{"label":"...","data":[num,num,...]}]}. Os números usados no gráfico devem ser os mesmos que a resolução comentada utiliza.`,
  tabela: `Recurso visual: TABELA. A questão deve depender de uma tabela com dados relevantes (resultados experimentais, dados populacionais, séries históricas, comparações entre grupos etc.), efetivamente necessários para resolver a questão. Preencha "recurso":"tabela" e "visual" com: {"tipo":"tabela","titulo":"...","colunas":["...","..."],"linhas":[["...","..."],["...","..."]]}.`,
};

function buildMatrizInstrucoes(q){
  const m = getAreaMatriz();
  if(q.habilidadeCod){
    const found = findHabilidade(q.habilidadeCod);
    return `A questão DEVE mobilizar exatamente esta competência e habilidade da Matriz de Referência (cite-as literalmente nos campos "competencia" e "habilidade" da resposta):\nCompetência ${found.competencia.numero}: ${found.competencia.texto}\n${found.habilidade.codigo}: ${found.habilidade.texto}`;
  }
  if(q.competenciaNum){
    const c = findCompetencia(q.competenciaNum);
    const habsTxt = c.habilidades.map(h => `${h.codigo}: ${h.texto}`).join("\n");
    return `A questão DEVE pertencer a esta competência de área:\nCompetência ${c.numero}: ${c.texto}\nEscolha, dentre as habilidades abaixo, a que melhor corresponde à operação cognitiva exigida pela questão que você vai elaborar, e cite-a literalmente no campo "habilidade":\n${habsTxt}`;
  }
  const allTxt = m.competencias.map(c => `Competência ${c.numero}: ${c.texto}\n` + c.habilidades.map(h => `  ${h.codigo}: ${h.texto}`).join("\n")).join("\n\n");
  return `O professor NÃO especificou competência/habilidade. Analise o tema pedido, a disciplina e o nível de dificuldade, e escolha, dentre TODAS as competências e habilidades oficiais da área abaixo, a única competência e a única habilidade que mais correspondem à operação cognitiva que a questão vai exigir (não apenas ao assunto de superfície). Cite-as literalmente e por completo nos campos "competencia" e "habilidade" da resposta.\n\n${allTxt}`;
}

const JSON_SCHEMA_TXT = `Responda SOMENTE com um objeto JSON válido (sem markdown, sem texto antes ou depois, sem comentários), exatamente neste formato:
{
 "area": "string",
 "disciplina": "string",
 "tema": "string",
 "dificuldade": "Fácil" | "Médio" | "Difícil",
 "competencia": {"numero": number, "texto": "string (texto oficial completo da competência)"},
 "habilidade": {"codigo": "HXX", "texto": "string (texto oficial completo da habilidade)"},
 "recurso": "nenhum" | "imagem" | "grafico" | "tabela",
 "visual": null ou objeto conforme instruído acima,
 "textoBase": "string (texto-suporte com contextualização; termine com a citação de fonte no formato ENEM, real ou verossímil)",
 "comando": "string (o enunciado da pergunta, curto, indireto)",
 "alternativas": {"A":"string","B":"string","C":"string","D":"string","E":"string"},
 "gabarito": "A" | "B" | "C" | "D" | "E",
 "resolucaoComentada": "string (explicação detalhada do raciocínio para chegar à resposta correta)",
 "analiseAlternativas": {
   "A": {"status":"correta"|"incorreta","comentario":"string"},
   "B": {"status":"correta"|"incorreta","comentario":"string"},
   "C": {"status":"correta"|"incorreta","comentario":"string"},
   "D": {"status":"correta"|"incorreta","comentario":"string"},
   "E": {"status":"correta"|"incorreta","comentario":"string"}
 }
}
No campo "comentario" de cada alternativa errada, nomeie explicitamente o tipo de distrator (leitura parcial, inversão de causa/efeito, verdade parcial, anacronismo/confusão conceitual, senso comum, erro de processo, excesso de escopo, reaproveitamento fora de contexto) e explique o raciocínio equivocado que ela representa. Nunca deixe mais de uma alternativa com status "correta".`;

function buildUserPrompt(q){
  return `Elabore UMA questão inédita, original, no padrão ENEM, com os seguintes parâmetros definidos pelo professor:

Área do conhecimento: ${AREA_META[state.area].label}
Disciplina: ${state.disciplina}
Tema/conteúdo solicitado: ${q.tema || "(o professor não detalhou; escolha um tema representativo da disciplina e do nível de dificuldade pedidos)"}
Nível de dificuldade: ${q.dificuldade}

${RECURSO_INSTRUCOES[q.recurso]}

${buildMatrizInstrucoes(q)}

${JSON_SCHEMA_TXT}`;
}

const VALIDATION_CHECKLIST = `Revise a questão JSON abaixo (elaborada por você mesmo) contra estes critérios pedagógicos, um a um:
1. Existe somente uma alternativa correta e inequívoca.
2. Não há alternativas ambíguas ou defensáveis como corretas além do gabarito.
3. Os quatro distratores são plausíveis, cada um representando um erro de raciocínio específico (nunca aleatório).
4. O conteúdo científico/conceitual está correto.
5. A questão realmente corresponde ao nível de dificuldade solicitado.
6. A competência indicada é adequada à operação cognitiva exigida pela questão.
7. A habilidade indicada é adequada à operação cognitiva exigida pela questão.
8. A questão tem as características estruturais do ENEM: texto-suporte com fonte citada, comando indireto (não pede repetição literal), 5 alternativas com extensão/estrutura parecidas.
9. Se há gráfico, tabela ou imagem, os dados/descrição são coerentes com o enunciado e efetivamente necessários para a resolução (não decorativos).
10. Todas as informações necessárias para resolver a questão estão disponíveis no texto-base, no comando ou no recurso visual.
11. Não há pistas involuntárias (ex.: alternativa correta com tamanho, redação ou grau de detalhe muito diferente das demais) que entreguem a resposta sem raciocínio.
12. A resposta exige interpretação/raciocínio, não apenas memorização direta de um fato isolado.

Se ALGUM critério não for plenamente atendido, reescreva a questão inteira corrigindo o problema, mantendo o mesmo tema, dificuldade e recurso visual solicitados. Se todos os critérios já estiverem atendidos, apenas devolva a mesma questão.

QUESTÃO A REVISAR:
__DRAFT_JSON__

${JSON_SCHEMA_TXT}`;

/* ---------------- API call ---------------- */
async function callClaude(system, userMsg, maxTokens){
  if(!state.apiKey){ throw new Error("Configure sua chave de API da Anthropic em Configurações antes de gerar questões."); }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": state.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: state.model,
      max_tokens: maxTokens || 8000,
      system: system,
      messages: [{ role: "user", content: userMsg }],
      // Modelos mais novos (com "thinking" adaptativo) podem antepor um bloco de
      // "pensamento" antes do texto. Desativamos explicitamente para garantir que
      // a resposta seja só o JSON esperado, sem precisar lidar com esse bloco extra.
      thinking: { type: "disabled" },
    }),
  });
  // Lê como texto primeiro — algumas respostas de erro (ex.: 401 de um proxy/CDN)
  // podem vir com corpo vazio ou não-JSON, e resp.json() quebraria nesse caso.
  const rawBody = await resp.text();
  let data = {};
  try{ data = rawBody ? JSON.parse(rawBody) : {}; }catch(e){ /* corpo não é JSON — trata abaixo */ }

  if(!resp.ok){
    let msg = (data && data.error && data.error.message) ? data.error.message : "";
    if(!msg) msg = rawBody ? rawBody.slice(0, 300) : `Erro HTTP ${resp.status} ${resp.statusText || ""}`.trim();
    if(resp.status === 401){
      msg = `Chave de API inválida ou expirada (401). Verifique a chave em Configurações — deve começar com "sk-ant-". Detalhe: ${msg}`;
    }
    throw new Error(msg);
  }
  // Procura o primeiro bloco de texto (evita pegar um bloco de "thinking" por engano,
  // caso o modelo insira um mesmo com thinking desativado).
  const textBlock = Array.isArray(data.content) ? data.content.find(b => b && b.type === "text") : null;
  const text = textBlock ? (textBlock.text || "") : "";
  return { text, truncated: data.stop_reason === "max_tokens" };
}

// Escapa quebras de linha/tabs "crus" que aparecem DENTRO de strings JSON
// (comum quando a IA escreve um texto longo e esquece de escapar \n) —
// sem isso, JSON.parse falha com "Bad control character in string literal".
function sanitizeJsonControlChars(text){
  let out = "";
  let inString = false;
  let escaped = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(inString){
      if(escaped){ out += ch; escaped = false; continue; }
      if(ch === "\\"){ out += ch; escaped = true; continue; }
      if(ch === '"'){ inString = false; out += ch; continue; }
      if(ch === "\n"){ out += "\\n"; continue; }
      if(ch === "\r"){ out += "\\r"; continue; }
      if(ch === "\t"){ out += "\\t"; continue; }
      out += ch;
    } else {
      if(ch === '"'){ inString = true; out += ch; continue; }
      out += ch;
    }
  }
  return out;
}

function parseJSONLoose(text){
  const raw = (text || "").trim();

  const candidates = [raw];
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if(fenced){ candidates.push(fenced[1].trim()); }
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if(start !== -1 && end !== -1 && end > start){
    candidates.push(raw.slice(start, end + 1));
  }

  let lastErr;
  for(const cand of candidates){
    const variants = [
      cand,
      cand.replace(/,(\s*[}\]])/g, "$1"),
      sanitizeJsonControlChars(cand),
      sanitizeJsonControlChars(cand).replace(/,(\s*[}\]])/g, "$1"),
    ];
    for(const v of variants){
      try{ return JSON.parse(v); } catch(e){ lastErr = e; }
    }
  }

  const preview = raw.slice(0, 220).replace(/\s+/g, " ");
  const detail = lastErr ? lastErr.message : "erro desconhecido";
  throw new Error(`Não foi possível interpretar a resposta do agente como JSON (${detail}). Início da resposta recebida: "${preview}${raw.length > 220 ? "..." : ""}"`);
}

// Chama a API e já interpreta o JSON, tentando de novo com mais espaço de saída
// se a resposta anterior tiver sido cortada por limite de tokens.
async function callClaudeForJSON(system, userMsg){
  let { text, truncated } = await callClaude(system, userMsg, 8000);
  try{
    return parseJSONLoose(text);
  }catch(err){
    if(truncated){
      const retry = await callClaude(system, userMsg, 12000);
      return parseJSONLoose(retry.text);
    }
    throw err;
  }
}

/* ---------------- Generation orchestration ---------------- */
// A geração roda inteiramente no backend (Supabase Edge Function "generate-question"):
// o navegador só envia os parâmetros da questão (área, disciplina, tema, dificuldade,
// recurso, competência/habilidade) e recebe a questão pronta. A chamada à API da
// Anthropic e a chave usada para isso ficam só no servidor — nunca no navegador.
async function generateQuestion(q){
  q.status = "generating"; q.errorMsg = ""; renderResults();
  try{
    const validar = document.getElementById("chkValidacao").checked;
    const resp = await fetch(QUESTION_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        area: state.area,
        disciplina: state.disciplina,
        tema: q.tema || "",
        dificuldade: q.dificuldade,
        recurso: q.recurso,
        competenciaNum: q.competenciaNum || null,
        habilidadeCod: q.habilidadeCod || null,
        instrucoesVisual: q.instrucoesVisual || "",
        validar,
      }),
    });
    const rawBody = await resp.text();
    let payload = {};
    try{ payload = rawBody ? JSON.parse(rawBody) : {}; }catch(e){ /* corpo não é JSON — trata abaixo */ }
    if(!resp.ok || payload.error){
      const msg = payload.error || rawBody.slice(0, 300) || `Erro HTTP ${resp.status} ao gerar a questão.`;
      throw new Error(msg);
    }
    if(!payload.question){
      throw new Error("O backend não retornou a questão.");
    }

    q.data = payload.question;
    q.status = "done";
  } catch(err){
    q.status = "error";
    q.errorMsg = err.message || String(err);
  }
  renderResults();
  updateProgress();
}

async function runPool(items, worker, concurrency){
  let i = 0;
  const runners = new Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while(i < items.length){
      const idx = i++; await worker(items[idx]);
    }
  });
  await Promise.all(runners);
}

async function generateAll(){
  document.getElementById("formPanel").style.display = "none";
  document.getElementById("resultsPanel").style.display = "block";
  document.getElementById("genProgressWrap").classList.remove("hidden");
  state.questions.forEach(q => { q.status = "idle"; q.data = null; q.errorMsg = ""; });
  renderResults();
  updateProgress();
  await runPool(state.questions, generateQuestion, 2);
  document.getElementById("genProgressWrap").classList.add("hidden");
  toast("Simulado gerado! Revise, edite ou regenere questões conforme necessário.", "ok");
}

function updateProgress(){
  const total = state.questions.length;
  const done = state.questions.filter(q => q.status === "done" || q.status === "error").length;
  const pct = total ? Math.round((done/total)*100) : 0;
  document.getElementById("genProgressFill").style.width = pct + "%";
  document.getElementById("resultsSummary").textContent =
    `${AREA_META[state.area].label} · ${state.disciplina} · ${total} questão(ões) · ${done}/${total} concluídas`;
}

/* ---------------- Results rendering ---------------- */
function renderResults(){
  const wrap = document.getElementById("questionResults");
  wrap.innerHTML = "";
  state.questions.forEach((q, idx) => wrap.appendChild(renderQuestionCard(q, idx)));
  document.body.classList.toggle("mode-aluno", state.viewMode === "aluno");
  document.body.classList.toggle("mode-professor", state.viewMode === "professor");
  renderSummaryTable();
}

function renderSummaryTable(){
  const done = state.questions.filter(q => q.status === "done");
  const card = document.getElementById("summaryCard");
  if(!done.length){ card.classList.add("hidden"); return; }
  card.classList.remove("hidden");
  const body = document.getElementById("summaryBody");
  body.innerHTML = "";
  state.questions.forEach((q, idx) => {
    if(q.status !== "done") return;
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${idx+1}</td><td>${escapeHtml(q.data.tema||q.tema)}</td><td>${escapeHtml(q.data.habilidade?.codigo||"—")}</td><td>${escapeHtml(q.data.dificuldade||q.dificuldade)}</td><td><strong>${escapeHtml(q.data.gabarito||"—")}</strong></td>`;
    body.appendChild(tr);
  });
}

function escapeHtml(s){ return String(s==null?"":s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

function renderQuestionCard(q, idx){
  const el = document.createElement("div");
  el.className = "qcard";
  const top = document.createElement("div"); top.className = "qcard-top"; el.appendChild(top);
  const inner = document.createElement("div"); inner.className = "qcard-inner";

  const head = document.createElement("div"); head.className = "qcard-head";
  head.innerHTML = `
    <div class="qtitle">
      <div class="qnum-badge">${idx+1}</div>
      <div>
        <h3>${q.data ? escapeHtml(q.data.tema || q.tema || "Questão") : escapeHtml(q.tema || "Questão " + (idx+1))}</h3>
        <div class="qcard-meta">${state.disciplina} ${q.approved ? " · <span style='color:#4ade80'>✓ aprovada</span>" : ""}</div>
      </div>
    </div>
    <div class="qcard-actions no-print"></div>
  `;
  inner.appendChild(head);

  const actions = head.querySelector(".qcard-actions");
  actions.appendChild(iconBtn("🔄", "Regenerar", () => generateQuestion(q)));
  actions.appendChild(iconBtn("✏️", "Editar", () => toggleEdit(el, q, idx)));
  if(q.data){
    actions.appendChild(iconBtn("⬇️", "Mais fácil", () => { q.dificuldade = "Fácil"; generateQuestion(q); }));
    actions.appendChild(iconBtn("⬆️", "Mais difícil", () => { q.dificuldade = "Difícil"; generateQuestion(q); }));
  }
  actions.appendChild(iconBtn(idx===0?"":"↑", "Mover para cima", () => moveQuestion(idx, -1), idx===0));
  actions.appendChild(iconBtn(idx===state.questions.length-1?"":"↓", "Mover para baixo", () => moveQuestion(idx, 1), idx===state.questions.length-1));
  actions.appendChild(iconBtn(q.approved?"✅":"☑️", q.approved?"Aprovada":"Aprovar", () => { q.approved = !q.approved; renderResults(); }));
  actions.appendChild(iconBtn("🗑️", "Excluir", () => deleteQuestion(idx)));

  // status / body
  if(q.status === "idle"){
    const s = document.createElement("div"); s.className = "status-line"; s.textContent = "Aguardando geração...";
    inner.appendChild(s);
  } else if(q.status === "generating" || q.status === "validating"){
    const s = document.createElement("div"); s.className = "status-line";
    s.innerHTML = `<div class="spinner"></div> O agente está elaborando (e revisando pedagogicamente) esta questão...`;
    inner.appendChild(s);
  } else if(q.status === "error"){
    const s = document.createElement("div"); s.className = "status-line";
    s.innerHTML = `⚠️ Erro ao gerar: ${escapeHtml(q.errorMsg)}`;
    inner.appendChild(s);
  } else if(q.status === "done"){
    inner.appendChild(buildQuestionBody(q.data, q));
  }

  // inline edit form (hidden by default)
  const editWrap = document.createElement("div");
  editWrap.className = "editrow hidden";
  editWrap.dataset.editFor = q.id;
  inner.appendChild(editWrap);

  el.appendChild(inner);
  return el;
}

function iconBtn(icon, title, onClick, disabled){
  const b = document.createElement("button");
  b.className = "btn ghost sm"; b.title = title; b.textContent = icon;
  if(disabled){ b.disabled = true; }
  else { b.addEventListener("click", onClick); }
  return b;
}

function moveQuestion(idx, dir){
  const j = idx + dir;
  if(j < 0 || j >= state.questions.length) return;
  const tmp = state.questions[idx]; state.questions[idx] = state.questions[j]; state.questions[j] = tmp;
  renderResults();
}

function deleteQuestion(idx){
  state.questions.splice(idx, 1);
  state.qty = state.questions.length;
  document.getElementById("qtyVal").textContent = state.qty;
  renderResults();
  updateProgress();
}

function toggleEdit(cardEl, q, idx){
  const editWrap = cardEl.querySelector(`[data-edit-for="${q.id}"]`);
  if(!editWrap.classList.contains("hidden")){ editWrap.classList.add("hidden"); editWrap.innerHTML=""; return; }
  editWrap.classList.remove("hidden");
  editWrap.innerHTML = `
    <div style="width:100%;display:grid;grid-template-columns:1fr;gap:10px;">
      <div>
        <label class="field-label">Tema</label>
        <textarea class="edit-tema">${escapeHtml(q.tema)}</textarea>
      </div>
      <div class="qgrid2">
        <div>
          <label class="field-label">Dificuldade</label>
          <select class="edit-dif">
            ${["Fácil","Médio","Difícil"].map(d=>`<option ${q.dificuldade===d?"selected":""}>${d}</option>`).join("")}
          </select>
        </div>
        <div>
          <label class="field-label">Recurso visual</label>
          <select class="edit-rec">
            <option value="nenhum" ${q.recurso==="nenhum"?"selected":""}>Sem recurso</option>
            <option value="imagem" ${q.recurso==="imagem"?"selected":""}>Imagem</option>
            <option value="grafico" ${q.recurso==="grafico"?"selected":""}>Gráfico</option>
            <option value="tabela" ${q.recurso==="tabela"?"selected":""}>Tabela</option>
          </select>
        </div>
      </div>
      <div class="visual-instr-block" style="${q.recurso==="nenhum"?"display:none;":""}">
        <label class="field-label">Instruções opcionais para a criação d${q.recurso==="imagem"?"a imagem":q.recurso==="tabela"?"a tabela":"o gráfico"}</label>
        <textarea class="edit-instr-visual" placeholder="Ex.: mostre o coração em corte transversal, com as quatro câmaras nomeadas; use um gráfico de linha em vez de barras...">${escapeHtml(q.instrucoesVisual||"")}</textarea>
      </div>
      <div class="qgrid2">
        <div>
          <label class="field-label">Competência</label>
          <select class="edit-comp"></select>
        </div>
        <div>
          <label class="field-label">Habilidade</label>
          <select class="edit-hab"></select>
        </div>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button class="btn sm ghost edit-cancel">Cancelar</button>
        <button class="btn sm edit-save">Salvar e gerar novamente</button>
      </div>
    </div>
  `;
  const compSel = editWrap.querySelector(".edit-comp");
  const habSel = editWrap.querySelector(".edit-hab");
  const recSel = editWrap.querySelector(".edit-rec");
  const instrBlock = editWrap.querySelector(".visual-instr-block");
  const instrLabel = instrBlock.querySelector(".field-label");
  populateCompetenciaSelect(compSel, q.competenciaNum);
  populateHabilidadeSelect(habSel, q.competenciaNum, q.habilidadeCod);
  compSel.addEventListener("change", () => {
    const val = compSel.value ? parseInt(compSel.value) : null;
    populateHabilidadeSelect(habSel, val, null);
  });
  recSel.addEventListener("change", () => {
    instrBlock.style.display = recSel.value === "nenhum" ? "none" : "";
    instrLabel.textContent = `Instruções opcionais para a criação d${recSel.value==="imagem"?"a imagem":recSel.value==="tabela"?"a tabela":"o gráfico"}`;
  });
  editWrap.querySelector(".edit-cancel").addEventListener("click", () => { editWrap.classList.add("hidden"); editWrap.innerHTML=""; });
  editWrap.querySelector(".edit-save").addEventListener("click", () => {
    q.tema = editWrap.querySelector(".edit-tema").value;
    q.dificuldade = editWrap.querySelector(".edit-dif").value;
    q.recurso = recSel.value;
    q.instrucoesVisual = editWrap.querySelector(".edit-instr-visual").value;
    q.competenciaNum = compSel.value ? parseInt(compSel.value) : null;
    q.habilidadeCod = habSel.value || null;
    editWrap.classList.add("hidden"); editWrap.innerHTML = "";
    generateQuestion(q);
  });
}

function buildQuestionBody(data, q){
  const wrap = document.createElement("div");

  const metaRow = document.createElement("div");
  metaRow.style.cssText = "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;";
  metaRow.innerHTML = `
    <span class="badge dif-${data.dificuldade}">${data.dificuldade}</span>
    <span class="badge">${escapeHtml(data.habilidade?.codigo||"")}</span>
    <span class="badge professor-only gabarito-badge">Gabarito: ${escapeHtml(data.gabarito||"")}</span>
  `;
  wrap.appendChild(metaRow);

  const tb = document.createElement("div"); tb.className = "texto-base"; tb.textContent = data.textoBase || "";
  wrap.appendChild(tb);

  if(data.visual && data.visual.tipo){
    wrap.appendChild(buildVisual(data.visual, q));
  }

  const cmd = document.createElement("p"); cmd.className = "comando"; cmd.textContent = data.comando || "";
  wrap.appendChild(cmd);

  const altList = document.createElement("div"); altList.className = "alt-list";
  ["A","B","C","D","E"].forEach(letter => {
    const isCorrect = data.gabarito === letter;
    const item = document.createElement("div");
    item.className = "alt-item" + (isCorrect ? " correct" : "");
    const comentario = data.analiseAlternativas && data.analiseAlternativas[letter] ? data.analiseAlternativas[letter].comentario : "";
    item.innerHTML = `
      <div class="alt-letter">${letter}</div>
      <div style="flex:1;">
        <div>${escapeHtml((data.alternativas && data.alternativas[letter]) || "")}</div>
        <div class="alt-comment professor-only">${isCorrect ? "✅ CORRETA" : "❌ INCORRETA"} — ${escapeHtml(comentario)}</div>
      </div>
    `;
    altList.appendChild(item);
  });
  wrap.appendChild(altList);

  const pedagog = document.createElement("div"); pedagog.className = "pedagog professor-only";
  pedagog.innerHTML = `
    <div class="pedagog-grid">
      <div class="pedagog-item"><div class="lab">Área</div><div class="val">${escapeHtml(AREA_META[state.area].label)}</div></div>
      <div class="pedagog-item"><div class="lab">Disciplina</div><div class="val">${escapeHtml(data.disciplina||state.disciplina)}</div></div>
      <div class="pedagog-item"><div class="lab">Dificuldade</div><div class="val">${escapeHtml(data.dificuldade||"")}</div></div>
      <div class="pedagog-item"><div class="lab">Gabarito</div><div class="val">${escapeHtml(data.gabarito||"")}</div></div>
    </div>
    <div class="pedagog-grid">
      <div class="pedagog-item" style="grid-column:1/-1;"><div class="lab">Competência</div><div class="val">Competência ${escapeHtml(data.competencia?.numero)} — ${escapeHtml(data.competencia?.texto)}</div></div>
      <div class="pedagog-item" style="grid-column:1/-1;"><div class="lab">Habilidade</div><div class="val">${escapeHtml(data.habilidade?.codigo)} — ${escapeHtml(data.habilidade?.texto)}</div></div>
    </div>
    <div class="lab" style="font-size:10.5px;text-transform:uppercase;letter-spacing:.5px;color:var(--ink-2);margin-bottom:6px;">Resolução comentada</div>
    <div class="resolucao">${escapeHtml(data.resolucaoComentada||"")}</div>
  `;
  wrap.appendChild(pedagog);

  return wrap;
}

// Rótulo em português do tipo de recurso visual, para textos de botão/mensagens.
function recursoLabel(tipo){
  return tipo === "imagem" ? "imagem" : tipo === "grafico" ? "gráfico" : tipo === "tabela" ? "tabela" : "recurso visual";
}

function buildVisual(visual, q){
  const box = document.createElement("div"); box.className = "visual-box";

  const headerRow = document.createElement("div"); headerRow.className = "visual-header-row";
  const title = document.createElement("div"); title.className = "visual-title";
  title.textContent = visual.titulo || (visual.tipo === "imagem" ? "Imagem ilustrativa" : visual.tipo === "grafico" ? "Gráfico" : "Tabela");
  headerRow.appendChild(title);
  const redoBtn = document.createElement("button");
  redoBtn.className = "btn sm ghost no-print visual-redo-btn";
  redoBtn.textContent = `🔄 Refazer ${recursoLabel(visual.tipo)}`;
  redoBtn.title = `Gera uma nova versão d${visual.tipo==="imagem"?"a imagem":visual.tipo==="tabela"?"a tabela":"o gráfico"}, mantendo o restante da questão exatamente como está.`;
  headerRow.appendChild(redoBtn);
  box.appendChild(headerRow);

  // Instruções opcionais, editáveis a qualquer momento (antes ou depois da geração) —
  // usadas tanto na criação inicial do recurso visual quanto em cada "refazer".
  const instrWrap = document.createElement("div"); instrWrap.className = "visual-instr-wrap no-print";
  instrWrap.innerHTML = `
    <label class="field-label">Instruções opcionais para o "refazer"</label>
    <textarea class="visual-instr-input" placeholder="Ex.: use um gráfico de linha em vez de barras; destaque o ano de 2020; mostre em corte transversal...">${escapeHtml(q.instrucoesVisual||"")}</textarea>
  `;
  box.appendChild(instrWrap);
  instrWrap.querySelector(".visual-instr-input").addEventListener("input", e => { q.instrucoesVisual = e.target.value; });

  const body = document.createElement("div"); body.className = "visual-body";
  box.appendChild(body);
  renderVisualContent(body, visual);

  redoBtn.addEventListener("click", () => {
    if(visual.tipo === "imagem"){
      redoImageVisual(q, visual, body);
    } else {
      redoDataVisual(q, body, title, redoBtn);
    }
  });

  return box;
}

// Desenha o conteúdo do recurso visual (imagem/tabela/gráfico) dentro de .visual-body.
// Extraído à parte para poder ser chamado de novo, no mesmo elemento já existente na
// tela, quando o professor/aluno clica em "Refazer" — sem precisar recriar o card inteiro.
function renderVisualContent(body, visual){
  body.innerHTML = "";
  if(visual.tipo === "imagem"){
    const promptText = visual.promptImagem || visual.descricao || "ilustração científica educacional";
    const holder = document.createElement("div");
    holder.className = "visual-image-holder";
    body.appendChild(holder);
    renderGeneratedImage(holder, promptText, visual.descricao || "");
  } else if(visual.tipo === "tabela"){
    const table = document.createElement("table"); table.className = "enem-table";
    const thead = document.createElement("thead"); const trh = document.createElement("tr");
    (visual.colunas||[]).forEach(c => { const th = document.createElement("th"); th.textContent = c; trh.appendChild(th); });
    thead.appendChild(trh); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    (visual.linhas||[]).forEach(row => {
      const tr = document.createElement("tr");
      row.forEach(cell => { const td = document.createElement("td"); td.textContent = cell; tr.appendChild(td); });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    body.appendChild(table);
  } else if(visual.tipo === "grafico"){
    const canvas = document.createElement("canvas"); canvas.style.maxHeight = "340px";
    body.appendChild(canvas);
    setTimeout(() => {
      try{
        new Chart(canvas.getContext("2d"), {
          type: visual.chartType || "bar",
          data: { labels: visual.labels || [], datasets: (visual.datasets||[]).map((ds,i) => ({
            label: ds.label, data: ds.data,
            backgroundColor: chartColor(i, .55), borderColor: chartColor(i, 1), borderWidth: 2, tension: .3,
          })) },
          options: {
            responsive: true,
            plugins: { legend: { labels: { color: "#c7cde3" } }, title: { display: !!visual.titulo, text: visual.titulo||"", color:"#fff" } },
            scales: (visual.chartType === "pie") ? {} : {
              x: { ticks: { color: "#8a92b8" }, grid: { color: "rgba(255,255,255,.06)" } },
              y: { ticks: { color: "#8a92b8" }, grid: { color: "rgba(255,255,255,.06)" } },
            },
          },
        });
      } catch(e){ body.innerHTML += `<p class="hint">Não foi possível renderizar o gráfico.</p>`; }
    }, 30);
  }
}

function renderGeneratedImage(holder, promptText, descricao){
  holder.innerHTML = `
    <div class="visual-image-loading" style="text-align:center;padding:28px 12px;">
      <div class="spinner" style="margin:0 auto;"></div>
      <div class="hint" style="margin-top:10px;">Gerando imagem... pode levar alguns segundos.</div>
    </div>
  `;
  generateImageViaBackend(promptText).then(dataUrl => {
    holder.innerHTML = "";
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = descricao || "";
    holder.appendChild(img);
    if(descricao){
      const cap = document.createElement("p");
      cap.style.cssText = "font-size:12px;color:var(--ink-2);margin:10px 0 0;";
      cap.textContent = descricao;
      holder.appendChild(cap);
    }
  }).catch(err => {
    holder.innerHTML = `
      <div style="text-align:center;padding:18px 12px;">
        <p class="hint" style="color:#f87171;">⚠️ Não foi possível gerar a imagem: ${escapeHtml(err.message || String(err))}</p>
        <button class="btn sm ghost no-print retry-img-btn">🔄 Tentar novamente</button>
      </div>
    `;
    holder.querySelector(".retry-img-btn").addEventListener("click", () => renderGeneratedImage(holder, promptText, descricao));
  });
}

// Botão "Refazer" para imagens: gera uma nova imagem (novo sorteio do modelo de imagem)
// a partir do mesmo conceito já definido pela questão, combinado com as instruções
// opcionais atuais do professor/aluno. Não passa de novo pelo Claude — é uma chamada
// direta e rápida ao backend de imagens, no mesmo local (holder) já exibido na tela.
function redoImageVisual(q, visual, body){
  const holder = body.querySelector(".visual-image-holder");
  if(!holder) return;
  const instrucoes = (q.instrucoesVisual || "").trim();
  const basePrompt = visual.promptImagem || visual.descricao || "ilustração científica educacional";
  const promptText = instrucoes
    ? `${basePrompt}\n\nInstruções adicionais do professor/aluno para esta nova versão: ${instrucoes}`
    : basePrompt;
  renderGeneratedImage(holder, promptText, visual.descricao || "");
}

// Botão "Refazer" para gráfico/tabela: pede ao backend (que por sua vez chama o Claude)
// para gerar SÓ um novo recurso visual, mantendo o texto-base, comando, alternativas,
// gabarito e resolução comentada da questão exatamente como estão — guiado pelas
// instruções opcionais atuais, se houver.
async function redoDataVisual(q, body, titleEl, redoBtn){
  redoBtn.disabled = true;
  const originalLabel = redoBtn.textContent;
  redoBtn.textContent = "⏳ Refazendo...";
  body.innerHTML = `
    <div style="text-align:center;padding:28px 12px;">
      <div class="spinner" style="margin:0 auto;"></div>
      <div class="hint" style="margin-top:10px;">Refazendo ${recursoLabel(q.data.visual.tipo)}...</div>
    </div>
  `;
  try{
    const resp = await fetch(QUESTION_BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        regenerarVisual: true,
        area: state.area,
        disciplina: state.disciplina,
        tema: q.data.tema || q.tema || "",
        dificuldade: q.data.dificuldade || q.dificuldade,
        recurso: q.data.visual.tipo,
        textoBase: q.data.textoBase || "",
        comando: q.data.comando || "",
        alternativas: q.data.alternativas || {},
        gabarito: q.data.gabarito || "",
        resolucaoComentada: q.data.resolucaoComentada || "",
        instrucoesVisual: q.instrucoesVisual || "",
      }),
    });
    const rawBody = await resp.text();
    let payload = {};
    try{ payload = rawBody ? JSON.parse(rawBody) : {}; }catch(e){ /* corpo não é JSON — trata abaixo */ }
    if(!resp.ok || payload.error){
      throw new Error(payload.error || rawBody.slice(0, 300) || `Erro HTTP ${resp.status} ao refazer o recurso visual.`);
    }
    if(!payload.visual){
      throw new Error("O backend não retornou um novo recurso visual.");
    }
    q.data.visual = payload.visual;
    titleEl.textContent = payload.visual.titulo || titleEl.textContent;
    renderVisualContent(body, payload.visual);
  } catch(err){
    // Mantém a versão anterior visível (ela não foi alterada) e só avisa do erro.
    renderVisualContent(body, q.data.visual);
    toast(`Não foi possível refazer: ${err.message || String(err)}`, "err");
  } finally {
    redoBtn.disabled = false;
    redoBtn.textContent = originalLabel;
  }
}

function chartColor(i, alpha){
  const palette = [`99,102,241`,`236,72,153`,`16,185,129`,`245,158,11`,`59,130,246`];
  return `rgba(${palette[i % palette.length]},${alpha})`;
}

/* ---------------- View toggle / print ---------------- */
function setViewMode(mode){
  state.viewMode = mode;
  document.getElementById("viewAluno").classList.toggle("active", mode === "aluno");
  document.getElementById("viewProfessor").classList.toggle("active", mode === "professor");
  document.body.classList.toggle("mode-aluno", mode === "aluno");
  document.body.classList.toggle("mode-professor", mode === "professor");
}

function exportHtmlSnapshot(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de exportar.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de exportar.", "err");
    return;
  }
  try{
    const panel = document.getElementById("resultsPanel");
    const clone = panel.cloneNode(true);

    // Remove non-printable UI (toolbar with buttons) from the static export.
    clone.querySelectorAll(".no-print").forEach(n => n.remove());

    // Freeze any live <canvas> charts as static images so the exported file
    // renders correctly without needing Chart.js / JS execution.
    const liveCanvases = panel.querySelectorAll("canvas");
    const cloneCanvases = clone.querySelectorAll("canvas");
    liveCanvases.forEach((liveCanvas, i) => {
      const cloneCanvas = cloneCanvases[i];
      if(!cloneCanvas) return;
      try{
        const img = document.createElement("img");
        img.src = liveCanvas.toDataURL("image/png");
        img.style.cssText = liveCanvas.getAttribute("style") || "max-width:100%;";
        cloneCanvas.replaceWith(img);
      }catch(e){ /* canvas tainted or empty — leave as-is */ }
    });

    const styleTag = document.querySelector("style");
    const css = styleTag ? styleTag.textContent : "";
    const modeClass = state.viewMode === "aluno" ? "mode-aluno" : "mode-professor";
    const titulo = `Simulado ENEM — ${AREA_META[state.area] ? AREA_META[state.area].label : ""} · ${state.disciplina || ""}`;

    const doc = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(titulo)}</title>
<style>${css}
body{background:#0b0f1e;}
@media print{ body{background:#fff;} }
</style>
</head>
<body class="${modeClass}">
<div class="wrap">${clone.outerHTML}</div>
</body>
</html>`;

    const blob = new Blob([doc], {type: "text/html"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const rotulo = state.viewMode === "aluno" ? "aluno" : "professor";
    const safeName = `Simulado_ENEM_${(state.disciplina||"questoes").replace(/[^a-zA-Z0-9]+/g,"_")}_${rotulo}.html`;
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Arquivo HTML exportado com sucesso.", "ok");
  }catch(err){
    toast("Não foi possível exportar o arquivo: " + err.message, "err");
  }
}

/* ---------------- PDF export (desenho vetorial em caixas coloridas — sem screenshot) ---------------- */

const PDF_PALETTE = {
  contexto:    { fill: [241, 245, 249], accent: [100, 116, 139], text: [30, 41, 59] },   // slate
  visual:      { fill: [248, 250, 252], accent: [71, 85, 105],  text: [30, 41, 59] },    // slate escuro
  pergunta:    { fill: [238, 242, 255], accent: [79, 70, 229],  text: [49, 46, 129] },    // indigo
  alternativa: { fill: [248, 250, 252], accent: [148, 163, 184],text: [30, 41, 59] },    // neutro
  correta:     { fill: [236, 253, 245], accent: [16, 185, 129], text: [6, 78, 59] },      // esmeralda
  habilidade:  { fill: [240, 253, 244], accent: [34, 197, 94],  text: [20, 83, 45] },     // verde
  gabarito:    { fill: [255, 251, 235], accent: [217, 119, 6],  text: [120, 53, 15] },    // âmbar
  resposta:    { fill: [236, 254, 255], accent: [8, 145, 178],  text: [22, 78, 99] },     // ciano
  resolucao:   { fill: [255, 247, 237], accent: [234, 88, 12],  text: [124, 45, 18] },    // laranja
  comentario:  { fill: [253, 242, 248], accent: [219, 39, 119], text: [131, 24, 67] },    // rosa
};

// A fonte padrão "helvetica" do jsPDF (Type1/AFM, WinAnsi) não possui glifos para
// vários símbolos matemáticos/científicos comuns em questões de Física, Química e
// Matemática (expoentes como m², s³, letras gregas, ≤ ≥ ≠ ≈, µ, √, etc.) — eles
// aparecem em branco ou como caracteres corrompidos no PDF gerado. Para nunca
// silenciar informação (ex.: "m/s²" virando "m/s"), sanitizamos esses símbolos
// para equivalentes em texto simples só no PDF (a versão em HTML na tela usa fontes
// do sistema/navegador e não precisa disso).
const PDF_SYMBOL_MAP = {
  "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5",
  "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9",
  "₀": "_0", "₁": "_1", "₂": "_2", "₃": "_3", "₄": "_4", "₅": "_5",
  "₆": "_6", "₇": "_7", "₈": "_8", "₉": "_9",
  "µ": "u", "μ": "u",
  "≈": "~", "≠": " diferente de ", "≤": "<=", "≥": ">=",
  "√": "raiz de ", "∞": "infinito",
  "Σ": "somatório de ", "∫": "integral de ",
  "π": "pi", "Δ": "Delta", "δ": "delta", "Ω": "Ohm", "ω": "ômega",
  "α": "alfa", "β": "beta", "θ": "teta", "λ": "lambda", "φ": "fi",
  "′": "'", "″": '"',
};
const PDF_SYMBOL_REGEX = new RegExp(Object.keys(PDF_SYMBOL_MAP).join("|"), "g");
function pdfSanitizeText(text){
  if(text == null) return text;
  return String(text).replace(PDF_SYMBOL_REGEX, ch => PDF_SYMBOL_MAP[ch]);
}

function pdfEnsureSpace(doc, ctx, neededHeight){
  if(ctx.y + neededHeight > ctx.pageHeight - ctx.margin){
    doc.addPage();
    ctx.y = ctx.margin;
  }
}

// Desenha uma "caixa" colorida com um rótulo (label) em maiúsculas e um corpo de texto,
// com barra de destaque colorida à esquerda. Quebra de página automática; se o próprio
// texto for maior que uma página inteira (raro), pagina o conteúdo internamente.
function pdfDrawBox(doc, ctx, opts){
  const { margin, pageWidth, pageHeight } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const padding = opts.padding != null ? opts.padding : 10;
  const innerX = margin + padding + 6;
  const innerWidth = contentWidth - padding * 2 - 6;
  const fontSize = opts.fontSize || 10.5;
  const labelSize = 8;
  const colors = opts.colors;
  const gap = opts.gap != null ? opts.gap : 10;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(fontSize);
  const lines = opts.big ? [] : doc.splitTextToSize(pdfSanitizeText(String(opts.text || "").trim()) || "—", innerWidth);
  const lineHeight = fontSize * 1.34;
  const labelHeight = opts.label ? 14 : 0;
  const bodyHeight = opts.big ? 34 : Math.max(lines.length, 1) * lineHeight;
  const boxHeight = padding * 2 + labelHeight + bodyHeight;
  const maxPageContent = pageHeight - margin * 2;

  if(!opts.big && boxHeight > maxPageContent){
    pdfDrawBoxPaginated(doc, ctx, opts, lines, lineHeight, labelHeight, padding, colors, fontSize, labelSize, gap);
    return;
  }

  pdfEnsureSpace(doc, ctx, boxHeight);
  const boxY = ctx.y;

  doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
  doc.roundedRect(margin, boxY, contentWidth, boxHeight, 6, 6, "F");
  doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.roundedRect(margin, boxY, 4, boxHeight, 2, 2, "F");

  let cursorY = boxY + padding + 6;
  if(opts.label){
    doc.setFont("helvetica", "bold");
    doc.setFontSize(labelSize);
    doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.text(String(opts.label).toUpperCase(), innerX, cursorY);
    cursorY += labelHeight;
  }

  doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
  if(opts.big){
    doc.setFont("helvetica", "bold");
    doc.setFontSize(26);
    doc.text(String(opts.text || "—"), margin + contentWidth / 2, cursorY + 16, { align: "center" });
  } else {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    lines.forEach((line, li) => {
      doc.text(line, innerX, cursorY + fontSize * 0.85 + li * lineHeight);
    });
  }

  ctx.y = boxY + boxHeight + gap;
}

// Fallback para textos gigantes (ex.: uma resolução comentada enorme) que sozinhos
// ultrapassam a altura de uma página — flui o conteúdo por múltiplas páginas.
function pdfDrawBoxPaginated(doc, ctx, opts, lines, lineHeight, labelHeight, padding, colors, fontSize, labelSize, gap){
  const { margin, pageWidth, pageHeight } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const innerX = margin + padding + 6;
  let idx = 0;
  let first = true;
  while(idx < lines.length || first){
    if(ctx.y + 60 > pageHeight - margin){ doc.addPage(); ctx.y = margin; }
    const boxY = ctx.y;
    const availableHeight = (pageHeight - margin) - boxY;
    const availableForLines = availableHeight - padding * 2 - (first ? labelHeight : 0);
    const linesThisPage = Math.max(1, Math.floor(availableForLines / lineHeight));
    const chunk = lines.slice(idx, idx + linesThisPage);
    const boxHeight = padding * 2 + (first ? labelHeight : 0) + chunk.length * lineHeight;

    doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
    doc.roundedRect(margin, boxY, contentWidth, boxHeight, 6, 6, "F");
    doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.roundedRect(margin, boxY, 4, boxHeight, 2, 2, "F");

    let cursorY = boxY + padding + 6;
    if(first && opts.label){
      doc.setFont("helvetica", "bold");
      doc.setFontSize(labelSize);
      doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
      doc.text(String(opts.label).toUpperCase(), innerX, cursorY);
      cursorY += labelHeight;
    }
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
    chunk.forEach((line, li) => {
      doc.text(line, innerX, cursorY + fontSize * 0.85 + li * lineHeight);
    });

    ctx.y = boxY + boxHeight;
    idx += chunk.length;
    first = false;
    if(idx < lines.length){ doc.addPage(); ctx.y = margin; }
  }
  ctx.y += gap;
}

function pdfGetVisualImageInfo(cardIdx){
  const card = document.querySelectorAll("#questionResults .qcard")[cardIdx];
  if(!card) return null;
  const img = card.querySelector(".visual-image-holder img");
  if(!img || !img.src) return null;
  return { dataUrl: img.src, width: img.naturalWidth || 800, height: img.naturalHeight || 500 };
}

// Os gráficos na tela usam texto claro (legenda, título, eixos) porque o app tem
// fundo escuro. Isso fica ilegível se capturado direto para o PDF (fundo branco).
// Por isso, antes de capturar a imagem do gráfico para o PDF, trocamos temporariamente
// as cores do texto para preto (alto contraste) e as linhas de grade para um cinza
// bem sutil, capturamos, e devolvemos as cores originais da tela em seguida — a
// aparência do app na tela não muda, só a imagem exportada para o PDF.
function pdfGetVisualChartInfo(cardIdx){
  const card = document.querySelectorAll("#questionResults .qcard")[cardIdx];
  if(!card) return null;
  const canvas = card.querySelector(".visual-body canvas");
  if(!canvas) return null;

  const chart = (window.Chart && typeof Chart.getChart === "function") ? Chart.getChart(canvas) : null;
  if(!chart){
    try{
      return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
    }catch(e){ return null; }
  }

  const opts = chart.options || {};
  const legendLabels = opts.plugins?.legend?.labels;
  const title = opts.plugins?.title;
  const xTicks = opts.scales?.x?.ticks;
  const yTicks = opts.scales?.y?.ticks;
  const xGrid = opts.scales?.x?.grid;
  const yGrid = opts.scales?.y?.grid;

  const original = {
    legend: legendLabels ? legendLabels.color : undefined,
    title: title ? title.color : undefined,
    xTicks: xTicks ? xTicks.color : undefined,
    yTicks: yTicks ? yTicks.color : undefined,
    xGrid: xGrid ? xGrid.color : undefined,
    yGrid: yGrid ? yGrid.color : undefined,
  };

  try{
    if(legendLabels) legendLabels.color = "#000000";
    if(title) title.color = "#000000";
    if(xTicks) xTicks.color = "#000000";
    if(yTicks) yTicks.color = "#000000";
    if(xGrid) xGrid.color = "rgba(0,0,0,.12)";
    if(yGrid) yGrid.color = "rgba(0,0,0,.12)";
    chart.update("none");

    return { dataUrl: canvas.toDataURL("image/png"), width: canvas.width, height: canvas.height };
  }catch(e){
    return null;
  }finally{
    // Importante: NÃO reutilizamos as referências de objeto (xTicks/yTicks/xGrid/yGrid)
    // capturadas antes do chart.update() acima — nesta versão do Chart.js, update()
    // regenera internamente os sub-objetos de "scales" (ticks/grid), então a referência
    // antiga fica "órfã" e escrever nela não muda mais nada que o Chart.js realmente lê.
    // Por isso resolvemos os objetos de novo, a partir de chart.options atual, na hora
    // de restaurar. (plugins.legend.labels e plugins.title não têm esse problema, mas
    // resolvemos de novo por segurança/consistência.)
    const freshOpts = chart.options || {};
    const freshLegendLabels = freshOpts.plugins?.legend?.labels;
    const freshTitle = freshOpts.plugins?.title;
    const freshXTicks = freshOpts.scales?.x?.ticks;
    const freshYTicks = freshOpts.scales?.y?.ticks;
    const freshXGrid = freshOpts.scales?.x?.grid;
    const freshYGrid = freshOpts.scales?.y?.grid;

    if(freshLegendLabels) freshLegendLabels.color = original.legend;
    if(freshTitle) freshTitle.color = original.title;
    if(freshXTicks) freshXTicks.color = original.xTicks;
    if(freshYTicks) freshYTicks.color = original.yTicks;
    if(freshXGrid) freshXGrid.color = original.xGrid;
    if(freshYGrid) freshYGrid.color = original.yGrid;
    chart.update("none");
  }
}

// Desenha o recurso visual (imagem gerada por IA, gráfico ou tabela) em sua própria caixa.
// Imagem/gráfico: incorpora a imagem já renderizada na tela (mesma proporção). Tabela: desenhada
// como tabela vetorial de verdade (linhas/colunas nítidas), não como captura de tela.
function pdfDrawVisualBox(doc, ctx, visual, cardIdx){
  if(!visual || !visual.tipo) return;
  const { margin, pageWidth, pageHeight } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const colors = PDF_PALETTE.visual;
  const padding = 10;
  const innerX = margin + padding + 6;
  const titleText = pdfSanitizeText(visual.titulo) || (visual.tipo === "imagem" ? "Imagem ilustrativa" : visual.tipo === "grafico" ? "Gráfico" : "Tabela");

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return;
    const cellPad = 5;
    const tableWidth = contentWidth - padding * 2 - 6;
    const colWidth = tableWidth / cols.length;
    doc.setFontSize(9);
    const lineH = 9 * 1.3;
    const headerWrapped = cols.map(c => doc.splitTextToSize(pdfSanitizeText(String(c)), colWidth - cellPad * 2));
    const rowsWrapped = rows.map(row => row.map(cell => doc.splitTextToSize(pdfSanitizeText(String(cell)), colWidth - cellPad * 2)));
    const headerHeight = Math.max(...headerWrapped.map(l => l.length), 1) * lineH + cellPad * 2;
    const rowHeights = rowsWrapped.map(r => Math.max(...r.map(l => l.length), 1) * lineH + cellPad * 2);
    const tableHeight = headerHeight + rowHeights.reduce((a, b) => a + b, 0);
    const boxHeight = padding * 2 + 16 + tableHeight;

    pdfEnsureSpace(doc, ctx, Math.min(boxHeight, pageHeight - ctx.margin * 2));
    const y = ctx.y;
    doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
    doc.roundedRect(margin, y, contentWidth, boxHeight, 6, 6, "F");
    doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.roundedRect(margin, y, 4, boxHeight, 2, 2, "F");
    doc.setFont("helvetica", "bold"); doc.setFontSize(8);
    doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    doc.text(titleText.toUpperCase(), innerX, y + padding + 6);

    let ty = y + padding + 16;
    const tx = innerX;
    doc.setDrawColor(colors.accent[0], colors.accent[1], colors.accent[2]);
    cols.forEach((c, i) => {
      // O preenchimento precisa ser reaplicado a cada coluna: no jsPDF, setTextColor()
      // reusa o mesmo estado interno de "cor de preenchimento" usado por rect(...,"F"),
      // então o texto preto da coluna anterior "vazava" para o preenchimento da
      // próxima célula do cabeçalho se a cor branca não fosse reafirmada aqui.
      doc.setFillColor(255, 255, 255);
      doc.rect(tx + i * colWidth, ty, colWidth, headerHeight, "FD");
      // Preto puro (em vez do slate padrão das caixas) para máxima legibilidade dos
      // dados da tabela, conforme pedido.
      doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
      headerWrapped[i].forEach((line, li) => doc.text(line, tx + i * colWidth + cellPad, ty + cellPad + 7 + li * lineH));
    });
    ty += headerHeight;
    rowsWrapped.forEach((row, ri) => {
      row.forEach((cellLines, ci) => {
        doc.setFillColor(252, 252, 253);
        doc.rect(tx + ci * colWidth, ty, colWidth, rowHeights[ri], "FD");
        doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(0, 0, 0);
        cellLines.forEach((line, li) => doc.text(line, tx + ci * colWidth + cellPad, ty + cellPad + 7 + li * lineH));
      });
      ty += rowHeights[ri];
    });
    ctx.y = y + boxHeight + 10;
    return;
  }

  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx) : pdfGetVisualChartInfo(cardIdx);
  if(!info) return; // sem imagem disponível (ex.: falhou a geração) — não bloqueia o PDF

  const maxW = contentWidth - padding * 2 - 6;
  const maxH = 260;
  let w = maxW, h = w * (info.height / info.width);
  if(h > maxH){ h = maxH; w = h * (info.width / info.height); }

  let capLines = [];
  if(visual.descricao){
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    capLines = doc.splitTextToSize(pdfSanitizeText(visual.descricao), maxW);
  }
  const capHeight = capLines.length ? (capLines.length * 8.5 * 1.3 + 10) : 0;
  const titleHeight = 16;
  const boxHeight = padding * 2 + titleHeight + h + capHeight;

  pdfEnsureSpace(doc, ctx, boxHeight);
  const y = ctx.y;
  doc.setFillColor(colors.fill[0], colors.fill[1], colors.fill[2]);
  doc.roundedRect(margin, y, contentWidth, boxHeight, 6, 6, "F");
  doc.setFillColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.roundedRect(margin, y, 4, boxHeight, 2, 2, "F");
  doc.setFont("helvetica", "bold"); doc.setFontSize(8);
  doc.setTextColor(colors.accent[0], colors.accent[1], colors.accent[2]);
  doc.text(titleText.toUpperCase(), innerX, y + padding + 6);

  const imgX = margin + (contentWidth - w) / 2;
  const imgY = y + padding + titleHeight;
  const fmtMatch = /^data:image\/(png|jpe?g|webp);base64,/i.exec(info.dataUrl);
  const imgFormat = fmtMatch ? fmtMatch[1].toUpperCase().replace("JPG", "JPEG") : "PNG";
  try{ doc.addImage(info.dataUrl, imgFormat, imgX, imgY, w, h); }catch(e){ /* imagem inválida — ignora silenciosamente */ }

  if(capLines.length){
    doc.setFont("helvetica", "normal"); doc.setFontSize(8.5);
    doc.setTextColor(colors.text[0], colors.text[1], colors.text[2]);
    capLines.forEach((line, li) => doc.text(line, innerX, imgY + h + 10 + li * (8.5 * 1.3)));
  }

  ctx.y = y + boxHeight + 10;
}

function pdfDrawQuestionHeader(doc, ctx, q, idx){
  const { margin, pageWidth } = ctx;
  const contentWidth = pageWidth - margin * 2;
  const d = q.data;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.setTextColor(30, 41, 59);
  const title = pdfSanitizeText(`Questão ${idx + 1}` + (d.tema ? ` — ${d.tema}` : ""));
  const titleLines = doc.splitTextToSize(title, contentWidth);
  titleLines.forEach((line, li) => doc.text(line, margin, ctx.y + 12 + li * 16));
  ctx.y += titleLines.length * 16 + 4;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  const metaParts = [d.disciplina || state.disciplina, d.dificuldade].filter(Boolean);
  doc.text(pdfSanitizeText(metaParts.join("   ·   ")), margin, ctx.y + 8);
  ctx.y += 20;
}

async function exportPdf(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de exportar em PDF.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de exportar em PDF.", "err");
    return;
  }
  if(!window.jspdf){
    toast("Biblioteca de PDF não carregou (verifique sua conexão com a internet) e tente novamente.", "err");
    return;
  }

  const btn = document.getElementById("btnExportPdf");
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = "Gerando PDF...";

  try{
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 40;
    const ctx = {
      margin,
      pageWidth: doc.internal.pageSize.getWidth(),
      pageHeight: doc.internal.pageSize.getHeight(),
      y: margin,
    };
    const isAluno = state.viewMode === "aluno";

    doc.setFont("helvetica", "bold");
    doc.setFontSize(20);
    doc.setTextColor(30, 41, 59);
    doc.text("Simulado ENEM", margin, ctx.y + 14);
    ctx.y += 26;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.setTextColor(71, 85, 105);
    doc.text(`${AREA_META[state.area] ? AREA_META[state.area].label : ""} · ${state.disciplina || ""}`, margin, ctx.y + 8);
    ctx.y += 16;
    doc.text(isAluno ? "Versão do aluno (sem gabarito)" : "Versão do professor (com gabarito e comentários)", margin, ctx.y + 8);
    ctx.y += 30;

    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(!doneQuestions.length){ throw new Error("Nenhuma questão para exportar."); }

    doneQuestions.forEach((o, i) => {
      const { q, idx } = o;
      const d = q.data;
      if(i > 0){ doc.addPage(); ctx.y = margin; }

      pdfDrawQuestionHeader(doc, ctx, q, idx);

      if(d.textoBase){
        pdfDrawBox(doc, ctx, { label: "Texto de apoio", text: d.textoBase, colors: PDF_PALETTE.contexto, fontSize: 10 });
      }

      if(d.visual && d.visual.tipo){
        pdfDrawVisualBox(doc, ctx, d.visual, idx);
      }

      if(d.comando){
        pdfDrawBox(doc, ctx, { label: "Pergunta", text: d.comando, colors: PDF_PALETTE.pergunta, fontSize: 11.5 });
      }

      ["A", "B", "C", "D", "E"].forEach(letter => {
        const isCorrect = !isAluno && d.gabarito === letter;
        const altText = (d.alternativas && d.alternativas[letter]) || "";
        pdfDrawBox(doc, ctx, {
          label: `Alternativa ${letter}` + (isCorrect ? " — CORRETA" : ""),
          text: altText,
          colors: isCorrect ? PDF_PALETTE.correta : PDF_PALETTE.alternativa,
          fontSize: 10.5,
          gap: 8,
        });
      });

      if(!isAluno){
        const habText = `Competência ${d.competencia?.numero || "—"}: ${d.competencia?.texto || ""}\n\n${d.habilidade?.codigo || "—"}: ${d.habilidade?.texto || ""}`;
        pdfDrawBox(doc, ctx, { label: "Habilidade e competência", text: habText, colors: PDF_PALETTE.habilidade, fontSize: 10 });

        pdfDrawBox(doc, ctx, { label: "Gabarito", text: d.gabarito || "—", colors: PDF_PALETTE.gabarito, big: true, gap: 14 });

        const respostaText = (d.alternativas && d.alternativas[d.gabarito]) || "";
        pdfDrawBox(doc, ctx, { label: "Resposta correta", text: respostaText, colors: PDF_PALETTE.resposta, fontSize: 10.5 });

        pdfDrawBox(doc, ctx, { label: "Resolução comentada", text: d.resolucaoComentada || "", colors: PDF_PALETTE.resolucao, fontSize: 10 });

        const comentarios = ["A", "B", "C", "D", "E"].map(letter => {
          const info = d.analiseAlternativas && d.analiseAlternativas[letter];
          if(!info) return "";
          const status = info.status === "correta" ? "CORRETA" : "INCORRETA";
          return `${letter} — ${status}: ${info.comentario || ""}`;
        }).filter(Boolean).join("\n\n");
        pdfDrawBox(doc, ctx, { label: "Comentários das alternativas", text: comentarios, colors: PDF_PALETTE.comentario, fontSize: 10 });
      }
    });

    const rotulo = isAluno ? "aluno" : "professor";
    const safeName = `Simulado_ENEM_${(state.disciplina||"questoes").replace(/[^a-zA-Z0-9]+/g,"_")}_${rotulo}.pdf`;
    doc.save(safeName);
    toast("PDF exportado com sucesso.", "ok");
  }catch(err){
    toast("Não foi possível exportar o PDF: " + (err.message || err), "err");
  }finally{
    btn.disabled = false; btn.textContent = originalLabel;
  }
}

/* ---------------- Init / events ---------------- */
function init(){
  renderAreaGrid();
  renderDisciplinaChips();
  setQty(1);

  // Recupera chave/modelo salvos neste navegador, se houver (ver STORAGE_KEYS).
  const savedKey = safeStorageGet(STORAGE_KEYS.apiKey);
  const savedModel = safeStorageGet(STORAGE_KEYS.model);
  if(savedKey){
    state.apiKey = savedKey;
    const keyInput = document.getElementById("apiKeyInput");
    if(keyInput) keyInput.value = savedKey;
  }
  if(savedModel){
    state.model = savedModel;
    const modelInput = document.getElementById("modelInput");
    if(modelInput) modelInput.value = savedModel;
  }

  document.getElementById("qtyMinus").addEventListener("click", () => setQty(state.qty - 1));
  document.getElementById("qtyPlus").addEventListener("click", () => setQty(state.qty + 1));

  document.getElementById("btnGenerate").addEventListener("click", () => {
    if(!state.area){ toast("Selecione a área do conhecimento.", "err"); return; }
    if(!state.disciplina){ toast("Selecione a disciplina.", "err"); return; }
    generateAll();
  });

  document.getElementById("btnBackToForm").addEventListener("click", () => {
    document.getElementById("formPanel").style.display = "block";
    document.getElementById("resultsPanel").style.display = "none";
  });

  document.getElementById("viewAluno").addEventListener("click", () => setViewMode("aluno"));
  document.getElementById("viewProfessor").addEventListener("click", () => setViewMode("professor"));
  document.getElementById("btnPrint").addEventListener("click", () => {
    if(!state.questions.length || !state.questions.some(q => q.status === "done")){
      toast("Gere ao menos uma questão antes de imprimir.", "err");
      return;
    }
    if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
      toast("Aguarde a geração das imagens terminar antes de imprimir.", "err");
      return;
    }
    try{
      if(typeof window.print !== "function") throw new Error("print indisponível");
      window.print();
    }catch(err){
      toast("Seu navegador não abriu a caixa de impressão. Use \"Exportar HTML\" e imprima o arquivo baixado.", "err");
    }
  });
  document.getElementById("btnExport").addEventListener("click", exportHtmlSnapshot);
  document.getElementById("btnExportPdf").addEventListener("click", exportPdf);

  document.getElementById("btnSettings").addEventListener("click", () => openModal("settingsModal"));
  document.getElementById("btnCloseSettings").addEventListener("click", () => closeModal("settingsModal"));
  document.getElementById("btnSaveSettings").addEventListener("click", () => {
    state.apiKey = document.getElementById("apiKeyInput").value.trim();
    state.model = document.getElementById("modelInput").value.trim() || state.model;
    let saved = false;
    if(state.apiKey){
      saved = safeStorageSet(STORAGE_KEYS.apiKey, state.apiKey);
      safeStorageSet(STORAGE_KEYS.model, state.model);
    }
    closeModal("settingsModal");
    if(!state.apiKey){
      toast("Nenhuma chave informada.", "err");
    } else if(saved){
      toast("Chave salva neste navegador — não vai pedir de novo.", "ok");
    } else {
      toast("Configurações salvas para esta sessão (este visualizador não permite lembrar a chave entre sessões).", "ok");
    }
  });

  const btnForgetKey = document.getElementById("btnForgetKey");
  if(btnForgetKey){
    btnForgetKey.addEventListener("click", () => {
      state.apiKey = "";
      safeStorageRemove(STORAGE_KEYS.apiKey);
      safeStorageRemove(STORAGE_KEYS.model);
      const keyInput = document.getElementById("apiKeyInput");
      if(keyInput) keyInput.value = "";
      toast("Chave removida deste navegador.", "ok");
    });
  }

  document.getElementById("btnHelp").addEventListener("click", () => openModal("helpModal"));
  document.getElementById("btnCloseHelp").addEventListener("click", () => closeModal("helpModal"));

  setViewMode("professor");

  // 3D tilt effect on cards (delegated)
  document.addEventListener("mousemove", e => {
    const card = e.target.closest && e.target.closest(".qcard, .area-tile");
    document.querySelectorAll(".qcard.tilt-active, .area-tile.tilt-active").forEach(c => { if(c !== card){ c.style.transform = ""; c.classList.remove("tilt-active"); }});
    if(!card) return;
    const r = card.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width - .5;
    const py = (e.clientY - r.top) / r.height - .5;
    card.classList.add("tilt-active");
    card.style.transform = `perspective(900px) rotateX(${(-py*4).toFixed(2)}deg) rotateY(${(px*4).toFixed(2)}deg) translateY(-2px)`;
  });
  document.addEventListener("mouseleave", () => {
    document.querySelectorAll(".tilt-active").forEach(c => { c.style.transform = ""; c.classList.remove("tilt-active"); });
  }, true);
}

function openModal(id){ document.getElementById(id).classList.add("show"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }

document.addEventListener("DOMContentLoaded", init);
