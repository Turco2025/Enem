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

/* ---------------- Autenticação (Supabase Auth) + "Meus Simulados" ----------------

   Login é OBRIGATÓRIO para gerar simulados: assim que a pessoa clica em
   qualquer caixa/etapa do formulário sem estar logada, o modal de login abre
   e bloqueia o fluxo até ela entrar ou se cadastrar (ver exigirLogin() e o
   listener de clique dos cartões de área em renderAreaGrid()). Uma vez
   logada, todo simulado gerado é automaticamente arquivado em "Meus
   Simulados" (tabela "simulados" no Supabase, protegida por RLS: cada
   usuário só enxerga os próprios registros).

   O cliente Supabase só é criado dentro de init() (na virada do
   DOMContentLoaded) — ver comentário junto à tag <script defer> do
   supabase-js no template — então nenhuma função abaixo pode ser chamada
   antes disso. */
const SUPABASE_URL = "https://gkceyrkdmnhgqimmrsre.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_-s4dLevKftQzX-aOJyKfMw_u5c_JzLV";

let supabaseClient = null;
let currentUser = null;
let currentSession = null;
// Guarda o id do registro em "simulados" quando o simulado exibido na tela
// veio de "Meus Simulados" (botão "Abrir") — assim, ao gerar de novo, não se
// confunde um simulado reaberto com um simulado novo.
let simuladoAbertoId = null;

// Promessas de geração de imagem ainda em andamento nesta tela. Toda imagem
// nova (nunca vista antes) entra aqui no instante em que é pedida ao backend;
// quem precisa ter certeza de que TODAS as imagens já terminaram antes de
// arquivar o simulado (generateAll, abrir um simulado salvo, refazer um
// recurso visual) chama aguardaImagensPendentes() antes de salvar.
let imagePromisesEmAndamento = [];
async function aguardaImagensPendentes(){
  if(!imagePromisesEmAndamento.length) return false;
  const pendentes = imagePromisesEmAndamento;
  imagePromisesEmAndamento = [];
  await Promise.allSettled(pendentes);
  return true;
}

function initAuth(){
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  supabaseClient.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
    currentUser = session ? session.user : null;
    atualizaHeaderAuth();
  });
  supabaseClient.auth.getSession().then(({ data }) => {
    currentSession = data.session;
    currentUser = data.session ? data.session.user : null;
    atualizaHeaderAuth();
  });
}

// Cabeçalho de autorização enviado ao backend (Supabase Edge Functions), que
// agora exige um usuário logado de verdade — ver usuarioAutenticado() nos
// arquivos supabase/functions/generate-question|generate-image/index.ts.
function authHeaders(){
  return currentSession && currentSession.access_token
    ? { "Authorization": "Bearer " + currentSession.access_token }
    : {};
}

function atualizaHeaderAuth(){
  const logado = !!currentUser;
  document.getElementById("btnEntrar").style.display = logado ? "none" : "";
  document.getElementById("btnSair").style.display = logado ? "" : "none";
  document.getElementById("btnMeusSimulados").style.display = logado ? "" : "none";
}

// Chama antes de qualquer ação que exija estar logado (selecionar área,
// clicar em "Gerar simulado completo", abrir "Meus Simulados"...). Se não
// houver sessão, abre o modal de login/cadastro e devolve false — quem
// chamou deve interromper a ação nesse caso.
function exigirLogin(){
  if(currentUser) return true;
  abrirAuthModal("login");
  return false;
}

function abrirAuthModal(aba){
  document.getElementById("authErr").classList.remove("show");
  document.getElementById("authErr").textContent = "";
  selecionaAbaAuth(aba || "login");
  openModal("authModal");
}

function selecionaAbaAuth(aba){
  const login = aba === "login";
  document.getElementById("authTabLogin").classList.toggle("sel", login);
  document.getElementById("authTabCadastro").classList.toggle("sel", !login);
  document.getElementById("authPaneLogin").classList.toggle("sel", login);
  document.getElementById("authPaneCadastro").classList.toggle("sel", !login);
}

function mostraErroAuth(msg){
  const el = document.getElementById("authErr");
  el.textContent = msg;
  el.classList.add("show");
}

function traduzErroAuth(err){
  const msg = String(err && err.message || err || "");
  if(/invalid login credentials/i.test(msg)) return "E-mail ou senha incorretos.";
  if(/already registered|already exists|user already registered/i.test(msg)) return "Já existe uma conta com este e-mail. Tente acessar em vez de cadastrar.";
  if(/password should be at least/i.test(msg)) return "A senha precisa ter pelo menos 6 caracteres.";
  if(/invalid email/i.test(msg)) return "E-mail inválido.";
  return msg || "Não foi possível concluir. Tente novamente.";
}

async function fazerLogin(){
  const email = document.getElementById("loginEmail").value.trim();
  const senha = document.getElementById("loginSenha").value;
  if(!email || !senha){ mostraErroAuth("Preencha e-mail e senha."); return; }
  const btn = document.getElementById("btnLoginSubmit");
  btn.disabled = true;
  try{
    const { error } = await supabaseClient.auth.signInWithPassword({ email, password: senha });
    if(error) throw error;
    closeModal("authModal");
    toast("Login realizado!", "ok");
  }catch(err){
    mostraErroAuth(traduzErroAuth(err));
  }finally{
    btn.disabled = false;
  }
}

async function fazerCadastro(){
  const email = document.getElementById("cadastroEmail").value.trim();
  const senha = document.getElementById("cadastroSenha").value;
  if(!email || !senha){ mostraErroAuth("Preencha e-mail e senha."); return; }
  if(senha.length < 6){ mostraErroAuth("A senha precisa ter pelo menos 6 caracteres."); return; }
  const btn = document.getElementById("btnCadastroSubmit");
  btn.disabled = true;
  try{
    const { data, error } = await supabaseClient.auth.signUp({ email, password: senha });
    if(error) throw error;
    if(data.session){
      closeModal("authModal");
      toast("Conta criada! Você já está logado.", "ok");
    }else{
      // Projeto com confirmação de e-mail ativada: ainda não há sessão.
      mostraErroAuth("Conta criada! Confira seu e-mail para confirmar o cadastro antes de entrar.");
    }
  }catch(err){
    mostraErroAuth(traduzErroAuth(err));
  }finally{
    btn.disabled = false;
  }
}

async function fazerLoginGoogle(){
  try{
    await supabaseClient.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
  }catch(err){
    mostraErroAuth(traduzErroAuth(err));
  }
}

async function fazerLogout(){
  await supabaseClient.auth.signOut();
  toast("Você saiu da sua conta.", "info");
  document.getElementById("formPanel").style.display = "block";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("simuladosPanel").style.display = "none";
}

/* ---------------- Arquivo "Meus Simulados" ---------------- */

// Chamado ao final de generateAll(): arquiva (ou atualiza, se o simulado
// atual veio de "Abrir") o simulado recém-gerado na conta do usuário
// logado. Tudo que é necessário para reabrir o simulado depois — as
// questões, o plano de gabarito, a validação escolhida — vai no campo
// "dados" (jsonb). Melhor esforço: se salvar falhar, o professor ainda fica
// com o simulado na tela e pode exportar normalmente, só não fica arquivado.
async function salvarSimuladoAtual(){
  if(!currentUser) return;
  const nomeArea = (AREA_META[state.area] && AREA_META[state.area].label) || state.area || "";
  const linha = {
    user_id: currentUser.id,
    nome: `Simulado de ${state.disciplina || state.area || "ENEM"}`,
    area: state.area,
    area_label: nomeArea,
    disciplina: state.disciplina,
    num_questoes: state.questions.length,
    validacao_dupla: !!document.getElementById("chkValidacao").checked,
    dados: {
      area: state.area,
      disciplina: state.disciplina,
      qty: state.qty,
      questions: state.questions,
      gabaritoPlan: state.gabaritoPlan || null,
    },
  };
  try{
    if(simuladoAbertoId){
      const { error } = await supabaseClient.from("simulados").update(linha).eq("id", simuladoAbertoId);
      if(error) throw error;
    }else{
      const { data, error } = await supabaseClient.from("simulados").insert(linha).select("id").single();
      if(error) throw error;
      simuladoAbertoId = data.id;
    }
  }catch(err){
    console.error("Falha ao arquivar o simulado em 'Meus Simulados':", err);
    toast("O simulado foi gerado, mas não foi possível arquivá-lo em 'Meus Simulados' agora.", "err");
  }
}

function formataDataSimulado(iso){
  try{
    return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
  }catch(e){ return ""; }
}

async function abrirMeusSimulados(){
  if(!exigirLogin()) return;
  document.getElementById("formPanel").style.display = "none";
  document.getElementById("resultsPanel").style.display = "none";
  document.getElementById("simuladosPanel").style.display = "block";
  const grid = document.getElementById("simuladosGrid");
  const vazio = document.getElementById("simuladosVazio");
  grid.innerHTML = `<p class="hint">Carregando...</p>`;
  vazio.classList.add("hidden");
  try{
    const { data, error } = await supabaseClient
      .from("simulados")
      .select("id, nome, area_label, disciplina, num_questoes, validacao_dupla, created_at")
      .order("created_at", { ascending: false });
    if(error) throw error;
    renderSimuladosGrid(data || []);
  }catch(err){
    grid.innerHTML = "";
    toast("Não foi possível carregar seus simulados: " + String(err && err.message || err), "err");
  }
}

function fecharMeusSimulados(){
  document.getElementById("simuladosPanel").style.display = "none";
  document.getElementById("formPanel").style.display = "block";
}

function renderSimuladosGrid(lista){
  const grid = document.getElementById("simuladosGrid");
  const vazio = document.getElementById("simuladosVazio");
  grid.innerHTML = "";
  if(!lista.length){ vazio.classList.remove("hidden"); return; }
  vazio.classList.add("hidden");
  lista.forEach(sim => {
    const card = document.createElement("div");
    card.className = "simulado-card";
    const qtdTxt = sim.num_questoes === 1 ? "1 questão" : `${sim.num_questoes} questões`;
    const valTxt = sim.validacao_dupla ? "com validação dupla" : "sem validação dupla";
    card.innerHTML = `
      <div class="simulado-tag">${escapeHtml(sim.area_label || "")}${sim.area_label ? " · " : ""}${escapeHtml(sim.disciplina || "")}</div>
      <div class="simulado-nome">
        <span class="txt" title="${escapeHtml(sim.nome)}">${escapeHtml(sim.nome)}</span>
        <button class="simulado-edit" title="Renomear">✏️</button>
      </div>
      <div class="simulado-meta">${qtdTxt} · ${valTxt}<br>📅 ${formataDataSimulado(sim.created_at)}</div>
      <div class="simulado-actions">
        <button class="btn ghost sm btn-abrir">Abrir</button>
        <button class="simulado-del" title="Excluir">🗑️</button>
      </div>`;
    card.querySelector(".btn-abrir").addEventListener("click", () => abrirSimuladoSalvo(sim.id));
    card.querySelector(".simulado-edit").addEventListener("click", () => iniciarRenomeioSimulado(card, sim));
    card.querySelector(".simulado-del").addEventListener("click", () => excluirSimulado(sim.id, card));
    grid.appendChild(card);
  });
}

function iniciarRenomeioSimulado(card, sim){
  const nomeWrap = card.querySelector(".simulado-nome");
  const nomeAtual = sim.nome;
  nomeWrap.innerHTML = `
    <input type="text" value="${escapeHtml(nomeAtual)}" maxlength="120">
    <button class="simulado-edit edit-ok" title="Salvar">✔️</button>
    <button class="simulado-edit edit-cancelar" title="Cancelar">✕</button>`;
  const input = nomeWrap.querySelector("input");
  input.focus();
  input.select();
  const salvar = async () => {
    const novoNome = input.value.trim() || nomeAtual;
    nomeWrap.innerHTML = `<span class="txt">${escapeHtml(novoNome)}</span><button class="simulado-edit" title="Renomear">✏️</button>`;
    nomeWrap.querySelector(".simulado-edit").addEventListener("click", () => iniciarRenomeioSimulado(card, { ...sim, nome: novoNome }));
    if(novoNome === nomeAtual) return;
    try{
      const { error } = await supabaseClient.from("simulados").update({ nome: novoNome }).eq("id", sim.id);
      if(error) throw error;
    }catch(err){
      toast("Não foi possível renomear: " + String(err && err.message || err), "err");
    }
  };
  const cancelar = () => {
    nomeWrap.innerHTML = `<span class="txt">${escapeHtml(nomeAtual)}</span><button class="simulado-edit" title="Renomear">✏️</button>`;
    nomeWrap.querySelector(".simulado-edit").addEventListener("click", () => iniciarRenomeioSimulado(card, sim));
  };
  nomeWrap.querySelector(".edit-ok").addEventListener("click", salvar);
  nomeWrap.querySelector(".edit-cancelar").addEventListener("click", cancelar);
  input.addEventListener("keydown", (e) => {
    if(e.key === "Enter") salvar();
    if(e.key === "Escape") cancelar();
  });
}

async function excluirSimulado(id, card){
  if(!confirm("Excluir este simulado arquivado? Esta ação não pode ser desfeita.")) return;
  try{
    const { error } = await supabaseClient.from("simulados").delete().eq("id", id);
    if(error) throw error;
    card.remove();
    if(!document.getElementById("simuladosGrid").children.length){
      document.getElementById("simuladosVazio").classList.remove("hidden");
    }
    toast("Simulado excluído.", "ok");
  }catch(err){
    toast("Não foi possível excluir: " + String(err && err.message || err), "err");
  }
}

