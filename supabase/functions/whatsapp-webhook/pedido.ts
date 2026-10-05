// whatsapp-webhook — etapa B1: o PEDIDO de simulado pelo WhatsApp (lógica pura, sem rede).
//
// O professor manda qualquer mensagem e o bot faz 6 perguntas, uma por vez, com listas e botões
// do WhatsApp (área, disciplina, temas, quantidade, dificuldade, recurso visual), mostra o resumo
// e pede "Sim". Este módulo valida os campos, monta o pedido, o resumo e a máquina de perguntas.
// (A interpretação de frase livre e o WhatsApp Flow ficaram como opções futuras — ver README.)
//
// Os parâmetros são EXATAMENTE os do painel "lote" do app (seção 4): disciplina (que define a
// área), temas separados por vírgula (rodízio: um tema por questão, na ordem — função
// distribuiTemaDoLote do app.js), quantidade por nível (Fácil/Médio/Difícil; "Mista" =
// contagemIgual do app) e recurso visual (nenhum/imagem/grafico/tabela). O app aceita de 1 a 20
// questões (setQty) — o mesmo teto vale aqui.

export const MIN_QUESTOES = 1;
export const MAX_QUESTOES = 20;              // = setQty do app.js (Math.min(20, n))
export const MAX_TEMAS = 40;                 // = itensDoTemaDoLote do app.js (slice(0, 40))
export const MAX_TEXTO_TEMAS = 600;

// Mesmas disciplinas e áreas de AREA_META (app.js v18.34).
export const AREAS: Record<string, { label: string; disciplinas: string[] }> = {
  linguagens: { label: "Linguagens, Códigos e suas Tecnologias", disciplinas: ["Língua Portuguesa", "Literatura", "Artes", "Práticas Corporais", "Inglês", "Espanhol"] },
  humanas: { label: "Ciências Humanas e suas Tecnologias", disciplinas: ["História", "Geografia", "Filosofia", "Sociologia"] },
  natureza: { label: "Ciências da Natureza e suas Tecnologias", disciplinas: ["Biologia", "Física", "Química"] },
  matematica: { label: "Matemática e suas Tecnologias", disciplinas: ["Matemática"] },
};
export const AREA_ROTULO_CURTO: Record<string, string> = { linguagens: "Linguagens", humanas: "Ciências Humanas", natureza: "Ciências da Natureza", matematica: "Matemática" };
export const DISCIPLINAS: string[] = Object.values(AREAS).flatMap((a) => a.disciplinas);

export const NIVEIS = ["Fácil", "Médio", "Difícil"] as const;
export type Nivel = typeof NIVEIS[number];
export const RECURSOS = ["nenhum", "imagem", "grafico", "tabela", "misto"] as const;
export type Recurso = typeof RECURSOS[number];
export const RECURSO_ROTULO: Record<Recurso, string> = { nenhum: "Sem recurso visual", imagem: "Com imagem", grafico: "Com gráfico", tabela: "Com tabela", misto: "Recurso misto (sem recurso, imagem, tabela e gráfico em rodízio)" };

