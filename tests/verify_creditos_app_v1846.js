/* v18.46 — CRÉDITOS NO APP (Etapa 2, 13/10/2026).

   Prova, no navegador, com o Supabase e o servidor simulados (um "banco" de créditos aqui no
   teste faz o papel das funções creditos_* — as regras do banco têm o próprio teste,
   tests/verify_creditos_banco_v1846.sh, e as do servidor, tests/verify_creditos_servidor_v7440.ts):
     A. botão "Créditos" no topo (só logado) e a janela com saldo, validade e os 4 pacotes;
     B. sem saldo para o simulado inteiro: a janela abre e NADA é pedido ao servidor;
     C. geração normal: um identificador por questão, o mesmo nas retentativas da questão,
        motivo "questao", e o saldo do topo acompanha;
     D. o saldo acaba no meio (402): as prontas ficam, as outras param marcadas, a janela abre
        uma vez, nada é devolvido por elas;
     E. a questão que chega mas não pode ser entregue (gabarito divergente) tem o crédito
        devolvido pelo app;
     F. "Regenerar": confere o saldo antes, identificador novo, motivo "refazer"; sem saldo,
        a janela abre e nada é pedido;
     G. imagem que não sai: crédito devolvido; "Tentar novamente": cobra de novo ANTES de pedir
        a imagem; se sair, a questão fica pronta e o crédito fica;
     H. "Interromper geração": o crédito das questões em andamento volta;
     I. robô do WhatsApp: identificadores "wa-<pedido>-<nº>" e, sem saldo, erro "sem créditos";
     J. conta sem limite (dono): "Créditos: ilimitado" e gera mesmo com saldo zero;
     K. sem erros de JavaScript; a janela cabe no celular sem rolagem lateral.

   Uso: node tests/verify_creditos_app_v1846.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const LIBS = [['jspdf', 'jspdf.umd.min.js'], ['npm/docx@', 'docx.umd.js'], ['Chart.js', 'chart.umd.js']];   // as cópias locais do robô
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; }, async setSession(){ return { data: { session: f.session }, error: null }; } },
  async rpc(nome){ if(nome === 'creditos_meu_saldo') return { data: await window.__saldoDoBanco(), error: null }; return { data: [{ vinculado: false }], error: null }; },
  from(){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: { id: 'simulado-teste' }, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

/* ---------- o "banco" de créditos do teste ---------- */
const banco = { saldo: 0, ilimitado: false, saldoQueOAppVe: null, cob: new Map() };   // id → 'cobrado' | 'devolvido'
function cobrar(id){
  if(banco.ilimitado) return { ok: true, cobrado: false, ilimitado: true };
  if(banco.cob.get(id) === 'cobrado') return { ok: true, cobrado: false, saldo: banco.saldo };
  if(banco.saldo <= 0) return { ok: false, motivo: 'sem_creditos', saldo: 0 };
  banco.saldo--; banco.cob.set(id, 'cobrado');
  return { ok: true, cobrado: true, saldo: banco.saldo };
}
function devolver(id){
  if(banco.cob.get(id) !== 'cobrado') return { ok: true, devolvido: false, saldo: banco.saldo };
  banco.saldo++; banco.cob.set(id, 'devolvido');
  return { ok: true, devolvido: true, saldo: banco.saldo };
}

