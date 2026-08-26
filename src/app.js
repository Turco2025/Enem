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

// jsPDF e docx.js são bibliotecas pesadas (~1MB juntas) usadas só nos botões
// "Exportar PDF"/"Exportar DOCX". Em vez de carregá-las sempre no <head> (o que
// deixava a página inicial mais lenta para todo mundo, mesmo quem nunca exporta),
// elas são baixadas sob demanda, uma única vez, na primeira exportação.
const CDN_URLS = {
  jspdf: "https://cdnjs.cloudflare.com/ajax/libs/jspdf/4.2.1/jspdf.umd.min.js",
  docx: "https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js",
};
const _scriptLoadPromises = {};
function loadScriptOnce(url){
  if(_scriptLoadPromises[url]) return _scriptLoadPromises[url];
  _scriptLoadPromises[url] = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = url;
    s.onload = () => resolve();
    s.onerror = () => { delete _scriptLoadPromises[url]; reject(new Error("Falha ao carregar " + url)); };
    document.head.appendChild(s);
  });
  return _scriptLoadPromises[url];
}

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
      prompt: `Ilustração educacional de MÁXIMA QUALIDADE para uma questão de vestibular (padrão ENEM). A imagem tem DUAS CAMADAS, e as duas são obrigatórias.

CAMADA 1 — BASE CINEMATOGRÁFICA: ultra-realistic 4K/8K photography, ultra definition, razor-sharp focus on the subject, cinematic composition, dramatic directional natural lighting, rich material textures and micro-detail, deep saturated color, atmospheric depth of field, epic sense of scale and grandeur — no padrão visual de National Geographic, BBC Earth, Planet Earth e projeção IMAX. Acabamento profissional de fotografia documental de museu. Nada chapado, genérico, borrado, pixelizado ou com cara de clipart.

CAMADA 2 — CAMADA DE ANOTAÇÃO: por cima da cena, uma sobreposição gráfica limpa e vetorial, em estilo de infográfico moderno com princípios de UI/UX — clean vector annotation overlay, consistent labeling system, clear visual hierarchy, clean sans-serif typography at consistent sizes, thin leader lines, generous spacing, high contrast against the scene, e halo suave ou tarja translúcida sutil atrás do texto onde o fundo estiver detalhado. Ela carrega as setas, os rótulos e as marcações de medida descritos na cena abaixo.

REGRA DE PRECEDÊNCIA: the cinematic scene must never obscure the annotation layer. Todo rótulo, seta e valor numérico permanece plenamente legível; se a riqueza da cena ameaçar a leitura, é a cena que cede (menos detalhe, área escurecida ou desfocada atrás da anotação, mais espaço na composição).

TEXTO NA IMAGEM: nenhum texto decorativo, legenda solta, assinatura ou marca d'água. Os únicos textos permitidos são os rótulos, números e marcações descritos na cena abaixo — esses são obrigatórios, precisam aparecer desenhados de forma nítida, legível e corretamente posicionados, e devem ser renderizados EM PORTUGUÊS, exatamente como escritos, com ortografia correta.

FIDELIDADE: a cena deve refletir exatamente a situação descrita, sem acrescentar elementos espetaculares que não façam parte dela.

Cena: ${promptText}`,

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

/* ---------------- Generation orchestration ---------------- */
// A geração roda inteiramente no backend (Supabase Edge Function "generate-question"):
// o navegador só envia os parâmetros da questão (área, disciplina, tema, dificuldade,
// recurso, competência/habilidade) e recebe a questão pronta. A chamada à API da
// Anthropic e a chave usada para isso ficam só no servidor — nunca no navegador.
/* ================= DISTRIBUIÇÃO DO GABARITO ==================================
   Regra do professor: os gabaritos nunca podem ser sequencialmente os mesmos.
   Dentro de cada bloco de CINCO questões consecutivas, as cinco letras aparecem
   uma única vez — logo, com 2, 3, 4 ou 5 questões todos os gabaritos saem
   diferentes, que é exatamente o caso pedido.

   Nota matemática, para quem for mexer nisto: exigir que TODA janela de cinco
   questões consecutivas tenha as cinco letras distintas obriga a sequência a ser
   periódica. Se as posições i..i+4 são uma permutação e i+1..i+5 também, então
   s[i+5] = s[i] — a mesma permutação se repetindo do começo ao fim, um padrão
   ainda mais fácil de decorar do que o problema original. Por isso a regra vale
   por BLOCO de cinco, com duas garantias extras: a primeira letra de um bloco
   nunca repete a última do bloco anterior (nunca há duas iguais seguidas) e cada
   bloco usa uma permutação diferente da anterior (não há período). O resultado
   distribui as cinco letras por igual e não deixa padrão explorável.          */
const GABARITO_LETRAS = ["A", "B", "C", "D", "E"];