// Faixa dos acentos combinantes (U+0300–U+036F) montada por código: sem sequências \uXXXX no fonte, que a
// publicação inline da função converte em caracteres literais (o código publicado deixaria de ser igual ao do repositório).
export const ACENTOS = new RegExp("[" + String.fromCharCode(0x300) + "-" + String.fromCharCode(0x36f) + "]", "g");
export function slug(s: string): string {
  return String(s ?? "").normalize("NFD").replace(ACENTOS, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}
export function areaValida(id: unknown): id is string { return typeof id === "string" && Object.hasOwn(AREAS, id); }
export function areaDaDisciplina(disciplina: string): string | null {
  for (const [area, a] of Object.entries(AREAS)) if (a.disciplinas.includes(disciplina)) return area;
  return null;
}
// "biologia" / "Biologia" / "BIOLOGIA" / "fisica" / "português" → nome oficial; null se não existir
export const APELIDOS_DISCIPLINA: Record<string, string> = {
  portugues: "Língua Portuguesa", lingua_portuguesa: "Língua Portuguesa", lp: "Língua Portuguesa", gramatica: "Língua Portuguesa", redacao: "Língua Portuguesa",
  ed_fisica: "Práticas Corporais", educacao_fisica: "Práticas Corporais", praticas_corporais: "Práticas Corporais",
  ingles: "Inglês", espanhol: "Espanhol", mat: "Matemática", matematica: "Matemática", bio: "Biologia", fis: "Física", qui: "Química",
  hist: "História", geo: "Geografia", filo: "Filosofia", socio: "Sociologia", lit: "Literatura",
};
export function disciplinaPorNome(texto: string): string | null {
  const alvo = slug(texto);
  if (!alvo) return null;
  for (const d of DISCIPLINAS) if (slug(d) === alvo) return d;
  return APELIDOS_DISCIPLINA[alvo] ?? null;
}

// ---------------------------------------------------------------------------
// Temas: "fotossíntese, respiração celular; ciclo do carbono" → lista (rodízio)
// Mesmas regras de itensDoTemaDoLote (app.js): quebra por linha, ou por ";" se
// houver, senão por ","; não quebra dentro de parênteses nem em decimais (3,5).
// ---------------------------------------------------------------------------
export function itensDosTemas(texto: string): string[] {
  // mesma limpeza do app: tira marcador de lista ("- ", "• ", "1) ", "2. "), um "e " inicial e a pontuação final
  const limpa = (s: string) => s.replace(/\s+/g, " ").trim().replace(/^(?:[-*•–—]\s*|\d{1,2}[.)]\s+)/, "").replace(/^(?:e|E)\s+(?=\S)/, "").replace(/[\s.;,:!?]+$/, "").trim();
  const linhas = String(texto || "").split(/\r?\n/).map(limpa).filter(Boolean);
  let partes: string[] = [];
  if (linhas.length > 1) partes = linhas;
  else if (linhas.length === 1) {
    const linha = linhas[0];
    const sep = /;/.test(linha) ? ";" : ",";
    let atual = ""; let nivel = 0;
    for (let i = 0; i < linha.length; i++) {
      const c = linha[i];
      if (c === "(" || c === "[") nivel++;
      else if (c === ")" || c === "]") nivel = Math.max(0, nivel - 1);
      const decimal = c === "," && /\d/.test(linha[i - 1] || "") && /\d/.test(linha[i + 1] || "");
      if (c === sep && nivel === 0 && !decimal) { partes.push(atual); atual = ""; } else atual += c;
    }
    partes.push(atual);
  }
  partes = partes.map(limpa).filter((x) => x.length >= 2);
  return partes.slice(0, MAX_TEMAS);
}
// Rodízio: n questões, um tema por questão, na ordem digitada (distribuiTemaDoLote).
export function distribuiTemas(itens: string[], n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(itens.length ? itens[i % itens.length] : "");
  return out;
}
// "Mista" = contagemIgual do app: base para todos, sobra para Fácil e depois Médio.
export function contagemIgual(total: number): Record<Nivel, number> {
  const base = Math.floor(total / 3), sobra = total % 3;
  return { "Fácil": base + (sobra > 0 ? 1 : 0), "Médio": base + (sobra > 1 ? 1 : 0), "Difícil": base };
}

// ---------------------------------------------------------------------------
// Campos (como saem do formulário) e o pedido validado (vai para wa_trabalhos.parametros)
// ---------------------------------------------------------------------------
export interface Campos {
  disciplina?: string | null;
  temas?: string[] | string | null;
  quantidade?: number | string | null;
  dificuldade?: string | null;                          // Fácil | Médio | Difícil | Mista
  contagem?: Partial<Record<string, number>> | null;    // quando o professor diz "3 fáceis, 4 médias, 3 difíceis"
  recurso?: string | null;                              // nenhum | imagem | grafico | tabela
}
export const CAMPOS_OBRIGATORIOS = ["disciplina", "temas", "quantidade", "dificuldade", "recurso"] as const;
export type Campo = typeof CAMPOS_OBRIGATORIOS[number];