async function abrirSimuladoSalvo(id){
  try{
    const { data, error } = await supabaseClient.from("simulados").select("*").eq("id", id).single();
    if(error) throw error;
    const dados = data.dados || {};
    state.area = dados.area || data.area;
    state.disciplina = dados.disciplina || data.disciplina;
    state.qty = dados.qty || (dados.questions ? dados.questions.length : 1);
    state.questions = dados.questions || [];
    state.gabaritoPlan = dados.gabaritoPlan || null;
    simuladoAbertoId = data.id;
    document.getElementById("chkValidacao").checked = !!data.validacao_dupla;
    document.getElementById("simuladosPanel").style.display = "none";
    document.getElementById("formPanel").style.display = "none";
    document.getElementById("resultsPanel").style.display = "block";
    document.getElementById("genProgressWrap").classList.add("hidden");
    renderResults();
    updateProgress();
    toast(`Simulado "${data.nome}" aberto.`, "ok");
    /* Todo simulado salvo a partir de agora já guarda as imagens prontas (ver
       renderGeneratedImage/generateAll), então reabri-lo não deveria gerar
       imagem nenhuma. Simulados arquivados ANTES desta correção, porém, não
       têm essa imagem guardada — o render acima teve que pedir uma agora. Uma
       vez terminada, ela é salva de volta no registro para NUNCA MAIS
       precisar ser gerada de novo ao reabrir este mesmo simulado. */
    const gerouImagemNova = await aguardaImagensPendentes();
    if(gerouImagemNova) await salvarSimuladoAtual();
  }catch(err){
    toast("Não foi possível abrir este simulado: " + String(err && err.message || err), "err");
  }
}

/* ---------------- Geração de imagem (GPT Image 2 via backend) ----------------

   QUALIDADE FIXA EM "low" — sem opção de escolha na interface. A decisão foi
   medida, não estilística. Gerando a MESMA especificação nas três qualidades,
   em 1536×1024:

       low     16 s   ·   158 tokens   ·   US$ 0,0065
       medium  39 s   · 1.372 tokens   ·   US$ 0,0429
       high    97 s   · 5.488 tokens   ·   US$ 0,1664

   Além de 26× mais barata e 6× mais rápida que "high", a saída em "low" foi a
   MAIS legível para o nosso caso: o modelo desenhou os rótulos em texto branco
   sobre tarja sólida — a camada de anotação que o protocolo pede —, enquanto em
   "high" ele gastou o orçamento extra em realismo fotográfico e escreveu os
   rótulos em cinza fino, sem tarja, sobre a foto. Para uma figura didática com
   régua e rótulo, mais tokens de imagem trabalham CONTRA a leitura.

   Não há mais seletor de qualidade por figura: toda imagem é sempre gerada em
   "low" — o backend (generate-image) trava isso do lado do servidor também,
   então nem uma requisição feita fora deste app consegue pedir outra coisa.

   FORMATO: WebP com compressão 80. A mesma imagem que sai com 2,2 MB em PNG sai
   com 110 KB em WebP — 20× menor, custo idêntico (a OpenAI cobra pelos tokens da
   imagem, não pelos bytes). É o que torna viável um simulado com 15 figuras sem
   gerar um PDF de 30 MB.                                                      */

const IMG_QUALIDADE_PADRAO = "low";

/* O agente já entrega o "promptImagem" no protocolo das 8 seções, que ali dentro
   descreve as duas camadas, a regra de precedência e as restrições negativas.
   Mandar tudo isso de novo num preâmbulo era repetir a mesma instrução duas
   vezes na mesma requisição. Então o preâmbulo só entra quando o texto NÃO é uma
   especificação completa — o caso de reserva, em que só há a "descricao". */
function imgEhEspecificacaoCompleta(texto){
  const t = String(texto || "");
  return /ELEMENT INVENTORY/i.test(t) && /NEGATIVE CONSTRAINTS/i.test(t);
}

const IMG_PREAMBULO_CURTO = `Ilustração educacional para uma questão no padrão ENEM. Cena real e nítida, com uma camada de anotação vetorial limpa por cima: rótulos legíveis com tarja ou halo atrás do texto, setas com sentido explícito e marcações de medida. A cena nunca pode prejudicar a leitura da anotação. Todo texto visível deve estar em português do Brasil, com ortografia correta. Sem texto decorativo, marca d'água ou assinatura.

Cena: `;

