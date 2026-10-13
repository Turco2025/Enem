/* v18.47 — A CAIXA "AUDITORIA LOCAL" SÓ APARECE NA CONTA DO DONO (13/10/2026).

   Decisão do professor: "A auditoria local continua funcionando, no entanto eu não quero que
   apareça para o usuário" → escolheu "Só eu vejo". Prova, no navegador, com o Supabase e o
   servidor simulados:
     A. professor comum (com créditos): a auditoria roda e a caixa está no cartão, mas não aparece;
     B. dono (saldo "ilimitado"): a caixa aparece;
     C. o saldo do dono chega DEPOIS de o cartão ser desenhado: a caixa aparece sem redesenhar;
     D. saiu da conta: a caixa some de novo;
     E. o resto do cartão (resolução comentada) continua aparecendo para todos; sem erros.

   Uso: node tests/verify_auditoria_dono_v1847.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SESSAO = { access_token: 'tok.teste', user: { id: '52e6a6ea-b394-4958-8294-06ff2f5091de', email: 'prof@exemplo.com' } };
const STUB = `window.supabase = { createClient(){ const f = window.__fake; return {
  auth: { onAuthStateChange(fn){ window.__authCb = fn; setTimeout(() => fn('INITIAL_SESSION', f.session), 0); return { data: { subscription: { unsubscribe(){} } } }; }, async getSession(){ return { data: { session: f.session } }; }, async signOut(){ return { error: null }; } },
  async rpc(nome){ if(nome === 'creditos_meu_saldo') return { data: await window.__saldoDoBanco(), error: null }; return { data: [{ vinculado: false }], error: null }; },
  from(){ const q = { select(){ return q; }, order(){ return q; }, eq(){ return q; }, insert(){ return q; }, update(){ return q; }, upsert(){ return q; }, single(){ return Promise.resolve({ data: { id: 'simulado-teste' }, error: null }); }, then(r){ r({ data: [], error: null }); } }; return q; } }; } };`;
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

const questao = (body) => ({
  question: {
    area: 'humanas', disciplina: 'História', tema: body.tema || 't', dificuldade: 'Médio',
    textoBase: 'Em 1943, a Consolidação das Leis do Trabalho reuniu a legislação trabalhista brasileira.',
    comando: 'A medida descrita no texto relaciona-se à', gabarito: body.gabaritoAlvo || 'A',
    alternativas: { A: 'ampliação de direitos trabalhistas.', B: 'abertura do mercado externo.', C: 'redução do papel do Estado.', D: 'extinção dos sindicatos urbanos.', E: 'expansão do voto feminino.' },
    analiseAlternativas: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(L => [L, { status: L === (body.gabaritoAlvo || 'A') ? 'correta' : 'incorreta', comentario: 'x' }])),
    resolucaoComentada: 'Resolução de teste.', competencia: 'C3', habilidade: 'H11', objetoConhecimento: 'o',
    fonte: { tipoUso: 'proprio', autor: '', instituicao: '', obra: '', referencia: '', comoVerificou: 'texto autoral', conferidoNaFonte: false },
    visual: null,
  },
  uso: { chamadas: 1, entradaNova: 1, cacheEscrito: 0, cacheLido: 0, saida: 1, buscasWeb: 0, custoUSD: 0.01 },
  creditos: { cobranca: body.cobrancaId, cobrado: true, saldo: 9 },
});

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const conta = { ilimitado: false, atraso: 0 };
  await p.addInitScript((f) => { window.__fake = f; }, { session: SESSAO });
  await p.exposeFunction('__saldoDoBanco', async () => { if(conta.atraso) await sleep(conta.atraso); return { ok: true, ilimitado: conta.ilimitado, saldo: conta.ilimitado ? 0 : 12, proxima_validade: null }; });
  const erros = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  await p.route('**/*', async r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if(u.includes('/functions/v1/generate-question')){
      const body = r.request().postDataJSON() || {};
      if(body.planejarRecortes) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(questao(body)) });
    }
    if(u.includes('/functions/v1/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.fulfill({ status: 204, body: '' });
  });
  await p.goto('file://' + INDEX); await sleep(900);

  const gera = () => p.evaluate(async () => {
    state.area = 'humanas'; state.disciplina = 'História';
    setQty(2);
    state.questions.forEach((q, i) => { q.tema = ['Era Vargas', 'Segunda Guerra'][i]; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; q.temaLote = null; });
    await generateAll();
  });
  const caixa = () => p.evaluate(() => {
    const els = Array.from(document.querySelectorAll('#questionResults .auditoria-local'));
    return {
      n: els.length,
      visiveis: els.filter(e => e.offsetParent !== null && getComputedStyle(e).display !== 'none').length,
      texto: els.map(e => e.textContent.replace(/\s+/g, ' ').trim()),
      naTela: /auditoria local/i.test(document.getElementById('questionResults').innerText),   // o rótulo sai em caixa alta na tela
      resolucao: document.getElementById('questionResults').innerText.includes('Resolução de teste.'),
      dona: document.body.classList.contains('conta-dona'),
      prontas: state.questions.filter(q => q.status === 'done').length,
    };
  });

  /* ---------- A. professor comum ---------- */
  await gera();
  let c = await caixa();
  ok(c.prontas === 2 && c.n === 2 && c.texto.every(t => t.startsWith('Auditoria local (sem custo)')), 'A1 a auditoria roda: cada cartão tem a sua caixa no código da página', JSON.stringify(c));
  ok(c.visiveis === 0 && !c.naTela && !c.dona, 'A2 professor comum: a caixa não aparece na tela', JSON.stringify(c));
  ok(c.resolucao, 'A3 a resolução comentada continua aparecendo');

  /* ---------- B. dono ---------- */
  conta.ilimitado = true;
  await p.evaluate(() => creditosAtualizar());
  c = await caixa();
  ok(c.dona && c.visiveis === 2 && c.naTela, 'B1 dono (ilimitado): a caixa aparece nos 2 cartões', JSON.stringify(c));

  /* ---------- C. saldo do dono chega depois do cartão ---------- */
  await p.evaluate(() => { creditos = { carregado: false, ilimitado: false, saldo: null, proximaValidade: null }; creditosPinta(); });
  ok(!(await caixa()).dona && (await caixa()).visiveis === 0, 'C1 enquanto o saldo não chega, a caixa fica escondida');
  conta.atraso = 600;
  await gera();
  const antes = await caixa();
  await p.evaluate(() => creditosAtualizar());
  conta.atraso = 0;
  c = await caixa();
  const mesmosCartoes = await p.evaluate(() => { const els = document.querySelectorAll('#questionResults .qcard'); return els.length; });
  ok(c.visiveis === 2 && mesmosCartoes === 2, 'C2 o saldo "ilimitado" chegou depois: a caixa aparece sem redesenhar os cartões', JSON.stringify({ antes: antes.visiveis, depois: c.visiveis }));

  /* ---------- D. saiu da conta ---------- */
  await p.evaluate(() => { window.__authCb('SIGNED_OUT', null); });
  await sleep(200);
  c = await caixa();
  ok(!c.dona && c.visiveis === 0, 'D1 depois de sair da conta, a caixa some', JSON.stringify(c));

  ok(erros.length === 0, 'E1 nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