export interface Pedido {
  area: string;
  disciplina: string;
  temas: string[];                 // itens (até 40)
  temas_texto: string;             // forma canônica: itens separados por ", "
  quantidade: number;              // 1..20
  nivel: Nivel | "Mista" | "Personalizada";
  contagem: Record<Nivel, number>; // por nível (soma = quantidade)
  recurso: Recurso;
  origem: "guiado";
  frase?: string;
}

export function normalizaNivel(v: unknown): Nivel | "Mista" | null {
  const d = slug(String(v ?? ""));
  if (["facil", "faceis"].includes(d)) return "Fácil";
  if (["medio", "media", "medios", "medias", "intermediario", "intermediaria"].includes(d)) return "Médio";
  if (["dificil", "dificeis"].includes(d)) return "Difícil";
  if (["mista", "misto", "mistas", "mistos", "variada", "variado", "variados", "misturada", "misturado", "todos", "todas", "todos_os_niveis"].includes(d)) return "Mista";
  return null;
}
export function normalizaRecurso(v: unknown): Recurso | null {
  const r = slug(String(v ?? ""));
  if (["nenhum", "sem_recurso", "sem_recurso_visual", "sem_imagem", "so_texto", "texto", "sem", "nenhum_recurso"].includes(r)) return "nenhum";
  if (["imagem", "com_imagem", "imagens", "com_imagens", "figura", "ilustracao"].includes(r)) return "imagem";
  if (["grafico", "com_grafico", "graficos", "com_graficos"].includes(r)) return "grafico";
  if (["tabela", "com_tabela", "tabelas", "com_tabelas"].includes(r)) return "tabela";
  if (["misto", "mista", "mistos", "mistas", "recurso_misto", "variado", "variados", "rodizio", "em_rodizio", "todos", "todos_os_recursos"].includes(r)) return "misto";
  return null;
}
export function normalizaContagem(c: unknown): Record<Nivel, number> | null {
  if (!c || typeof c !== "object") return null;
  const out: Record<Nivel, number> = { "Fácil": 0, "Médio": 0, "Difícil": 0 };
  let algum = false;
  for (const [k, v] of Object.entries(c as Record<string, unknown>)) {
    const n = normalizaNivel(k); const q = Number(v);
    if (n && n !== "Mista" && Number.isInteger(q) && q >= 0) { out[n] += q; if (q > 0) algum = true; }
  }
  return algum ? out : null;
}
export function temasDe(c: Campos): string[] {
  if (Array.isArray(c.temas)) return c.temas.map((t) => String(t).replace(/[ \t]+/g, " ").trim()).filter((t) => t.length >= 2).slice(0, MAX_TEMAS);
  return itensDosTemas(String(c.temas ?? "").replace(/[ \t]+/g, " ").trim().slice(0, MAX_TEXTO_TEMAS));
}

// Diz o que falta (na ordem em que o professor normalmente fala) — sem validar os valores.
export function camposFaltantes(c: Campos): Campo[] {
  const f: Campo[] = [];
  if (!c.disciplina) f.push("disciplina");
  if (!temasDe(c).length) f.push("temas");
  const temContagem = !!normalizaContagem(c.contagem);
  if ((c.quantidade == null || String(c.quantidade).trim() === "") && !temContagem) f.push("quantidade");
  if (!c.dificuldade && !temContagem) f.push("dificuldade");
  if (!c.recurso) f.push("recurso");
  return f;
}

export type Validacao = { ok: true; pedido: Pedido } | { ok: false; erros: string[]; faltam: Campo[] };