function embaralhaLetras(){
  const a = GABARITO_LETRAS.slice();
  for(let i = a.length - 1; i > 0; i--){
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}

function planejaGabaritos(n){
  const plano = [];
  let ultimaLetra = null;
  let blocoAnterior = "";
  while(plano.length < n){
    let bloco = embaralhaLetras();
    for(let t = 0; t < 40; t++){
      const ok = (!ultimaLetra || bloco[0] !== ultimaLetra) && bloco.join("") !== blocoAnterior;
      if(ok) break;
      bloco = embaralhaLetras();
    }
    blocoAnterior = bloco.join("");
    ultimaLetra = bloco[bloco.length - 1];
    plano.push.apply(plano, bloco);
  }
  return plano.slice(0, n);
}

// Garante que o plano existe e cobre o índice pedido (regeneração avulsa também).
function gabaritoAlvoDe(idx){
  if(!Array.isArray(state.gabaritoPlan) || state.gabaritoPlan.length <= idx){
    state.gabaritoPlan = planejaGabaritos(Math.max(state.questions.length, idx + 1));
  }
  return state.gabaritoPlan[idx] || null;
}

// As alternativas numéricas têm de ficar em ordem crescente (Guia do Inep). Se
// estiverem, trocar duas de lugar quebraria a regra — nesse caso não mexemos.
function alternativasNumericasOrdenadas(alts){
  const vals = GABARITO_LETRAS.map(L => {
    const t = String((alts && alts[L]) || "").trim().replace(/\./g, "").replace(",", ".");
    const m = /^-?\d+(\.\d+)?/.exec(t);
    return m ? parseFloat(m[0]) : null;
  });
  if(vals.some(v => v === null)) return false;
  for(let i = 1; i < vals.length; i++){ if(vals[i] < vals[i - 1]) return false; }
  return true;
}

/* Reposiciona a resposta correta na letra planejada. É rede de segurança: o
   prompt já exige a posição, e o certo é o modelo escrever os distratores de
   modo que a correta caia lá respeitando a ordem lógica. Só usamos a troca
   quando ela não quebra a ordem numérica das alternativas.
   Devolve "ok" | "mantido" | "impossivel".                                    */
function aplicaGabaritoAlvo(data, alvo){
  if(!alvo || !data || !data.gabarito) return "mantido";
  if(data.gabarito === alvo) return "ok";
  const alts = data.alternativas;
  if(!alts || !alts[data.gabarito] || !alts[alvo]) return "impossivel";
  if(alternativasNumericasOrdenadas(alts)) return "impossivel";

  const de = data.gabarito;
  const t = alts[de]; alts[de] = alts[alvo]; alts[alvo] = t;
  const an = data.analiseAlternativas;
  if(an && an[de] && an[alvo]){ const t2 = an[de]; an[de] = an[alvo]; an[alvo] = t2; }
  data.gabarito = alvo;
  data.gabaritoReposicionado = true;
  return "ok";
}

// Confere a distribuição final e devolve os problemas encontrados, se houver.
function auditaGabaritos(){
  const letras = state.questions.map(q => (q.data && q.data.gabarito) || null);
  const problemas = [];
  for(let i = 1; i < letras.length; i++){
    if(letras[i] && letras[i] === letras[i - 1]) problemas.push(`questões ${i} e ${i + 1} com o mesmo gabarito (${letras[i]})`);
  }
  for(let b = 0; b < letras.length; b += 5){
    const bloco = letras.slice(b, b + 5).filter(Boolean);
    if(new Set(bloco).size !== bloco.length) problemas.push(`gabarito repetido entre as questões ${b + 1} e ${Math.min(b + 5, letras.length)}`);
  }
  return problemas;
}

async function generateQuestion(q){
  q.status = "generating"; q.errorMsg = ""; updateQuestionCard(q, state.questions.indexOf(q));
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
        gabaritoAlvo: gabaritoAlvoDe(state.questions.indexOf(q)),
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
    // Rede de segurança: a letra planejada tem de ser mesmo a correta.
    q.gabaritoStatus = aplicaGabaritoAlvo(q.data, gabaritoAlvoDe(state.questions.indexOf(q)));
    q.status = "done";
  } catch(err){
    q.status = "error";
    q.errorMsg = err.message || String(err);
  }
  updateQuestionCard(q, state.questions.indexOf(q));
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
  state.questions.forEach(q => { q.status = "idle"; q.data = null; q.errorMsg = ""; q.gabaritoStatus = null; });
  // Plano de gabaritos sorteado ANTES de gerar: como as questões saem em
  // paralelo, cada uma precisa saber de antemão qual letra é a sua, senão não há
  // como garantir que não se repitam.
  state.gabaritoPlan = planejaGabaritos(state.questions.length);
  renderResults();
  updateProgress();
  // Concorrência aumentada de 2 para 4: cada questão já roda inteiramente no
  // backend (Supabase Edge Function), então gerar mais questões em paralelo
  // reduz bastante o tempo total para simulados com várias questões.
  await runPool(state.questions, generateQuestion, 4);
  document.getElementById("genProgressWrap").classList.add("hidden");

  // Auditoria da distribuição do gabarito, com o resultado dito em voz alta.
  const presos = state.questions.filter(q => q.gabaritoStatus === "impossivel").length;
  const problemas = auditaGabaritos();
  if(problemas.length){
    toast("Simulado gerado, mas a distribuição do gabarito ficou imperfeita: " + problemas[0] + ". Regenere a questão para corrigir.", "err");
  }else if(presos){
    toast("Simulado gerado. " + presos + " quest" + (presos > 1 ? "ões vieram" : "ão veio") + " com o gabarito fora da posição planejada e não pôde ser reposicionada sem quebrar a ordem numérica das alternativas.", "err");
  }else{
    toast("Simulado gerado! Revise, edite ou regenere questões conforme necessário.", "ok");
  }
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

// Atualiza SÓ o card da questão `q` (em vez de recriar o painel inteiro, como
// renderResults() faz). Antes, cada mudança de status de UMA questão durante a
// geração (que roda em paralelo para várias questões) reconstruía TODOS os
// cards e recriava do zero todos os gráficos Chart.js já prontos — deixando a
// geração de simulados com várias questões visivelmente mais lenta e travada
// quanto mais questões eram configuradas. Atualizar só o card afetado evita
// esse trabalho redundante.
function updateQuestionCard(q, idx){
  const wrap = document.getElementById("questionResults");
  const existing = wrap.querySelector(`.qcard[data-qid="${q.id}"]`);
  if(existing){
    existing.querySelectorAll("canvas").forEach(cv => {
      const ch = (window.Chart && typeof Chart.getChart === "function") ? Chart.getChart(cv) : null;
      if(ch) ch.destroy();
    });
  }
  const fresh = renderQuestionCard(q, idx);
  if(existing){ existing.replaceWith(fresh); } else { wrap.appendChild(fresh); }
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
  el.dataset.qid = q.id;
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
      <div class="qgrid-stack">
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
      ${data.objetoConhecimento ? `<div class="pedagog-item" style="grid-column:1/-1;"><div class="lab">Objeto de conhecimento</div><div class="val">${escapeHtml(data.objetoConhecimento)}</div></div>` : ""}
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


/* ================= ANATOMIA DO CADERNO ENEM 2025 — versão do aluno ============
   System design obrigatório para PDF, DOCX e impressão da VERSÃO DO ALUNO.
   Todas as medidas vêm de "Anatomia do caderno ENEM" (revisão 2025), levantada
   sobre o PDF oficial do ENEM 2025 — 2º dia, Caderno 7, Azul (INEP/MEC) — pela
   geometria vetorial, pelas fontes incorporadas e por amostragem de pixels.
   Nenhuma medida foi estimada a olho.

   O que mudou em relação à revisão anterior (que era de 2019): a família passou
   de Arial para Calibri; a entrelinha caiu de 12,8 para 12,0 pt; as margens
   passaram a ser espelhadas; o fio da calha virou sólido; o separador de questão
   migrou de um filete pontilhado ABAIXO para uma barra bicolor ACIMA; o rótulo
   virou caixa alta; e o miolo ganhou cor.

   A versão do PROFESSOR permanece exatamente como era (caixas coloridas, coluna
   única, gabarito, resolução e comentários). Nada aqui a afeta.                */

const MM = 72 / 25.4;                       // 1 mm em pontos tipográficos

const ENEM = {
  pageW: 200 * MM,                          // 200 mm — formato próprio do INEP
  pageH: 275 * MM,                          // 275 mm (menor que A4)

  // Margens ESPELHADAS: a mancha desliza 2,5 mm conforme a paridade da página.
  // Página ímpar (mão direita) começa em 8,00 mm; página par, em 10,50 mm.
  margOdd:  8.00 * MM,
  margEven: 10.50 * MM,

  manchaW: 182.33 * MM,                     // largura da mancha, igual em toda página
  colW:    89.47 * MM,                      // 89,47 × 2 + 3,40 = 182,34 mm
  gutter:   3.40 * MM,
  flowTop:  28.00 * MM,                     // topo do fluxo das colunas
  flowBottom: 260.00 * MM,                  // base do fluxo
  ruleHead: 25.00 * MM,                     // filete de cabeçalho
  ruleFoot: 263.00 * MM,                    // filete de rodapé
  segBlue:  49.16 * MM,                     // trecho azul do filete
  segMicro: 131.54 * MM,                    // trecho de microtexto do filete

  indent:   6.00 * MM,                      // recuo da primeira linha
  hang:     4.50 * MM,                      // texto da alternativa pendurado
  ornStart:24.47 * MM,                      // início da barra, a partir da coluna
  ornEndGap: 0.30 * MM,                     // folga antes da borda direita
  ornH:     1.06 * MM,                      // altura da faixa
  ornBlueShare: 0.795,                      // 79,5 % azul, 20,5 % escuro

  body: 10,                                 // corpo de texto e alternativas
  leading: 12.0,                            // entrelinha do corpo (1,20×)
  altLeading: 13.4,                         // entrelinha das alternativas (1,34×)
  qLabel: 11,                               // "QUESTÃO N" — bold, caixa alta
  areaTitle: 11,                            // título de área — bold, caixa alta
  caption: 8,                               // referência / fonte = corpo − 2 pt
  captionLead: 9.6,                         // entrelinha da referência (1,20×)
  footer: 9,                                // rodapé corrido e fólio
  micro: 1.5,                               // microtexto de segurança

  ink:      [35, 31, 32],                   // #231F20 — preto quente de impressão
  footGray: [88, 89, 91],                   // #58595B — rodapé corrido
  ornGray:  [147, 149, 152],                // #939598 — ornamento do cabeçalho
  azul:     [185, 229, 250],                // #B9E5FA — azul da versão
  azulTab:  [109, 207, 246],                // #6DCFF6 — cabeçalho de tabela
  azulLogo: [0, 75, 141],                   // #004B8D — logotipo "enem"

  // O jsPDF não embarca Calibri. A Helvetica é 5,8 % mais larga: medido em 940
  // linhas reais do caderno, a razão de avanço Calibri/Helvetica é 0,942. Usar
  // Helvetica a 0,942 × o corpo reproduz a MEDIDA da Calibri (mesma quantidade
  // de caracteres por linha) e, como a Helvetica tem altura-x maior, o texto
  // ainda aparenta o tamanho certo. A entrelinha permanece absoluta — ela é
  // propriedade da grade, não da fonte. No Word, a fonte declarada é Calibri.
  helvK: 0.942,
};

// Margem esquerda da mancha na página n (1 = primeira página de questões).
function enemLeft(pageNo){ return (pageNo % 2 === 1) ? ENEM.margOdd : ENEM.margEven; }
// Lado externo da página: ímpar → direita, par → esquerda.
function enemOuterIsRight(pageNo){ return pageNo % 2 === 1; }

// Define fonte e corpo já compensados para a substituição Helvetica → Calibri.
function enemFont(doc, weight, size){
  doc.setFont("helvetica", weight || "normal");
  doc.setFontSize(size * ENEM.helvK);
}
function enemInk(doc, c){ const k = c || ENEM.ink; doc.setTextColor(k[0], k[1], k[2]); }

// Filete sólido. No caderno 2025 NÃO existe traço pontilhado vetorial: tudo que
// parece pontilhado é, na verdade, o microtexto de segurança.
function enemSolidLine(doc, x1, y, x2, w, color){
  const c = color || ENEM.ink;
  doc.setDrawColor(c[0], c[1], c[2]);
  doc.setLineWidth(w == null ? 0.5 : w);
  doc.line(x1, y, x2, y);
}

// Microtexto de segurança: a palavra ENEM2025 repetida em 1,5 pt, ocupando
// 131,54 mm. À vista parece um filete pontilhado; é recurso antifraude.
function enemMicroText(doc, x, y, width, word){
  const w = word || "SIMULADO";
  enemFont(doc, "bold", ENEM.micro);
  enemInk(doc);
  const unit = doc.getTextWidth(w);
  if(!unit || unit <= 0) return;
  // Uma única linha, sem maxWidth: com quebra automática o filete viraria duas.
  const n = Math.max(1, Math.floor(width / unit));
  doc.text(w.repeat(n), x, y);
}

// Cabeçalho e rodapé de uma página de questões. Tudo que é "de canto" (fólio,
// tarja de cor, marca de registro) segue a margem EXTERNA; tudo que é "de miolo"
// (logotipo, rodapé corrido) segue a INTERNA.
function enemPageChrome(doc, ctx, flow){
  const n = ctx.pageNo;
  const left = enemLeft(n);
  const right = left + ENEM.manchaW;
  const outerRight = enemOuterIsRight(n);

  // --- Filete de cabeçalho: trecho azul do lado interno, microtexto do externo.
  if(outerRight){
    enemSolidLine(doc, left, ENEM.ruleHead, left + ENEM.segBlue, 1.0, ENEM.azul);
    enemMicroText(doc, right - ENEM.segMicro, ENEM.ruleHead - 0.6, ENEM.segMicro);
  }else{
    enemMicroText(doc, left, ENEM.ruleHead - 0.6, ENEM.segMicro);
    enemSolidLine(doc, right - ENEM.segBlue, ENEM.ruleHead, right, 1.0, ENEM.azul);
  }

  // --- Filete de rodapé: composição invertida em relação ao cabeçalho.
  if(outerRight){
    enemMicroText(doc, left, ENEM.ruleFoot - 0.6, ENEM.segMicro);
    enemSolidLine(doc, right - ENEM.segBlue, ENEM.ruleFoot, right, 1.0, ENEM.azul);
  }else{
    enemSolidLine(doc, left, ENEM.ruleFoot, left + ENEM.segBlue, 1.0, ENEM.azul);
    enemMicroText(doc, right - ENEM.segMicro, ENEM.ruleFoot - 0.6, ENEM.segMicro);
  }

  // --- Marca do caderno, na margem interna, na mesma geometria do logotipo do
  // original. NÃO reproduzimos o logotipo do INEP nem a marca oficial "enem":
  // isto é um simulado, e passar-se por caderno oficial seria falsificação.
  // O que se copia é a diagramação, não a identidade da instituição.
  const logoY = 15.6 * MM;
  const ano = String(ctx.ano || new Date().getFullYear());
  enemFont(doc, "bold", 16);
  const wMark = doc.getTextWidth("simulado");
  enemFont(doc, "normal", 16);
  const wAno = doc.getTextWidth(ano);
  const wLogo = wMark + 1.5 + wAno;
  // Na página par o bloco é ancorado pela direita, para não vazar da mancha.
  const logoX = outerRight ? left : (right - wLogo);
  enemFont(doc, "bold", 16);
  enemInk(doc, ENEM.azulLogo);
  doc.text("simulado", logoX, logoY);
  enemFont(doc, "normal", 16);
  enemInk(doc, ENEM.ornGray);
  doc.text(ano, logoX + wMark + 1.5, logoY);
  const markEnd = logoX + wLogo;
  enemFont(doc, "normal", 5.5);
  enemInk(doc, ENEM.ornGray);
  doc.text("Simulado no padrão do caderno ENEM",
    outerRight ? logoX : markEnd, logoY + 5.2,
    { align: outerRight ? "left" : "right" });

  // --- Fileira de quadrados girados 20°, em #939598, encostada no logotipo.
  const sqW = 5.5 * MM, sqH = 6.6 * MM, skew = Math.tan(20 * Math.PI / 180) * sqH;
  const sqBlock = 4 * (sqW + 0.4);
  let sqX = outerRight ? (markEnd + 4) : (logoX - sqBlock - 6);
  doc.setFillColor(ENEM.ornGray[0], ENEM.ornGray[1], ENEM.ornGray[2]);
  for(let i = 0; i < 4; i++){
    const y0 = 10.25 * MM, y1 = y0 + sqH;
    doc.triangle(sqX + skew, y0, sqX + skew + sqW, y0, sqX + sqW, y1, "F");
    doc.triangle(sqX + skew, y0, sqX + sqW, y1, sqX, y1, "F");
    sqX += sqW + 0.4;
  }

  // --- Barra cinza de 48,93 × 2,38 mm sob o logotipo, do lado interno.
  const barW = 48.93 * MM, barH = 2.38 * MM;
  doc.setFillColor(ENEM.ornGray[0], ENEM.ornGray[1], ENEM.ornGray[2]);
  doc.rect(outerRight ? left : (right - barW), 19.29 * MM, barW, barH, "F");

  // --- Tarja da versão: 11 × 30 mm sangrando na borda EXTERNA, com o quadrado
  // de registro de 3 × 3 mm na quina interna. No caderno oficial a altura da
  // tarja identifica a área; aqui o simulado tem uma área só, então ela fica
  // sempre no topo.
  const tW = 11 * MM, tH = 30 * MM;
  const tX = outerRight ? (ENEM.pageW - 6 * MM) : (-5 * MM);
  doc.setFillColor(ENEM.azul[0], ENEM.azul[1], ENEM.azul[2]);
  doc.rect(tX, -5 * MM, tW, tH, "F");
  doc.setFillColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
  doc.rect(outerRight ? (ENEM.pageW - 7.5 * MM) : (4.5 * MM), 23.5 * MM, 3 * MM, 3 * MM, "F");

  // --- Fio vertical da calha: sólido, 0,5 pt, só nas páginas de duas colunas.
  if(!flow || flow.cols === 2){
    const gx = left + 90.75 * MM;
    doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
    doc.setLineWidth(0.5);
    doc.line(gx, ENEM.flowTop, gx, ENEM.flowBottom);
  }

  // --- Rodapé: texto corrido na margem interna, fólio na externa.
  const footY = ENEM.ruleFoot + 3.9 * MM;
  enemFont(doc, "normal", ENEM.footer);
  enemInk(doc, ENEM.footGray);
  doc.text(ctx.footerText, outerRight ? left : right, footY, { align: outerRight ? "left" : "right" });
  enemFont(doc, "bold", ENEM.footer);
  enemInk(doc);
  doc.text(String(n), outerRight ? right : left, footY, { align: outerRight ? "right" : "left" });
}

// Estado do fluxo. `cols` é 1 ou 2: a página inteira vira coluna única de
// 182,33 mm quando a questão traz uma figura larga (§6 da especificação).
function enemStartPage(doc, ctx, flow, cols){
  flow.cols = cols;
  flow.col = 0;
  flow.x = enemLeft(ctx.pageNo);
  flow.w = cols === 1 ? ENEM.manchaW : ENEM.colW;
  flow.y = ENEM.flowTop;
  enemPageChrome(doc, ctx, flow);
}

function enemNewFlow(doc, ctx, cols){
  const flow = { cols: 2, col: 0, x: 0, y: 0, w: ENEM.colW, top: ENEM.flowTop, bottom: ENEM.flowBottom };
  enemStartPage(doc, ctx, flow, cols || 2);
  return flow;
}

function enemNextColumn(doc, ctx, flow){
  if(flow.cols === 2 && flow.col === 0){
    flow.col = 1;
    flow.x = enemLeft(ctx.pageNo) + ENEM.colW + ENEM.gutter;
    flow.y = flow.top;
    return;
  }
  doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
  ctx.pageNo += 1;
  enemStartPage(doc, ctx, flow, flow.cols);
}

// Troca o modo da página (1 ou 2 colunas). A troca sempre começa página nova,
// como no caderno original — figura larga nunca atravessa colunas com texto ao
// redor. Quando o modo já é o pedido, não faz nada.
function enemSetMode(doc, ctx, flow, cols){
  if(flow.cols === cols) return;
  doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
  ctx.pageNo += 1;
  enemStartPage(doc, ctx, flow, cols);
}

function enemEnsure(doc, ctx, flow, needed){
  if(flow.y + needed > flow.bottom) enemNextColumn(doc, ctx, flow);
}
function enemFits(flow, needed){ return flow.y + needed <= flow.bottom; }

// Justificação real: distribui o espaço restante entre as palavras da linha.
// A última linha de cada parágrafo fica alinhada à esquerda, como no original.
function enemDrawJustified(doc, line, x, y, width, isLast){
  const words = line.split(/\s+/).filter(Boolean);
  if(isLast || words.length < 2){ doc.text(line, x, y); return; }
  const wordsWidth = words.reduce((s, w) => s + doc.getTextWidth(w), 0);
  const gap = (width - wordsWidth) / (words.length - 1);
  let cx = x;
  words.forEach(w => { doc.text(w, cx, y); cx += doc.getTextWidth(w) + gap; });
}

// Parágrafo de corpo: 10 pt, entrelinha 12,0 pt, justificado, primeira linha
// recuada em 6 mm, sem linha em branco entre parágrafos.
function enemParagraph(doc, ctx, flow, text, opts){
  const o = opts || {};
  const size = o.size || ENEM.body;
  const lead = o.leading || ENEM.leading;
  const indent = o.indent != null ? o.indent : ENEM.indent;
  const weight = o.bold ? "bold" : "normal";
  const clean = pdfSanitizeText(String(text || "").trim());
  if(!clean) return;

  clean.split(/\n+/).forEach(par => {
    let remaining = par.trim();
    let first = true;
    while(remaining.length){
      enemFont(doc, weight, size);
      const width = flow.w - (first ? indent : 0);
      const chunk = doc.splitTextToSize(remaining, width)[0];
      const isLast = chunk.length >= remaining.length;
      enemEnsure(doc, ctx, flow, lead);
      enemFont(doc, weight, size);
      enemInk(doc);
      enemDrawJustified(doc, chunk, flow.x + (first ? indent : 0), flow.y + size, width, isLast);
      flow.y += lead;
      remaining = remaining.slice(chunk.length).trim();
      first = false;
    }
  });
}

// Parágrafo de corpo que entende **negrito** no meio da frase. Mesma métrica do
// enemParagraph: 10 pt, entrelinha 12,0 pt, justificado.
function enemRichParagraph(doc, ctx, flow, text, opts){
  const o = opts || {};
  const size = o.size || ENEM.body;
  const lead = o.leading || ENEM.leading;
  const indent = o.indent != null ? o.indent : 0;
  const clean = pdfSanitizeText(String(text || "").trim());
  if(!clean) return;
  clean.split(/\n+/).forEach(par => {
    if(!par.trim()) return;
    const lines = enemWrapRuns(doc, enemRichRuns(par.trim()), flow.w - indent, size, false);
    lines.forEach((parts, i) => {
      enemEnsure(doc, ctx, flow, lead);
      enemDrawRichLine(doc, parts, flow.x + indent, flow.y + size, flow.w - indent,
                       size, "justify", i === lines.length - 1, false);
      flow.y += lead;
    });
  });
}

// Subtítulo interno — Calibri-Bold 10 pt em caixa alta, o mesmo papel que
// "TEXTO I" cumpre dentro de uma questão.
function enemSubhead(doc, ctx, flow, texto){
  enemEnsure(doc, ctx, flow, ENEM.leading * 2);
  flow.y += 1.5 * MM;
  enemFont(doc, "bold", ENEM.body);
  enemInk(doc);
  doc.text(String(texto).toUpperCase(), flow.x, flow.y + ENEM.body);
  flow.y += ENEM.leading;
}

// Rótulo "QUESTÃO N" em CAIXA ALTA (11 pt bold) seguido da barra-ornamento:
// filete escuro de 1 pt no topo e, abaixo, faixa de 1,06 mm com 79,5 % em
// #B9E5FA e 20,5 % em #231F20. A barra começa sempre a 24,47 mm da borda da
// coluna, qualquer que seja o comprimento do rótulo.
function enemBlockLabel(doc, ctx, flow, texto){
  enemEnsure(doc, ctx, flow, ENEM.qLabel * 3);
  const y = flow.y + ENEM.qLabel;

  enemFont(doc, "bold", ENEM.qLabel);
  enemInk(doc);
  doc.text(String(texto).toUpperCase(), flow.x, y);

  const x0 = flow.x + ENEM.ornStart;
  const x1 = flow.x + flow.w - ENEM.ornEndGap;
  if(x1 > x0){
    const barY = y - 2.6;
    enemSolidLine(doc, x0, barY, x1, 1.0, ENEM.ink);
    const cut = x0 + (x1 - x0) * ENEM.ornBlueShare;
    doc.setFillColor(ENEM.azul[0], ENEM.azul[1], ENEM.azul[2]);
    doc.rect(x0, barY + 0.5, cut - x0, ENEM.ornH, "F");
    doc.setFillColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
    doc.rect(cut, barY + 0.5, x1 - cut, ENEM.ornH, "F");
  }
  flow.y += ENEM.qLabel + 0.76 * MM;
}

// Título de área — Calibri-Bold 11 pt em caixa alta, recuado 2 mm da margem da
// coluna. É o componente que abre uma seção do caderno; a barra-ornamento
// pertence à questão e não é usada aqui.
function enemAreaTitle(doc, ctx, flow, texto){
  if(!texto) return;
  enemEnsure(doc, ctx, flow, ENEM.areaTitle * 3);
  enemFont(doc, "bold", ENEM.areaTitle);
  enemInk(doc);
  doc.text(String(texto).toUpperCase(), flow.x + 2 * MM, flow.y + ENEM.areaTitle,
           { maxWidth: flow.w - 2 * MM });
  flow.y += ENEM.areaTitle + 3.2 * MM;
}

function enemQuestionLabel(doc, ctx, flow, numero){
  enemBlockLabel(doc, ctx, flow, "QUESTÃO " + numero);
}

// Letra-opção circulada. No original é um glifo da fonte dingbat
// BundesbahnPiStd-1; aqui é traçado vetorial equivalente, para não depender de
// fonte incorporada.
function enemOptionMark(doc, x, yBaseline, letter){
  const r = 4.8;
  const cx = x + r, cy = yBaseline - 3.0;
  doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
  doc.setLineWidth(0.6);
  doc.circle(cx, cy, r, "S");
  enemFont(doc, "normal", ENEM.body * 0.80);
  enemInk(doc);
  doc.text(letter, cx, cy + 2.5, { align: "center" });
}

// Alternativa A–E: letra circulada encostada na margem da coluna, texto
// pendurado a 4,5 mm, entrelinha 13,4 pt, alinhado à esquerda (não justificado).
function enemAlternative(doc, ctx, flow, letter, text){
  const width = flow.w - ENEM.hang;
  enemFont(doc, "normal", ENEM.body);
  const lines = doc.splitTextToSize(pdfSanitizeText(String(text || "").trim()) || "—", width);
  lines.forEach((ln, i) => {
    enemEnsure(doc, ctx, flow, ENEM.altLeading);
    const base = flow.y + ENEM.body;
    if(i === 0) enemOptionMark(doc, flow.x, base, letter);
    enemFont(doc, "normal", ENEM.body);
    enemInk(doc);
    doc.text(ln, flow.x + ENEM.hang, base);
    flow.y += ENEM.altLeading;
  });
}

// Quebra o texto em trechos normais e em negrito. O título da obra vem marcado
// com **asteriscos duplos**, convenção que o gerador de questões já usa.
function enemRichRuns(text){
  const out = [];
  String(text).split(/(\*\*[^*]+\*\*)/g).forEach(part => {
    if(!part) return;
    const bold = /^\*\*[^*]+\*\*$/.test(part);
    out.push({ text: bold ? part.slice(2, -2) : part, bold: bold });
  });
  return out.length ? out : [{ text: String(text), bold: false }];
}

// Quebra os trechos em linhas que caibam na largura, preservando o peso de cada
// palavra. Devolve um array de linhas; cada linha é um array de { text, bold }.
function enemWrapRuns(doc, runs, width, size, italic){
  const lines = [];
  let line = [], lineW = 0;
  runs.forEach(run => {
    enemFont(doc, enemStyle(run.bold, !!italic), size);
    run.text.split(/(\s+)/).forEach(tok => {
      if(!tok) return;
      const w = doc.getTextWidth(tok);
      if(/^\s+$/.test(tok)){
        if(line.length){ line.push({ text: tok, bold: run.bold, w: w }); lineW += w; }
        return;
      }
      if(lineW + w > width && line.length){
        while(line.length && /^\s+$/.test(line[line.length - 1].text)) { lineW -= line.pop().w; }
        lines.push(line); line = []; lineW = 0;
      }
      line.push({ text: tok, bold: run.bold, w: w });
      lineW += w;
    });
  });
  if(line.length) lines.push(line);
  return lines;
}

// Estilo da fonte na substituição Helvetica → Calibri.
function enemStyle(bold, italic){
  return bold ? (italic ? "bolditalic" : "bold") : (italic ? "italic" : "normal");
}

// Desenha uma linha de trechos com peso/inclinação mistos.
//   align "right"   → bandeira à esquerda (referência do texto introdutório)
//   align "justify" → justificada nas duas margens (referência de recurso visual);
//                     a última linha do bloco nunca é esticada
function enemDrawRichLine(doc, parts, x, y, width, size, align, isLast, italic){
  const total = parts.reduce((a, p) => a + p.w, 0);
  let extra = 0;
  let cx = x;
  if(align === "right"){
    cx = x + width - total;
  }else if(align === "justify" && !isLast){
    const gaps = parts.filter(p => /^\s+$/.test(p.text)).length;
    if(gaps > 0) extra = (width - total) / gaps;
  }
  parts.forEach(p => {
    const isGap = /^\s+$/.test(p.text);
    if(!isGap){
      enemFont(doc, enemStyle(p.bold, italic), size);
      enemInk(doc);
      doc.text(p.text, cx, y);
    }
    cx += p.w + (isGap ? extra : 0);
  });
}

/* Referência / fonte bibliográfica — sempre no CORPO MENOS DOIS PONTOS (8 pt
   para um corpo de 10 pt). Há dois tratamentos, e eles não se misturam:

   ▸ REFERÊNCIA DO TEXTO INTRODUTÓRIO (o texto-base da questão): em ITÁLICO,
     alinhada à direita, com o título da obra em negrito-itálico.

   ▸ REFERÊNCIA DE IMAGEM, TABELA E GRÁFICO: JUSTIFICADA nas duas margens, em
     redondo, com o título da obra em negrito.

   Divergência autorizada pelo professor: o caderno oficial de 2025 não usa
   itálico em nenhum dos 3.484 caracteres de referência e alinha tudo à direita.
   O itálico no texto introdutório e a justificação nas legendas de recurso
   visual são decisão deste sistema, registradas no design system.            */
function enemCaption(doc, ctx, flow, text, opts){
  const o = opts || {};
  const align = o.align || "right";
  const italic = !!o.italic;
  const clean = pdfSanitizeText(String(text || "").trim());
  if(!clean) return;
  const size = ENEM.caption;
  const runs = enemRichRuns(clean);
  // A medição precisa usar a mesma inclinação com que a linha será desenhada.
  const lines = enemWrapRuns(doc, runs, flow.w, size, italic);
  const lh = ENEM.captionLead;
  lines.forEach((parts, i) => {
    enemEnsure(doc, ctx, flow, lh);
    enemDrawRichLine(doc, parts, flow.x, flow.y + size, flow.w, size, align,
                     i === lines.length - 1, italic);
    flow.y += lh;
  });
  flow.y += 1.5;
}

// Reconhece a linha de referência bibliográfica ao fim do texto-base. O gerador
// de questões emite a fonte como último parágrafo, no padrão ABNT.
function enemIsReference(par){
  const t = String(par || "").trim();
  if(!t || t.length > 340) return false;
  if(/(Dispon[ií]vel em|Acesso em|adaptado\)|fragmento\)|adaptada\))/i.test(t)) return true;
  // SOBRENOME, N. ... com ano no fim — assinatura típica de referência ABNT.
  if(/^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ'\-]{1,}\s*,/.test(t) && /\d{4}/.test(t)) return true;
  return false;
}