async function generateImageViaBackend(promptText){
  const texto = String(promptText || "");
  const prompt = imgEhEspecificacaoCompleta(texto) ? texto : (IMG_PREAMBULO_CURTO + texto);

  const res = await fetch(IMAGE_BACKEND_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({
      prompt,
      size: "1536x1024",
      quality: IMG_QUALIDADE_PADRAO,
      outputFormat: "webp",
      outputCompression: 80,
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
  if(data.uso) somaUsoImagem(data.uso);
  return { dataUrl: data.imageDataUrl, uso: data.uso || null };
}

/* Contabilidade das imagens do simulado, para o custo ser verificável em vez de
   estimado: o backend devolve tokens, segundos e preço de cada imagem. */
function zeraUsoImagem(){
  state.usoImagem = { imagens: 0, segundos: 0, tokensEntrada: 0, tokensSaida: 0, custoUSD: 0, bytes: 0 };
}
function somaUsoImagem(u){
  if(!state.usoImagem) zeraUsoImagem();
  const a = state.usoImagem;
  a.imagens += 1;
  a.segundos += Number(u.segundos) || 0;
  a.tokensEntrada += Number(u.tokensEntrada) || 0;
  a.tokensSaida += Number(u.tokensSaida) || 0;
  a.custoUSD += Number(u.custoUSD) || 0;
  a.bytes += Number(u.bytesImagem) || 0;
  console.log(`[imagem] ${u.qualidade} · ${u.segundos}s · ${u.tokensSaida} tokens · US$ ${Number(u.custoUSD).toFixed(5)} · ${Math.round((Number(u.bytesImagem)||0)/1024)} KB  |  acumulado: ${a.imagens} imagens, US$ ${a.custoUSD.toFixed(4)}`);
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
    tile.addEventListener("click", () => { if(exigirLogin()) selectArea(key); });
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
    // Consumo relatado pelo backend (tokens novos, escritos e lidos do cache).
    // Serve para conferir, em produção, que o cache de prompt está valendo.
    if(payload.uso) somaUso(payload.uso);
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

// Usado pelos botões "Regenerar"/"Mais fácil"/"Mais difícil" de uma questão já
// na tela: gera a questão de novo (com sua nova imagem, se houver), espera a
// imagem terminar e, se este simulado já estiver arquivado em "Meus
// Simulados", atualiza o arquivo — senão a edição feita aqui se perderia na
// próxima vez que o simulado fosse reaberto.
async function regenerarQuestaoEArquivar(q){
  await generateQuestion(q);
  await aguardaImagensPendentes();
  if(simuladoAbertoId) await salvarSimuladoAtual();
}

/* Contabilidade de tokens do simulado inteiro. O backend devolve, em cada
   questão, quantos tokens de entrada foram novos, quantos gravaram cache e
   quantos vieram lidos do cache. Somando tudo dá para dizer, ao fim da geração,
   se o aquecimento funcionou — em vez de acreditar que funcionou. */
function zeraUso(){
  state.uso = { chamadas: 0, entradaNova: 0, cacheEscrito: 0, cacheLido: 0, saida: 0 };
}
function somaUso(u){
  if(!state.uso) zeraUso();
  Object.keys(state.uso).forEach(k => { state.uso[k] += Number(u[k]) || 0; });
}
function relatoUso(){
  const u = state.uso;
  if(!u || !u.chamadas) return "";
  const total = u.entradaNova + u.cacheEscrito + u.cacheLido;
  const pct = total ? Math.round((u.cacheLido / total) * 100) : 0;
  return `[tokens] ${u.chamadas} chamadas · entrada nova ${u.entradaNova} · cache escrito ${u.cacheEscrito} · cache lido ${u.cacheLido} (${pct}% da entrada) · saída ${u.saida}`;
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
  zeraUso();
  zeraUsoImagem();
  /* AQUECIMENTO DO CACHE. O prompt do sistema tem mais de 25 mil caracteres e é
     o mesmo em todas as questões da área. O backend o manda com cache_control,
     mas quem grava o cache é a primeira chamada — e chamadas simultâneas não
     enxergam o cache uma da outra. Disparando as 4 de uma vez, as 4 pagariam o
     prompt inteiro. Gerando a primeira sozinha, ela grava; as demais leem.
     Custa a espera de uma questão e economiza o prompt em todas as outras. */
  const [primeira, ...demais] = state.questions;
  if(primeira) await generateQuestion(primeira);
  // Concorrência 4: cada questão já roda inteiramente no backend (Supabase Edge
  // Function), então gerar mais em paralelo reduz bastante o tempo total. O
  // valor foi mantido em 4 de propósito — subir sem medir troca tempo por
  // retentativas, e uma questão repetida é uma questão cobrada duas vezes.
  if(demais.length) await runPool(demais, generateQuestion, 4);
  document.getElementById("genProgressWrap").classList.add("hidden");
  const relato = relatoUso();
  if(relato) console.log(relato);

  // Auditoria da distribuição do gabarito, com o resultado dito em voz alta.
  const presos = state.questions.filter(q => q.gabaritoStatus === "impossivel").length;
  const quimica = auditaQuimica();
  const problemas = auditaGabaritos();
  if(quimica.length){
    toast(avisoQuimica(quimica) + " Edite a questão antes de exportar.", "err");
  }else if(problemas.length){
    toast("Simulado gerado, mas a distribuição do gabarito ficou imperfeita: " + problemas[0] + ". Regenere a questão para corrigir.", "err");
  }else if(presos){
    toast("Simulado gerado. " + presos + " quest" + (presos > 1 ? "ões vieram" : "ão veio") + " com o gabarito fora da posição planejada e não pôde ser reposicionada sem quebrar a ordem numérica das alternativas.", "err");
  }else{
    toast("Simulado gerado! Revise, edite ou regenere questões conforme necessário.", "ok");
  }

  // As imagens são pedidas ao backend em paralelo ao texto (ver
  // renderGeneratedImage) e por isso ainda podem estar em andamento aqui.
  // Espera todas terminarem ANTES de arquivar, para que o simulado guardado
  // em "Meus Simulados" já leve as imagens prontas — nunca só o texto — e
  // reabri-lo depois não precise (nem vá) gerar nenhuma imagem de novo.
  await aguardaImagensPendentes();

  // Arquiva automaticamente em "Meus Simulados" (todo simulado gerado fica
  // arquivado). Roda por último e nunca interrompe o fluxo do professor —
  // qualquer falha aqui só avisa por toast, sem desfazer o simulado na tela.
  await salvarSimuladoAtual();
}


/* A fórmula é uma unidade visual: não pode ser partida no fim da linha. O Word e
   o navegador quebram depois de um traço de ligação ou do ponto de hidrato, e
   "CH₃–CH₂–" numa linha e "OH" na outra deixa de ser uma fórmula.

   A solução preserva o caractere que a regra determina — o traço continua sendo
   "–", o ponto continua sendo "·" — e insere depois dele um JUNTADOR DE PALAVRA
   (U+2060), que é invisível e não imprime nada: só diz ao compositor que ali não
   se quebra. No PDF ele é removido, porque lá a linha só quebra em espaço.      */
const QUI_LIGACAO = /[A-Za-zÀ-ÿ0-9₀-₉⁰-⁹⁺⁻()\[\]]+(?:[–—·=≡][A-Za-zÀ-ÿ0-9₀-₉⁰-⁹⁺⁻()\[\]]+)+/g;
function quiJuntaFormula(texto){
  let t = String(texto == null ? "" : texto);
  if(/[–—·=≡]/.test(t)){
    t = t.replace(QUI_LIGACAO, tok => {
      // Só amarra o que tem cara de fórmula: precisa de um símbolo de elemento.
      if(!/[A-Z]/.test(tok)) return tok;
      return tok.replace(/([–—·=≡])/g, "$1\u2060");
    });
  }
  // A seta nunca fica órfã no fim da linha: ela é colada ao que vem depois por
  // um espaço inseparável, então a equação longa quebra ANTES da seta — que é a
  // convenção de composição para equações que não cabem na medida.
  t = t.replace(/([→←⇌↔])[ \u00A0]+/g, "$1\u00A0");
  return t;
}

/* ---- AUDITORIA DE NOTAÇÃO QUÍMICA ----

   A fórmula tem de chegar ao estudante pronta: H₂SO₄, SO₄²⁻,
   2 H₂(g) + O₂(g) → 2 H₂O(l). Nunca um comando a ser interpretado depois —
   nada de LaTeX, tag, cifrão, chave ou barra invertida —, e nunca a versão
   mutilada em algarismo comum (H2O, Ca2+, SO4-2).

   Esta auditoria varre TUDO que sai impresso: texto-base, fonte, comando,
   recurso visual, as cinco alternativas, o gabarito, a ficha, a resolução e o
   comentário de cada alternativa. Se algo não passar, o simulado não é
   entregue como concluído (§17 da regra).                                   */

const QUI_INF = "₀₁₂₃₄₅₆₇₈₉";
const QUI_SUP = "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻";

// Símbolos oficiais dos elementos químicos (IUPAC) — usados para exigir que um
// trecho candidato a "fórmula"/"carga" mutilada corresponda de fato a um
// elemento real, e não a uma variável ou rótulo comum de Matemática, Física ou
// Geometria (V1, T2, P0, E0, A2...) que por acaso tem a forma de letra
// maiúscula + dígito. Sem essa checagem, esses rótulos — extremamente comuns
// fora da Química — eram confundidos com fórmula/carga quebrada e bloqueavam
// a exportação (PDF/DOCX/HTML/impressão) de simulados que não tinham erro nenhum.
const QUI_ELEMENTOS = new Set([
  "H","He","Li","Be","B","C","N","O","F","Ne","Na","Mg","Al","Si","P","S","Cl","Ar",
  "K","Ca","Sc","Ti","V","Cr","Mn","Fe","Co","Ni","Cu","Zn","Ga","Ge","As","Se","Br","Kr",
  "Rb","Sr","Y","Zr","Nb","Mo","Tc","Ru","Rh","Pd","Ag","Cd","In","Sn","Sb","Te","I","Xe",
  "Cs","Ba","La","Ce","Pr","Nd","Pm","Sm","Eu","Gd","Tb","Dy","Ho","Er","Tm","Yb","Lu",
  "Hf","Ta","W","Re","Os","Ir","Pt","Au","Hg","Tl","Pb","Bi","Po","At","Rn",
  "Fr","Ra","Ac","Th","Pa","U","Np","Pu","Am","Cm","Bk","Cf","Es","Fm","Md","No","Lr",
  "Rf","Db","Sg","Bh","Hs","Mt","Ds","Rg","Cn","Nh","Fl","Mc","Lv","Ts","Og",
]);

// 1) Códigos de renderização — proibidos sem exceção.
const QUI_CODIGOS = [
  { re: /\\(?:ce|frac|text|mathrm|cdot|rightarrow|leftarrow|times|pm|sqrt|begin|end)\b/, o: "comando LaTeX" },
  // Moeda (R$, US$, A$...) não é LaTeX: o cifrão de fórmula só conta quando
  // NÃO está colado a uma letra antes dele (é assim que "R$ 100,00" e
  // "US$ 50" deixam de disparar falso-positivo de fórmula matemática).
  { re: /(?<![A-Za-z])\$\$?[^$\n]*\$\$?/,        o: "cifrão de fórmula matemática" },
  { re: /\\\(|\\\)|\\\[|\\\]/,                   o: "delimitador matemático" },
  { re: /[_^]\{[^}]*\}/,                          o: "índice ou expoente em chaves" },
  { re: /<\/?(?:sub|sup|span|i|b|em|strong|math|mi|mn|msub|msup)\b[^>]*>/i, o: "tag HTML" },
  { re: /&(?:nbsp|amp|lt|gt|#\d+);/,             o: "entidade HTML" },
  { re: /```|~~~/,                                o: "bloco de código" },
];

// 2) Fórmula com índice em algarismo comum: H2O, Fe2O3, Al2(SO4)3.
const QUI_INDICE_ASCII = /(?:[A-Z][a-z]?\d{1,3}|\)\d{1,3}|\]\d{1,3})(?:[A-Z][a-z]?\d{0,3}|[()\[\]])*/g;
// 3) Carga escrita fora do padrão: Ca2+, Ca+2, SO4-2, SO₄2-.
// Quando o gatilho é uma LETRA maiúscula solta (não parêntese/colchete de
// fecho, nem dígito já subscrito — esses dois são inequívocos por si só), ela
// só conta como carga se for de fato um símbolo de elemento (QUI_ELEMENTOS) —
// senão "V1-V2" (diferença de velocidades) ou "P1+P2" (soma de pontos), comuns
// em Física/Matemática, seriam confundidos com carga química mal escrita.
const QUI_CARGA_ERRADA = [
  { re: /\b([A-Z][a-z]?)\d{1,2}[+\-](?![\d\-])/, o: "carga em algarismo comum (use Ca²⁺, não Ca2+)", precisaElemento: true },
  { re: /(\)|\])\d{1,2}[+\-](?![\d\-])/,         o: "carga em algarismo comum (use Ca²⁺, não Ca2+)", precisaElemento: false },
  { re: /([₀-₉])\d{1,2}[+\-](?![\d\-])/,         o: "carga em algarismo comum (use Ca²⁺, não Ca2+)", precisaElemento: false },
  { re: /\b([A-Z][a-z]?)[+\-]\d{1,2}(?![\d])/,   o: "sinal antes do número da carga (use Ca²⁺, não Ca+2)", precisaElemento: true },
  { re: /(\)|\])[+\-]\d{1,2}(?![\d])/,           o: "sinal antes do número da carga (use Ca²⁺, não Ca+2)", precisaElemento: false },
  { re: /([₀-₉])[+\-]\d{1,2}(?![\d])/,           o: "sinal antes do número da carga (use Ca²⁺, não Ca+2)", precisaElemento: false },
  // Só vale para CARGA (o sinal vem depois de uma espécie química). Expoente
  // matemático — 1,5 × 10⁻³ — tem o sinal antes do número e está certo assim.
  { re: /([A-Za-z\)\]₀-₉])[⁺⁻][⁰¹²³⁴⁵⁶⁷⁸⁹]/,     o: "sinal antes do número da carga (use ²⁺, não ⁺²)", precisaElemento: false },
];
// 4) Seta montada com caracteres separados — proibida sem exceção. Só acusa
//    quando a sequência está funcionando COMO seta numa expressão química, isto
//    é, com espécie química de um dos lados.
const QUI_ESPECIE = "[A-Za-z0-9₀-₉⁰-⁹⁺⁻()\\[\\]·]";
const QUI_SETA_FALSA = new RegExp(
  QUI_ESPECIE + "\\s*(?:<=+>|<-+>|-+>|=+>|<-+|<=+)\\s*" + QUI_ESPECIE);
// 5) ↔ é ressonância, não equilíbrio: entre espécies com estado físico, o certo é ⇌.
const QUI_RESSONANCIA_ERRADA = /\([slgaq]{1,2}\)\s*↔|↔\s*\d*\s*[A-Z][a-z]?[₀-₉]*\(/;
// 6) Caractere solto: índice ou expoente separado da fórmula por espaço.
const QUI_SOLTO = new RegExp("[A-Za-z\\)\\]]\\s+[" + QUI_INF + QUI_SUP + "]");

// Normaliza a fórmula para comparar grafias: índices e expoentes viram
// algarismo comum, para que "H₂SO₄" e "H2SO4" colidam e a inconsistência apareça.
function quiNormaliza(t){
  let s = String(t);
  for(let i = 0; i < 10; i++){
    s = s.split(QUI_INF[i]).join(String(i)).split(QUI_SUP[i]).join(String(i));
  }
  return s.split("⁺").join("+").split("⁻").join("-");
}

function quiEhFormula(tok){
  // Precisa ter cara de substância: pelo menos um símbolo de elemento e um
  // dígito colado. Descarta "2025", "Caderno 7" e afins.
  if(!/[A-Z]/.test(tok) || !/\d/.test(tok)) return false;
  if(/^[A-Z]\d{4,}$/.test(tok)) return false;              // código, não fórmula
  // Só conta como fórmula mutilada se houver pelo menos um grupo ELEMENTO+DÍGITO
  // em que (a) o dígito vale 2 ou mais — um índice químico de valor 1 nunca é
  // escrito (é "H", nunca "H1") — e (b) a letra é de fato um símbolo oficial de
  // elemento (QUI_ELEMENTOS). Sem essas duas condições juntas, "E0", "V1", "T2",
  // "A3" e outros rótulos/variáveis comuns de Matemática e Física seriam
  // confundidos com fórmula química mutilada e bloqueariam a exportação de um
  // simulado sem erro nenhum.
  const grupos = tok.match(/[A-Z][a-z]?\d+/g) || [];
  return grupos.some(g => {
    const letra = g.match(/^[A-Z][a-z]?/)[0];
    const digito = Number(g.match(/\d+/)[0]);
    return digito >= 2 && QUI_ELEMENTOS.has(letra);
  });
}

function quiCamposDaQuestao(q, idx){
  const d = (q && q.data) || {};
  const campos = [];
  const add = (rotulo, valor) => { if(valor) campos.push({ rotulo, texto: String(valor) }); };
  add("texto-base", d.textoBase);
  add("referência", d.fonte);
  add("comando", d.comando);
  if(d.visual){
    add("título do recurso visual", d.visual.titulo);
    add("descrição do recurso visual", d.visual.descricao);
    (d.visual.colunas || []).forEach((c, i) => add("cabeçalho da tabela (coluna " + (i + 1) + ")", c));
    (d.visual.linhas || []).forEach(l => (l || []).forEach(c => add("célula da tabela", c)));
    add("prompt da imagem", d.visual.prompt);
  }
  ["A","B","C","D","E"].forEach(L => add("alternativa " + L, d.alternativas && d.alternativas[L]));
  add("objeto de conhecimento", d.objetoConhecimento);
  add("resolução comentada", d.resolucaoComentada);
  const an = d.analiseAlternativas || {};
  ["A","B","C","D","E"].forEach(L => add("comentário da alternativa " + L, an[L] && an[L].comentario));
  return campos.map(c => Object.assign(c, { questao: idx + 1 }));
}

function auditaQuimica(questoes){
  const lista = questoes || state.questions;
  const problemas = [];
  const grafias = new Map();                 // fórmula normalizada → grafias vistas
  const registra = (c, o) => problemas.push({
    questao: c.questao, campo: c.rotulo, ocorrencia: o,
  });

  lista.forEach((q, idx) => {
    if(!q || !q.data) return;
    quiCamposDaQuestao(q, idx).forEach(campo => {
      const t = campo.texto;

      QUI_CODIGOS.forEach(r => { if(r.re.test(t)) registra(campo, r.o); });
      QUI_CARGA_ERRADA.forEach(r => {
        const m = t.match(r.re);
        if(!m) return;
        if(r.precisaElemento && !QUI_ELEMENTOS.has(m[1])) return;
        registra(campo, r.o);
      });
      if(QUI_SETA_FALSA.test(t)){
        registra(campo, "seta montada com caracteres separados (use → ← ⇌ ↔ ↑ ↓)");
      }
      if(QUI_RESSONANCIA_ERRADA.test(t)){
        registra(campo, "↔ usado como equilíbrio químico (o símbolo de equilíbrio é ⇌)");
      }
      if(QUI_SOLTO.test(t)) registra(campo, "índice ou carga separado da fórmula");

      const achados = t.match(QUI_INDICE_ASCII) || [];
      achados.filter(quiEhFormula).forEach(f => {
        registra(campo, "fórmula com índice em algarismo comum: " + f);
      });

      // Consistência (§12): a mesma substância em duas grafias na mesma prova.
      const corretas = t.match(new RegExp("[A-Z][A-Za-z()\\[\\]·" + QUI_INF + QUI_SUP + "]*[" + QUI_INF + QUI_SUP + "][A-Za-z()\\[\\]·" + QUI_INF + QUI_SUP + "]*", "g")) || [];
      corretas.concat(achados.filter(quiEhFormula)).forEach(f => {
        const chave = quiNormaliza(f);
        if(!grafias.has(chave)) grafias.set(chave, new Set());
        grafias.get(chave).add(f);
      });
    });
  });

  grafias.forEach((formas, chave) => {
    if(formas.size > 1){
      problemas.push({ questao: null, campo: "consistência",
        ocorrencia: "a mesma substância aparece como " + Array.from(formas).join(" e ") });
    }
  });

  // Caracteres que o PDF não conseguiria imprimir com a fonte embarcada.
  if(typeof CARLITO_COBERTURA === "string"){
    const cobertura = new Set(Array.from(CARLITO_COBERTURA).concat(["\n","\t","\r"]));
    lista.forEach((q, idx) => {
      if(!q || !q.data) return;
      quiCamposDaQuestao(q, idx).forEach(campo => {
        const fora = Array.from(new Set(Array.from(campo.texto).filter(ch => !cobertura.has(ch))));
        if(fora.length) problemas.push({ questao: campo.questao, campo: campo.rotulo,
          ocorrencia: "caractere sem glifo na fonte do PDF: " + fora.join(" ") });
      });
    });
  }
  return problemas;
}

// Mensagem única, no formato que a regra manda (§17).
function avisoQuimica(problemas){
  if(!problemas.length) return "";
  const p = problemas[0];
  const onde = p.questao ? ("questão " + p.questao + ", " + p.campo) : p.campo;
  const resto = problemas.length > 1 ? (" (+" + (problemas.length - 1) + " ocorrência" + (problemas.length > 2 ? "s" : "") + ")") : "";
  return "REVISÃO QUÍMICA NECESSÁRIA: " + onde + " — " + p.ocorrencia + "." + resto;
}

// Porta de saída: nenhum PDF, DOCX, HTML ou impressão sai com fórmula quebrada.
function bloqueiaSeQuimicaInvalida(doneQuestions){
  const problemas = auditaQuimica(doneQuestions.map(o => o.q));
  if(!problemas.length) return false;
  toast(avisoQuimica(problemas) + " Corrija a questão e exporte de novo.", "err");
  try{ console.warn("[química] problemas encontrados:", problemas); }catch(e){}
  return true;
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
  actions.appendChild(iconBtn("🔄", "Regenerar", () => regenerarQuestaoEArquivar(q)));
  actions.appendChild(iconBtn("✏️", "Editar", () => toggleEdit(el, q, idx)));
  if(q.data){
    actions.appendChild(iconBtn("⬇️", "Mais fácil", () => { q.dificuldade = "Fácil"; regenerarQuestaoEArquivar(q); }));
    actions.appendChild(iconBtn("⬆️", "Mais difícil", () => { q.dificuldade = "Difícil"; regenerarQuestaoEArquivar(q); }));
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
    // "Refazer" (qualquer recurso, inclusive imagem) sempre volta a passar pelo
    // Claude com o texto-base/comando/alternativas/gabarito/resolução reais da
    // questão (regenerarVisual no backend) — nunca reenvia direto ao gerador de
    // imagem só o prompt antigo, que poderia estar descrevendo a cena errada.
    redoVisual(q, body, title, redoBtn);
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
    renderGeneratedImage(holder, promptText, visual.descricao || "", visual);
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

// Desenha a imagem de um recurso visual. Se `visual.imagemDataUrl` já existir
// (imagem já gerada antes e guardada no próprio objeto — inclusive dentro de
// um simulado arquivado em "Meus Simulados"), mostra ela direto, sem pedir
// uma imagem nova ao backend: abrir um simulado salvo (ou só re-renderizar a
// tela, por exemplo ao aprovar/mover outra questão) NUNCA deve gerar imagens
// novas nem trocar as que já existem. Só quando não há imagem guardada é que
// uma é pedida ao backend — e, assim que chega, fica salva em `visual`, para
// a próxima renderização (e o próximo arquivamento) reaproveitarem a mesma.
function renderGeneratedImage(holder, promptText, descricao, visual){
  if(visual && visual.imagemDataUrl){
    holder.innerHTML = "";
    const img = document.createElement("img");
    img.src = visual.imagemDataUrl;
    img.alt = descricao || "";
    holder.appendChild(img);
    if(descricao){
      const cap = document.createElement("p");
      cap.style.cssText = "font-size:12px;color:var(--ink-2);margin:10px 0 0;";
      cap.textContent = descricao;
      holder.appendChild(cap);
    }
    return;
  }
  holder.innerHTML = `
    <div class="visual-image-loading" style="text-align:center;padding:28px 12px;">
      <div class="spinner" style="margin:0 auto;"></div>
      <div class="hint" style="margin-top:10px;">Gerando imagem... cerca de 15 s.</div>
    </div>
  `;
  const promessa = generateImageViaBackend(promptText).then(({ dataUrl, uso }) => {
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
    // Guarda a imagem pronta no próprio recurso visual da questão, para nunca
    // mais precisar gerar de novo esta mesma figura.
    if(visual) visual.imagemDataUrl = dataUrl;
    /* Sem seletor de qualidade e sem custo exibido na tela — a geração é
       sempre "low", sem opção de troca. O uso continua contabilizado em
       state.usoImagem (ver somaUsoImagem) para consulta quando pedida. */
  }).catch(err => {
    holder.innerHTML = `
      <div style="text-align:center;padding:18px 12px;">
        <p class="hint" style="color:#f87171;">⚠️ Não foi possível gerar a imagem: ${escapeHtml(err.message || String(err))}</p>
        <button class="btn sm ghost no-print retry-img-btn">🔄 Tentar novamente</button>
      </div>
    `;
    holder.querySelector(".retry-img-btn").addEventListener("click", () => renderGeneratedImage(holder, promptText, descricao, visual));
  });
  imagePromisesEmAndamento.push(promessa);
}

// Botão "Refazer" para imagem/gráfico/tabela: pede ao backend (que por sua vez chama o Claude)
// para gerar SÓ um novo recurso visual, mantendo o texto-base, comando, alternativas,
// gabarito e resolução comentada da questão exatamente como estão — guiado pelas
// instruções opcionais atuais, se houver.
async function redoVisual(q, body, titleEl, redoBtn){
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
      headers: { "Content-Type": "application/json", ...authHeaders() },
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
    // Se for imagem, renderVisualContent acabou de pedir a imagem nova ao
    // backend (payload.visual ainda não tem imagemDataUrl). Espera ela ficar
    // pronta e, se este simulado já estiver arquivado, atualiza o arquivo —
    // senão o "Refazer" se perderia na próxima vez que o simulado reabrisse.
    await aguardaImagensPendentes();
    if(simuladoAbertoId) await salvarSimuladoAtual();
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

/* "Exportar HTML" entrega o documento na anatomia do caderno ENEM 2025 — não
   mais um retrato da tela do app. Mesma grade do PDF, expressa em CSS. */
async function exportHtmlSnapshot(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de exportar.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de exportar.", "err");
    return;
  }
  try{
    const professor = state.viewMode !== "aluno";
    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
    const html = enemBuildPrintHTML(doneQuestions, professor);
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const rotulo = professor ? "professor" : "aluno";
    const safeName = "Simulado_ENEM_" + (state.disciplina || "questoes").replace(/[^a-zA-Z0-9]+/g, "_") + "_" + rotulo + ".html";
    a.href = url;
    a.download = safeName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("Arquivo HTML exportado no padrão do caderno ENEM.", "ok");
  }catch(err){
    toast("Não foi possível exportar o arquivo: " + err.message, "err");
  }
}

/* "Imprimir" manda para a impressora o MESMO documento do botão PDF. */
async function printExam(){
  if(!state.questions.length || !state.questions.some(q => q.status === "done")){
    toast("Gere ao menos uma questão antes de imprimir.", "err");
    return;
  }
  if(document.getElementById("resultsPanel").querySelector(".visual-image-loading")){
    toast("Aguarde a geração das imagens terminar antes de imprimir.", "err");
    return;
  }
  if(!window.jspdf){
    try{
      await loadScriptOnce(CDN_URLS.jspdf);
    }catch(e){
      toast("Não foi possível carregar a biblioteca de impressão (verifique sua conexão) e tente novamente.", "err");
      return;
    }
  }
  const btn = document.getElementById("btnPrint");
  const label = btn ? btn.textContent : "";
  if(btn){ btn.disabled = true; btn.textContent = "Preparando..."; }
  try{
    const professor = state.viewMode !== "aluno";
    const doneQuestions = state.questions.map((q, idx) => ({ q, idx })).filter(o => o.q.status === "done");
    if(!doneQuestions.length) throw new Error("Nenhuma questão para imprimir.");
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
    const abriu = enemPrintPdf(doneQuestions, professor);
    toast(abriu ? "Documento aberto para impressão no padrão do caderno ENEM."
                : "Seu navegador bloqueou a janela; o arquivo foi baixado — abra-o e imprima.", abriu ? "ok" : "err");
  }catch(err){
    toast("Não foi possível preparar a impressão: " + err.message, "err");
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = label; }
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

/* ---- NOTAÇÃO QUÍMICA NO PDF ----

   Com a Carlito embarcada (fonts.js), o PDF imprime a fórmula como ela é:
   H₂SO₄, SO₄²⁻, 2 H₂(g) + O₂(g) → 2 H₂O(l). Nada de "H2SO4", "^2", "_2" ou
   LaTeX: converter índice em "^2" mutila a fórmula e o estudante passa a ler um
   comando, não uma substância.

   Até a v28 esta função fazia exatamente isso — trocava ² por "^2", ₂ por "_2",
   µ por "u", → não existia. Era a única saída possível enquanto o PDF usava a
   Helvetica WinAnsi, que não tem esses glifos. Com a fonte embarcada o mapa
   deixou de ser necessário e passou a ser proibido.

   Sobra um caso: um caractere fora do subconjunto embarcado sairia EM BRANCO,
   e uma página em branco mente. Esses caracteres viram "□" e ficam registrados
   para o auditor apontar antes da entrega.                                   */

const PDF_SYMBOL_MAP = {
  // Mapa de emergência: só entra em ação se a Carlito não puder ser embarcada
  // (falha ao registrar a fonte). Aí o PDF cai na Helvetica WinAnsi, e é
  // preferível "m/s^2" a "m/s".
  "⁰": "^0", "¹": "^1", "²": "^2", "³": "^3", "⁴": "^4", "⁵": "^5",
  "⁶": "^6", "⁷": "^7", "⁸": "^8", "⁹": "^9", "⁺": "^+", "⁻": "^-",
  "₀": "_0", "₁": "_1", "₂": "_2", "₃": "_3", "₄": "_4", "₅": "_5",
  "₆": "_6", "₇": "_7", "₈": "_8", "₉": "_9",
  "µ": "u", "μ": "u", "≈": "~", "≠": " diferente de ", "≤": "<=", "≥": ">=",
  "√": "raiz de ", "∞": "infinito",
  // Setas e ligações NÃO entram aqui: montar "→" com hífen e sinal de maior é
  // proibido pela regra de notação. Se a fonte falhar, o auditor barra a
  // exportação — não se entrega uma seta improvisada ao estudante.
  "Σ": "somatório de ", "∫": "integral de ",
  "π": "pi", "Δ": "Delta", "δ": "delta", "Ω": "Ohm", "ω": "ômega",
  "α": "alfa", "β": "beta", "θ": "teta", "λ": "lambda", "φ": "fi",
  "′": "'", "″": '"',
};
const PDF_SYMBOL_REGEX = new RegExp(Object.keys(PDF_SYMBOL_MAP).join("|"), "g");

let enemFonteEmbarcada = false;                 // ligado por enemRegistraFontes
const PDF_FORA_DO_SUBCONJUNTO = new Set();
let CARLITO_SET = null;

function pdfSanitizeText(text){
  if(text == null) return text;
  const s = quiJuntaFormula(String(text));
  if(!enemFonteEmbarcada){
    // Caminho degradado: sem a fonte embarcada, aproxima em ASCII.
    return s.replace(PDF_SYMBOL_REGEX, ch => PDF_SYMBOL_MAP[ch]);
  }
  if(!CARLITO_SET) CARLITO_SET = new Set(Array.from(CARLITO_COBERTURA));
  let out = "";
  for(const ch of s){
    if(ch === "\u2060") continue;                 // juntador: invisível, só serve ao Word e ao HTML
    if(ch === "\n" || ch === "\t" || ch === "\r" || CARLITO_SET.has(ch)) out += ch;
    else { PDF_FORA_DO_SUBCONJUNTO.add(ch); out += "\u25A1"; }
  }
  return out;
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

  // A Carlito vai EMBARCADA (ver fonts.js): métrica idêntica à Calibri e o
  // alfabeto completo que a notação química exige — índices inferiores, cargas
  // superiores, setas de reação, letras gregas. Não há mais substituição de
  // fonte, então o corpo é 10 pt de verdade e o fator de correção é 1.
  fonte: "Carlito",
  helvK: 1.0,
};

// Margem esquerda da mancha na página n (1 = primeira página de questões).
function enemLeft(pageNo){ return (pageNo % 2 === 1) ? ENEM.margOdd : ENEM.margEven; }
// Lado externo da página: ímpar → direita, par → esquerda.
function enemOuterIsRight(pageNo){ return pageNo % 2 === 1; }

// Define fonte e corpo já compensados para a substituição Helvetica → Calibri.
// Registra as quatro faces da Carlito no documento. Roda uma vez por PDF; se
// algo falhar, o texto ainda sai — em Helvetica, sem os glifos de química —, e
// o auditor avisa em vez de a página mentir.
function enemRegistraFontes(doc){
  try{
    CARLITO_FACES.forEach(f => {
      doc.addFileToVFS(f.arquivo, f.dados);
      doc.addFont(f.arquivo, ENEM.fonte, f.estilo);
    });
    enemFonteEmbarcada = !!doc.getFontList()[ENEM.fonte];
    return enemFonteEmbarcada;
  }catch(e){
    enemFonteEmbarcada = false;
    return false;
  }
}

function enemFont(doc, weight, size){
  doc.setFont(doc.__carlito ? ENEM.fonte : "helvetica", weight || "normal");
  doc.setFontSize(size * (doc.__carlito ? 1 : ENEM.helvK));
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

// Parágrafo de corpo: 10 pt, entrelinha 12,0 pt, justificado, primeira linha
// recuada em 6 mm, sem linha em branco entre parágrafos.
function enemParagraph(doc, ctx, flow, text, opts){
  const o = opts || {};
  const size = o.size || ENEM.body;
  const lead = o.leading || ENEM.leading;
  const indent = o.indent != null ? o.indent : ENEM.indent;
  const clean = pdfSanitizeText(String(text || "").trim());
  if(!clean) return;

  clean.split(/\n+/).forEach(par => {
    const t = par.trim();
    if(!t) return;
    // O corpo do caderno é 97,7 % regular, mas o negrito existe — e os marcadores
    // **assim** do gerador NÃO podem vazar impressos na página.
    const runs = enemRichRuns(t).map(r => ({ text: r.text, bold: r.bold || !!o.bold }));
    const lines = enemWrapRuns(doc, runs, flow.w, size, false, indent);
    lines.forEach((parts, i) => {
      const off = i === 0 ? indent : 0;            // recuo só na primeira linha
      enemEnsure(doc, ctx, flow, lead);
      enemDrawRichLine(doc, parts, flow.x + off, flow.y + size, flow.w - off,
                       size, "justify", i === lines.length - 1, false);
      flow.y += lead;
    });
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

/* Alternativa A–E: letra circulada encostada na margem da coluna, texto
   pendurado a 4,5 mm, entrelinha 13,4 pt, JUSTIFICADO nas duas margens.

   Determinação do professor: todo texto do simulado sai justificado — o
   texto-base, o comando, as alternativas, o gabarito e os comentários de cada
   alternativa —, no PDF, no Word e no HTML. Esta função desenha tanto as
   alternativas da prova quanto os comentários da versão do professor, então a
   regra vale nos dois lugares. A última linha de cada alternativa nunca é
   esticada (enemDrawRichLine trata isso), e alternativa de uma linha só — o
   caso comum em Matemática, Física e Química — fica visualmente igual ao que
   era antes, porque linha única é sempre última linha.                       */
function enemAlternative(doc, ctx, flow, letter, text){
  const width = flow.w - ENEM.hang;
  const clean = pdfSanitizeText(String(text || "").trim()) || "—";
  const lines = enemWrapRuns(doc, enemRichRuns(clean), width, ENEM.body, false);
  lines.forEach((parts, i) => {
    enemEnsure(doc, ctx, flow, ENEM.altLeading);
    const base = flow.y + ENEM.body;
    if(i === 0) enemOptionMark(doc, flow.x, base, letter);
    // Justificadas, com o texto pendurado a 4,5 mm da letra circulada.
    enemDrawRichLine(doc, parts, flow.x + ENEM.hang, base, width, ENEM.body,
                     "justify", i === lines.length - 1, false);
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
function enemWrapRuns(doc, runs, width, size, italic, firstIndent){
  const fi = firstIndent || 0;                     // recuo só da 1ª linha
  const lines = [];
  let line = [], lineW = 0;
  const limite = () => (lines.length === 0 ? width - fi : width);
  runs.forEach(run => {
    enemFont(doc, enemStyle(run.bold, !!italic), size);
    run.text.split(/([ \t\n]+)/).forEach(tok => {
      if(!tok) return;
      const w = doc.getTextWidth(tok);
      if(/^[ \t\n]+$/.test(tok)){
        if(line.length){ line.push({ text: tok, bold: run.bold, w: w }); lineW += w; }
        return;
      }
      if(lineW + w > limite() && line.length){
        while(line.length && /^[ \t\n]+$/.test(line[line.length - 1].text)) { lineW -= line.pop().w; }
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
    const gaps = parts.filter(p => /^[ \t\n]+$/.test(p.text)).length;
    if(gaps > 0) extra = (width - total) / gaps;
  }
  parts.forEach(p => {
    const isGap = /^[ \t\n]+$/.test(p.text);   // o espaço inseparável NÃO é vão de justificação
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
function enemBuildPdfDoc(doneQuestions, professor){
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: [ENEM.pageW, ENEM.pageH], orientation: "portrait" });
  doc.__carlito = enemRegistraFontes(doc);
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
  return { doc: doc, safeName: safeName };
}

// Baixar o PDF. Construção e entrega ficam separadas para que a IMPRESSÃO possa
// usar exatamente o mesmo documento, sem uma segunda diagramação para manter
// em sincronia.
function enemExportPdf(doneQuestions, professor){
  const built = enemBuildPdfDoc(doneQuestions, professor);
  built.doc.save(built.safeName);
}


/* ---- IMPRESSÃO E EXPORTAÇÃO HTML na anatomia do caderno ENEM 2025 ----

   Duas saídas, uma só especificação:

   • "Imprimir" monta EXATAMENTE o mesmo documento do botão PDF (as mesmas
     funções enem*), chama doc.autoPrint() e abre o blob numa aba. A folha que
     sai da impressora não pode divergir do PDF nem por um décimo de milímetro,
     porque é o mesmo arquivo — inclusive fólio, margens espelhadas e cromo de
     página. Antes este botão chamava window.print() sobre a tela do app, e o
     que ia para a impressora eram os cartões da interface.

   • "Exportar HTML" gera um documento web autocontido que reproduz a mesma
     grade em CSS: 200 × 275 mm, duas colunas de 89,47 mm com fio sólido na
     calha, Calibri 10/12,0 pt, tinta #231F20, barra-ornamento, letras
     circuladas e os dois tratamentos de referência do §2.1. O cabeçalho e o
     rodapé se repetem em cada folha por <thead>/<tfoot> — em CSS de impressão
     o navegador só repete cromo de página desse jeito; `position: fixed` com
     deslocamento negativo é levado para o fim da página no Chrome.           */

function enemPrintEsc(s){
  return quiJuntaFormula(String(s == null ? "" : s))
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// **negrito** vira <strong>; todo o resto é escapado.
function enemPrintRich(text){
  return enemRichRuns(quiJuntaFormula(String(text == null ? "" : text)))
    .map(r => r.bold ? "<strong>" + enemPrintEsc(r.text) + "</strong>" : enemPrintEsc(r.text))
    .join("");
}

const ENEM_PRINT_CSS = `
/* Formato próprio do INEP — 200 × 275 mm, menor que A4. Margens ESPELHADAS:
   a mancha desliza 2,5 mm conforme a paridade da página, deixando a margem
   externa maior que a interna (§1). O cabeçalho e o rodapé ficam DENTRO do
   fluxo, no <thead>/<tfoot>, por isso a margem do @page é a do papel. */
@page { size: 200mm 275mm; margin: 8mm 9.67mm 6mm 8mm; }
@page :right { margin: 8mm 9.67mm 6mm 8mm; }
@page :left  { margin: 8mm 8mm 6mm 10.5mm; }

*{ box-sizing: border-box; }
html,body{ margin:0; padding:0; }
body{
  font-family: Calibri, Carlito, "Segoe UI", system-ui, sans-serif;
  font-size: 10pt;
  line-height: 12pt;              /* entrelinha do corpo: 12,0 pt (1,20x) */
  color: #231F20;                 /* preto quente de impressão, NÃO #000000 */
  background: #fff;
  letter-spacing: 0;              /* tracking nativo: medido em 0,0000 pt */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* A tabela é só o veículo do cromo repetido: <thead> reserva a faixa do
   cabeçalho (28 − 8 = 20 mm) e <tfoot> a do rodapé (269 − 260 = 9 mm). */
table.pg{ width:100%; border-collapse:collapse; }
table.pg > thead td{ height:20mm; padding:0; vertical-align:top; position:relative; }
table.pg > tfoot td{ height:9mm;  padding:0; vertical-align:bottom; }
table.pg > tbody td{ padding:0; vertical-align:top; }

.marca{ font-size:16pt; font-weight:700; color:#004B8D; line-height:1; }
.marca .ano{ color:#939598; font-weight:400; }
.marca-sub{ font-size:5.5pt; color:#939598; margin-top:0.8mm; }
.cab{ display:flex; align-items:flex-start; gap:4mm; padding-top:2.3mm; }
.quadros{ display:flex; gap:0.4mm; margin-top:0.4mm; }
.quadros i{ width:5.5mm; height:6.6mm; background:#939598; transform:skewX(-20deg); display:block; }
.barra-cinza{ width:48.93mm; height:2.38mm; background:#939598; margin-top:1.6mm; }

/* Filete misto: um trecho azul de 49,16 mm do lado interno e um de microtexto
   de 131,54 mm do lado externo — no rodapé a composição se inverte (§4). */
.filete{ height:1.06mm; display:flex; align-items:flex-start; margin-top:1.5mm; }
.filete .azul{ flex:0 0 49.16mm; height:1.06mm; background:#B9E5FA; }
.filete .micro{
  flex:0 0 131.54mm; min-width:0; overflow:hidden; white-space:nowrap;
  font:700 1.5pt/1 Arial, sans-serif; color:#231F20;
}
.rodape{ display:flex; align-items:baseline; font-size:9pt; color:#58595B; margin-top:1.1mm; }

/* Tarja da versão: 11 × 30 mm sangrando na borda externa, com o quadrado de
   registro de 3 × 3 mm na quina interna. Vive no <thead>, e por isso se repete. */
.tarja{ position:absolute; top:-8mm; right:-9.67mm; width:11mm; height:30mm; background:#B9E5FA; }
.tarja i{ position:absolute; left:-1.5mm; top:31.5mm; width:3mm; height:3mm; background:#231F20; }

/* Miolo: duas colunas de 89,47 mm, calha de 3,40 mm com fio vertical SÓLIDO de
   0,5 pt. Em 2025 não existe mais traço pontilhado no caderno. */
.miolo{ column-count:2; column-gap:3.40mm; column-rule:0.5pt solid #231F20; column-fill:auto; }
.miolo.unica{ column-count:1; column-rule:none; }
.quebra{ break-before:page; }

/* Título de área — 11 pt bold caixa alta, recuado 2 mm, sem barra-ornamento. */
.area{ font-size:11pt; font-weight:700; text-transform:uppercase; margin:0 0 3.2mm 2mm; }

/* Rótulo QUESTÃO N + barra-ornamento: começa sempre a 24,47 mm da borda da
   coluna, termina 0,30 mm antes da direita, altura 1,06 mm, filete escuro de
   1 pt no topo, 79,5 % em #B9E5FA e 20,5 % em #231F20 (§5.2). */
.rotulo{ display:flex; align-items:center; margin:0 0 0.76mm; break-after:avoid; }
.rotulo .txt{ width:24.47mm; flex:0 0 24.47mm; font-size:11pt; font-weight:700;
              text-transform:uppercase; white-space:nowrap; }
.rotulo .barra{
  flex:1; height:1.06mm; margin-right:0.30mm; border-top:1pt solid #231F20;
  background:linear-gradient(to right,#B9E5FA 0 79.5%,#231F20 79.5% 100%);
}

/* Corpo: justificado, primeira linha recuada em 6 mm, sem espaço entre
   parágrafos. Comando: justificado e SEM recuo. */
.corpo{ margin:0; text-align:justify; text-indent:6mm; }
.comando{ margin:0; text-align:justify; text-indent:0; }

/* §2.1 — as duas referências, que nunca se misturam. Ambas em corpo − 2 pt. */
.ref{ font-size:8pt; line-height:9.6pt; margin:0.5mm 0 1.5mm; }
.ref-texto{ text-align:right; font-style:italic; }
.ref-visual{ text-align:justify; }

/* Alternativas: letra circulada na margem, texto pendurado a 4,5 mm,
   entrelinha 13,4 pt, justificadas — como no PDF e no Word. */
.alts{ margin:1.51mm 0 0; }
.alt{ margin:0; padding-left:4.5mm; text-indent:-4.5mm; line-height:13.4pt; text-align:justify; }
.alt .letra{ font-family:"Segoe UI Symbol","Apple Symbols",Calibri,sans-serif; margin-right:1.6mm; }

/* Filete sólido de fechamento, 0,5 pt, largura cheia da coluna. No caderno
   oficial ele aparece SÓ no fim da sequência — entre questões consecutivas
   quem separa é a barra-ornamento da questão seguinte (§5.9). */
.fecho{ margin:2.53mm 0 0; }
.miolo > .questao:last-child .fecho,
.miolo > .fecho{ border-bottom:0.5pt solid #231F20; }
.questao{ margin-bottom:2.53mm; }

/* Subtítulo interno — bold 10 pt caixa alta, 1,5 mm de respiro acima (§7.4). */
.sub{ font-size:10pt; font-weight:700; text-transform:uppercase; margin:1.5mm 0 0; break-after:avoid; }
.ficha{ margin:0; text-align:justify; }

figure{ margin:1.6mm 0 2.11mm; break-inside:avoid; }
figure img{ display:block; max-width:100%; height:auto; margin:0 auto; }

/* Tabela: moldura externa 1 pt, divisórias 0,5 pt, cabeçalho em #6DCFF6 com
   texto bold 10 pt centralizado (§6). */
table.dados{ width:100%; border-collapse:collapse; margin:1.6mm 0 2.11mm; break-inside:avoid; }
table.dados th,table.dados td{ border:0.5pt solid #231F20; padding:1mm 1.5mm;
                               text-align:center; font-size:10pt; line-height:12pt; }
table.dados th{ background:#6DCFF6; font-weight:700; border-width:1pt; }

@media screen{
  body{ background:#e9e9ec; padding:10mm 0; }
  table.pg{ width:200mm; margin:0 auto; background:#fff; padding:8mm 9.67mm 6mm 8mm;
            box-shadow:0 2px 18px rgba(0,0,0,.18); }
  .aviso{ width:200mm; margin:0 auto 8mm; font:400 13px/1.55 system-ui,sans-serif;
          color:#333; background:#fff; border-left:3px solid #004B8D; padding:12px 16px 12px 14px; }
}
@media print{
  .aviso{ display:none; }
  /* Nota: na ÚLTIMA folha, se o conteúdo termina no meio da página, o rodapé
     sobe junto com ele — é limitação do <tfoot> repetido, o único mecanismo de
     cromo de página que o Chrome honra na impressão. A folha idêntica ao PDF,
     com rodapé fixo na base e fólio, sai pelo botão Imprimir. */
}
`;

function enemPrintChromeTop(ctx){
  return '<thead><tr><td>' +
    '<div class="tarja"><i></i></div>' +
    '<div class="cab"><div>' +
    '<div class="marca">simulado<span class="ano">' + enemPrintEsc(ctx.ano) + '</span></div>' +
    '<div class="marca-sub">Simulado no padrão do caderno ENEM</div></div>' +
    '<div class="quadros"><i></i><i></i><i></i><i></i></div></div>' +
    '<div class="barra-cinza"></div>' +
    '<div class="filete"><span class="azul"></span>' +
    '<span class="micro">' + "SIMULADO".repeat(150) + '</span></div>' +
    '</td></tr></thead>';
}

function enemPrintChromeBot(ctx){
  return '<tfoot><tr><td>' +
    '<div class="filete"><span class="micro">' + "SIMULADO".repeat(150) + '</span>' +
    '<span class="azul"></span></div>' +
    '<div class="rodape"><span>' + enemPrintEsc(ctx.footerText) + '</span></div>' +
    '</td></tr></tfoot>';
}

function enemPrintRotulo(texto){
  return '<div class="rotulo"><span class="txt">' + enemPrintEsc(texto) +
         '</span><span class="barra"></span></div>';
}

// Texto-base: parágrafos de corpo e, no fim, a referência do TEXTO INTRODUTÓRIO
// — itálico, à direita (§2.1). Mesma regra e mesma detecção do PDF.
function enemPrintTextoBase(out, text, fonte){
  const pars = String(text || "").trim().split(/\n+/).filter(p => p.trim());
  let ref = String(fonte || "").trim();
  if(!ref && pars.length > 1 && enemIsReference(pars[pars.length - 1])) ref = pars.pop();
  pars.forEach(p => out.push('<p class="corpo">' + enemPrintRich(p) + '</p>'));
  if(ref) out.push('<p class="ref ref-texto">' + enemPrintRich(ref) + '</p>');
}

// Recurso visual. A referência de imagem, tabela e gráfico é redonda e
// JUSTIFICADA (§2.1) — nunca em itálico, nunca à direita.
function enemPrintVisual(out, visual, cardIdx){
  if(!visual || !visual.tipo) return;
  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return;
    out.push('<table class="dados"><thead><tr>' +
      cols.map(c => '<th>' + enemPrintEsc(c) + '</th>').join("") + '</tr></thead><tbody>' +
      rows.map(r => '<tr>' + r.map(c => '<td>' + enemPrintEsc(c) + '</td>').join("") + '</tr>').join("") +
      '</tbody></table>');
    if(visual.titulo) out.push('<p class="ref ref-visual">' + enemPrintRich(visual.titulo) + '</p>');
    return;
  }
  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx) : pdfGetVisualChartInfo(cardIdx);
  if(!info || !info.dataUrl) return;
  out.push('<figure><img src="' + info.dataUrl + '" alt=""></figure>');
  if(visual.descricao) out.push('<p class="ref ref-visual">' + enemPrintRich(visual.descricao) + '</p>');
}

// Caderno de questões — IDÊNTICO nas duas versões. Nada de gabarito, resolução
// ou comentário aparece aqui (§7.1).
function enemPrintQuestao(o){
  const d = o.q.data || {};
  const out = ['<section class="questao">'];
  out.push(enemPrintRotulo("Questão " + (o.idx + 1)));
  if(d.textoBase) enemPrintTextoBase(out, d.textoBase, d.fonte);
  if(d.visual && d.visual.tipo) enemPrintVisual(out, d.visual, o.idx);
  if(d.comando) out.push('<p class="comando">' + enemPrintRich(d.comando) + '</p>');
  out.push('<div class="alts">');
  ["A","B","C","D","E"].forEach(L => {
    out.push('<p class="alt"><span class="letra">' + (ENEM_DOCX_MARKS[L] || L) +
             '</span>' + enemPrintRich((d.alternativas && d.alternativas[L]) || "") + '</p>');
  });
  out.push('</div><div class="fecho"></div></section>');
  return out.join("\n");
}

// Caderno de respostas — SÓ na versão do professor (§7.3).
function enemPrintResposta(o){
  const d = o.q.data || {};
  const out = ['<section class="questao">'];
  out.push(enemPrintRotulo("Questão " + (o.idx + 1)));
  const letra = d.gabarito || "—";
  out.push('<p class="alt"><span class="letra">' + (ENEM_DOCX_MARKS[letra] || letra) +
           '</span><strong>GABARITO: ' + enemPrintEsc(letra) + '</strong></p>');
  const resposta = (d.alternativas && d.alternativas[d.gabarito]) || "";
  if(resposta) out.push('<p class="ficha" style="margin-left:4.5mm">' + enemPrintRich(resposta) + '</p>');

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
    out.push('<p class="sub">Ficha pedagógica</p>');
    ficha.forEach(l => out.push('<p class="ficha">' + enemPrintRich(l) + '</p>'));
  }
  if(d.resolucaoComentada){
    out.push('<p class="sub">Resolução comentada</p>');
    out.push('<p class="comando">' + enemPrintRich(d.resolucaoComentada) + '</p>');
  }
  const analise = d.analiseAlternativas || {};
  if(["A","B","C","D","E"].some(L => analise[L] && analise[L].comentario)){
    out.push('<p class="sub">Comentários das alternativas</p>');
    ["A","B","C","D","E"].forEach(L => {
      const info = analise[L];
      if(!info) return;
      const status = info.status === "correta" ? "CORRETA" : "INCORRETA";
      out.push('<p class="alt"><span class="letra">' + (ENEM_DOCX_MARKS[L] || L) +
               '</span>' + status + " — " + enemPrintRich(info.comentario || "") + '</p>');
    });
  }
  out.push('<div class="fecho"></div></section>');
  return out.join("\n");
}

/* Documento HTML completo. Questões em blocos contíguos por modo de coluna:
   uma questão com figura larga põe a página inteira em coluna única (§6), então
   ela abre um bloco .miolo.unica próprio. */
function enemBuildPrintHTML(doneQuestions, professor){
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const ctx = {
    ano: new Date().getFullYear(),
    footerText: [String(areaLabel).toUpperCase(), state.disciplina || "",
                 professor ? "VERSÃO DO PROFESSOR" : "VERSÃO DO ALUNO"].filter(Boolean).join(" | "),
  };

  // Agrupa questões consecutivas que compartilham o mesmo modo de coluna.
  const grupos = [];
  doneQuestions.forEach(o => {
    const wide = enemNeedsWidePage(o);
    const ultimo = grupos[grupos.length - 1];
    if(ultimo && ultimo.wide === wide) ultimo.itens.push(o);
    else grupos.push({ wide: wide, itens: [o] });
  });

  const miolos = grupos.map(g =>
    '<div class="miolo' + (g.wide ? " unica" : "") + '">' +
    g.itens.map(enemPrintQuestao).join("\n") + '</div>').join("\n");

  let fecho;
  if(professor){
    // §7.3 — caderno de respostas completo, em página nova.
    fecho = '<h2 class="area quebra">Gabarito e resoluções</h2>' +
            '<div class="miolo">' + doneQuestions.map(enemPrintResposta).join("\n") + '</div>';
  }else{
    // §7.2 — folha de gabarito: SOMENTE a letra de cada questão.
    const linhas = doneQuestions.map(o => {
      const letra = (o.q.data && o.q.data.gabarito) || "—";
      return '<p class="alt"><strong>' + (o.idx + 1) + '.</strong><span class="letra">' +
             (ENEM_DOCX_MARKS[letra] || letra) + '</span></p>';
    }).join("\n");
    fecho = '<h2 class="area quebra">Gabarito</h2>' +
            '<div class="miolo">' + linhas + '<div class="fecho"></div></div>';
  }

  const titulo = "Simulado ENEM — " + areaLabel + (state.disciplina ? " · " + state.disciplina : "") +
                 " — versão do " + (professor ? "professor" : "aluno");

  return '<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
    '<title>' + enemPrintEsc(titulo) + '</title>\n<style>' + ENEM_PRINT_CSS + '</style>\n</head>\n<body>\n' +
    '<p class="aviso">Documento no padrão do caderno ENEM 2025 — 200 × 275 mm, duas colunas de 89,47 mm. ' +
    'Ao imprimir, escolha o papel <strong>200 × 275 mm</strong> (ou A4 sem "ajustar à página") e mantenha ' +
    'as margens do documento. Para a folha idêntica ao PDF, com fólio e margens espelhadas, use o botão ' +
    '<strong>Imprimir</strong> do aplicativo.</p>\n' +
    '<table class="pg">\n' + enemPrintChromeTop(ctx) + '\n' + enemPrintChromeBot(ctx) + '\n' +
    '<tbody><tr><td>\n<h2 class="area">' + enemPrintEsc(areaLabel) + '</h2>\n' +
    miolos + '\n' + fecho + '\n</td></tr></tbody>\n</table>\n</body>\n</html>';
}

/* Imprimir = o MESMO documento do PDF. Nada de re-renderizar em CSS e torcer
   para bater: montamos o jsPDF idêntico ao do botão PDF, marcamos autoPrint e
   abrimos o blob. O que sai da impressora é, literalmente, o PDF. */
function enemPrintPdf(doneQuestions, professor){
  const built = enemBuildPdfDoc(doneQuestions, professor);
  const doc = built.doc;
  doc.autoPrint();
  const url = doc.output("bloburl");
  const win = window.open(url, "_blank");
  if(!win){
    // Bloqueador de pop-up: baixa o arquivo, que imprime exatamente igual.
    doc.save(built.safeName);
    return false;
  }
  return true;
}

/* ---- Anatomia ENEM 2025 no DOCX — a MESMA página do PDF ----
   O Word não redesenha: ele declara. Mas declara exatamente a mesma geometria
   que o jsPDF desenha — página 200 × 275 mm, mancha de 182,33 mm, duas colunas
   de 89,47 mm com fio separador, corpo Calibri 10 pt com entrelinha exata de
   12,0 pt, tinta #231F20 — e carrega o mesmo cromo de página: marca, quadrados,
   barra cinza, filete misto (azul + microtexto), tarja da versão, rodapé
   corrido e fólio. Cabeçalho e rodapé se espelham pela paridade da página,
   como no caderno oficial.

   Onde as duas saídas ainda divergem, e por quê:
   • margens do CORPO espelhadas — o docx.js 8.5 não expõe o <w:mirrorMargins/>
     do Word; aplicamos a geometria da página ímpar (interna 8,00 / externa
     9,67 mm) a todas. Cabeçalho e rodapé espelham normalmente.
   • os quadrados do cabeçalho saem retos; no original são girados 20°.        */
const TW = 56.6929;                                   // 1 mm em twips
const docxMM = v => Math.round(v * TW);                   // mm → twips
const ENEM_DOCX = {
  pageW: docxMM(200), pageH: docxMM(275),
  margTop: docxMM(28.00), margBottom: docxMM(15.0),   // topo do fluxo das colunas, como no PDF
  margInner: docxMM(8.00), margOuter: docxMM(9.67),
  header: docxMM(10.3), footer: docxMM(6.7),   // filete em 25,00 mm e 263,00 mm
  mancha: docxMM(182.33), colW: docxMM(89.47), gutter: docxMM(3.40),
  indent: docxMM(6), hang: docxMM(4.5),
  line: Math.round(12.0 * 20),                        // entrelinha exata de 12,0 pt
  altLine: Math.round(13.4 * 20),                     // entrelinha das alternativas
  capLine: Math.round(9.6 * 20),                      // entrelinha da referência
  segBlue: docxMM(49.16), segMicro: docxMM(131.54),
  ornStart: docxMM(24.47), ornGap: docxMM(0.30), ornBlueShare: 0.795,
  barraCinza: docxMM(48.93),
  ink: "231F20", footGray: "58595B", ornGray: "939598",
  azul: "B9E5FA", azulTab: "6DCFF6", azulLogo: "004B8D",
  font: "Calibri", fontLight: "Calibri Light",
};

// Espessuras de borda em OITAVOS de ponto — é assim que o Word mede filete.
const DOCX_LINHA = {
  fina: 4,        // 0,5 pt — filete de fechamento e divisórias de tabela
  cheia: 8,       // 1,0 pt — filete de cabeçalho/rodapé e topo do ornamento
  orn: 24,        // 1,06 mm ≈ 3,0 pt — a faixa da barra-ornamento
  barra: 54,      // 2,38 mm ≈ 6,75 pt — a barra cinza do cabeçalho
};

// Parágrafo de altura mínima: só existe para carregar uma borda.
function docxFilamento(borders){
  const { Paragraph, LineRuleType } = window.docx;
  return new Paragraph({
    spacing: { before: 0, after: 0, line: 20, lineRule: LineRuleType.EXACTLY },
    border: borders,
    children: [],
  });
}

function docxCelula(widthTw, children, opts){
  const { TableCell, WidthType, BorderStyle, VerticalAlign } = window.docx;
  const o = opts || {};
  const nada = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  return new TableCell({
    width: { size: widthTw, type: WidthType.DXA },
    borders: o.borders || { top: nada, bottom: nada, left: nada, right: nada },
    shading: o.fill ? { type: window.docx.ShadingType.CLEAR, fill: o.fill, color: "auto" } : undefined,
    verticalAlign: o.valign || VerticalAlign.BOTTOM,
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
    children: children,
  });
}

function docxLinhaTabela(cells, alturaTw){
  const { TableRow, HeightRule } = window.docx;
  return new TableRow({
    height: alturaTw ? { value: alturaTw, rule: HeightRule.EXACT } : undefined,
    children: cells,
  });
}

function docxTabelaLimpa(rows, widths, float){
  const { Table, WidthType, BorderStyle, TableLayoutType } = window.docx;
  const nada = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
  const cols = Array.isArray(widths) ? widths : [widths];
  return new Table({
    width: { size: cols.reduce((a, b) => a + b, 0), type: WidthType.DXA },
    columnWidths: cols,                 // vira <w:tblGrid> — sem isso a largura escorre
    layout: TableLayoutType.FIXED,
    borders: { top: nada, bottom: nada, left: nada, right: nada,
               insideHorizontal: nada, insideVertical: nada },
    float: float,
    rows: rows,
  });
}

/* Filete misto do §4: um trecho azul de 49,16 mm e um de microtexto de
   131,54 mm. No cabeçalho o azul fica do lado INTERNO; no rodapé, do EXTERNO —
   sempre cruzado. `azulPrimeiro` diz de que lado ele entra nesta folha.      */
function docxFilete(azulPrimeiro){
  const { Paragraph, TextRun, BorderStyle, LineRuleType } = window.docx;
  const azul = docxCelula(ENEM_DOCX.segBlue, [ docxFilamento({}) ], { fill: ENEM_DOCX.azul });
  // O "fio pontilhado" do caderno é, na verdade, a palavra repetida em
  // Arial-Bold 1,5 pt. É recurso antifraude, não ornamento.
  const micro = docxCelula(ENEM_DOCX.segMicro, [ new Paragraph({
    spacing: { before: 0, after: 0, line: 40, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: "SIMULADO".repeat(60), font: "Arial", size: 3, bold: true, color: ENEM_DOCX.ink }) ],
  }) ]);
  return docxTabelaLimpa(
    [ docxLinhaTabela(azulPrimeiro ? [azul, micro] : [micro, azul], docxMM(1.06)) ],
    azulPrimeiro ? [ENEM_DOCX.segBlue, ENEM_DOCX.segMicro] : [ENEM_DOCX.segMicro, ENEM_DOCX.segBlue]);
}

// Tarja da versão + quadrado de registro, ancorados à FOLHA na borda externa.
// São quadros de parágrafo (w:framePr), não tabelas flutuantes: é o mecanismo
// que o Word e o LibreOffice posicionam de forma previsível dentro do cabeçalho.
function docxTarja(outerIsRight){
  const { Paragraph, TextRun, ShadingType, FrameAnchorType, FrameWrap, HeightRule, LineRuleType } = window.docx;
  const larg = outerIsRight ? docxMM(11) : docxMM(6);   // na folha par ela sangra
  const x    = outerIsRight ? docxMM(194) : 0;
  const reg  = outerIsRight ? docxMM(192.5) : docxMM(4.5);
  const quadro = (w, h, px, py, cor) => new Paragraph({
    frame: {
      type: "absolute", width: w, height: h, rule: HeightRule.EXACT,
      anchor: { horizontal: FrameAnchorType.PAGE, vertical: FrameAnchorType.PAGE },
      position: { x: px, y: py },
      space: { horizontal: 0, vertical: 0 },
      wrap: FrameWrap.NONE,
    },
    shading: { type: ShadingType.CLEAR, fill: cor, color: "auto" },
    // O w:shd pinta a CAIXA DE LINHA do parágrafo, não o quadro — então a
    // entrelinha exata é que dá altura à tarja.
    spacing: { before: 0, after: 0, line: h, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: " ", size: 2, color: cor }) ],
  });
  // Só o PRIMEIRO parágrafo com quadro de um cabeçalho/rodapé sobrevive: os
  // seguintes são fundidos nele. Por isso a tarja mora no cabeçalho e o quadrado
  // de registro no rodapé — ambos ancorados à FOLHA, então cada um cai no seu
  // lugar independentemente de onde foi declarado.
  return {
    tarja:    quadro(larg, docxMM(25), x, 0, ENEM_DOCX.azul),  // 11 × 30 mm sangrando: 25 visíveis
    registro: quadro(docxMM(3), docxMM(3), reg, docxMM(23.5), ENEM_DOCX.ink),
  };
}

/* Marca do caderno. NÃO reproduzimos o logotipo do INEP: isto é um simulado, e
   passar-se por caderno oficial seria falsificação. Copia-se a diagramação, não
   a identidade da instituição.                                               */
function docxMarca(ano, outerIsRight){
  const { Paragraph, TextRun, AlignmentType, LineRuleType, VerticalAlign } = window.docx;
  const alinha = outerIsRight ? AlignmentType.LEFT : AlignmentType.RIGHT;
  const marca = new Paragraph({
    alignment: alinha,
    spacing: { before: 0, after: 0, line: Math.round(17 * 20), lineRule: LineRuleType.EXACTLY },
    children: [
      new TextRun({ text: "simulado", bold: true, font: ENEM_DOCX.font, size: 32, color: ENEM_DOCX.azulLogo }),
      new TextRun({ text: String(ano), font: ENEM_DOCX.font, size: 32, color: ENEM_DOCX.ornGray }),
    ],
  });
  const sub = new Paragraph({
    alignment: alinha,
    spacing: { before: 0, after: 0, line: Math.round(7 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: "Simulado no padrão do caderno ENEM", font: ENEM_DOCX.font, size: 11, color: ENEM_DOCX.ornGray }) ],
  });
  // Quatro quadrados de 5,5 × 6,6 mm em #939598, encostados na marca.
  const quad = () => docxCelula(docxMM(5.5), [ new Paragraph({ children: [] }) ], { fill: ENEM_DOCX.ornGray });
  const vao  = () => docxCelula(docxMM(0.4), [ new Paragraph({ children: [] }) ]);
  const bloco = [ quad(), vao(), quad(), vao(), quad(), vao(), quad() ];
  const wMarca = docxMM(52), wBloco = docxMM(23.2);
  const wResto = ENEM_DOCX.mancha - wMarca - wBloco;
  const marcaCel = docxCelula(wMarca, [ marca ], { valign: VerticalAlign.BOTTOM });
  const resto = docxCelula(wResto, [ new Paragraph({ children: [] }) ]);
  const larguras = [docxMM(5.5), docxMM(0.4), docxMM(5.5), docxMM(0.4), docxMM(5.5), docxMM(0.4), docxMM(5.5)];
  const cells = outerIsRight ? [marcaCel].concat(bloco, [resto])
                             : [resto].concat(bloco, [marcaCel]);
  const grade = outerIsRight ? [wMarca].concat(larguras, [wResto])
                             : [wResto].concat(larguras, [wMarca]);
  return [
    docxTabelaLimpa([ docxLinhaTabela(cells, docxMM(6.6)) ], grade),
    sub,
  ];
}

// Barra cinza de 48,93 × 2,38 mm sob a marca, do lado interno.
function docxBarraCinza(outerIsRight){
  const { BorderStyle } = window.docx;
  const barra = docxCelula(ENEM_DOCX.barraCinza, [ docxFilamento({}) ], { fill: ENEM_DOCX.ornGray });
  const vazio = docxCelula(ENEM_DOCX.mancha - ENEM_DOCX.barraCinza, [ docxFilamento({}) ]);
  const wResto = ENEM_DOCX.mancha - ENEM_DOCX.barraCinza;
  return docxTabelaLimpa(
    [ docxLinhaTabela(outerIsRight ? [barra, vazio] : [vazio, barra], docxMM(2.38)) ],
    outerIsRight ? [ENEM_DOCX.barraCinza, wResto] : [wResto, ENEM_DOCX.barraCinza]);
}

function enemDocxHeader(ctx, outerIsRight){
  const { Header } = window.docx;
  // A tarja entra POR ÚLTIMO: mesmo flutuando, uma tabela ocupa posição no
  // fluxo, e no começo ela empurraria todo o cabeçalho folha abaixo.
  const { Paragraph, LineRuleType } = window.docx;
  // 2,4 mm entre a barra cinza (19,29–21,67 mm) e o filete de 25,00 mm.
  const respiro = new Paragraph({
    spacing: { before: 0, after: 0, line: 136, lineRule: LineRuleType.EXACTLY }, children: [] });
  const filhos = [ docxTarja(outerIsRight).tarja ]
    .concat(docxMarca(ctx.ano, outerIsRight))
    .concat([ docxBarraCinza(outerIsRight), respiro, docxFilete(outerIsRight) ]);
  return new Header({ children: filhos });
}

function enemDocxFooter(ctx, outerIsRight){
  const { Footer, Paragraph, TextRun, AlignmentType, LineRuleType, PageNumber } = window.docx;
  // Rodapé: texto corrido na margem INTERNA, fólio na EXTERNA.
  const corrido = docxCelula(ENEM_DOCX.mancha - docxMM(12), [ new Paragraph({
    alignment: outerIsRight ? AlignmentType.LEFT : AlignmentType.RIGHT,
    spacing: { before: 0, after: 0, line: Math.round(11 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: ctx.footerText, font: ENEM_DOCX.fontLight, size: 18, color: ENEM_DOCX.footGray }) ],
  }) ]);
  const folio = docxCelula(docxMM(12), [ new Paragraph({
    alignment: outerIsRight ? AlignmentType.RIGHT : AlignmentType.LEFT,
    spacing: { before: 0, after: 0, line: Math.round(11 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ children: [ PageNumber.CURRENT ], bold: true, font: ENEM_DOCX.font, size: 18, color: ENEM_DOCX.ink }) ],
  }) ]);
  const wCorrido = ENEM_DOCX.mancha - docxMM(12);
  const linha = docxTabelaLimpa(
    [ docxLinhaTabela(outerIsRight ? [corrido, folio] : [folio, corrido]) ],
    outerIsRight ? [wCorrido, docxMM(12)] : [docxMM(12), wCorrido]);
  // No rodapé o azul fica do lado EXTERNO — a composição inverte a do cabeçalho.
  return new Footer({ children: [ docxTarja(outerIsRight).registro,
                                  docxFilete(!outerIsRight), linha ] });
}

/* ---------------- conteúdo: as mesmas regras que o PDF desenha ------------- */

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
      children: enemRichRuns(quiJuntaFormula(par.trim())).map(r => new TextRun({
        text: r.text, font: ENEM_DOCX.font, size: Math.round(size * 2),
        color: o.color || ENEM_DOCX.ink, bold: r.bold || !!o.bold,
      })),
    }));
  });
  return out;
}

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
      children: enemRichRuns(quiJuntaFormula(par.trim())).map(r => new TextRun({
        text: r.text, bold: r.bold, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink,
      })),
    }));
  });
  return out;
}

/* Rótulo QUESTÃO N com a barra-ornamento à direita: começa sempre a 24,47 mm
   da borda da coluna, termina 0,30 mm antes da direita, filete escuro de 1 pt
   no topo e faixa de 1,06 mm com 79,5 % em #B9E5FA e 20,5 % em #231F20.     */
function enemDocxQuestionLabel(numero, colTw, primeiro){
  const { Paragraph, TextRun, AlignmentType, BorderStyle, LineRuleType, VerticalAlign } = window.docx;
  const larg = colTw || ENEM_DOCX.colW;
  const barra = larg - ENEM_DOCX.ornStart - ENEM_DOCX.ornGap;
  const azulW = Math.round(barra * ENEM_DOCX.ornBlueShare);
  const escuroW = barra - azulW;
  const topo = { style: BorderStyle.SINGLE, size: DOCX_LINHA.cheia, color: ENEM_DOCX.ink, space: 0 };
  const faixa = cor => docxFilamento({
    top: topo,
    bottom: { style: BorderStyle.SINGLE, size: DOCX_LINHA.orn, color: cor, space: 0 },
  });
  const rotulo = new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 0, after: 0, line: Math.round(12 * 20), lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: "QUESTÃO " + numero, bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
  });
  const respiro = primeiro ? [] : [
    // 2,53 mm entre a última alternativa da questão anterior e este rótulo.
    new Paragraph({ spacing: { before: 0, after: 143, line: 20, lineRule: LineRuleType.EXACTLY }, children: [] }),
  ];
  return respiro.concat([
    docxTabelaLimpa([ docxLinhaTabela([
      docxCelula(ENEM_DOCX.ornStart, [ rotulo ], { valign: VerticalAlign.BOTTOM }),
      docxCelula(azulW,   [ faixa(ENEM_DOCX.azul) ]),
      docxCelula(escuroW, [ faixa(ENEM_DOCX.ink) ]),
      docxCelula(ENEM_DOCX.ornGap, [ docxFilamento({}) ]),
    ]) ], [ENEM_DOCX.ornStart, azulW, escuroW, ENEM_DOCX.ornGap]),
    // 0,76 mm entre o rótulo e a primeira linha do texto-base.
    new Paragraph({ spacing: { before: 0, after: 43, line: 20, lineRule: LineRuleType.EXACTLY }, children: [] }),
  ]);
}

const ENEM_DOCX_MARKS = { A: "Ⓐ", B: "Ⓑ", C: "Ⓒ", D: "Ⓓ", E: "Ⓔ" };

// Justificada, como no PDF — ver enemAlternative. O Word aplica a justificação
// ao parágrafo inteiro e deixa a última linha em bandeira, exatamente como o
// desenho do PDF faz, o que mantém as duas saídas idênticas.
function enemDocxAlternative(letter, text){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  return [ new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    indent: { left: ENEM_DOCX.hang, hanging: ENEM_DOCX.hang },
    spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
    children: [
      new TextRun({ text: ENEM_DOCX_MARKS[letter] + "\t", font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      ...enemRichRuns(quiJuntaFormula(String(text || "").trim() || "—")).map(r => new TextRun({
        text: r.text, bold: r.bold, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink,
      })),
    ],
  }) ];
}

/* §2.1 — as duas referências. Do texto introdutório: itálico, à direita. De
   imagem, tabela ou gráfico: redonda, justificada. Ambas em corpo − 2 pt.   */
function enemDocxCaption(text, opts){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const o = opts || {};
  const clean = String(text || "").trim();
  if(!clean) return [];
  return [ new Paragraph({
    alignment: o.justify ? AlignmentType.JUSTIFIED : AlignmentType.RIGHT,
    spacing: { line: ENEM_DOCX.capLine, lineRule: LineRuleType.EXACTLY, before: 40, after: 60 },
    children: enemRichRuns(quiJuntaFormula(clean)).map(r => new TextRun({
      text: r.text, bold: r.bold, italics: !!o.italic,
      font: ENEM_DOCX.font, size: 16, color: ENEM_DOCX.ink,
    })),
  }) ];
}

function enemDocxTextoBase(text, fonte){
  const pars = String(text || "").trim().split(/\n+/).filter(x => x.trim());
  let ref = String(fonte || "").trim();
  if(!ref && pars.length > 1 && enemIsReference(pars[pars.length - 1])) ref = pars.pop();
  const out = [];
  pars.forEach(par => out.push(...enemDocxParagraph(par)));
  if(ref) out.push(...enemDocxCaption(ref, { italic: true }));
  return out;
}

// Filete de fechamento: sólido, 0,5 pt, largura cheia da coluna. No caderno
// oficial ele NÃO separa questões consecutivas — quem separa é a barra da
// questão seguinte (§5.9).
function enemDocxRule(){
  const { Paragraph, BorderStyle, LineRuleType } = window.docx;
  return [ new Paragraph({
    spacing: { before: 143, after: 60, line: 20, lineRule: LineRuleType.EXACTLY },
    border: { bottom: { style: BorderStyle.SINGLE, size: DOCX_LINHA.fina, color: ENEM_DOCX.ink, space: 1 } },
    children: [],
  }) ];
}

function enemDocxVisual(visual, cardIdx, colTw){
  const { Paragraph, TextRun, ImageRun, AlignmentType, Table, TableRow, TableCell,
          WidthType, BorderStyle, ShadingType } = window.docx;
  if(!visual || !visual.tipo) return [];
  const out = [];
  const larg = colTw || ENEM_DOCX.colW;

  if(visual.tipo === "tabela"){
    const cols = visual.colunas || [];
    const rows = visual.linhas || [];
    if(!cols.length) return [];
    const moldura = { style: BorderStyle.SINGLE, size: DOCX_LINHA.cheia, color: ENEM_DOCX.ink };
    const divisa  = { style: BorderStyle.SINGLE, size: DOCX_LINHA.fina, color: ENEM_DOCX.ink };
    const cell = (txt, cab) => new TableCell({
      borders: cab ? { top: moldura, bottom: moldura, left: moldura, right: moldura }
                   : { top: divisa, bottom: divisa, left: divisa, right: divisa },
      shading: cab ? { type: ShadingType.CLEAR, fill: ENEM_DOCX.azulTab, color: "auto" } : undefined,
      children: [ new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [ new TextRun({ text: String(txt == null ? "" : txt), font: ENEM_DOCX.font, size: 20, bold: !!cab, color: ENEM_DOCX.ink }) ],
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

  const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx, true) : pdfGetVisualChartInfo(cardIdx);
  if(!info) return [];
  const maxW = Math.round(larg / TW * 72 / 25.4);      // twips → mm → pontos
  const ratio = info.height / info.width;
  const w = maxW, h = Math.round(maxW * ratio);
  try{
    out.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 91, after: 120 },              // 1,60 mm antes · 2,11 mm depois
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

function enemDocxSubhead(texto){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  return [ new Paragraph({
    // Justificado por coerência com o resto do documento. Subtítulo é sempre
    // uma linha só, então a justificação não estica nada — mas deixa o
    // alinhamento declarado igual em todo o arquivo.
    alignment: AlignmentType.JUSTIFIED,
    spacing: { before: 85, after: 0, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    children: [ new TextRun({ text: String(texto).toUpperCase(), bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }) ],
  }) ];
}

function enemDocxAreaTitle(texto){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  return [ new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 181, line: ENEM_DOCX.line, lineRule: LineRuleType.EXACTLY },
    indent: { left: docxMM(2) },
    children: [ new TextRun({ text: String(texto).toUpperCase(), bold: true, font: ENEM_DOCX.font, size: 22, color: ENEM_DOCX.ink }) ],
  }) ];
}

/* §7.2 — folha de gabarito do ALUNO: somente a letra de cada questão. */
function enemDocxGabaritoAluno(doneQuestions){
  const { Paragraph, TextRun, LineRuleType } = window.docx;
  const out = [];
  out.push(...enemDocxAreaTitle("Gabarito"));
  doneQuestions.forEach(o => {
    const letra = (o.q.data && o.q.data.gabarito) || "—";
    out.push(new Paragraph({
      spacing: { line: ENEM_DOCX.altLine, lineRule: LineRuleType.EXACTLY, before: 0, after: 0 },
      children: [
        new TextRun({ text: (o.idx + 1) + ".\t", bold: true, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
        new TextRun({ text: ENEM_DOCX_MARKS[letra] || letra, font: ENEM_DOCX.font, size: 20, color: ENEM_DOCX.ink }),
      ],
    }));
  });
  out.push(...enemDocxRule());
  return out;
}

/* §7.3 — caderno de respostas do PROFESSOR. */
function enemDocxGabaritoBlock(o){
  const { Paragraph, TextRun, AlignmentType, LineRuleType } = window.docx;
  const d = o.q.data || {};
  const out = [];
  out.push(...enemDocxQuestionLabel(o.idx + 1, ENEM_DOCX.colW, o.primeiroDoCaderno));

  const letra = d.gabarito || "—";
  out.push(new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
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
  return out;
}

/* Uma SEÇÃO do Word por bloco de questões que compartilha o modo de coluna —
   é assim que a página inteira vira coluna única quando entra figura larga
   (§6), do mesmo jeito que o PDF faz. Cabeçalho e rodapé são reconstruídos em
   cada seção, espelhados por paridade.                                       */
function enemDocxSections(doneQuestions, professor){
  const { SectionType } = window.docx;
  const areaLabel = AREA_META[state.area] ? AREA_META[state.area].label : "";
  const ctx = {
    ano: new Date().getFullYear(),
    footerText: [String(areaLabel).toUpperCase(), state.disciplina || "",
                 professor ? "VERSÃO DO PROFESSOR" : "VERSÃO DO ALUNO"].filter(Boolean).join(" | "),
  };

  const props = cols => ({
    page: {
      size: { width: ENEM_DOCX.pageW, height: ENEM_DOCX.pageH },
      margin: {
        top: ENEM_DOCX.margTop, bottom: ENEM_DOCX.margBottom,
        left: ENEM_DOCX.margInner, right: ENEM_DOCX.margOuter,
        header: ENEM_DOCX.header, footer: ENEM_DOCX.footer,
      },
    },
    column: cols === 1 ? { count: 1 }
                       : { count: 2, space: ENEM_DOCX.gutter, separate: true },
    type: SectionType.NEXT_PAGE,
  });
  const secao = (cols, children) => ({
    properties: props(cols),
    headers: { default: enemDocxHeader(ctx, true), even: enemDocxHeader(ctx, false) },
    footers: { default: enemDocxFooter(ctx, true), even: enemDocxFooter(ctx, false) },
    children: children,
  });

  // Agrupa questões consecutivas que compartilham o mesmo modo de coluna.
  const grupos = [];
  doneQuestions.forEach(o => {
    const wide = enemNeedsWidePage(o);
    const ultimo = grupos[grupos.length - 1];
    if(ultimo && ultimo.wide === wide) ultimo.itens.push(o);
    else grupos.push({ wide: wide, itens: [o] });
  });

  const sections = [];
  grupos.forEach((g, gi) => {
    const colTw = g.wide ? ENEM_DOCX.mancha : ENEM_DOCX.colW;
    const children = [];
    if(gi === 0) children.push(...enemDocxAreaTitle(areaLabel));
    g.itens.forEach((o, i) => {
      const d = o.q.data;
      children.push(...enemDocxQuestionLabel(o.idx + 1, colTw, gi === 0 && i === 0));
      if(d.textoBase) children.push(...enemDocxTextoBase(d.textoBase, d.fonte));
      if(d.visual && d.visual.tipo) children.push(...enemDocxVisual(d.visual, o.idx, colTw));
      if(d.comando) children.push(...enemDocxParagraph(d.comando, { indent: false }));
      ["A","B","C","D","E"].forEach(L => {
        children.push(...enemDocxAlternative(L, (d.alternativas && d.alternativas[L]) || ""));
      });
      // Filete de fechamento só ao fim da sequência — nunca entre questões.
      const ultimoDeTudo = gi === grupos.length - 1 && i === g.itens.length - 1;
      if(ultimoDeTudo) children.push(...enemDocxRule());
    });
    sections.push(secao(g.wide ? 1 : 2, children));
  });

  // Fecho: aluno → folha de gabarito; professor → caderno de respostas.
  const fecho = [];
  if(professor){
    fecho.push(...enemDocxAreaTitle("Gabarito e resoluções"));
    doneQuestions.forEach((o, i) => {
      fecho.push(...enemDocxGabaritoBlock(Object.assign({}, o, { primeiroDoCaderno: i === 0 })));
      if(i === doneQuestions.length - 1) fecho.push(...enemDocxRule());
    });
  }else{
    fecho.push(...enemDocxGabaritoAluno(doneQuestions));
  }
  sections.push(secao(2, fecho));

  return sections;
}

function pdfGetVisualImageInfo(cardIdx, paraDocx){
  const card = document.querySelectorAll("#questionResults .qcard")[cardIdx];
  if(!card) return null;
  const img = card.querySelector(".visual-image-holder img");
  if(!img || !img.src) return null;
  // Só o Word precisa da conversão; o PDF aceita o WebP e converte internamente.
  const dataUrl = paraDocx ? imagemParaJpeg(img.src, img) : img.src;
  // Sem conversão possível, o Word sai sem a figura — e, como quem chama
  // interrompe o bloco inteiro, sem a legenda também. É pior perder a figura do
  // que entregar um .docx com um quadro quebrado que ninguém consegue abrir.
  if(!dataUrl) return null;
  return { dataUrl, width: img.naturalWidth || 800, height: img.naturalHeight || 500 };
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
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
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
  return f;   // diz o formato REAL; quem garante que não chega webp é imagemParaJpeg
}

/* O Word não abre WebP. Desde que as imagens passaram a chegar em WebP (bem
   menor que o PNG, ver a seção de geração de imagem), é preciso converter antes
   de embutir no .docx — senão o arquivo sai com um quadro vazio no lugar da
   figura. O PDF não precisa disto: o jsPDF converte sozinho para JPEG.

   A conversão é feita no próprio navegador, com canvas, a partir da imagem que
   JÁ está desenhada na tela (portanto já decodificada). Se algo falhar, devolve
   a original em vez de derrubar a exportação inteira — e aí o pior caso é o
   comportamento anterior, não uma exportação perdida.                         */
function imagemParaJpeg(dataUrl, imgEl){
  if(!/^data:image\/webp/i.test(dataUrl || "")) return dataUrl;
  try{
    const fonte = (imgEl && imgEl.complete && imgEl.naturalWidth) ? imgEl : null;
    if(!fonte) return null;
    const cv = document.createElement("canvas");
    cv.width = fonte.naturalWidth;
    cv.height = fonte.naturalHeight;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = "#FFFFFF";                 // JPEG não tem transparência
    ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.drawImage(fonte, 0, 0);
    const saida = cv.toDataURL("image/jpeg", 0.92);
    return /^data:image\/jpeg/i.test(saida) ? saida : null;
  }catch(e){
    return null;   // devolver o WebP aqui faria o Word receber bytes que não abre
  }
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
    const info = visual.tipo === "imagem" ? pdfGetVisualImageInfo(cardIdx, true) : pdfGetVisualChartInfo(cardIdx);
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

    // AS DUAS VERSÕES saem na mesma anatomia do PDF: página 200 × 275 mm, duas
    // colunas de 89,47 mm com fio separador, Calibri 10/12,0 pt, tinta #231F20,
    // e o mesmo cromo de página — marca, quadrados, barra cinza, filete misto,
    // tarja, rodapé corrido e fólio. `evenAndOddHeaderAndFooters` faz cabeçalho
    // e rodapé espelharem pela paridade, como no caderno oficial.
    if(bloqueiaSeQuimicaInvalida(doneQuestions)) return;
    const docEnem = new Document({
      evenAndOddHeaderAndFooters: true,
      sections: enemDocxSections(doneQuestions, !isAluno),
    });
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
  initAuth();
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
    if(!exigirLogin()) return;
    if(!state.area){ toast("Selecione a área do conhecimento.", "err"); return; }
    if(!state.disciplina){ toast("Selecione a disciplina.", "err"); return; }
    simuladoAbertoId = null; // simulado novo, não é edição de um já arquivado
    generateAll();
  });

  document.getElementById("btnBackToForm").addEventListener("click", () => {
    simuladoAbertoId = null;
    document.getElementById("formPanel").style.display = "block";
    document.getElementById("resultsPanel").style.display = "none";
  });

  document.getElementById("viewAluno").addEventListener("click", () => setViewMode("aluno"));
  document.getElementById("viewProfessor").addEventListener("click", () => setViewMode("professor"));
  document.getElementById("btnPrint").addEventListener("click", printExam);
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

  // ---------------- Autenticação e "Meus Simulados" ----------------
  document.getElementById("btnEntrar").addEventListener("click", () => abrirAuthModal("login"));
  document.getElementById("btnCloseAuth").addEventListener("click", () => closeModal("authModal"));
  document.getElementById("authTabLogin").addEventListener("click", () => selecionaAbaAuth("login"));
  document.getElementById("authTabCadastro").addEventListener("click", () => selecionaAbaAuth("cadastro"));
  document.getElementById("linkIrCadastro").addEventListener("click", () => selecionaAbaAuth("cadastro"));
  document.getElementById("linkIrLogin").addEventListener("click", () => selecionaAbaAuth("login"));
  document.getElementById("btnGoogleAuth").addEventListener("click", fazerLoginGoogle);
  document.getElementById("btnLoginSubmit").addEventListener("click", fazerLogin);
  document.getElementById("btnCadastroSubmit").addEventListener("click", fazerCadastro);
  ["loginEmail","loginSenha"].forEach(id => document.getElementById(id).addEventListener("keydown", e => { if(e.key === "Enter") fazerLogin(); }));
  ["cadastroEmail","cadastroSenha"].forEach(id => document.getElementById(id).addEventListener("keydown", e => { if(e.key === "Enter") fazerCadastro(); }));
  document.getElementById("btnSair").addEventListener("click", fazerLogout);
  document.getElementById("btnMeusSimulados").addEventListener("click", abrirMeusSimulados);
  document.getElementById("btnFecharSimulados").addEventListener("click", fecharMeusSimulados);

  setViewMode("professor");

  // Efeito de inclinação 3D ao passar o mouse foi removido a pedido do usuário:
  // os cartões de questão (.qcard) e os blocos de área (.area-tile) agora ficam
  // fixos, sem rotacionar/deslocar ao movimentar o cursor sobre eles.
}

function openModal(id){ document.getElementById(id).classList.add("show"); }
function closeModal(id){ document.getElementById(id).classList.remove("show"); }

document.addEventListener("DOMContentLoaded", init);