export function validarPedido(c: Campos, frase?: string): Validacao {
  const erros: string[] = [];
  const faltam = camposFaltantes(c);
  const disciplina = c.disciplina ? disciplinaPorNome(c.disciplina) : null;
  if (c.disciplina && !disciplina) erros.push(`não conheço a disciplina "${String(c.disciplina).slice(0, 40)}" (as do ENEM: ${DISCIPLINAS.join(", ")})`);
  const temas = temasDe(c);
  const contagemDada = normalizaContagem(c.contagem);
  let q = NaN;
  if (c.quantidade != null && String(c.quantidade).trim() !== "") {
    const qTxt = String(c.quantidade).trim();
    q = /^\d{1,2}$/.test(qTxt) ? Number(qTxt) : NaN;
    if (!Number.isInteger(q) || q < MIN_QUESTOES || q > MAX_QUESTOES) erros.push(`a quantidade tem de ser um número de ${MIN_QUESTOES} a ${MAX_QUESTOES}`);
  } else if (contagemDada) {
    q = contagemDada["Fácil"] + contagemDada["Médio"] + contagemDada["Difícil"];
    if (q < MIN_QUESTOES || q > MAX_QUESTOES) erros.push(`a soma por nível (${q}) tem de ficar entre ${MIN_QUESTOES} e ${MAX_QUESTOES}`);
  }
  const somaContagem = contagemDada ? contagemDada["Fácil"] + contagemDada["Médio"] + contagemDada["Difícil"] : 0;
  if (contagemDada && Number.isInteger(q) && somaContagem !== q) erros.push(`a soma por nível (${somaContagem}) não bate com a quantidade (${q})`);
  const nivel = c.dificuldade ? normalizaNivel(c.dificuldade) : null;
  if (c.dificuldade && !nivel) erros.push(`não entendi o nível "${String(c.dificuldade).slice(0, 30)}" (fácil, médio, difícil ou mista)`);
  const recurso = c.recurso ? normalizaRecurso(c.recurso) : null;
  if (c.recurso && !recurso) erros.push(`não entendi o recurso "${String(c.recurso).slice(0, 30)}" (sem recurso, imagem, gráfico, tabela ou misto)`);
  if (erros.length || faltam.length || !disciplina || !recurso || !Number.isInteger(q) || (!nivel && !contagemDada)) return { ok: false, erros, faltam };
  let contagem: Record<Nivel, number>;
  let nivelFinal: Pedido["nivel"];
  if (contagemDada) { contagem = contagemDada; nivelFinal = "Personalizada"; }
  else if (nivel === "Mista") { contagem = contagemIgual(q); nivelFinal = "Mista"; }
  else { contagem = { "Fácil": 0, "Médio": 0, "Difícil": 0 }; contagem[nivel as Nivel] = q; nivelFinal = nivel as Nivel; }
  return { ok: true, pedido: { area: areaDaDisciplina(disciplina)!, disciplina, temas, temas_texto: temas.join(", "), quantidade: q, nivel: nivelFinal, contagem, recurso, origem: "guiado", frase: frase?.slice(0, 500) } };
}

// Resumo que o bot manda de volta ("foi isto que entendi").
export function resumoPedido(p: Pedido): string {
  const niveis = p.nivel === "Mista"
    ? `mista (${p.contagem["Fácil"]} fáceis, ${p.contagem["Médio"]} médias, ${p.contagem["Difícil"]} difíceis)`
    : p.nivel === "Personalizada" ? `${p.contagem["Fácil"]} fáceis, ${p.contagem["Médio"]} médias, ${p.contagem["Difícil"]} difíceis`
    : p.nivel === "Fácil" ? "fácil" : p.nivel === "Médio" ? "média" : "difícil";
  // lista de temas limitada a ~500 caracteres: o corpo de um botão do WhatsApp tem teto de 1024
  let listaTemas = ""; let mostrados = 0;
  for (const t of p.temas) { const prox = (listaTemas ? listaTemas + "; " : "") + t; if (prox.length > 500) break; listaTemas = prox; mostrados++; }
  if (mostrados < p.temas.length) listaTemas += `… (+${p.temas.length - mostrados} temas)`;
  const temas = p.temas.length === 1 ? `Tema: ${p.temas[0].slice(0, 500)}` : `Temas (${p.temas.length}, em rodízio): ${listaTemas}`;
  const sobras = p.temas.length > p.quantidade ? `\n⚠️ Há mais temas que questões: só os ${p.quantidade} primeiros entram (um por questão).` : "";
  return `📋 *Foi isto que entendi*\n` +
    `• ${p.quantidade} ${p.quantidade === 1 ? "questão" : "questões"} de *${p.disciplina}* (${AREA_ROTULO_CURTO[p.area]})\n` +
    `• ${temas}\n` +
    `• Dificuldade: ${niveis}\n` +
    `• ${RECURSO_ROTULO[p.recurso]}` + sobras;
}

