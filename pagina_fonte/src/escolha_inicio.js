/* tela de escolha, no <head>: links antigos da página do professor (ex.: /#planos) seguem para a
   mesma seção em /professor/ antes de a tela aparecer. A volta do login do Google (#access_token=...)
   não está nesta lista e fica na raiz, onde o auth.js recebe a sessão e segue para /app/. */
(() => {
  const SECOES = ['topo', 'gabarito', 'tempo', 'como', 'whatsapp', 'questao', 'diferenciais', 'pessoas', 'limites', 'planos', 'duvidas', 'fim'];
  if (SECOES.includes(location.hash.slice(1))) location.replace('/professor/' + location.search + location.hash);
})();
