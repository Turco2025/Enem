/* v18.50: CAMPO "DIFICULDADE" E IMAGEM PRONTA VINDOS DA IA (análise de site, 13/10/2026).

   Prova, no navegador, com o servidor simulado devolvendo uma questão "envenenada":
     M1. dificuldade com marcação HTML não vira código na página (nenhum script roda) e aparece
         como texto;
     M2. a cor do selo só vale para Fácil, Médio ou Difícil;
     M3. uma "imagemDataUrl" que não é imagem em base64 (ex.: um endereço de outro site) é
         descartada e a imagem é pedida ao gerador de imagens;
     M4. uma questão já salva com esses valores também é desenhada sem rodar nada;
     M5. 409 "em_andamento" (trava da cobrança, backend v74.42): o app espera e tenta de novo com o
         MESMO identificador, sem gastar tentativa nem devolver crédito, e a questão sai;
     M6. sem erros de JavaScript.

   Uso: node tests/verify_seguranca_app_v1850.js <caminho absoluto do index.html> */
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
  await p.addInitScript((f) => { window.__fake = f; window.__xss = 0; }, { session: SESSAO });
  await p.exposeFunction('__saldoDoBanco', () => ({ ok: true, ilimitado: banco.ilimitado, saldo: banco.saldo, proxima_validade: '2027-10-13T12:00:00Z' }));
  const erros = [], externos = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  p.on('console', m => { if(m.type() === 'error' && !/^Failed to load resource/.test(m.text())) erros.push('console.error: ' + m.text()); });
  const imagens = [];
  let emAndamento = 0;            // quantos 409 em_andamento devolver antes da questão
  const pedidosGeracao = [];
  const VENENO = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
  await p.route('**/*', async r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    for(const [trecho, arquivo] of LIBS) if(u.includes(trecho)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '..', 'robo', 'libs_locais', arquivo)) });
    const resp = (status, obj) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) }).catch(() => {});
    if(u.includes('/functions/v1/generate-question')){
      const body = r.request().postDataJSON() || {};
      if(body.devolverCredito || body.confirmarCredito) return resp(200, { creditos: { ok: true, cobrado: false, saldo: banco.saldo, cobranca: body.cobrancaId } });
      if(body.planejarRecortes || body.regenerarVisual) return resp(200, {});
      pedidosGeracao.push(body);
      if(emAndamento > 0){ emAndamento--; return resp(409, { error: 'Esta questão ainda está sendo gerada. Aguarde alguns segundos.', code: 'em_andamento', creditos: { cobranca: body.cobrancaId, cobrado: false, saldo: banco.saldo } }); }
      const c = cobrar(body.cobrancaId);
      const q = questaoSimulada(body);
      q.question.dificuldade = VENENO;
      if(q.question.visual) q.question.visual.imagemDataUrl = 'https://exemplo.invalid/rastreador.png';
      return resp(200, { ...q, creditos: { cobranca: body.cobrancaId, cobrado: !!c.cobrado, saldo: c.saldo } });
    }
    if(u.includes('/functions/v1/generate-image')){
      imagens.push(1);
      return resp(200, { imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', uso: { segundos: 1, custoUSD: 0.01 } });
    }
    if(u.includes('/functions/v1/')){ try{ await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }catch(e){} return; }
    if(!u.startsWith('file://') && !u.includes('fonts.')) externos.push(u);
    try{ await r.fulfill({ status: 204, body: '' }); }catch(e){}
  });

  banco.saldo = 10;
  await p.goto('file://' + INDEX); await sleep(900);
  await p.evaluate(() => {
    closeModal('creditosModal');
    state.area = 'humanas'; state.disciplina = 'História';
    setQty(1);
    state.questions.forEach(q => { q.tema = 'Regiões do Brasil'; q.recurso = 'imagem'; q.dificuldade = 'Médio'; q.temaLote = null; q.instrucoesVisual = ''; });
  });
  await p.evaluate(() => generateAll());
  await p.waitForFunction(() => state.questions[0].status === 'done', null, { timeout: 8000 }).catch(() => {});
  await sleep(600);
  const e1 = await p.evaluate(() => {
    const card = document.querySelector('#questionResults');
    const badge = card ? [...card.querySelectorAll('.badge')][0] : null;
    return {
      status: state.questions[0].status, xss: window.__xss,
      imgsNoSelo: badge ? badge.querySelectorAll('img').length : -1,
      textoDoSelo: badge ? badge.textContent : null, classe: badge ? badge.className : null,
      imagem: (state.questions[0].data.visual || {}).imagemDataUrl || '',
      imgsRastreador: [...document.querySelectorAll('img')].filter(i => (i.getAttribute('src') || '').includes('exemplo.invalid')).length,
    };
  });
  ok(e1.xss === 0 && e1.imgsNoSelo === 0 && e1.textoDoSelo.includes('<img src=x'), 'M1 dificuldade com marcação aparece como texto e nenhum script roda', JSON.stringify(e1));
  ok(e1.classe === 'badge', 'M2 valor fora da lista não vira classe de cor', JSON.stringify(e1.classe));
  ok(e1.imgsRastreador === 0 && imagens.length === 1 && e1.imagem.startsWith('data:image/png;base64,'), 'M3 endereço externo no lugar da imagem é descartado e a imagem vem do gerador', JSON.stringify({ img: imagens.length, rastreador: e1.imgsRastreador, imagem: e1.imagem.slice(0, 30) }));

  // M4. questão salva com os mesmos valores, desenhada de novo (como ao reabrir um simulado)
  const e4 = await p.evaluate(() => {
    const data = JSON.parse(JSON.stringify(state.questions[0].data));
    data.dificuldade = '<svg onload="window.__xss=(window.__xss||0)+1"></svg>';
    const el = buildQuestionBody(data, state.questions[0]);
    document.body.appendChild(el);
    return { xss: window.__xss, svgs: el.querySelectorAll('svg[onload]').length };
  });
  await sleep(300);
  const xssDepois = await p.evaluate(() => window.__xss);
  ok(xssDepois === 0 && e4.svgs === 0, 'M4 questão salva com marcação na dificuldade é desenhada sem rodar nada', JSON.stringify({ e4, xssDepois }));
  // M5. trava da cobrança: 2 respostas 409 em_andamento antes da questão
  emAndamento = 2;
  const nG = pedidosGeracao.length;
  await p.evaluate(() => {
    ESPERA_EM_ANDAMENTO_MS = 50;   // o app espera 10 s; aqui, 50 ms
    closeModal('creditosModal');
    document.getElementById('formPanel').style.display = '';
    document.getElementById('resultsPanel').style.display = 'none';
    setQty(1);
    state.questions.forEach(q => { q.tema = 'Biomas'; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; q.temaLote = null; q.instrucoesVisual = ''; });
  });
  await p.evaluate(() => generateAll());
  await p.waitForFunction(() => state.questions[0].status === 'done' || state.questions[0].status === 'error', null, { timeout: 8000 }).catch(() => {});
  const e5 = await p.evaluate(() => ({ status: state.questions[0].status, msg: state.questions[0].errorMsg || '', id: state.questions[0].cobrancaId, devolvido: !!state.questions[0].creditoDevolvido }));
  const ids5 = pedidosGeracao.slice(nG).map(x => x.cobrancaId);
  ok(e5.status === 'done' && ids5.length === 3 && ids5.every(i => i === e5.id) && !e5.devolvido, 'M5 409 em_andamento: o app espera, repete com o mesmo identificador e a questão sai', JSON.stringify({ e5, ids5 }));
  ok(erros.length === 0, 'M6 nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
