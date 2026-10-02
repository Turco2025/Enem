/* v18.32 — ORIGEM DO MATERIAL NOS MODOS DA IA (backend v74.31).

   História, Geografia, Filosofia, Sociologia, Práticas Corporais e Língua
   Estrangeira, sem texto na biblioteca, usam o conhecimento da própria IA, sem
   internet: texto-base autoral com dados reais (estado "ia_autoral") ou paráfrase
   com referência (estado "ia_parafrase"). Este teste prova que a auditoria local
   do card diz isso — e NÃO "Fonte validada pelo agente validador" —, e que os
   avisos dos estados antigos não mudaram.

   Uso: node tests/verify_ordem_ia_app.js <caminho absoluto do index.html> */
const { chromium } = require('playwright');
const INDEX = process.argv[2];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const STUB = `window.supabase={createClient(){return{auth:{onAuthStateChange(fn){setTimeout(()=>fn('INITIAL_SESSION',null),0);return{data:{subscription:{unsubscribe(){}}}}},async getSession(){return{data:{session:null}}},async signOut(){return{error:null}}},async rpc(){return{data:null,error:null}},from(){const q={select(){return q},order(){return q},eq(){return q},insert(){return q},update(){return q},upsert(){return q},single(){return Promise.resolve({data:null,error:null})},then(r){r({data:[],error:null})}};return q}}}};`;
let total = 0, falhas = 0;
function ok(c, msg, extra){ if(c){ total++; console.log('PASS ' + msg); } else { falhas++; console.log('FAIL ' + msg + (extra ? '\n     ' + extra : '')); } }

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

  const textos = (v) => p.evaluate((val) => {
    const q = { status: 'done', validacaoFonte: val,
      data: { area: 'humanas', disciplina: 'História', tema: 't', textoBase: 'tb', comando: 'cmd', gabarito: 'B',
        alternativas: { A: 'aa', B: 'bb', C: 'cc', D: 'dd', E: 'ee' },
        analiseAlternativas: { A: { status: 'incorreta', comentario: 'x' }, B: { status: 'correta', comentario: 'x' }, C: { status: 'incorreta', comentario: 'x' }, D: { status: 'incorreta', comentario: 'x' }, E: { status: 'incorreta', comentario: 'x' } },
        resolucaoComentada: 'r' } };
    return auditaQuestaoLocal(q).map(i => i.nivel + ': ' + i.texto).join('\n');
  }, v);

  const aut = await textos({ estado: 'ia_autoral', libera: true, motivo: 'tema sem autor nem obra pedidos e sem texto na biblioteca' });
  ok(aut.includes('info: Texto-base autoral com dados reais') && aut.includes('sem pesquisa na internet e sem citar ninguém') && aut.includes('(tema sem autor nem obra pedidos e sem texto na biblioteca)')
     && !aut.includes('agente validador'), 'A1 texto autoral da IA: a tela diz de onde veio, e não fala em validador', aut);
  const par = await textos({ estado: 'ia_parafrase', libera: true, motivo: 'm' });
  ok(par.includes('info: Fonte: conhecimento da própria IA, sem pesquisa na internet') && par.includes('sem citação literal') && !par.includes('agente validador'),
     'A2 paráfrase da IA: a tela diz conhecimento da IA, referência só com dados certos e sem citação literal', par);
  const val = await textos({ estado: 'aprovado', libera: true, nivel: 'A', suporte: 'direto', confianca: 'alta', fonteAberta: true, rodada: 1 });
  ok(val.includes('Fonte validada pelo agente validador · nível A'), 'A3 fonte da internet aprovada pelo validador: aviso de antes, sem mudança', val);
  const enem = await textos({ estado: 'aprovado_enem', libera: true });
  ok(enem.includes('banco de textos das provas oficiais do ENEM'), 'A4 texto da biblioteca: aviso de antes, sem mudança', enem);
  const rep = await textos({ estado: 'reprovado', libera: false, motivo: 'x' });
  ok(rep.includes('aviso: Fonte não validada pelo agente validador: x'), 'A5 reprovado: aviso de antes, sem mudança', rep);
  ok(erros.length === 0, 'Z nenhum erro de JavaScript na página', erros.join(' | '));
  await b.close();
  console.log(`\n${total} verificações passaram, ${falhas} falharam.`);
  process.exit(falhas ? 1 : 0);
})();