// Texto-base: parágrafos de corpo e, se o último for a fonte bibliográfica,
// ela sai no tratamento de referência do texto introdutório.
function enemTextoBase(doc, ctx, flow, text, fonte){
  const pars = String(text || "").trim().split(/\n+/).filter(p => p.trim());
  let ref = String(fonte || "").trim();
  if(!ref && pars.length > 1 && enemIsReference(pars[pars.length - 1])) ref = pars.pop();
  pars.forEach(par => enemParagraph(doc, ctx, flow, par));
  if(ref) enemCaption(doc, ctx, flow, ref, { align: "right", italic: true });
}

// Recurso visual dentro da coluna. Imagem e gráfico entram COLORIDOS — em 2025
// metade das figuras do caderno oficial é colorida. Tabela é desenhada como
// tabela vetorial, com o cabeçalho preenchido em #6DCFF6.
function enemVisual(doc, ctx, flow, visual, cardIdx){
  if(!visual || !visual.tipo) return;

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return;
    const cw = flow.w / cols.length;
    const pad = 3;
    enemFont(doc, "bold", ENEM.body);
    const head = cols.map(c => doc.splitTextToSize(pdfSanitizeText(String(c)), cw - pad * 2));
    enemFont(doc, "normal", ENEM.body);
    const body = rows.map(r => r.map(c => doc.splitTextToSize(pdfSanitizeText(String(c)), cw - pad * 2)));
    const lh = ENEM.leading;
    const hH = Math.max.apply(null, head.map(l => l.length).concat([1])) * lh + pad * 2;
    const rH = body.map(r => Math.max.apply(null, r.map(l => l.length).concat([1])) * lh + pad * 2);
    enemEnsure(doc, ctx, flow, Math.min(hH + rH.reduce((a, b) => a + b, 0), flow.bottom - flow.top));
    let y = flow.y;

    doc.setFillColor(ENEM.azulTab[0], ENEM.azulTab[1], ENEM.azulTab[2]);
    doc.rect(flow.x, y, cw * cols.length, hH, "F");
    doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
    doc.setLineWidth(1.0);
    doc.rect(flow.x, y, cw * cols.length, hH, "S");
    enemFont(doc, "bold", ENEM.body);
    enemInk(doc);
    head.forEach((lines, i) => {
      lines.forEach((ln, k) => doc.text(ln, flow.x + i * cw + cw / 2, y + pad + ENEM.body + k * lh, { align: "center" }));
    });
    y += hH;

    doc.setLineWidth(0.5);
    body.forEach((row, ri) => {
      row.forEach((lines, ci) => {
        doc.setDrawColor(ENEM.ink[0], ENEM.ink[1], ENEM.ink[2]);
        doc.rect(flow.x + ci * cw, y, cw, rH[ri], "S");
        enemFont(doc, "normal", ENEM.body);
        enemInk(doc);
        lines.forEach((ln, k) => doc.text(ln, flow.x + ci * cw + cw / 2, y + pad + ENEM.body + k * lh, { align: "center" }));
      });
      y += rH[ri];
    });
    flow.y = y + 2.11 * MM;
    if(visual.titulo) enemCaption(doc, ctx, flow, visual.titulo, { align: "justify" });
    return;
  }

  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx) : pdfGetVisualChartInfo(cardIdx);
  if(!info) return;
  const ratio = info.height / info.width;
  let w = flow.w;
  let h = w * ratio;
  const maxH = flow.bottom - flow.top - 30;
  if(h > maxH){ h = maxH; w = h / ratio; }
  flow.y += 1.60 * MM;                       // espaço texto → figura
  enemEnsure(doc, ctx, flow, h + 4);
  const fmtMatch = /^data:image\/(png|jpe?g|webp);base64,/i.exec(info.dataUrl);
  const fmt = fmtMatch ? fmtMatch[1].toUpperCase().replace("JPG", "JPEG") : "PNG";
  try{ doc.addImage(info.dataUrl, fmt, flow.x + (flow.w - w) / 2, flow.y, w, h); }catch(e){ return; }
  flow.y += h + 2.11 * MM;                   // espaço figura → texto
  if(visual.descricao) enemCaption(doc, ctx, flow, visual.descricao, { align: "justify" });
}