// Estimativa de espera (minutos) para o texto da resposta — conservadora.
export function minutosEstimados(p: Pedido): number {
  const porQuestao = p.recurso === "imagem" ? 1.6 : p.recurso === "misto" ? 1.3 : p.recurso === "nenhum" ? 1.0 : 1.2;
  return Math.max(2, Math.ceil(p.quantidade * porQuestao) + 1);
}

// Texto "normalizado" de uma resposta: id do botão/linha, ou o texto digitado.
export function respostaDoProfessor(msg: { type?: string; text?: { body?: string }; interactive?: { type?: string; list_reply?: { id?: string; title?: string }; button_reply?: { id?: string; title?: string } } }): string | null {
  if (msg.type === "text") return String(msg.text?.body ?? "").trim();
  if (msg.type === "interactive") {
    const i = msg.interactive;
    if (i?.type === "list_reply") return String(i.list_reply?.id ?? i.list_reply?.title ?? "").trim();
    if (i?.type === "button_reply") return String(i.button_reply?.id ?? i.button_reply?.title ?? "").trim();
  }
  return null;
}
export function ehSim(r: string): boolean { return r === "conf:sim" || /^(sim|s|ok|pode|confirmo|confirmar|isso|gerar|gera|pode gerar|sim,?\s*gerar|sim,?\s*pode|certo|correto|exato|positivo|👍)[.!]?$/i.test(r.trim()); }
export function ehCancelar(r: string): boolean { return r === "conf:cancelar" || /^(cancelar|cancela|desistir|deixa|esquece|parar)[.!]?$/i.test(r.trim()); }

// Expiração do formulário: uma hora sem mensagem → a próxima mensagem começa um pedido novo.
export const FORMULARIO_EXPIRA_MS = 60 * 60 * 1000;
export function estadoExpirado(e: { iniciado_em?: string; atualizado_em?: string } | null | undefined, agora = Date.now()): boolean {
  const ref = e?.atualizado_em ?? e?.iniciado_em;
  if (!ref) return true;
  return agora - new Date(ref).getTime() > FORMULARIO_EXPIRA_MS;
}

// ---------------------------------------------------------------------------
// FORMULÁRIO POR PERGUNTAS (listas e botões do WhatsApp) — a versão publicada.
// Uma pergunta por vez; estado em wa_conversas.estado: { passo, dados, iniciado_em, atualizado_em }.
// Ordem (B2.2): 1 área · 2 disciplina · 3 quantidade · 4 temas · 5 recurso visual · 6 dificuldade.
// O próximo passo é sempre o primeiro campo que ainda falta (ORDEM_PASSOS): um formulário que
// estava no meio quando a ordem mudou continua de onde parou, sem pular pergunta.
// ---------------------------------------------------------------------------
export type Passo = "area" | "disciplina" | "quantidade" | "temas" | "recurso" | "dificuldade" | "confirmar" | "registrando";
export const ORDEM_PASSOS: Passo[] = ["area", "disciplina", "quantidade", "temas", "recurso", "dificuldade"];
export function proximoFaltante(d: Record<string, string>): Passo {
  return ORDEM_PASSOS.find((p) => !String(d[p] ?? "").trim()) ?? "confirmar";
}
export interface EstadoGuiado { passo: Passo; dados: Record<string, string>; iniciado_em: string; atualizado_em?: string; ultimo_wamid?: string; ultima_resposta?: Record<string, unknown>[] }
export const TOTAL_PERGUNTAS = 6;

