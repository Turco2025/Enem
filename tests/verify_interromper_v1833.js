/* v18.33 — BOTÃO "INTERROMPER GERAÇÃO" (pedido do professor, 02/10/2026).

   Prova, no navegador e com o backend simulado (cada questão demora 1,5 s):
     A. o botão só aparece enquanto a leva está sendo gerada;
     B. ao clicar, nenhuma questão nova é pedida ao servidor, os pedidos em andamento
        são cancelados, as prontas ficam e as demais ficam marcadas como interrompidas;
     C. o resumo e os avisos dizem a verdade ("prontas · interrompidas"; nada de
        "Simulado gerado!"), e o botão some no fim;
     D. "Regenerar" depois da interrupção funciona normalmente;
     E. uma leva sem interrupção segue igual (todas prontas, "Simulado gerado!");
     F. imagens: a leva interrompida não tenta de novo nem pede imagem nova.

   Uso: node tests/verify_interromper_v1833.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(){ return { data: [{ vinculado: false }], error: null }; },
  from(){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: null, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

const questaoSimulada = (body) => ({
  question: {
    area: 'humanas', disciplina: 'História', tema: body.tema || 't', dificuldade: body.dificuldade || 'Médio',
    textoBase: 'Em 1943, a Consolidação das Leis do Trabalho reuniu a legislação trabalhista brasileira.',
    comando: 'A medida descrita no texto relaciona-se à', gabarito: body.gabaritoAlvo || 'A',
    alternativas: { A: 'ampliação de direitos trabalhistas.', B: 'abertura do mercado externo.', C: 'redução do papel do Estado.', D: 'extinção dos sindicatos urbanos.', E: 'expansão do voto feminino.' },
    analiseAlternativas: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(L => [L, { status: L === (body.gabaritoAlvo || 'A') ? 'correta' : 'incorreta', comentario: 'x' }])),
    resolucaoComentada: 'r', competencia: 'C3', habilidade: 'H11', objetoConhecimento: 'o',
    fonte: { tipoUso: 'proprio', autor: '', instituicao: '', obra: '', referencia: '', comoVerificou: 'texto autoral', conferidoNaFonte: false },
    visual: null,
  },
  uso: { chamadas: 1, entradaNova: 1, cacheEscrito: 0, cacheLido: 0, saida: 1, buscasWeb: 0, custoUSD: 0.01 },
  fontesDiag: { aplicavel: true, estado: 'aprovado', validacao: { estado: 'ia_autoral', libera: true } },
});

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  await p.addInitScript((f) => { window.__fake = f; }, { session: SESSAO });
  const erros = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  const pedidos = { questao: [], imagem: [] };
  let atrasoQuestao = 1500, atrasoImagem = 1500;
  await p.route('**/*', async r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js') || u.includes('jsdelivr')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if(u.includes('/functions/v1/generate-question')){
      const body = r.request().postDataJSON() || {};
      pedidos.questao.push({ t: Date.now(), tema: body.tema, planejar: !!body.planejarRecortes });
      await sleep(atrasoQuestao);
      try{ await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(questaoSimulada(body)) }); }catch(e){ /* pedido cancelado pelo app */ }
      return;
    }
    if(u.includes('/functions/v1/generate-image')){
      pedidos.imagem.push({ t: Date.now() });
      await sleep(atrasoImagem);
      try{ await r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'falha simulada' }) }); }catch(e){ /* cancelado */ }
      return;
    }
    if(u.includes('/functions/v1/')){ try{ await r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }); }catch(e){} return; }
    try{ await r.fulfill({ status: 204, body: '' }); }catch(e){}
  });
  await p.goto('file://' + INDEX); await sleep(700);

  const prepara = (n) => p.evaluate((n) => {
    window.__toasts = [];
    if(!window.__toastEmbrulhado){
      const original = toast;
      window.toast = function(msg, tipo){ window.__toasts.push({ tipo, msg: String(msg) }); return original(msg, tipo); };
      window.__toastEmbrulhado = true;
    }
    state.area = 'humanas'; state.disciplina = 'História';
    document.querySelectorAll('.area-tile').forEach(t => t.classList.toggle('active', t.dataset.area === 'humanas'));
    setQty(n);
    const temas = ['Era Vargas', 'Segunda Guerra', 'Primeira Guerra', 'Revolução Francesa', 'Era do Ouro', 'Era do Café', 'Grandes navegações'];
    state.questions.forEach((q, i) => { q.tema = temas[i % temas.length]; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; q.temaLote = null; });
  }, n);
  const estado = () => p.evaluate(() => {
    const btn = document.getElementById('btnInterromper');
    return {
      visivel: !!btn && !btn.classList.contains('hidden') && getComputedStyle(btn).display !== 'none',
      desativado: !!btn && btn.disabled, texto: btn ? btn.textContent.trim() : '',
      status: state.questions.map(q => q.status), msgs: state.questions.map(q => q.errorMsg || ''),
      resumo: document.getElementById('resultsSummary').textContent,
      toasts: (window.__toasts || []).map(t => t.msg),
      cardsInterrompidos: Array.from(document.querySelectorAll('#questionResults .status-line')).filter(s => s.textContent.includes('⏹️ Geração interrompida pelo professor')).length,
    };
  });

  /* ---------- A. o botão só aparece durante a geração ---------- */
  await prepara(7);
  let e = await estado();
  ok(!e.visivel, 'A1 antes de gerar, o botão "Interromper geração" não aparece', JSON.stringify(e));
  ok(await p.evaluate(() => !!document.getElementById('btnInterromper') && document.getElementById('btnInterromper').closest('.results-toolbar') !== null),
     'A2 o botão fica na barra do painel "Simulado gerado"');
  p.evaluate(() => { window.__fim = false; generateAll().then(() => { window.__fim = true; }); });
  await sleep(500);
  e = await estado();
  ok(e.visivel && !e.desativado && e.texto === '⏹️ Interromper geração', 'A3 durante a geração o botão aparece, ativo, com o texto "Interromper geração"', JSON.stringify(e));

  /* ---------- B. interromper no meio ---------- */
  await p.waitForFunction(() => state.questions[0].status === 'done', null, { timeout: 10000 });
  await sleep(400);   // as demais (5 em paralelo) estão em andamento no servidor simulado
  const antes = pedidos.questao.length;
  const emAndamento = await p.evaluate(() => state.questions.filter(q => q.status === 'generating').length);
  await p.click('#btnInterromper');
  await sleep(100);
  e = await estado();
  ok(emAndamento >= 1, 'B1 havia questões em andamento no momento do clique', String(emAndamento));
  ok(e.status[0] === 'done' && e.status.slice(1).every(s => s === 'error'), 'B2 a questão pronta ficou; todas as outras pararam na hora', JSON.stringify(e.status));
  ok(e.msgs.slice(1).every(m => m.startsWith('Geração interrompida pelo professor')), 'B3 as paradas dizem que foram interrompidas pelo professor (e não "The operation was aborted")', JSON.stringify(e.msgs));
  await sleep(3500);
  ok(pedidos.questao.length === antes, 'B4 depois do clique nenhuma questão nova foi pedida ao servidor', `${antes} → ${pedidos.questao.length}`);
  await p.waitForFunction(() => window.__fim === true, null, { timeout: 15000 });
  e = await estado();
  ok(e.status[0] === 'done' && e.status.slice(1).every(s => s === 'error') && e.msgs.slice(1).every(m => m.startsWith('Geração interrompida pelo professor')),
     'B5 as respostas que chegariam depois do cancelamento não mudaram nada', JSON.stringify(e.status));

  /* ---------- C. resumo, avisos e o botão no fim ---------- */
  ok(e.resumo.includes('1/7 prontas · 6 interrompida(s)'), 'C1 o resumo diz quantas ficaram prontas e quantas foram interrompidas', e.resumo);
  ok(e.toasts.some(t => t.startsWith('Geração interrompida: 1 de 7 questão(ões) pronta(s); 6 ficaram marcadas')) && !e.toasts.some(t => t.startsWith('Simulado gerado')),
     'C2 aviso de interrupção, e nada de "Simulado gerado!"', JSON.stringify(e.toasts));
  ok(!e.visivel, 'C3 terminada a leva, o botão some', JSON.stringify(e));
  ok(e.cardsInterrompidos === 6, 'C4 os cartões das 6 questões mostram "⏹️ Geração interrompida pelo professor…"', String(e.cardsInterrompidos));

  /* ---------- D. Regenerar depois da interrupção ---------- */
  const nAntesRegen = pedidos.questao.length;
  await p.evaluate(() => generateQuestion(state.questions[3]));
  e = await estado();
  ok(e.status[3] === 'done' && pedidos.questao.length === nAntesRegen + 1, 'D1 "Regenerar" depois da interrupção gera a questão normalmente', JSON.stringify(e.status));
  ok(e.resumo.includes('2/7 prontas · 5 interrompida(s)'), 'D2 o resumo acompanha a questão regenerada', e.resumo);

  /* ---------- E. leva sem interrupção ---------- */
  atrasoQuestao = 300;
  await prepara(4);
  await p.evaluate(() => generateAll());
  e = await estado();
  ok(e.status.every(s => s === 'done') && e.resumo.includes('4/4 concluídas') && !e.resumo.includes('interrompida'), 'E1 leva sem interrupção: todas prontas e o resumo de antes', e.resumo);
  ok(e.toasts.some(t => t.startsWith('Simulado gerado')) && !e.toasts.some(t => t.startsWith('Geração interrompida')), 'E2 aviso "Simulado gerado!" como antes', JSON.stringify(e.toasts));
  ok(!e.visivel, 'E3 o botão some no fim da leva');
  await p.click('#btnInterromper', { force: true, timeout: 1000 }).catch(() => {});
  e = await estado();
  ok(e.status.every(s => s === 'done'), 'E4 sem leva em curso, o botão (escondido) não muda nenhuma questão');

  /* ---------- F. imagens ---------- */
  atrasoImagem = 1200;
  const nImg0 = pedidos.imagem.length;
  const F = await p.evaluate(async () => {
    const q = state.questions[0];
    const run = { controller: new AbortController(), interrompida: false, emAndamento: true };
    const promessa = gerarImagemComRetentativas('ESPECIFICAÇÃO COMPLETA DA IMAGEM: um mapa do Brasil com as capitais', q, run).then(() => 'ok', (err) => (err && err.interrompida ? 'interrompida: ' : 'erro: ') + (err && err.message));
    await new Promise(r => setTimeout(r, 300));
    run.interrompida = true; run.controller.abort();
    const r1 = await promessa;
    const r2 = await gerarImagemComRetentativas('x', q, { controller: new AbortController(), interrompida: true, emAndamento: true }).then(() => 'ok', (err) => (err && err.interrompida ? 'interrompida' : 'erro'));
    return { r1, r2 };
  });
  await sleep(1500);
  ok(F.r1.startsWith('interrompida: Geração interrompida pelo professor antes da imagem obrigatória'), 'F1 imagem em andamento: o pedido é cancelado e a mensagem é a da interrupção', F.r1);
  ok(pedidos.imagem.length - nImg0 === 1, 'F2 a imagem cancelada não é pedida de novo (nenhuma retentativa)', String(pedidos.imagem.length - nImg0));
  ok(F.r2 === 'interrompida', 'F3 com a leva já interrompida, nenhuma imagem nova é pedida');
  ok(await p.evaluate(async () => { const feitos = []; await runPool([1, 2, 3, 4, 5], async (x) => { feitos.push(x); }, 2, () => feitos.length >= 2); return feitos.length === 2; }),
     'F4 runPool para de começar itens quando deveParar() fica verdadeiro');

  ok(erros.length === 0, 'Z nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