// Filete de fechamento: sólido, 0,5 pt, largura cheia da coluna. No caderno
// oficial ele aparece SÓ quando a questão encerra a coluna (15 das 60 colunas);
// entre questões consecutivas quem separa é a barra da questão seguinte.
function enemCloseQuestion(doc, ctx, flow, isLastOfColumn){
  flow.y += 2.53 * MM;
  if(isLastOfColumn){
    enemSolidLine(doc, flow.x, flow.y, flow.x + flow.w, 0.5, ENEM.ink);
    flow.y += 3;
  }
}

/* FOLHA DE GABARITO (versão do aluno) — sai DEPOIS de todas as questões e traz
   SOMENTE a letra de cada questão. Nada de resolução, comentário, competência,
   habilidade ou dificuldade: isso é exclusivo da versão do professor.
   Mesma anatomia: página nova, título de área, fluxo de duas colunas.        */
function enemGabaritoAluno(doc, ctx, flow, doneQuestions){
  enemSetMode(doc, ctx, flow, 2);
  doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
  ctx.pageNo += 1;
  enemStartPage(doc, ctx, flow, 2);
  enemAreaTitle(doc, ctx, flow, "Gabarito");

  doneQuestions.forEach(o => {
    const letra = (o.q.data && o.q.data.gabarito) || "—";
    enemEnsure(doc, ctx, flow, ENEM.altLeading);
    const base = flow.y + ENEM.body;
    // Número da questão à esquerda, letra circulada logo depois — a mesma
    // letra-opção usada nas alternativas, para o aluno reconhecer de imediato.
    enemFont(doc, "bold", ENEM.body);
    enemInk(doc);
    const rotulo = String(o.idx + 1) + ".";
    doc.text(rotulo, flow.x, base);
    if(/^[A-E]$/.test(letra)){
      enemOptionMark(doc, flow.x + 8 * MM, base, letra);
    }else{
      enemFont(doc, "normal", ENEM.body);
      doc.text(letra, flow.x + 8 * MM, base);
    }
    flow.y += ENEM.altLeading;
  });
  flow.y += 2.53 * MM;
  enemSolidLine(doc, flow.x, flow.y, flow.x + flow.w, 0.5, ENEM.ink);
}