type Msg = Record<string, unknown>;
const texto = (body: string): Msg => ({ type: "text", text: { preview_url: false, body } });
const lista = (body: string, botao: string, titulo: string, linhas: { id: string; title: string; description?: string }[]): Msg => ({
  type: "interactive",
  interactive: { type: "list", body: { text: body }, action: { button: botao.slice(0, 20), sections: [{ title: titulo.slice(0, 24), rows: linhas.map((l) => ({ id: l.id, title: l.title.slice(0, 24), ...(l.description ? { description: l.description.slice(0, 72) } : {}) })) }] } },
});
const botoes = (body: string, opcoes: { id: string; title: string }[]): Msg => ({
  type: "interactive",
  interactive: { type: "button", body: { text: body.slice(0, 1024) }, action: { buttons: opcoes.map((o) => ({ type: "reply", reply: { id: o.id, title: o.title.slice(0, 20) } })) } },
});

// Campos do formulário → Campos do pedido.
export function camposDoGuiado(d: Record<string, string>): Campos {
  return { disciplina: d.disciplina, temas: d.temas, quantidade: d.quantidade, dificuldade: d.dificuldade, recurso: d.recurso };
}

export function perguntaDoPasso(passo: Passo, dados: Record<string, string>): Msg {
  switch (passo) {
    case "area": return lista(`Vamos montar o simulado em ${TOTAL_PERGUNTAS} perguntas rápidas. Responda CANCELAR a qualquer momento para desistir.\n\n1/${TOTAL_PERGUNTAS} — Qual é a área?`, "Escolher área", "Áreas do ENEM",
      Object.entries(AREAS).map(([id, a]) => ({ id: `area:${id}`, title: AREA_ROTULO_CURTO[id], description: a.disciplinas.map((d) => d === "Língua Portuguesa" ? "Português" : d).join(", ") })));
    case "disciplina": {
      const a = areaValida(dados.area) ? AREAS[dados.area] : AREAS.linguagens;
      return lista(`2/${TOTAL_PERGUNTAS} — Qual disciplina?`, "Escolher disciplina", areaValida(dados.area) ? AREA_ROTULO_CURTO[dados.area] : "Disciplinas",
        a.disciplinas.map((d) => ({ id: `disc:${slug(d)}`, title: d })));
    }
    case "quantidade": return texto(`3/${TOTAL_PERGUNTAS} — Quantas questões? Responda só o número (${MIN_QUESTOES} a ${MAX_QUESTOES}).`);
    case "temas": return texto(`4/${TOTAL_PERGUNTAS} — Quais temas? Escreva todos numa mensagem só, separados por vírgula (um tema por questão, em rodízio).\n\nEx.: fotossíntese, respiração celular, ciclo do carbono`);
    case "recurso": return lista(`5/${TOTAL_PERGUNTAS} — As questões terão recurso visual?`, "Escolher recurso", "Recurso visual", [
      { id: "rec:nenhum", title: "Sem recurso" }, { id: "rec:imagem", title: "Com imagem" }, { id: "rec:grafico", title: "Com gráfico" }, { id: "rec:tabela", title: "Com tabela" },
      { id: "rec:misto", title: "Misto", description: "Sem recurso, imagem, tabela e gráfico em rodízio" },
    ]);
    case "dificuldade": return lista(`6/${TOTAL_PERGUNTAS} — Nível de dificuldade?`, "Escolher nível", "Dificuldade", [
      { id: "dif:facil", title: "Fácil" }, { id: "dif:medio", title: "Médio" }, { id: "dif:dificil", title: "Difícil" }, { id: "dif:mista", title: "Misto", description: "Fáceis, médias e difíceis em partes iguais" },
    ]);
    case "confirmar":
    case "registrando": {
      const v = validarPedido(camposDoGuiado(dados));
      const corpo = v.ok ? resumoPedido(v.pedido) + "\n\nPosso gerar?" : "Algo ficou inválido: " + v.erros.join("; ");
      return botoes(corpo, [{ id: "conf:sim", title: "Sim, gerar" }, { id: "conf:refazer", title: "Refazer" }, { id: "conf:cancelar", title: "Cancelar" }]);
    }
  }
}

