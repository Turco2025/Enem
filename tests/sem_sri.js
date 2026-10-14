// v18.50 — cópia de teste SEM a impressão digital (integrity/SRI) das bibliotecas externas.
//
// O app e as páginas conferem o integrity do supabase-js, do Chart.js, do jsPDF e do docx: o
// navegador só executa o arquivo se os bytes forem exatamente os do pacote oficial. Vários testes
// antigos trocam o supabase-js por um supabase-js FALSO (para simular login sem rede); com o
// integrity, o navegador recusaria esse falso. Para esses testes, este arquivo gera uma cópia do
// index.html sem os atributos integrity/crossorigin e sem as impressões digitais de CDN_SRI,
// ou seja, exatamente o comportamento de antes da v18.50. O index.html de verdade (com integrity)
// é conferido por tests/verify_sri_bibliotecas_v1850.js e pelo ensaio do robô (robo/teste_local.mjs).
//
// Uso:
//   node tests/verify_raiz.js "$(node tests/sem_sri.js index.html)"
//   require('./sem_sri').semSriNaPasta(pasta)   // todos os .html de uma pasta (testes das páginas)
const fs = require('fs'), os = require('os'), path = require('path');

const ATRIBUTOS = /\s+integrity="sha384-[A-Za-z0-9+\/=]+"\s+crossorigin="anonymous"/g;
const IMPRESSOES = /"sha384-[A-Za-z0-9+\/=]+"/g;

function semSri(html) {
  return html.replace(ATRIBUTOS, '').replace(IMPRESSOES, '""');
}

function semSriNaPasta(pasta) {
  for (const nome of fs.readdirSync(pasta, { withFileTypes: true })) {
    const f = path.join(pasta, nome.name);
    if (nome.isDirectory()) semSriNaPasta(f);
    else if (nome.name.endsWith('.html')) fs.writeFileSync(f, semSri(fs.readFileSync(f, 'utf8')));
  }
}

function copiaSemSri(index) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sem-sri-'));
  const destino = path.join(dir, 'index.html');
  fs.writeFileSync(destino, semSri(fs.readFileSync(index, 'utf8')));
  return destino;
}

module.exports = { semSri, semSriNaPasta, copiaSemSri };

if (require.main === module) {
  const index = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
  process.stdout.write(copiaSemSri(index));
}