/* CADERNO DE RESPOSTAS (versão do professor) — sai DEPOIS de todas as questões,
   na mesma anatomia: 200 × 275 mm, duas colunas de 89,47 mm, Calibri 10/12,0 pt,
   tinta #231F20, rótulo em caixa alta com a barra-ornamento. Nenhum componente
   novo é inventado aqui: o que muda é o conteúdo, não a forma.               */
function enemGabaritoBlock(doc, ctx, flow, o, isLastOfColumn){
  const d = o.q.data || {};
  const numero = o.idx + 1;

  enemQuestionLabel(doc, ctx, flow, numero);

  // Gabarito: letra circulada na margem e a resposta correta ao lado.
  const letra = d.gabarito || "—";
  enemEnsure(doc, ctx, flow, ENEM.altLeading);
  const base = flow.y + ENEM.body;
  if(/^[A-E]$/.test(letra)) enemOptionMark(doc, flow.x, base, letra);
  enemFont(doc, "bold", ENEM.body);
  enemInk(doc);
  doc.text("GABARITO: " + letra, flow.x + ENEM.hang, base);
  flow.y += ENEM.altLeading;
  const resposta = (d.alternativas && d.alternativas[d.gabarito]) || "";
  if(resposta) enemRichParagraph(doc, ctx, flow, resposta, { indent: ENEM.hang });

  // Ficha pedagógica — cada linha é "rótulo: valor", o rótulo em negrito.
  const ficha = [];
  if(d.competencia && (d.competencia.numero || d.competencia.texto)){
    ficha.push("**Competência " + (d.competencia.numero || "—") + ":** " + (d.competencia.texto || ""));
  }
  if(d.habilidade && (d.habilidade.codigo || d.habilidade.texto)){
    ficha.push("**Habilidade " + (d.habilidade.codigo || "—") + ":** " + (d.habilidade.texto || ""));
  }
  if(d.objetoConhecimento) ficha.push("**Objeto de conhecimento:** " + d.objetoConhecimento);
  const conteudo = d.tema || o.q.tema || "";
  if(conteudo) ficha.push("**Conteúdo abordado:** " + conteudo);
  const dif = d.dificuldade || o.q.dificuldade || "";
  if(dif) ficha.push("**Nível de dificuldade:** " + dif);
  if(ficha.length){
    enemSubhead(doc, ctx, flow, "Ficha pedagógica");
    ficha.forEach(l => enemRichParagraph(doc, ctx, flow, l));
  }

  if(d.resolucaoComentada){
    enemSubhead(doc, ctx, flow, "Resolução comentada");
    enemParagraph(doc, ctx, flow, d.resolucaoComentada, { indent: 0 });
  }

  const analise = d.analiseAlternativas || {};
  const temAnalise = ["A","B","C","D","E"].some(L => analise[L] && analise[L].comentario);
  if(temAnalise){
    enemSubhead(doc, ctx, flow, "Comentários das alternativas");
    ["A","B","C","D","E"].forEach(L => {
      const info = analise[L];
      if(!info) return;
      const status = info.status === "correta" ? "CORRETA" : "INCORRETA";
      enemAlternative(doc, ctx, flow, L, status + " — " + (info.comentario || ""));
    });
  }

  enemCloseQuestion(doc, ctx, flow, isLastOfColumn);
}

// Uma questão só vai para o modo de coluna única quando traz uma figura larga —
// proporção a partir de 1,8 : 1, que a 89,47 mm ficaria ilegível.
function enemNeedsWidePage(o){
  const d = o.q.data;
  if(!d.visual || !d.visual.tipo || d.visual.tipo === "tabela") return false;
  const info = d.visual.tipo === "imagem" ? pdfGetVisualImageInfo(o.idx) : pdfGetVisualChartInfo(o.idx);
  if(!info || !info.height) return false;
  return (info.width / info.height) >= 1.8;
}

/* Monta o PDF inteiro na anatomia do caderno ENEM 2025. As duas versões usam
   EXATAMENTE a mesma diagramação; a do professor apenas acrescenta, DEPOIS de
   todas as questões, o caderno de respostas — gabarito, ficha pedagógica,
   resolução comentada e comentário de cada alternativa, questão por questão. */
function enemExportPdf(doneQuestions, professor){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: [ENEM.pageW, ENEM.pageH], orientation: "portrait" });
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const ctx = {
    areaLabel,
    ano: new Date().getFullYear(),
    footerText: [String(areaLabel).toUpperCase(), state.disciplina || "",
                 professor ? "VERSÃO DO PROFESSOR" : "VERSÃO DO ALUNO"].filter(Boolean).join(" | "),
    pageNo: 1,
  };

  // O modo da primeira página já nasce certo, para não abrir página em branco
  // quando a primeira questão traz figura larga.
  const wideMap = doneQuestions.map(enemNeedsWidePage);
  const flow = enemNewFlow(doc, ctx, wideMap[0] ? 1 : 2);

  // Título de área abre a primeira coluna, recuado 2 mm, 11 pt bold caixa alta.
  enemAreaTitle(doc, ctx, flow, areaLabel);

  doneQuestions.forEach((o, i) => {
    const d = o.q.data;
    enemSetMode(doc, ctx, flow, wideMap[i] ? 1 : 2);

    enemQuestionLabel(doc, ctx, flow, o.idx + 1);
    if(d.textoBase) enemTextoBase(doc, ctx, flow, d.textoBase, d.fonte);
    if(d.visual && d.visual.tipo) enemVisual(doc, ctx, flow, d.visual, o.idx);
    if(d.comando) enemParagraph(doc, ctx, flow, d.comando, { indent: 0 });
    flow.y += 1.51 * MM;                     // espaço corpo → 1ª alternativa
    ["A", "B", "C", "D", "E"].forEach(letter => {
      enemAlternative(doc, ctx, flow, letter, (d.alternativas && d.alternativas[letter]) || "");
    });
    // Fecha com filete só se a próxima questão não couber nesta coluna.
    const last = i === doneQuestions.length - 1;
    enemCloseQuestion(doc, ctx, flow, last || !enemFits(flow, 70));
  });

  // ---- Fim do caderno de questões. O que vem depois depende da versão:
  //      aluno → só as letras do gabarito;  professor → o caderno de respostas.
  if(!professor){
    enemGabaritoAluno(doc, ctx, flow, doneQuestions);
  }
  if(professor){
    enemSetMode(doc, ctx, flow, 2);
    if(flow.y > flow.top){
      doc.addPage([ENEM.pageW, ENEM.pageH], "portrait");
      ctx.pageNo += 1;
      enemStartPage(doc, ctx, flow, 2);
    }
    enemAreaTitle(doc, ctx, flow, "Gabarito e resoluções");
    doneQuestions.forEach((o, i) => {
      const last = i === doneQuestions.length - 1;
      enemGabaritoBlock(doc, ctx, flow, o, last || !enemFits(flow, 70));
    });
  }

  const rotulo = professor ? "professor" : "aluno";
  const safeName = "Simulado_ENEM_" + (state.disciplina || "questoes").replace(/[^a-zA-Z0-9]+/g, "_") + "_" + rotulo + ".pdf";
  doc.save(safeName);
}

/* ---- Anatomia ENEM 2025 no DOCX (versão do aluno) ----
   Mesmas medidas do PDF, convertidas para TWIPs (1 pt = 20 twips; 1 mm = 56,6929).
   No Word a fonte declarada é Calibri de verdade — não há substituição. Página
   200 × 275 mm, duas colunas de 89,47 mm com fio separador, corpo 10 pt com
   entrelinha exata de 12,0 pt, justificado, recuo de 6 mm e tinta #231F20.
   As margens seguem a geometria da página ímpar (ver comentário na exportação). */