export type Transicao =
  | { tipo: "pergunta"; estado: EstadoGuiado; mensagem: Msg }                 // segue para o próximo passo
  | { tipo: "repetir"; estado: EstadoGuiado; mensagem: Msg; aviso: string }   // resposta inválida: repete o passo
  | { tipo: "confirmado"; pedido: Pedido }                                      // "Sim" na confirmação
  | { tipo: "cancelado" };

export function iniciarGuiado(agora = new Date()): { estado: EstadoGuiado; mensagem: Msg } {
  const estado: EstadoGuiado = { passo: "area", dados: {}, iniciado_em: agora.toISOString(), atualizado_em: agora.toISOString() };
  return { estado, mensagem: perguntaDoPasso("area", {}) };
}

// Aplica a resposta ao passo atual e devolve o que fazer em seguida.
export function avancarGuiado(estado: EstadoGuiado, resposta: string): Transicao {
  const r = resposta.trim();
  const d = { ...estado.dados };
  const proximo = (p: Passo): Transicao => ({ tipo: "pergunta", estado: { ...estado, passo: p, dados: d }, mensagem: perguntaDoPasso(p, d) });
  const repetir = (aviso: string): Transicao => ({ tipo: "repetir", estado: { ...estado, dados: d }, mensagem: perguntaDoPasso(estado.passo, d), aviso });
  if (ehCancelar(r)) return { tipo: "cancelado" };
  switch (estado.passo) {
    case "area": {
      const id = r.replace(/^area:/, "");
      const area = areaValida(id) ? id : Object.keys(AREAS).find((k) => slug(AREA_ROTULO_CURTO[k]) === slug(r) || slug(AREAS[k].label) === slug(r));
      if (!area) return repetir("Não entendi a área — toque em \"Escolher área\" e escolha na lista.");
      d.area = area; return proximo(proximoFaltante(d));
    }
    case "disciplina": {
      const disc = disciplinaPorNome(r.replace(/^disc:/, ""));
      if (!disc || !areaValida(d.area) || !AREAS[d.area].disciplinas.includes(disc)) return repetir("Escolha uma disciplina da lista.");
      d.disciplina = disc; return proximo(proximoFaltante(d));
    }
    case "temas": {
      if (/^(area|disc|dif|rec|conf):/.test(r)) return repetir("Agora preciso dos temas, em texto.");   // toque num botão/lista antigo não é tema
      if (!itensDosTemas(r).length) return repetir("Preciso de pelo menos um tema (com 2 letras ou mais).");
      d.temas = r.slice(0, MAX_TEXTO_TEMAS); return proximo(proximoFaltante(d));
    }
    case "quantidade": {
      const n = /^\d{1,2}$/.test(r) ? Number(r) : NaN;
      if (!Number.isInteger(n) || n < MIN_QUESTOES || n > MAX_QUESTOES) return repetir(`Responda só um número de ${MIN_QUESTOES} a ${MAX_QUESTOES}.`);
      d.quantidade = String(n); return proximo(proximoFaltante(d));
    }
    case "dificuldade": {
      const v = normalizaNivel(r.replace(/^dif:/, ""));
      if (!v) return repetir("Escolha o nível na lista.");
      d.dificuldade = v; return proximo(proximoFaltante(d));
    }
    case "recurso": {
      const v = normalizaRecurso(r.replace(/^rec:/, ""));
      if (!v) return repetir("Escolha o recurso na lista.");
      d.recurso = v; return proximo(proximoFaltante(d));
    }
    case "confirmar":
    case "registrando": {
      if (r === "conf:refazer" || /^(refazer|recome[çc]ar|de novo|corrigir)[.!]?$/i.test(r)) { const ini = iniciarGuiado(); return { tipo: "pergunta", estado: ini.estado, mensagem: ini.mensagem }; }
      if (ehSim(r)) {
        const v = validarPedido(camposDoGuiado(d));
        if (!v.ok) { const ini = iniciarGuiado(); return { tipo: "pergunta", estado: ini.estado, mensagem: ini.mensagem }; }
        return { tipo: "confirmado", pedido: v.pedido };
      }
      return repetir("Toque em um dos botões: Sim, gerar · Refazer · Cancelar.");
    }
  }
}
