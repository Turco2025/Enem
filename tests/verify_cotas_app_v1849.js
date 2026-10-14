/* v18.49: COTA DO USO GRÁTIS NO APP (verificação de segurança de 13/10/2026).

   Prova, no navegador, com o Supabase e o servidor simulados (as regras do banco têm o próprio
   teste, tests/verify_cotas_banco_v1849.sh, e as do servidor, tests/verify_cotas_servidor_v1849.ts):
     L1. o pedido de imagem leva o identificador da questão cobrada (cobrancaId);
     L2. o "Refazer" de imagem/gráfico/tabela leva o mesmo identificador;
     L3. imagem recusada pela cota (402 sem_creditos): o app NÃO repete o pedido e a questão
         fica com erro mostrando o motivo;
     L4. "Refazer" recusado pela cota: a janela de créditos abre e a questão continua como estava;
     L5. limite do dia (429 limite_diario): também não repete;
     L6. sem erros de JavaScript.

   Uso: node tests/verify_cotas_app_v1849.js <caminho absoluto do index.html> */
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
  await p.exposeFunction('__saldoDoBanco', () => ({ ok: true, ilimitado: banco.ilimitado, saldo: banco.saldo, proxima_validade: '2027-10-13T12:00:00Z' }));
  const erros = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  p.on('console', m => { if(m.type() === 'error' && !/^Failed to load resource: the server responded with a status of (402|403|422|429)/.test(m.text())) erros.push('console.error: ' + m.text()); });
  const pedidos = [], imagens = [];
  let imagemModo = 'ok', visualModo = 'ok';
  await p.route('**/*', async r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    for(const [trecho, arquivo] of LIBS) if(u.includes(trecho)) return r.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(path.join(__dirname, '..', 'robo', 'libs_locais', arquivo)) });
    const resp = (status, obj) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(obj) }).catch(() => {});
    if(u.includes('/functions/v1/generate-question')){
      const body = r.request().postDataJSON() || {};
      pedidos.push(body);
      if(body.devolverCredito) return resp(200, { creditos: { ...devolver(body.cobrancaId), cobranca: body.cobrancaId } });
      if(body.confirmarCredito) return resp(200, { creditos: { ok: true, cobrado: false, saldo: banco.saldo, cobranca: body.cobrancaId } });
      if(body.planejarRecortes) return resp(200, {});
      if(body.regenerarVisual){
        if(visualModo === 'sem_creditos') return resp(402, { error: 'Refazer imagem, gráfico ou tabela é grátis para as questões que você gera. Para continuar, é preciso ter créditos.', code: 'sem_creditos' });
        return resp(200, { visual: { tipo: 'imagem', descricao: 'Mapa do Brasil (refeito)', promptImagem: ESPEC }, uso: { custoUSD: 0.01 } });
      }
      const c = cobrar(body.cobrancaId);
      if(!c.ok) return resp(402, { error: 'Seus créditos acabaram.', code: 'sem_creditos', creditos: { cobranca: body.cobrancaId, cobrado: false, saldo: 0 } });
      await sleep(100);
      return resp(200, { ...questaoSimulada(body), creditos: { cobranca: body.cobrancaId, cobrado: !!c.cobrado, saldo: c.saldo } });
    }
    if(u.includes('/functions/v1/generate-image')){
      const body = r.request().postDataJSON() || {};
      imagens.push(body);
      await sleep(50);
      if(imagemModo === 'sem_creditos') return resp(402, { error: 'A imagem é grátis para as questões que você gera. Para continuar, é preciso ter créditos.', code: 'sem_creditos' });
      if(imagemModo === 'limite_diario') return resp(429, { error: 'Você chegou ao limite de 20 imagens grátis por dia fora das questões geradas agora. Tente de novo amanhã.', code: 'limite_diario' });
      return resp(200, { imageDataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', uso: { segundos: 1, custoUSD: 0.01 } });
    }
    if(u.includes('/functions/v1/')){ try{ await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }catch(e){} return; }
    try{ await r.fulfill({ status: 204, body: '' }); }catch(e){}
  });

  banco.saldo = 10;
  await p.goto('file://' + INDEX); await sleep(900);
  const prepara = (n, tema) => p.evaluate(([n, tema]) => {
    closeModal('creditosModal');
    document.getElementById('formPanel').style.display = '';
    document.getElementById('resultsPanel').style.display = 'none';
    state.area = 'humanas'; state.disciplina = 'História';
    setQty(n);
    state.questions.forEach(q => { q.tema = tema; q.recurso = 'imagem'; q.dificuldade = 'Médio'; q.temaLote = null; q.instrucoesVisual = ''; });
  }, [n, tema]);
  const estado = () => p.evaluate(() => ({
    id: state.questions[0].cobrancaId, status: state.questions[0].status, msg: state.questions[0].errorMsg || '',
    janela: document.getElementById('creditosModal').classList.contains('show'),
    temImagem: !!(state.questions[0].data && state.questions[0].data.visual && state.questions[0].data.visual.imagemDataUrl),
  }));

  /* L1. geração com imagem */
  await prepara(1, 'Regiões do Brasil');
  await p.evaluate(() => generateAll());
  await p.waitForFunction(() => state.questions[0].status === 'done', null, { timeout: 8000 }).catch(() => {});
  let e = await estado();
  ok(e.status === 'done' && imagens.length === 1 && imagens[0].cobrancaId === e.id && /^q-/.test(e.id), 'L1 o pedido de imagem leva o identificador da questão cobrada', JSON.stringify({ e, img: imagens.map(x => x.cobrancaId) }));

  /* L2. "Refazer" do recurso visual */
  const nP = pedidos.length, nI = imagens.length;
  await p.click('#questionResults .visual-redo-btn');
  await sleep(1200);
  const redo = pedidos.slice(nP).filter(x => x.regenerarVisual);
  ok(redo.length === 1 && redo[0].cobrancaId === e.id && imagens.length === nI + 1 && imagens[nI].cobrancaId === e.id,
    'L2 "Refazer" leva o identificador da questão, no pedido do recurso e no da imagem nova', JSON.stringify({ redo: redo.map(x => x.cobrancaId), img: imagens.slice(nI).map(x => x.cobrancaId), id: e.id }));

  /* L3. imagem recusada pela cota: sem repetição */
  imagemModo = 'sem_creditos';
  await prepara(1, 'Biomas');
  const nI3 = imagens.length;
  await p.evaluate(() => generateAll());
  await p.waitForFunction(() => state.questions[0].status === 'error', null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  e = await estado();
  ok(e.status === 'error' && imagens.length === nI3 + 1 && e.msg.includes('é preciso ter créditos'), 'L3 imagem recusada pela cota (402): 1 pedido só, sem repetir, e a questão mostra o motivo', JSON.stringify({ tentativas: imagens.length - nI3, e }));

  /* L4. "Refazer" recusado pela cota: abre a janela de créditos */
  imagemModo = 'ok'; visualModo = 'sem_creditos';
  await prepara(1, 'Clima');
  await p.evaluate(() => generateAll());
  await p.waitForFunction(() => state.questions[0].status === 'done', null, { timeout: 8000 }).catch(() => {});
  await p.evaluate(() => closeModal('creditosModal'));
  const nI4 = imagens.length;
  await p.click('#questionResults .visual-redo-btn'); await sleep(800);
  e = await estado();
  ok(e.janela && imagens.length === nI4 && e.status === 'done' && e.temImagem, 'L4 "Refazer" recusado pela cota: a janela de créditos abre e a questão continua como estava', JSON.stringify({ e, img: imagens.length - nI4 }));

  /* L5. limite do dia: sem repetição */
  visualModo = 'ok'; imagemModo = 'limite_diario';
  await p.evaluate(() => closeModal('creditosModal'));
  await prepara(1, 'Relevo');
  const nI5 = imagens.length;
  await p.evaluate(() => generateAll());
  await p.waitForFunction(() => state.questions[0].status === 'error', null, { timeout: 8000 }).catch(() => {});
  await sleep(500);
  e = await estado();
  ok(e.status === 'error' && imagens.length === nI5 + 1 && e.msg.includes('limite'), 'L5 limite do dia (429): 1 pedido só, sem repetir', JSON.stringify({ tentativas: imagens.length - nI5, msg: e.msg }));

  ok(erros.length === 0, 'L6 nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