const TW = 56.6929;                                   // 1 mm em twips
const ENEM_DOCX = {
  pageW: Math.round(200 * TW),
  pageH: Math.round(275 * TW),
  margTop: Math.round(26.88 * TW),
  margBottom: Math.round(15.0 * TW),
  margInner: Math.round(8.00 * TW),                   // margem interna (gutter do Word)
  margOuter: Math.round(9.67 * TW),                   // margem externa
  gutter: Math.round(3.40 * TW),
  indent: Math.round(6 * TW),
  hang: Math.round(4.5 * TW),
  line: Math.round(12.0 * 20),                        // entrelinha exata de 12,0 pt
  altLine: Math.round(13.4 * 20),                     // entrelinha das alternativas
  ink: "231F20",
  footGray: "58595B",
  azulTab: "6DCFF6",
  font: "Calibri",
};

// Parágrafo de corpo — 10 pt, entrelinha exata, justificado, primeira linha recuada.
function enemDocxParagraph(text, opts){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const o = opts || {};
  const size = o.size || 10;
  const out = [];
  String(text || "").trim().split(/\n+/).forEach(par => {
    if(!par.trim()) return;
    out.push(new Paragraph({
      alignment: o.alignment || AlignmentType.JUSTIFIED,
      indent: o.indent === false ? undefined : { firstLine: ENEM_DOCX.indent },
      spacing: { line: o.line || ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
      children: [ new TextRun({ text: par.trim(), font: ENEM_DOCX.font, size: Math.round(size * 2), color: o.color || ENEM_DOCX.ink, bold: !!o.bold }) ],
    }));
  });
  return out;
}

// "QUESTÃO N" — 11 pt bold, CAIXA ALTA, com respiro acima. A barra-ornamento do
// PDF vira aqui uma borda inferior azul no próprio parágrafo do rótulo.
function enemDocxQuestionLabel(numero){
  const { Paragraph, TextRun, LineRuleType } = window.docx;
  return [ new Paragraph({
    spacing: { before: 144, after: 43, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: "QUESTÃO " + numero, bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
  }) ];
}

// Alternativa A–E. O glifo circulado do original é uma fonte dingbat que não pode
// ser incorporada aqui; no Word usamos o caractere circulado Unicode equivalente,
// mantendo o corpo de 10 pt, o texto pendurado a 4,5 mm e a entrelinha de 13,4 pt.
const ENEM_DOCX_MARKS = { A: "Ⓐ", B: "Ⓑ", C: "Ⓒ", D: "Ⓓ", E: "Ⓔ" };
function enemDocxAlternative(letter, text){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  return [ new Paragraph({
    alignment: AlignmentType.LEFT,
    indent: { left: ENEM_DOCX.hang, hanging: ENEM_DOCX.hang },
    spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
    children: [
      new TextRun({ text: ENEM_DOCX_MARKS[letter] + "\t", font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      new TextRun({ text: String(text || "").trim() || "—", font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
    ],
  }) ];
}

/* Referência / fonte bibliográfica — corpo menos dois pontos (8 pt), em dois
   tratamentos distintos:
     ▸ texto introdutório  → ITÁLICO, alinhado à direita, título em negrito-itálico
     ▸ imagem/tabela/gráfico → JUSTIFICADO, redondo, título em negrito          */
function enemDocxCaption(text, opts){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const o = opts || {};
  const clean = String(text || "").trim();
  if(!clean) return [];
  return [ new Paragraph({
    alignment: o.justify ? AlignmentType.JUSTIFIED : AlignmentType.RIGHT,
    spacing: { line: Math.round(9.6 * 20), lineRule: LineRuleType.EXACTLY, before: 40, after: 60 },
    children: enemRichRuns(clean).map(r => new TextRun({
      text: r.text, bold: r.bold, italics: !!o.italic,
      font: ENEM_DOCX.font, size: 16, color: ENEM_DOCX.ink,
    })),
  }) ];
}

// Texto-base no Word: parágrafos de corpo e, ao fim, a fonte bibliográfica no
// tratamento de referência do texto introdutório.
function enemDocxTextoBase(text, fonte){
  const pars = String(text || "").trim().split(/\n+/).filter(x => x.trim());
  let ref = String(fonte || "").trim();
  if(!ref && pars.length > 1 && enemIsReference(pars[pars.length - 1])) ref = pars.pop();
  const out = [];
  pars.forEach(par => out.push(...enemDocxParagraph(par)));
  if(ref) out.push(...enemDocxCaption(ref, { italic: true }));
  return out;
}

// Filete SÓLIDO de fechamento de questão (em 2025 não há mais traço pontilhado).
function enemDocxRule(){
  const { Paragraph, BorderStyle } = window.docx;
  return [ new Paragraph({
    spacing: { before: 143, after: 143 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: ENEM_DOCX.ink, space: 1 } },
    children: [],
  }) ];
}

// Recurso visual — imagem e gráfico saem COLORIDOS, como no caderno 2025.
function enemDocxVisual(visual, cardIdx){
  const { Paragraph, TextRun, ImageRun, AlignmentType, Table, TableRow, TableCell, WidthType, BorderStyle, ShadingType } = window.docx;
  if(!visual || !visual.tipo) return [];
  const out = [];

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return [];
    const border = { style: BorderStyle.SINGLE, size: 4, color: ENEM_DOCX.ink };
    const borders = { top: border, bottom: border, left: border, right: border };
    const cell = (txt, bold) => new TableCell({
      borders,
      shading: bold ? { type: ShadingType.CLEAR, fill: ENEM_DOCX.azulTab, color: "auto" } : undefined,
      children: [ new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [ new TextRun({ text: String(txt), font: ENEM_DOCX.font, size: 20, bold: !!bold, color: ENEM_DOCX.ink }) ],
      }) ],
    });
    out.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [ new TableRow({ children: cols.map(c => cell(c, true)) }) ]
        .concat(rows.map(r => new TableRow({ children: r.map(c => cell(c, false)) }))),
    }));
    out.push(...enemDocxCaption(visual.titulo, { justify: true }));
    return out;
  }

  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx) : pdfGetVisualChartInfo(cardIdx);
  if(!info) return [];
  // Largura da coluna do miolo: 89,47 mm ≈ 254 pt.
  const maxW = 254;
  const ratio = info.height / info.width;
  const w = maxW, h = Math.round(maxW * ratio);
  try{
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 91, after: 120 },
      children: [ new ImageRun({
        data: docxDataUrlToUint8Array(info.dataUrl),
        transformation: { width: w, height: h },
        type: docxImageType(info.dataUrl),
      }) ],
    }));
  }catch(e){ return out; }
  out.push(...enemDocxCaption(visual.descricao, { justify: true }));
  return out;
}

// Parágrafo de corpo que entende **negrito** no meio da frase.
function enemDocxRichParagraph(text, opts){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const o = opts || {};
  const out = [];
  String(text || "").trim().split(/\n+/).forEach(par => {
    if(!par.trim()) return;
    out.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      indent: o.indent ? { left: o.indent } : undefined,
      spacing: { line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
      children: enemRichRuns(par.trim()).map(r => new TextRun({
        text: r.text, bold: r.bold, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink,
      })),
    }));
  });
  return out;
}

// Subtítulo interno — bold 10 pt caixa alta, mesmo papel de "TEXTO I".
function enemDocxSubhead(texto){
  const { Paragraph, TextRun, LineRuleType } = window.docx;
  return [ new Paragraph({
    spacing: { before: 85, after: 0, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: String(texto).toUpperCase(), bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }) ],
  }) ];
}

