/* v18.34 — INGLÊS E ESPANHOL SEPARADOS NO APP (pedido do professor, 02/10/2026).

   Prova, no navegador e com o backend simulado:
     A. em Linguagens, os chips "Inglês" e "Espanhol" aparecem no lugar de
        "Língua Estrangeira (Inglês/Espanhol)";
     B. escolhido "Espanhol" (ou "Inglês"), é esse o nome que vai para o backend em cada
        questão, e os objetos de conhecimento e a calibração são os da Língua Estrangeira;
     C. simulado arquivado com o rótulo antigo: o chip antigo aparece marcado (a tela não
        mostra uma disciplina enquanto o estado guarda outra) e some ao escolher outra.

   Uso: node tests/verify_ingles_espanhol_app.js <caminho absoluto do index.html> */
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
const ANTIGA = 'Língua Estrangeira (Inglês/Espanhol)';

const resposta = (body) => ({
  question: {
    area: 'linguagens', disciplina: body.disciplina, tema: body.tema || 't', dificuldade: body.dificuldade || 'Médio',
    textoBase: 'Los ayuntamientos prueban una semana escolar de cuatro días, y las familias discuten el cambio.\n\nDisponível em: www.exemplo.org.',
    comando: 'No texto, a expressão “semana escolar” refere-se à', gabarito: body.gabaritoAlvo || 'A',
    alternativas: { A: 'organização do calendário das aulas.', B: 'duração do ano letivo completo.', C: 'jornada diária dos professores.', D: 'quantidade de disciplinas do curso.', E: 'frequência das reuniões de pais.' },
    analiseAlternativas: Object.fromEntries(['A', 'B', 'C', 'D', 'E'].map(L => [L, { status: L === (body.gabaritoAlvo || 'A') ? 'correta' : 'incorreta', comentario: 'x' }])),
    resolucaoComentada: 'r', competencia: 'C2', habilidade: 'H6', objetoConhecimento: 'Estudo do texto',
    fonte: { tipoUso: 'proprio', autor: '', instituicao: '', obra: '', referencia: '', comoVerificou: 'texto autoral', conferidoNaFonte: false }, visual: null,
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
  const corpos = [];
  await p.route('**/*', async r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js') || u.includes('jsdelivr')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    if(u.includes('/functions/v1/generate-question')){
      const body = r.request().postDataJSON() || {};
      corpos.push(body);
      if(body.planejarRecortes) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ recortes: [] }) });
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(resposta(body)) });
    }
    if(u.includes('/functions/v1/')) return r.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    return r.fulfill({ status: 204, body: '' });
  });
  await p.goto('file://' + INDEX); await sleep(700);
  const chips = () => p.evaluate(() => Array.from(document.querySelectorAll('#disciplinaChips .chip')).map(c => ({ t: c.textContent.trim(), sel: c.classList.contains('sel'), aria: c.getAttribute('aria-pressed') })));

  /* ---------- A ---------- */
  await p.evaluate(() => selectArea('linguagens'));
  let c = await chips();
  ok(JSON.stringify(c.map(x => x.t)) === JSON.stringify(['Língua Portuguesa', 'Literatura', 'Artes', 'Práticas Corporais', 'Inglês', 'Espanhol']),
     'A1 Linguagens mostra os chips Inglês e Espanhol, e não mais "Língua Estrangeira (Inglês/Espanhol)"', JSON.stringify(c.map(x => x.t)));
  ok(await p.evaluate(() => AREA_META.linguagens.desc.includes('inglês e espanhol')), 'A2 a descrição da área cita inglês e espanhol');

  /* ---------- B ---------- */
  for(const disc of ['Espanhol', 'Inglês']){
    await p.evaluate((d) => { Array.from(document.querySelectorAll('#disciplinaChips .chip')).find(x => x.textContent.trim() === d).click(); }, disc);
    c = await chips();
    ok(c.filter(x => x.sel).length === 1 && c.find(x => x.sel).t === disc && c.find(x => x.t === disc).aria === 'true', `B1 clicar em "${disc}" marca só esse chip`, JSON.stringify(c));
    const B = await p.evaluate((d) => ({ estado: state.disciplina, objetos: objetosDaDisciplina('linguagens', d), antigos: objetosDaDisciplina('linguagens', 'Língua Estrangeira (Inglês/Espanhol)'), cal: JSON.stringify(CALIBRACAO_APP[d]), calAnt: JSON.stringify(CALIBRACAO_APP['Língua Estrangeira (Inglês/Espanhol)']) }), disc);
    ok(B.estado === disc, `B2 o estado guarda "${disc}"`);
    ok(JSON.stringify(B.objetos) === JSON.stringify(B.antigos) && B.objetos.length === 2 && B.cal === B.calAnt, `B3 ${disc}: objetos de conhecimento e calibração iguais aos da Língua Estrangeira`, JSON.stringify(B));
    corpos.length = 0;
    await p.evaluate(() => { setQty(3); state.questions.forEach((q, i) => { q.tema = ['Redes sociais', 'Meio ambiente', 'Educação'][i]; q.recurso = 'nenhum'; q.dificuldade = 'Médio'; }); });
    await p.evaluate(() => generateAll());
    const enviados = corpos.filter(x => !x.planejarRecortes);
    ok(enviados.length === 3 && enviados.every(x => x.disciplina === disc && x.area === 'linguagens'), `B4 as 3 questões vão ao backend como "${disc}"`, JSON.stringify(enviados.map(x => x.disciplina)));
    const resumo = await p.evaluate(() => document.getElementById('resultsSummary').textContent);
    ok(resumo.includes(`· ${disc} ·`), `B5 o resumo do simulado mostra "${disc}"`, resumo);
    await p.evaluate(() => document.getElementById('btnBackToForm').click());
  }

  /* ---------- C ---------- */
  await p.evaluate((ant) => { state.area = 'linguagens'; state.disciplina = ant; renderAreaGrid(); renderDisciplinaChips(); }, ANTIGA);
  c = await chips();
  ok(c.length === 7 && c[6].t === ANTIGA && c[6].sel && c.filter(x => x.sel).length === 1, 'C1 simulado arquivado com o rótulo antigo: o chip antigo aparece, marcado', JSON.stringify(c));
  await p.evaluate(() => { Array.from(document.querySelectorAll('#disciplinaChips .chip')).find(x => x.textContent.trim() === 'Inglês').click(); });
  c = await chips();
  ok(c.length === 6 && !c.some(x => x.t === ANTIGA) && c.find(x => x.sel).t === 'Inglês', 'C2 escolhida outra disciplina, o chip antigo some', JSON.stringify(c));
  await p.evaluate(() => selectArea('humanas'));
  c = await chips();
  ok(JSON.stringify(c.map(x => x.t)) === JSON.stringify(['História', 'Geografia', 'Filosofia', 'Sociologia']), 'C3 as demais áreas não mudam');

  ok(erros.length === 0, 'Z nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
