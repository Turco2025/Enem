/* v18.31 — "[object Object]" LOGO ABAIXO DA REFERÊNCIA.

   Desde o backend v74.8 o campo "fonte" da questão é o REGISTRO da verificação
   ({ tipoUso, autor, obra, referencia, ... }). PDF, Word e impressão faziam
   String(fonte) e imprimiam "[object Object]" no lugar da referência, com a
   referência verdadeira saindo como parágrafo comum logo acima. Este teste
   prova que:
   · o registro nunca é impresso (nem "[object Object]", nem uma 2ª referência);
   · a referência do fim do texto-base sai UMA vez, no tratamento de referência
     (itálico, à direita), também nas da biblioteca do professor;
   · questões antigas (fonte em texto, ou sem fonte) saem exatamente como antes.

   Uso: node tests/verify_referencia_objeto.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STUB = `window.supabase={createClient(){return{auth:{onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',null),0);return{data:{subscription:{unsubscribe(){}}}}},async getSession(){return{data:{session:null}}},async signOut(){return{error:null}}},async rpc(){return{data:null,error:null}},from(){const q={select(){return q},order(){return q},eq(){return q},insert(){return q},update(){return q},upsert(){return q},single(){return Promise.resolve({data:null,error:null})},then(r){r({data:[],error:null})}};return q}}}};`;
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

const REF_FUVEST = 'Olavo Bilac. Poesias. Trecho reproduzido na prova da Fuvest 1980.';
const TB_FUVEST = '"Ora (direis) ouvir estrelas! Certo\nPerdeste o senso!" E eu vos direi, no entanto,\n' + REF_FUVEST;
const REG_FUVEST = { tipoUso: 'citacao', autor: 'Olavo Bilac', instituicao: '', obra: 'Poesias', referencia: REF_FUVEST, comoVerificou: 'biblioteca', conferidoNaFonte: true };
const REF_ABNT = 'ASSIS, Machado de. Dom Casmurro. Rio de Janeiro: Garnier, 1899.';
const TB_ABNT = 'Tudo acaba, leitor; é um velho truísmo.\n' + REF_ABNT;
const REG_ABNT = { tipoUso: 'citacao', autor: 'Machado de Assis', instituicao: '', obra: 'Dom Casmurro', referencia: REF_ABNT, comoVerificou: 'c', conferidoNaFonte: true };

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const erros = [];
  p.on('pageerror', e => erros.push('pageerror: ' + e.message));
  await p.route('**/*', r => {
    const u = r.request().url();
    if(u.startsWith('file://')) return r.continue();
    if(u.includes('supabase-js') || u.includes('jsdelivr')) return r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB });
    return r.fulfill({ status: 204, body: '' });
  });
  await p.goto('file://' + INDEX); await sleep(500);

  const imprime = (tb, fonte) => p.evaluate(([t, f]) => { const out = []; enemPrintTextoBase(out, t, f); return out; }, [tb, fonte]);
  const corpo = out => out.filter(l => l.startsWith('<p class="corpo">'));
  const refs = out => out.filter(l => l.includes('class="ref ref-texto"'));
  const semObjeto = out => !out.join('\n').includes('[object Object]');

  /* ---------- (A) impressão / HTML ---------- */
  let o = await imprime(TB_FUVEST, REG_FUVEST);
  ok(semObjeto(o), 'A1 biblioteca do professor: "[object Object]" não aparece', JSON.stringify(o));
  ok(refs(o).length === 1 && refs(o)[0].includes('Trecho reproduzido na prova da Fuvest 1980'),
     'A2 a referência da prova sai UMA vez, como referência (itálico, à direita)', JSON.stringify(o));
  ok(corpo(o).length === 2 && !corpo(o).join('').includes('Trecho reproduzido'),
     'A3 a referência não sai também como parágrafo do texto', JSON.stringify(o));

  o = await imprime(TB_ABNT, REG_ABNT);
  ok(semObjeto(o) && refs(o).length === 1 && refs(o)[0].includes('Dom Casmurro') && corpo(o).length === 1,
     'A4 referência ABNT com o registro: uma referência, sem "[object Object]"', JSON.stringify(o));

  o = await imprime('Situação hipotética redigida para a questão.\nSegundo parágrafo da situação.',
                    { tipoUso: 'proprio', autor: '', instituicao: '', obra: '', referencia: '', comoVerificou: '', conferidoNaFonte: false });
  ok(semObjeto(o) && refs(o).length === 0 && corpo(o).length === 2,
     'A5 texto próprio: nenhuma referência inventada, nenhum parágrafo perdido', JSON.stringify(o));

  o = await imprime('Primeiro parágrafo do texto.\nÚltimo parágrafo do texto, sem ser referência.', REG_FUVEST);
  ok(semObjeto(o) && refs(o).length === 0 && corpo(o).length === 2,
     'A6 registro com referência que não está no texto: nada é acrescentado nem tirado', JSON.stringify(o));

  o = await imprime(TB_ABNT, undefined);
  ok(refs(o).length === 1 && refs(o)[0].includes('Dom Casmurro') && corpo(o).length === 1,
     'A7 questão antiga sem "fonte": detecção pelo padrão ABNT, como antes', JSON.stringify(o));

  o = await imprime('Texto antigo.', 'ANDRADE, Carlos Drummond de. Alguma poesia. 1930.');
  ok(refs(o).length === 1 && refs(o)[0].includes('Alguma poesia') && corpo(o).length === 1,
     'A8 questão antiga com "fonte" em texto: vale como antes', JSON.stringify(o));

  o = await imprime(REF_FUVEST, REG_FUVEST);
  ok(corpo(o).length === 1 && refs(o).length === 0,
     'A9 texto-base de um parágrafo só: nunca é tirado do corpo', JSON.stringify(o));

  /* ---------- (B) questão inteira na impressão ---------- */
  const q = { status: 'done', data: {
    area: 'linguagens', disciplina: 'Literatura', tema: 't', textoBase: TB_FUVEST, fonte: REG_FUVEST,
    comando: 'No poema, o eu lírico', gabarito: 'B',
    alternativas: { A: 'aa', B: 'bb', C: 'cc', D: 'dd', E: 'ee' },
  } };
  const secao = await p.evaluate((qq) => enemPrintQuestao({ q: qq, idx: 0 }), q);
  ok(!secao.includes('[object Object]') && (secao.match(/Trecho reproduzido na prova da Fuvest 1980/g) || []).length === 1,
     'B1 a questão impressa inteira: sem "[object Object]" e com a referência uma vez', secao.slice(0, 400));

  /* ---------- (C) PDF e Word pela mesma regra ---------- */
  const pdf = await p.evaluate(([t, f]) => {
    const orig = { par: window.enemParagraph, cap: window.enemCaption };
    const reg = { par: [], cap: [] };
    window.enemParagraph = (doc, ctx, flow, par) => reg.par.push(par);
    window.enemCaption = (doc, ctx, flow, ref, opt) => reg.cap.push({ ref, opt });
    try { enemTextoBase({}, {}, {}, t, f); } finally { window.enemParagraph = orig.par; window.enemCaption = orig.cap; }
    return reg;
  }, [TB_FUVEST, REG_FUVEST]);
  ok(pdf.cap.length === 1 && String(pdf.cap[0].ref).includes('Fuvest 1980') && pdf.cap[0].opt.italic && pdf.cap[0].opt.align === 'right'
     && pdf.par.length === 2 && !JSON.stringify(pdf).includes('[object Object]'),
     'C1 PDF: a referência sai uma vez, em itálico à direita, sem "[object Object]"', JSON.stringify(pdf));

  const docx = await p.evaluate(([t, f]) => {
    const orig = { par: window.enemDocxParagraph, cap: window.enemDocxCaption };
    const reg = { par: [], cap: [] };
    window.enemDocxParagraph = (par) => { reg.par.push(par); return []; };
    window.enemDocxCaption = (ref, opt) => { reg.cap.push({ ref, opt }); return []; };
    try { enemDocxTextoBase(t, f); } finally { window.enemDocxParagraph = orig.par; window.enemDocxCaption = orig.cap; }
    return reg;
  }, [TB_FUVEST, REG_FUVEST]);
  ok(docx.cap.length === 1 && String(docx.cap[0].ref).includes('Fuvest 1980') && docx.cap[0].opt.italic
     && docx.par.length === 2 && !JSON.stringify(docx).includes('[object Object]'),
     'C2 Word: a referência sai uma vez, em itálico, sem "[object Object]"', JSON.stringify(docx));

  /* ---------- (D) a conferência de notação lê a referência, não o objeto ---------- */
  const campos = await p.evaluate((qq) => quiCamposDaQuestao(qq, 0), q);
  const campoRef = campos.find(c => c.rotulo === 'referência');
  ok(campoRef && campoRef.texto === REF_FUVEST && !JSON.stringify(campos).includes('[object Object]'),
     'D1 a conferência de notação confere a referência do registro', JSON.stringify(campoRef));

  /* ---------- (E) nenhuma outra leitura de "fonte" como texto ---------- */
  const fonteApp = await p.evaluate(() => [enemTextoBase, enemPrintTextoBase, enemDocxTextoBase].map(f => f.toString()).join('\n'));
  ok(!/String\(fonte/.test(fonteApp) && (fonteApp.match(/enemSeparaReferencia\(pars, fonte\)/g) || []).length === 3,
     'E1 as três saídas (PDF, impressão, Word) usam a mesma separação da referência');

  ok(erros.length === 0, 'Z sem erros de página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
