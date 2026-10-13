/* ===== tela de escolha (raiz do site) ===== */
(() => {
  // Ao escolher, a letra fica marcada por um instante (como no cartão-resposta) e a página abre.
  const menosMovimento = matchMedia('(prefers-reduced-motion: reduce)');
  document.querySelectorAll('.opcao').forEach(a => a.addEventListener('click', e => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button) return;
    e.preventDefault();
    a.classList.add('marcada');
    setTimeout(() => { location.href = a.getAttribute('href'); }, menosMovimento.matches ? 0 : 220);
  }));
  // Voltando pelo botão "voltar" do navegador, a tela aparece de novo sem a letra marcada.
  addEventListener('pageshow', () => document.querySelectorAll('.opcao.marcada').forEach(a => a.classList.remove('marcada')));
})();