/* Folha de gabarito do aluno no Word — SOMENTE a letra de cada questão. */
function enemDocxGabaritoAluno(doneQuestions){
  const { Paragraph, TextRun, LineRuleType, PageBreak } = window.docx;
  const out = [];
  out.push(new Paragraph({ children: [ new PageBreak() ] }));
  out.push(new Paragraph({
    spacing: { after: 181, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    indent: { left: Math.round(2 * TW) },
    children: [ new TextRun({ text: "GABARITO", bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
  }));
  doneQuestions.forEach(o => {
    const letra = (o.q.data && o.q.data.gabarito) || "\u2014";
    out.push(new Paragraph({
      spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
      children: [
        new TextRun({ text: (o.idx + 1) + ".\t", bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
        new TextRun({ text: ENEM_DOCX_MARKS[letra] || letra, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      ],
    }));
  });
  return out;
}

// Um bloco do caderno de respostas, na mesma anatomia das questões.
function enemDocxGabaritoBlock(o){
  const { Paragraph, TextRun, LineRuleType } = window.docx;
  const d = o.q.data || {};
  const out = [];
  out.push(...enemDocxQuestionLabel(o.idx + 1));

  const letra = d.gabarito || "—";
  out.push(new Paragraph({
    spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
    indent: { left: ENEM_DOCX.hang, hanging: ENEM_DOCX.hang },
    children: [
      new TextRun({ text: (ENEM_DOCX_MARKS[letra] || "○") + "\t", font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      new TextRun({ text: "GABARITO: " + letra, bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
    ],
  }));
  const resposta = (d.alternativas && d.alternativas[d.gabarito]) || "";
  if(resposta) out.push(...enemDocxRichParagraph(resposta, { indent: ENEM_DOCX.hang }));

  const ficha = [];
  if(d.competencia && (d.competencia.numero || d.competencia.texto)){
    ficha.push("**Competência " + (d.competencia.numero || "—") + ":** " + (d.competencia.texto || ""));
  }
  if(d.habilidade && (d.habilidade.codigo || d.habilidade.texto)){
    ficha.push("**Habilidade " + (d.habilidade.codigo || "—") + ":** " + (d.habilidade.texto || ""));
  }
  if(d.objetoConhecimento) ficha.push("**Objeto de conhecimento:** " + d.objetoConhecimento);
  const conteudo = d.tema || o.q.tema || "";
  if(conteudo) ficha.push("**Conteúdo abordado:** " + conteudo);
  const dif = d.dificuldade || o.q.dificuldade || "";
  if(dif) ficha.push("**Nível de dificuldade:** " + dif);
  if(ficha.length){
    out.push(...enemDocxSubhead("Ficha pedagógica"));
    ficha.forEach(l => out.push(...enemDocxRichParagraph(l)));
  }

  if(d.resolucaoComentada){
    out.push(...enemDocxSubhead("Resolução comentada"));
    out.push(...enemDocxParagraph(d.resolucaoComentada, { indent: false }));
  }

  const analise = d.analiseAlternativas || {};
  if(["A","B","C","D","E"].some(L => analise[L] && analise[L].comentario)){
    out.push(...enemDocxSubhead("Comentários das alternativas"));
    ["A","B","C","D","E"].forEach(L => {
      const info = analise[L];
      if(!info) return;
      const status = info.status === "correta" ? "CORRETA" : "INCORRETA";
      out.push(...enemDocxAlternative(L, status + " — " + (info.comentario || "")));
    });
  }
  out.push(...enemDocxRule());
  return out;
}

/* Monta a seção do Word inteira, em 2 colunas. As duas versões usam a mesma
   diagramação; a do professor acrescenta o caderno de respostas ao fim.      */
function enemDocxSection(doneQuestions, professor){
  const { Paragraph, TextRun, AlignmentType, LineRuleType, BorderStyle, PageBreak } = window.docx;
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const children = [];

  children.push(new Paragraph({
    spacing: { after: 120, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    indent: { left: Math.round(2 * TW) },
    children: [ new TextRun({ text: String(areaLabel).toUpperCase(), bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
  }));

  doneQuestions.forEach((o, i) => {
    const d = o.q.data;
    children.push(...enemDocxQuestionLabel(o.idx + 1));
    if(d.textoBase) children.push(...enemDocxTextoBase(d.textoBase, d.fonte));
    if(d.visual && d.visual.tipo) children.push(...enemDocxVisual(d.visual, o.idx));
    if(d.comando) children.push(...enemDocxParagraph(d.comando, { indent: false }));
    ["A", "B", "C", "D", "E"].forEach(letter => {
      children.push(...enemDocxAlternative(letter, (d.alternativas && d.alternativas[letter]) || ""));
    });
    if(i < doneQuestions.length - 1) children.push(...enemDocxRule());
  });

  // ---- Fim do caderno de questões. O que vem depois depende da versão:
  //      aluno → só as letras do gabarito;  professor → o caderno de respostas.
  if(!professor){
    children.push(...enemDocxGabaritoAluno(doneQuestions));
  }
  if(professor){
    children.push(new Paragraph({ children: [ new PageBreak() ] }));
    children.push(new Paragraph({
      spacing: { after: 85, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
      children: [ new TextRun({ text: "GABARITO E RESOLUÇÕES", bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
    }));
    doneQuestions.forEach(o => children.push(...enemDocxGabaritoBlock(o)));
  }

  return {
    properties: {
      page: {
        size: { width: ENEM_DOCX.pageW, height: ENEM_DOCX.pageH },
        margin: {
          top: ENEM_DOCX.margTop, bottom: ENEM_DOCX.margBottom,
          left: ENEM_DOCX.margInner, right: ENEM_DOCX.margOuter,
        },
      },
      column: { count: 2, space: ENEM_DOCX.gutter, separate: true },
    },
    children,
  };
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
    try{
      await loadScriptOnce(CDN_URLS.jspdf);
    }catch(e){
      toast("Não foi possível carregar a biblioteca de PDF (verifique sua conexão com a internet) e tente novamente.", "err");
      return;
    }
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

    // AS DUAS VERSÕES saem na anatomia do caderno ENEM 2025 (200×275 mm, duas
    // colunas de 89,47 mm, Calibri 10/12,0 pt, tinta #231F20, letras circuladas,
    // barra-ornamento). A do professor é idêntica à do aluno e acrescenta, DEPOIS
    // de todas as questões, o caderno de respostas — gabarito, ficha pedagógica,
    // resolução comentada e comentário de cada alternativa.
    enemExportPdf(doneQuestions, !isAluno);
    toast("PDF exportado com sucesso.", "ok");
    return;

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
        let habText = `Competência ${d.competencia?.numero || "—"}: ${d.competencia?.texto || ""}\n\n${d.habilidade?.codigo || "—"}: ${d.habilidade?.texto || ""}`;
        if(d.objetoConhecimento) habText += `\n\nObjeto de conhecimento: ${d.objetoConhecimento}`;
        pdfDrawBox(doc, ctx, { label: "Habilidade, competência e objeto de conhecimento", text: habText, colors: PDF_PALETTE.habilidade, fontSize: 10 });

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

/* ---------------- DOCX export (espelho exato do layout do PDF, em Word) ----------------
 * Usa as MESMAS constantes de layout (PDF_PALETTE, dimensões A4 em pt, margens, ordem
 * das seções) que o exportPdf() acima, para que o DOCX gerado seja um espelho fiel do
 * PDF: mesmas caixas coloridas com barra de destaque à esquerda, mesmos rótulos, mesma
 * ordem de blocos por questão, mesma quebra de página por questão.
 * Duas diferenças estruturais, inerentes ao formato Word (não afetam o layout visível):
 * 1) O Word faz flow automático de texto grande dentro de uma caixa/tabela entre páginas
 *    — não precisamos do equivalente a pdfDrawBoxPaginated().
 * 2) O Word tem suporte nativo a Unicode — símbolos como π, √, ², ≤, ≥ aparecem
 *    corretamente sem precisar da sanitização usada no PDF (pdfSanitizeText).
 * -------------------------------------------------------------------------------------- */

const DOCX_PAGE_WIDTH_PT = 595.28;   // A4 em pt — mesmo valor usado pelo jsPDF acima
const DOCX_PAGE_HEIGHT_PT = 841.89;
const DOCX_MARGIN_PT = 40;           // mesma margem usada no PDF (const margin = 40 em exportPdf)
const DOCX_CONTENT_WIDTH_PT = DOCX_PAGE_WIDTH_PT - DOCX_MARGIN_PT * 2;
const DOCX_CONTENT_WIDTH_TWIPS = Math.round(DOCX_CONTENT_WIDTH_PT * 20); // 1pt = 20 twips (DXA)

function ptToTwips(pt){ return Math.round(pt * 20); }
function ptToHalfPt(pt){ return Math.round(pt * 2); }       // TextRun "size" é em meios-de-ponto
function ptToPx(pt){ return Math.round(pt * (96 / 72)); }   // ImageRun usa "pixels" a 96dpi
function ptToEighths(pt){ return Math.round(pt * 8); }      // bordas OOXML em oitavos de ponto

function rgbToHex([r, g, b]){
  return [r, g, b].map(n => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0")).join("").toUpperCase();
}

function docxColors(paletteEntry){
  return {
    fill: rgbToHex(paletteEntry.fill),
    accent: rgbToHex(paletteEntry.accent),
    text: rgbToHex(paletteEntry.text),
  };
}

function docxImageType(dataUrl){
  const m = /^data:image\/(png|jpe?g|webp|gif|bmp);base64,/i.exec(dataUrl || "");
  if(!m) return "png";
  const f = m[1].toLowerCase();
  if(f === "jpeg" || f === "jpg") return "jpg";
  if(f === "webp") return "png"; // docx não suporta webp nativamente; nossos casos reais geram png/jpeg
  return f;
}

function docxDataUrlToUint8Array(dataUrl){
  const base64 = (dataUrl || "").split(",")[1] || "";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for(let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// Equivalente, em DOCX, da caixa colorida desenhada por pdfDrawBox() no PDF: uma tabela
// de 1 célula (truque padrão para caixa com fundo colorido no Word), com borda esquerda
// grossa e colorida simulando a barra de destaque do PDF, rótulo em maiúsculas e corpo
// de texto — mesmas cores (PDF_PALETTE), mesmo tamanho de fonte, mesma ordem de blocos.
function docxBuildBox({ label, text, colors, fontSize = 10.5, big = false, gap = 10 }){
  const { Table, TableRow, TableCell, Paragraph, TextRun, WidthType, BorderStyle, ShadingType, AlignmentType } = window.docx;
  const c = docxColors(colors);
  const cellChildren = [];

  if(label){
    cellChildren.push(new Paragraph({
      spacing: { after: 60 },
      children: [ new TextRun({ text: String(label).toUpperCase(), bold: true, size: ptToHalfPt(8), color: c.accent, font: "Helvetica" }) ],
    }));
  }

  if(big){
    cellChildren.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [ new TextRun({ text: String(text || "—"), bold: true, size: ptToHalfPt(26), color: c.text, font: "Helvetica" }) ],
    }));
  } else {
    const raw = String(text || "").trim();
    const bodyLines = raw ? raw.split(/\n+/) : ["—"];
    bodyLines.forEach((line, i) => {
      cellChildren.push(new Paragraph({
        spacing: { after: i === bodyLines.length - 1 ? 0 : 60 },
        children: [ new TextRun({ text: line, size: ptToHalfPt(fontSize), color: c.text, font: "Helvetica" }) ],
      }));
    });
  }

  const table = new Table({
    width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    rows: [ new TableRow({ children: [ new TableCell({
      width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
      shading: { fill: c.fill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 140, bottom: 140, left: 170, right: 140 },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.SINGLE, size: ptToEighths(4), color: c.accent },
      },
      children: cellChildren,
    }) ] }) ],
  });

  return [ table, new Paragraph({ spacing: { after: ptToTwips(gap) } }) ];
}

// Equivalente, em DOCX, de pdfDrawVisualBox(): a mesma caixa (cor PDF_PALETTE.visual)
// contendo, dependendo do tipo — imagem gerada por IA / gráfico (embutidos como imagem,
// lidos da tela via pdfGetVisualImageInfo/pdfGetVisualChartInfo, reaproveitadas do bloco
// de PDF acima) ou tabela (desenhada como tabela nativa do Word, não como imagem).
function docxBuildVisualBox(visual, cardIdx){
  if(!visual || !visual.tipo) return [];
  const { Table, TableRow, TableCell, Paragraph, TextRun, ImageRun, WidthType, BorderStyle, ShadingType, AlignmentType } = window.docx;
  const c = docxColors(PDF_PALETTE.visual);
  const titleText = visual.titulo || (visual.tipo === "imagem" ? "Imagem ilustrativa" : visual.tipo === "grafico" ? "Gráfico" : "Tabela");
  const innerChildren = [
    new Paragraph({
      spacing: { after: 90 },
      children: [ new TextRun({ text: String(titleText).toUpperCase(), bold: true, size: ptToHalfPt(8), color: c.accent, font: "Helvetica" }) ],
    }),
  ];

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(cols.length){
      const tableWidthTwips = DOCX_CONTENT_WIDTH_TWIPS - 600;
      const colWidthTwips = Math.round(tableWidthTwips / cols.length);
      const headerRow = new TableRow({
        children: cols.map(col => new TableCell({
          width: { size: colWidthTwips, type: WidthType.DXA },
          shading: { fill: "FFFFFF", type: ShadingType.CLEAR, color: "auto" },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [ new Paragraph({ children: [ new TextRun({ text: String(col), bold: true, size: ptToHalfPt(9), color: "000000", font: "Helvetica" }) ] }) ],
        })),
      });
      const dataRows = rows.map(row => new TableRow({
        children: row.map(cell => new TableCell({
          width: { size: colWidthTwips, type: WidthType.DXA },
          shading: { fill: "FCFCFD", type: ShadingType.CLEAR, color: "auto" },
          margins: { top: 80, bottom: 80, left: 100, right: 100 },
          children: [ new Paragraph({ children: [ new TextRun({ text: String(cell), size: ptToHalfPt(9), color: "000000", font: "Helvetica" }) ] }) ],
        })),
      }));
      innerChildren.push(new Table({
        width: { size: tableWidthTwips, type: WidthType.DXA },
        rows: [ headerRow, ...dataRows ],
      }));
    }
  } else {
    const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx) : pdfGetVisualChartInfo(cardIdx);
    if(info){
      const maxW = DOCX_CONTENT_WIDTH_PT - 20 - 6;
      const maxH = 260;
      let w = maxW, h = w * (info.height / info.width);
      if(h > maxH){ h = maxH; w = h * (info.width / info.height); }
      try{
        innerChildren.push(new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [ new ImageRun({
            data: docxDataUrlToUint8Array(info.dataUrl),
            transformation: { width: ptToPx(w), height: ptToPx(h) },
            type: docxImageType(info.dataUrl),
          }) ],
        }));
      }catch(e){ /* imagem inválida — ignora silenciosamente, igual ao PDF */ }
      if(visual.descricao){
        innerChildren.push(new Paragraph({
          spacing: { before: 80 },
          children: [ new TextRun({ text: visual.descricao, italics: true, size: ptToHalfPt(8.5), color: c.text, font: "Helvetica" }) ],
        }));
      }
    }
  }

  const table = new Table({
    width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
    rows: [ new TableRow({ children: [ new TableCell({
      width: { size: DOCX_CONTENT_WIDTH_TWIPS, type: WidthType.DXA },
      shading: { fill: c.fill, type: ShadingType.CLEAR, color: "auto" },
      margins: { top: 140, bottom: 140, left: 170, right: 140 },
      borders: {
        top: { style: BorderStyle.NONE, size: 0, color: "auto" },
        bottom: { style: BorderStyle.NONE, size: 0, color: "auto" },
        right: { style: BorderStyle.NONE, size: 0, color: "auto" },
        left: { style: BorderStyle.SINGLE, size: ptToEighths(4), color: c.accent },
      },
      children: innerChildren,
    }) ] }) ],
  });

  return [ table, new Paragraph({ spacing: { after: ptToTwips(10) } }) ];
}

function docxBuildQuestionHeader(q, idx){
  const { Paragraph, TextRun } = window.docx;
  const d = q.data;
  const title = `Questão ${idx + 1}` + (d.tema ? ` — ${d.tema}` : "");
  const metaParts = [d.disciplina || state.disciplina, d.dificuldade].filter(Boolean);
  return [
    new Paragraph({
      spacing: { after: 40 },
      children: [ new TextRun({ text: title, bold: true, size: ptToHalfPt(14), color: "1E293B", font: "Helvetica" }) ],
    }),
    new Paragraph({
      spacing: { after: 160 },
      children: [ new TextRun({ text: metaParts.join("   ·   "), size: ptToHalfPt(9), color: "64748B", font: "Helvetica" }) ],
    }),
  ];
}

async function exportDocx(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de exportar em DOCX.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de exportar em DOCX.", "err");
    return;
  }
  if(!window.docx){
    try{
      await loadScriptOnce(CDN_URLS.docx);
    }catch(e){
      toast("Não foi possível carregar a biblioteca de DOCX (verifique sua conexão com a internet) e tente novamente.", "err");
      return;
    }
  }

  const btn = document.getElementById("btnExportDocx");
  const originalLabel = btn.textContent;
  btn.disabled = true; btn.textContent = "Gerando DOCX...";

  try{
    const { Document, Packer, Paragraph, TextRun, PageBreak } = window.docx;
    const isAluno = state.viewMode === "aluno";

    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(!doneQuestions.length){ throw new Error("Nenhuma questão para exportar."); }

    // AS DUAS VERSÕES saem na mesma anatomia ENEM do PDF, em 2 colunas do Word.
    // As margens do caderno ENEM são espelhadas (a mancha desliza 2,5 mm conforme
    // a paridade). O docx.js 8.5 não expõe o <w:mirrorMargins/> do Word, então
    // aqui aplicamos a geometria da página ímpar a todas: interna 8,00 mm e
    // externa 9,67 mm. Quem precisar do espelhamento real liga "Margens
    // espelhadas" em Layout → Margens, no próprio Word. O PDF já espelha.
    const docEnem = new Document({ sections: [ enemDocxSection(doneQuestions, !isAluno) ] });
    const blobEnem = await Packer.toBlob(docEnem);
    const rotuloEnem = isAluno ? "aluno" : "professor";
    const nomeEnem = "Simulado_ENEM_" + (state.disciplina||"questoes").replace(/[^a-zA-Z0-9]+/g,"_") + "_" + rotuloEnem + ".docx";
    const urlEnem = URL.createObjectURL(blobEnem);
    const aEnem = document.createElement("a");
    aEnem.href = urlEnem; aEnem.download = nomeEnem;
    document.body.appendChild(aEnem); aEnem.click(); document.body.removeChild(aEnem);
    setTimeout(() => URL.revokeObjectURL(urlEnem), 4000);
    toast("DOCX exportado com sucesso.", "ok");
    return;

    const children = [];
    children.push(new Paragraph({
      spacing: { after: 60 },
      children: [ new TextRun({ text: "Simulado ENEM", bold: true, size: ptToHalfPt(20), color: "1E293B", font: "Helvetica" }) ],
    }));
    children.push(new Paragraph({
      spacing: { after: 40 },
      children: [ new TextRun({ text: `${AREA_META[state.area] ? AREA_META[state.area].label : ""} · ${state.disciplina || ""}`, size: ptToHalfPt(11), color: "475569", font: "Helvetica" }) ],
    }));
    children.push(new Paragraph({
      spacing: { after: 260 },
      children: [ new TextRun({ text: isAluno ? "Versão do aluno (sem gabarito)" : "Versão do professor (com gabarito e comentários)", size: ptToHalfPt(11), color: "475569", font: "Helvetica" }) ],
    }));

    doneQuestions.forEach((o, i) => {
      const { q, idx } = o;
      const d = q.data;
      if(i > 0){
        children.push(new Paragraph({ children: [ new PageBreak() ] }));
      }

      children.push(...docxBuildQuestionHeader(q, idx));

      if(d.textoBase){
        children.push(...docxBuildBox({ label: "Texto de apoio", text: d.textoBase, colors: PDF_PALETTE.contexto, fontSize: 10 }));
      }

      if(d.visual && d.visual.tipo){
        children.push(...docxBuildVisualBox(d.visual, idx));
      }

      if(d.comando){
        children.push(...docxBuildBox({ label: "Pergunta", text: d.comando, colors: PDF_PALETTE.pergunta, fontSize: 11.5 }));
      }

      ["A", "B", "C", "D", "E"].forEach(letter => {
        const isCorrect = !isAluno && d.gabarito === letter;
        const altText = (d.alternativas && d.alternativas[letter]) || "";
        children.push(...docxBuildBox({
          label: `Alternativa ${letter}` + (isCorrect ? " — CORRETA" : ""),
          text: altText,
          colors: isCorrect ? PDF_PALETTE.correta : PDF_PALETTE.alternativa,
          fontSize: 10.5,
          gap: 8,
        }));
      });

      if(!isAluno){
        let habText = `Competência ${d.competencia?.numero || "—"}: ${d.competencia?.texto || ""}\n\n${d.habilidade?.codigo || "—"}: ${d.habilidade?.texto || ""}`;
        if(d.objetoConhecimento) habText += `\n\nObjeto de conhecimento: ${d.objetoConhecimento}`;
        children.push(...docxBuildBox({ label: "Habilidade, competência e objeto de conhecimento", text: habText, colors: PDF_PALETTE.habilidade, fontSize: 10 }));

        children.push(...docxBuildBox({ label: "Gabarito", text: d.gabarito || "—", colors: PDF_PALETTE.gabarito, big: true, gap: 14 }));

        const respostaText = (d.alternativas && d.alternativas[d.gabarito]) || "";
        children.push(...docxBuildBox({ label: "Resposta correta", text: respostaText, colors: PDF_PALETTE.resposta, fontSize: 10.5 }));

        children.push(...docxBuildBox({ label: "Resolução comentada", text: d.resolucaoComentada || "", colors: PDF_PALETTE.resolucao, fontSize: 10 }));

        const comentarios = ["A", "B", "C", "D", "E"].map(letter => {
          const info = d.analiseAlternativas && d.analiseAlternativas[letter];
          if(!info) return "";
          const status = info.status === "correta" ? "CORRETA" : "INCORRETA";
          return `${letter} — ${status}: ${info.comentario || ""}`;
        }).filter(Boolean).join("\n\n");
        children.push(...docxBuildBox({ label: "Comentários das alternativas", text: comentarios, colors: PDF_PALETTE.comentario, fontSize: 10 }));
      }
    });

    const doc = new Document({
      sections: [{
        properties: {
          page: {
            size: { width: Math.round(DOCX_PAGE_WIDTH_PT * 20), height: Math.round(DOCX_PAGE_HEIGHT_PT * 20) },
            margin: {
              top: ptToTwips(DOCX_MARGIN_PT), bottom: ptToTwips(DOCX_MARGIN_PT),
              left: ptToTwips(DOCX_MARGIN_PT), right: ptToTwips(DOCX_MARGIN_PT),
            },
          },
        },
        children,
      }],
    });

    const blob = await Packer.toBlob(doc);
    const rotulo = isAluno ? "aluno" : "professor";
    const safeName = `Simulado_ENEM_${(state.disciplina||"questoes").replace(/[^a-zA-Z0-9]+/g,"_")}_${rotulo}.docx`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = safeName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("DOCX exportado com sucesso.", "ok");
  }catch(err){
    toast("Não foi possível exportar o DOCX: " + (err.message || err), "err");
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
  document.getElementById("btnExportDocx").addEventListener("click", exportDocx);

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