const ESPEC = 'ESPECIFICAÇÃO COMPLETA DA IMAGEM: mapa do Brasil em projeção simples, com as cinco regiões em cores distintas; rótulos em português com o nome de cada região dentro dela; rosa dos ventos no canto superior direito; escala gráfica no canto inferior esquerdo; sem textos além dos rótulos.';
const questaoSimulada = (body) => {
  const alvo = body.gabaritoAlvo || 'A';
  const diverge = /DIVERGE/.test(body.tema || '');
  const imagem = body.recurso === 'imagem';
  return {
    question: {
      area: 'humanas', disciplina: 'História', tema: body.tema || 't', dificuldade: body.dificuldade || 'Médio',
      textoBase: 'Em 1943, a Consolidação das Leis do Trabalho reuniu a legislação trabalhista brasileira.',
      comando: 'A medida descrita no texto relaciona-se à', gabarito: alvo,
      alternativas: { A: 'ampliação de direitos trabalhistas.', B: 'abertura do mercado externo.', C: 'redução do papel do Estado.', D: 'extinção dos sindicatos urbanos.', E: 'expansão do voto feminino.' },
      analiseAlternativas: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map((L, i) => [L, { status: L === alvo || (diverge && L === (alvo === 'A' ? 'B' : 'A')) ? 'correta' : 'incorreta', comentario: 'x' }])),
      resolucaoComentada: 'r', competencia: 'C3', habilidade: 'H11', objetoConhecimento: 'o',
      fonte: { tipoUso: 'proprio', autor: '', instituicao: '', obra: '', referencia: '', comoVerificou: 'texto autoral', conferidoNaFonte: false },
      visual: imagem ? { tipo: 'imagem', descricao: 'Mapa do Brasil', promptImagem: ESPEC } : null,
      recurso: body.recurso || 'nenhum',
    },
    uso: { chamadas: 1, entradaNova: 1, cacheEscrito: 0, cacheLido: 0, saida: 1, buscasWeb: 0, custoUSD: 0.01 },
    fontesDiag: { aplicavel: true, estado: 'aprovado', validacao: { estado: 'ia_autoral', libera: true } },
  };
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.addInitScript((f) => { window.__fake = f; }, { session: SESSAO });
  // saldoQueOAppVe: vale para UMA consulta (simula o saldo gasto em outra aba depois dela)
  await p.exposeFunction('__saldoDoBanco', () => { const s = banco.saldoQueOAppVe == null ? banco.saldo : banco.saldoQueOAppVe; banco.saldoQueOAppVe = null; return { ok: true, ilimitado: banco.ilimitado, saldo: s, proxima_validade: '2027-10-13T12:00:00Z' }; });
  const erros = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  // erros do console, menos o registro do navegador das respostas 402/403/422 que o teste simula de propósito
  p.on('console', m => { if(m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (402|403|422)/.test(m.text())) erros.push('console.error: ' + m.text()); });
  const pedidos = [];   // todos os POST a generate-question, com o corpo
  const imagens = [];
  let atraso = 150, falhaFonteUmaVez = new Set(), imagemFalha = true, atrasoImagem = 50;
  await p.route('**/*', async r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    for(const [trecho, arquivo] of LIBS) if(u.includes(trecho)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '..', 'robo', 'libs_locais', arquivo)) });
    if(u.includes('/functions/v1/generate-question')){
      const body = r.request().postDataJSON() || {};
      pedidos.push(body);
      const resp = (status, obj) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) }).catch(() => {});
      if(body.devolverCredito) return resp(200, { creditos: { ...devolver(body.cobrancaId), cobranca: body.cobrancaId } });
      if(body.confirmarCredito){
        const c = banco.cob.get(body.cobrancaId) === 'devolvido' ? cobrar(body.cobrancaId) : { ok: true, cobrado: false, saldo: banco.saldo };
        if(!c.ok) return resp(402, { error: 'Seus créditos acabaram.', code: 'sem_creditos', creditos: { saldo: 0 } });
        return resp(200, { creditos: { ...c, cobranca: body.cobrancaId } });
      }
      if(body.planejarRecortes || body.regenerarVisual) return resp(200, {});
      const c = cobrar(body.cobrancaId);
      if(!c.ok) return resp(402, { error: 'Seus créditos acabaram. Compre um pacote de créditos para continuar gerando questões.', code: 'sem_creditos', creditos: { cobranca: body.cobrancaId, cobrado: false, saldo: 0 } });
      await sleep(atraso);
      if(falhaFonteUmaVez.has(body.tema)){
        falhaFonteUmaVez.delete(body.tema);
        const dev = c.cobrado ? devolver(body.cobrancaId) : null;   // o servidor devolve o que não entregou
        return resp(422, { error: 'fonte bloqueada', fontesDiag: { estado: 'bloqueado_antes_da_geracao', fontesTentadas: [{ url: 'https://exemplo.org/a' }] }, creditos: { cobranca: body.cobrancaId, cobrado: false, devolvido: !!(dev && dev.devolvido), saldo: banco.saldo } });
      }
      return resp(200, { ...questaoSimulada(body), creditos: { cobranca: body.cobrancaId, ilimitado: !!c.ilimitado, cobrado: !!c.cobrado, saldo: c.saldo } });
    }
    if(u.includes('/functions/v1/generate-image')){
      imagens.push(Date.now());
      await sleep(atrasoImagem);
      if(imagemFalha) return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'fazer login (falha simulada)' }) }).catch(() => {});
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', uso: { segundos: 1, custoUSD: 0.01 } }) }).catch(() => {});
    }
    if(u.includes('/functions/v1/')){ try{ await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }catch(e){} return; }
    try{ await r.fulfill({ status: 204, body: '' }); }catch(e){}
  });

  banco.saldo = 12;
  await p.goto('file://' + INDEX); await sleep(900);

  const prepara = (n, opcoes) => p.evaluate(([n, opcoes]) => {
    window.__toasts = [];
    if(!window.__toastEmbrulhado){
      const original = toast;
      window.toast = function(msg, tipo){ window.__toasts.push({ tipo, msg: String(msg) }); return original(msg, tipo); };
      window.__toastEmbrulhado = true;
    }
    closeModal('creditosModal');
    document.getElementById('formPanel').style.display = '';
    document.getElementById('resultsPanel').style.display = 'none';
    state.area = 'humanas'; state.disciplina = 'História';
    setQty(n);
    const temas = (opcoes && opcoes.temas) || ['Era Vargas', 'Segunda Guerra', 'Primeira Guerra', 'Revolução Francesa', 'Era do Ouro', 'Era do Café', 'Grandes navegações'];
    state.questions.forEach((q, i) => { q.tema = temas[i % temas.length]; q.recurso = (opcoes && opcoes.recurso) || 'nenhum'; q.dificuldade = 'Médio'; q.temaLote = null; q.instrucoesVisual = ''; });
  }, [n, opcoes || null]);
  const geracoes = () => pedidos.filter(x => !x.devolverCredito && !x.confirmarCredito && !x.planejarRecortes && !x.regenerarVisual);
  const devolucoes = () => pedidos.filter(x => x.devolverCredito);
  const tela = () => p.evaluate(() => {
    const m = document.getElementById('creditosModal');
    return {
      botao: document.getElementById('btnCreditos').style.display !== 'none' ? document.getElementById('btnCreditos').textContent.trim() : null,
      janela: m.classList.contains('show'),
      aviso: document.getElementById('creditosAviso').classList.contains('show') ? document.getElementById('creditosAviso').textContent : '',
      saldo: document.getElementById('creditosSaldo').textContent,
      validade: document.getElementById('creditosValidade').textContent,
      form: document.getElementById('formPanel').style.display !== 'none',
      status: state.questions.map(q => q.status), msgs: state.questions.map(q => q.errorMsg || ''),
      toasts: (window.__toasts || []).map(t => t.msg),
    };
  });

  /* ---------- A. botão e janela ---------- */
  let t = await tela();
  ok(t.botao === '12 créditos', 'A1 logado: o topo mostra "12 créditos"', JSON.stringify(t.botao));
  await p.click('#btnCreditos'); await sleep(300);
  t = await tela();
  const pacotes = await p.$$eval('#creditosPacotes .pacote', els => els.map(e => e.innerText.replace(/\s+/g, ' ').trim()));
  ok(t.janela && t.saldo === '12' && t.validade.includes('13/10/2027') && !t.aviso, 'A2 a janela mostra o saldo (12) e a validade dos créditos mais antigos', JSON.stringify(t));
  ok(pacotes.length === 4
    && pacotes[0].includes('50') && pacotes[0].includes('R$ 150') && pacotes[0].includes('R$ 3,00 por questão')
    && pacotes[1].includes('100') && pacotes[1].includes('R$ 270') && pacotes[1].includes('R$ 2,70 por questão') && pacotes[1].includes('10% a menos')
    && pacotes[2].includes('200') && pacotes[2].includes('R$ 500') && pacotes[2].includes('R$ 2,50 por questão') && pacotes[2].includes('17% a menos')
    && pacotes[3].includes('400') && pacotes[3].includes('R$ 800') && pacotes[3].includes('R$ 2,00 por questão') && pacotes[3].includes('33% a menos') && pacotes[3].includes('Menor preço por questão'),
    'A3 os 4 pacotes com preço, preço por questão e desconto', JSON.stringify(pacotes));
  const nAntesClique = pedidos.length;
  await p.click('#creditosPacotes .pacote:nth-child(2)'); await sleep(150);
  const compra = await p.$eval('#creditosCompraAviso', e => ({ show: e.classList.contains('show'), txt: e.textContent }));
  ok(compra.show && compra.txt.includes('100 créditos') && compra.txt.includes('fica pronta em breve') && pedidos.length === nAntesClique, 'A4 clicar num pacote só avisa que a compra fica pronta em breve (nada é cobrado)', JSON.stringify(compra));
  // celular: a janela cabe sem rolagem lateral
  await p.setViewportSize({ width: 375, height: 760 }); await sleep(250);
  const cel = await p.evaluate(() => ({ larg: document.documentElement.scrollWidth, box: document.querySelector('#creditosModal .modal-box').getBoundingClientRect().right }));
  ok(cel.larg <= 375 && cel.box <= 375, 'A5 no celular (375 px) a janela cabe sem rolagem lateral', JSON.stringify(cel));
  await p.setViewportSize({ width: 1280, height: 900 }); await sleep(150);
  await p.click('#btnFecharCreditos'); await sleep(150);
  ok(!(await tela()).janela, 'A6 o ✕ fecha a janela');

  /* ---------- B. sem saldo para o simulado inteiro ---------- */
  banco.saldo = 3;
  await prepara(5);
  const nB = pedidos.length;
  await p.evaluate(() => iniciarGeracao()); await sleep(600);
  t = await tela();
  ok(t.janela && t.aviso.includes('Este simulado tem 5 questões e você tem 3 créditos') && t.form && pedidos.length === nB,
    'B1 5 questões com 3 créditos: a janela abre com o aviso, o formulário fica e nada é pedido ao servidor', JSON.stringify({ aviso: t.aviso, form: t.form, pedidos: pedidos.length - nB }));
  ok(t.botao === '3 créditos', 'B2 o topo mostra o saldo atualizado (3 créditos)', t.botao);

  /* ---------- C. geração normal ---------- */
  banco.saldo = 10;
  await prepara(4);
  falhaFonteUmaVez = new Set(['Segunda Guerra']);
  const nC = pedidos.length;
  await p.evaluate(() => generateAll());
  t = await tela();
  const pedC = pedidos.slice(nC).filter(x => !x.devolverCredito && !x.planejarRecortes);
  const ids = await p.evaluate(() => state.questions.map(q => q.cobrancaId));
  const daSegunda = pedC.filter(x => x.tema === 'Segunda Guerra');
  ok(t.status.every(s => s === 'done') && new Set(ids).size === 4 && ids.every(id => /^q-[0-9a-f-]{36}$/.test(id)),
    'C1 todas prontas, cada questão com o seu identificador (q-<uuid>)', JSON.stringify({ st: t.status, ids }));
  ok(daSegunda.length === 2 && daSegunda[0].cobrancaId === daSegunda[1].cobrancaId && daSegunda[0].cobrancaId === ids[1],
    'C2 a retentativa automática (fonte bloqueada) manda o MESMO identificador', JSON.stringify(daSegunda.map(x => x.cobrancaId)));
  ok(pedC.every(x => x.motivoCredito === 'questao'), 'C3 motivo "questao" em todos os pedidos da leva');
  ok(banco.saldo === 6 && t.botao === '6 créditos' && pedidos.slice(nC).filter(x => x.devolverCredito).length === 0,
    'C4 4 questões entregues = 4 créditos (10 → 6), sem nenhuma devolução, e o topo acompanha', JSON.stringify({ saldo: banco.saldo, botao: t.botao }));

  /* ---------- D. o saldo acaba no meio ---------- */
  banco.saldo = 2; banco.saldoQueOAppVe = 10;   // gastou em outra aba: o app ainda acha que tem 10
  await prepara(4);
  const nD = pedidos.length;
  await p.evaluate(() => generateAll());
  banco.saldoQueOAppVe = null;
  t = await tela();
  const prontasD = t.status.filter(s => s === 'done').length;
  const semCreditoD = t.msgs.filter(m => m.startsWith('Seus créditos acabaram antes desta questão')).length;
  ok(prontasD === 2 && semCreditoD === 2 && t.status.filter(s => s === 'error').length === 2, 'D1 2 créditos para 4 questões: 2 prontas e 2 marcadas "Seus créditos acabaram…"', JSON.stringify(t.status));
  ok(t.janela && t.aviso.includes('Seus créditos acabaram durante a geração'), 'D2 a janela de créditos abre com o aviso', t.aviso);
  ok(t.toasts.some(x => x.startsWith('Seus créditos acabaram: 2 de 4 questões ficaram prontas')) && !t.toasts.some(x => x.startsWith('Simulado gerado')), 'D3 aviso na tela, e nada de "Simulado gerado!"', JSON.stringify(t.toasts));
  await sleep(500);
  ok(pedidos.slice(nD).filter(x => x.devolverCredito).length === 0 && banco.saldo === 0, 'D4 nada é devolvido pelas que não foram cobradas (saldo 0)', JSON.stringify({ dev: pedidos.slice(nD).filter(x => x.devolverCredito).length, saldo: banco.saldo }));
  ok(t.botao === '0 créditos' && await p.$eval('#btnCreditos', e => e.classList.contains('vazio')), 'D5 o topo mostra "0 créditos" em destaque');
  const cardsD = await p.$$eval('#questionResults .status-line', els => els.filter(e => e.textContent.includes('Seus créditos acabaram antes desta questão')).length);
  ok(cardsD === 2, 'D6 os cartões das 2 questões paradas explicam o motivo', String(cardsD));

  /* ---------- E. questão que chega mas não pode ser entregue ---------- */
  banco.saldo = 5;
  await prepara(2, { temas: ['Era Vargas', 'DIVERGE Revolução'] });
  const nE = pedidos.length;
  await p.evaluate(() => generateAll());
  await sleep(600);
  t = await tela();
  const idE = await p.evaluate(() => state.questions[1].cobrancaId);
  const devE = pedidos.slice(nE).filter(x => x.devolverCredito);
  ok(t.status[0] === 'done' && t.status[1] === 'error' && t.msgs[1].includes('marca 2 alternativa'), 'E1 a questão com gabarito divergente vira erro', JSON.stringify(t.msgs));
  ok(devE.length === 1 && devE[0].cobrancaId === idE && /^erro no app/.test(devE[0].motivo) && banco.cob.get(idE) === 'devolvido' && banco.saldo === 4,
    'E2 o app pede a devolução dela (o mesmo identificador) e o crédito volta (5 → 4, não 3)', JSON.stringify({ devE, saldo: banco.saldo }));

  /* ---------- F. Regenerar ---------- */
  const idAntigo = await p.evaluate(() => state.questions[0].cobrancaId);
  const nF = pedidos.length;
  await p.evaluate(() => regenerarQuestaoEArquivar(state.questions[0]));
  const pedF = pedidos.slice(nF).filter(x => !x.devolverCredito);
  const idNovo = await p.evaluate(() => state.questions[0].cobrancaId);
  ok(pedF.length === 1 && pedF[0].cobrancaId === idNovo && idNovo !== idAntigo && pedF[0].motivoCredito === 'refazer' && banco.saldo === 3,
    'F1 "Regenerar" numa questão pronta: identificador novo, motivo "refazer", cobra 1', JSON.stringify({ pedF, saldo: banco.saldo }));
  const nF2 = pedidos.length;
  await p.evaluate(() => regenerarQuestaoEArquivar(state.questions[1]));
  ok(pedidos.slice(nF2)[0] && pedidos.slice(nF2)[0].motivoCredito === 'questao', 'F2 "Regenerar" numa questão com erro: motivo "questao"');
  await sleep(600);   // a devolução desta (gabarito divergente de novo) chega antes de zerar o saldo
  banco.saldo = 0;
  await p.evaluate(() => closeModal('creditosModal'));
  const nF3 = pedidos.length;
  await p.evaluate(() => regenerarQuestaoEArquivar(state.questions[0]));
  t = await tela();
  ok(t.janela && t.aviso.includes('você precisa de 1 crédito') && pedidos.length === nF3 && t.status[0] === 'done',
    'F3 sem saldo: "Regenerar" abre a janela, não pede nada e a questão continua como estava', JSON.stringify({ aviso: t.aviso, pedidos: pedidos.length - nF3, st: t.status[0] }));

  /* ---------- G. imagem ---------- */
  banco.saldo = 5; imagemFalha = true;
  await prepara(1, { temas: ['Regiões do Brasil'], recurso: 'imagem' });
  const nG = pedidos.length;
  await p.evaluate(() => generateAll());
  await sleep(800);
  t = await tela();
  const idG = await p.evaluate(() => state.questions[0].cobrancaId);
  ok(t.status[0] === 'error' && t.msgs[0].startsWith('Imagem obrigatória NÃO gerada') && banco.cob.get(idG) === 'devolvido' && banco.saldo === 5
    && pedidos.slice(nG).filter(x => x.devolverCredito && x.cobrancaId === idG && x.motivo === 'imagem não gerada').length === 1,
    'G1 a imagem não saiu: a questão fica com erro e o crédito volta (saldo 5)', JSON.stringify({ st: t.status, saldo: banco.saldo, est: banco.cob.get(idG) }));
  imagemFalha = false;
  const nG2 = pedidos.length, nImg = imagens.length;
  await p.click('#questionResults .retry-img-btn');
  await p.waitForFunction(() => state.questions[0].status === 'done', null, { timeout: 8000 }).catch(() => {});
  await sleep(300);
  const conf = pedidos.slice(nG2).filter(x => x.confirmarCredito);
  ok(conf.length === 1 && conf[0].cobrancaId === idG && imagens.length === nImg + 1, 'G2 "Tentar novamente": pede para cobrar de novo e só então pede a imagem', JSON.stringify({ conf: conf.length, imagens: imagens.length - nImg }));
  t = await tela();
  ok(t.status[0] === 'done' && banco.cob.get(idG) === 'cobrado' && banco.saldo === 4, 'G3 a imagem saiu: questão pronta e o crédito cobrado (5 → 4)', JSON.stringify({ st: t.status, saldo: banco.saldo }));
  // sem saldo, "Tentar novamente" não pede a imagem
  banco.saldo = 1; imagemFalha = true;
  await prepara(1, { temas: ['Biomas'], recurso: 'imagem' });
  await p.evaluate(() => generateAll());
  await sleep(800);
  banco.saldo = 0;
  await p.evaluate(() => closeModal('creditosModal'));
  const nImg2 = imagens.length;
  // o crédito devolvido foi gasto em outro lugar: a recobrança é recusada
  await p.click('#questionResults .retry-img-btn'); await sleep(500);
  t = await tela();
  ok(t.janela && imagens.length === nImg2 && t.status[0] === 'error', 'G4 sem saldo, "Tentar novamente" abre a janela e não pede a imagem', JSON.stringify({ janela: t.janela, img: imagens.length - nImg2 }));
  // a recobrança passa, mas a imagem falha de novo: o crédito volta outra vez
  banco.saldo = 1; imagemFalha = true;
  await p.evaluate(() => closeModal('creditosModal'));
  const idG5 = await p.evaluate(() => state.questions[0].cobrancaId);
  await p.click('#questionResults .retry-img-btn'); await sleep(900);
  ok(banco.cob.get(idG5) === 'devolvido' && banco.saldo === 1, 'G5 cobrou de novo, a imagem falhou outra vez: o crédito volta (saldo 1)', JSON.stringify({ est: banco.cob.get(idG5), saldo: banco.saldo }));

  /* ---------- H. Interromper geração ---------- */
  banco.saldo = 10; atraso = 2500;
  await prepara(4);
  p.evaluate(() => { window.__fimH = false; generateAll().then(() => { window.__fimH = true; }); });
  await p.waitForFunction(() => state.questions[0].status === 'done', null, { timeout: 10000 });
  await sleep(500);
  const emAndamento = await p.evaluate(() => state.questions.filter(q => q.status === 'generating').map(q => q.cobrancaId));
  const saldoNoClique = banco.saldo;
  await p.click('#btnInterromper');
  await p.waitForFunction(() => window.__fimH === true, null, { timeout: 15000 });
  await sleep(4500);   // o app espera 3 s antes de pedir a devolução de uma interrompida
  ok(emAndamento.length === 3 && saldoNoClique === 6 && emAndamento.every(id => banco.cob.get(id) === 'devolvido') && banco.saldo === 9,
    'H1 interrompida com 3 em andamento (já cobradas): as 3 voltam; fica só a pronta (10 → 9)', JSON.stringify({ emAndamento: emAndamento.length, saldoNoClique, saldo: banco.saldo }));
  atraso = 150;

  /* ---------- I. robô do WhatsApp ---------- */
  banco.saldo = 10;
  await prepara(1);
  const nI = pedidos.length;
  const rI = await p.evaluate(async () => {
    try{
      const r = await enemAutomacao.gerar({ area: 'humanas', disciplina: 'História', quantidade: 3, temas_texto: 'Era Vargas', contagem: { 'Fácil': 1, 'Médio': 1, 'Difícil': 1 }, recurso: 'nenhum', cobrancaBase: 'wa-11111111-1111-4111-8111-111111111111' });
      return { ok: true, prontas: r.prontas, versao: r.versao };
    }catch(e){ return { ok: false, erro: String(e && e.message || e) }; }
  });
  const idsI = pedidos.slice(nI).filter(x => !x.planejarRecortes && !x.devolverCredito).map(x => x.cobrancaId);
  ok(rI.ok && rI.prontas === 3 && rI.versao === '18.46', 'I1 o robô gera o pedido (entrada de automação 18.46)', JSON.stringify(rI));
  ok(['1', '2', '3'].every(n => idsI.includes('wa-11111111-1111-4111-8111-111111111111-' + n)), 'I2 identificadores fixos "wa-<pedido>-1..3"', JSON.stringify(idsI));
  const idsDepois = await p.evaluate(() => automacaoCobrancaBase);
  ok(idsDepois === null, 'I3 depois do pedido, o identificador fixo é esquecido (a tela volta a usar q-<uuid>)');
  banco.saldo = 2;
  const nI4 = pedidos.length;
  const rI4 = await p.evaluate(async () => {
    try{ await enemAutomacao.gerar({ area: 'humanas', disciplina: 'História', quantidade: 3, temas_texto: 'Era Vargas', contagem: { 'Fácil': 1, 'Médio': 1, 'Difícil': 1 }, recurso: 'nenhum', cobrancaBase: 'wa-22222222-2222-4222-8222-222222222222' }); return 'gerou'; }
    catch(e){ return String(e && e.message || e); }
  });
  t = await tela();
  ok(rI4.startsWith('sem créditos: a conta tem 2 créditos e o pedido precisa de 3') && pedidos.length === nI4 && !t.janela,
    'I4 robô sem saldo: erro "sem créditos: …" (o robô não repete), nada pedido e nenhuma janela', JSON.stringify({ rI4, pedidos: pedidos.length - nI4 }));
  await p.evaluate(() => { automacaoFase = 'pronto'; automacaoErro = ''; });

  /* ---------- J. conta sem limite ---------- */
  banco.ilimitado = true; banco.saldo = 0;
  await p.evaluate(() => creditosAtualizar());
  await prepara(2);
  const nJ = pedidos.length;
  await p.evaluate(() => generateAll());
  t = await tela();
  ok(t.botao === 'Créditos: ilimitado' && t.status.every(s => s === 'done') && pedidos.slice(nJ).filter(x => !x.planejarRecortes).length === 2,
    'J1 dono: "Créditos: ilimitado" e gera com saldo zero', JSON.stringify({ botao: t.botao, st: t.status }));
  await p.click('#btnCreditos'); await sleep(200);
  t = await tela();
  ok(t.saldo === 'Ilimitado' && !t.validade, 'J2 a janela do dono mostra "Ilimitado"', JSON.stringify({ saldo: t.saldo, validade: t.validade }));

  /* ---------- K. ---------- */
  ok(erros.length === 0, 'K1 nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
