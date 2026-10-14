/* ===== login e cadastro na página inicial =====
   A mesma conta do aplicativo (Supabase Auth): Google ou e-mail e senha. A página e o app
   ficam no mesmo endereço (a página na raiz, o app em /app/), então o login feito aqui já
   vale lá. Depois de entrar, a pessoa vai para /app/. Logado, o menu mostra "Abrir o app".
   ?entrar abre a janela na aba Entrar (é para onde o app manda quem chega sem login);
   ?cadastrar abre na aba Cadastrar. Sem o supabase-js (prévia, arquivo local), a janela
   abre mas avisa que o login só funciona no site publicado. */
(() => {
  // o supabase-js vem com defer: ele só existe no DOMContentLoaded
  const iniciar = () => {
  const SUPABASE_URL = 'https://gkceyrkdmnhgqimmrsre.supabase.co';
  const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_-s4dLevKftQzX-aOJyKfMw_u5c_JzLV';
  const APP = '/app/';
  const $ = s => document.querySelector(s);
  const caixa = $('#auth');
  if (!caixa) return;
  const msg = $('#authMsg');
  const formLogin = $('#formLogin'), formCadastro = $('#formCadastro');
  const params = new URLSearchParams(location.search);
  // volta do Google ou do e-mail de confirmação: o Supabase devolve a sessão na URL
  const voltouDoLogin = /access_token=|refresh_token=/.test(location.hash) || params.has('code');
  let sb = null;
  try {
    if (window.supabase && /^https?:$/.test(location.protocol)) sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  } catch (e) { console.error('[login] supabase:', e); }

  let focoAntes = null;
  function aba(qual) {
    const login = qual !== 'cadastro';
    $('#abaLogin').setAttribute('aria-selected', login);
    $('#abaCadastro').setAttribute('aria-selected', !login);
    formLogin.hidden = !login; formCadastro.hidden = login;
    msg.hidden = true;
  }
  function abrir(qual) {
    focoAntes = document.activeElement;
    aba(qual);
    caixa.hidden = false;
    document.documentElement.classList.add('auth-aberta');
    setTimeout(() => { const f = (qual === 'cadastro' ? formCadastro : formLogin).querySelector('input'); if (f) f.focus(); }, 30);
  }
  function fechar() {
    caixa.hidden = true;
    document.documentElement.classList.remove('auth-aberta');
    if (focoAntes && focoAntes.focus) focoAntes.focus();
  }
  function mostra(texto, tipo) { msg.textContent = texto; msg.dataset.tipo = tipo || 'erro'; msg.hidden = false; }
  function traduz(err) {
    const m = String((err && err.message) || err || '');
    // v18.51: senha recusada pelo Supabase (proteção contra senhas vazadas, plano Pro)
    const motivos = (err && Array.isArray(err.reasons)) ? err.reasons : [];
    if (motivos.includes('pwned') || /known to be weak|easy to guess|pwned/i.test(m)) return 'Essa senha já apareceu em vazamentos de dados na internet e é fácil de adivinhar. Escolha outra senha.';
    if (err && err.code === 'weak_password' && !motivos.includes('length')) return 'Essa senha é fraca. Escolha uma senha mais longa e difícil de adivinhar.';
    if (/invalid login credentials/i.test(m)) return 'E-mail ou senha incorretos.';
    if (/email not confirmed/i.test(m)) return 'Confirme o seu e-mail antes de entrar. O link chegou na sua caixa de entrada.';
    if (/already registered|already exists/i.test(m)) return 'Já existe uma conta com este e-mail. Use a aba Entrar.';
    if (/password should be at least/i.test(m)) return 'A senha precisa ter pelo menos 6 caracteres.';
    if (/invalid email|unable to validate email/i.test(m)) return 'E-mail inválido.';
    if (/failed to fetch|network/i.test(m)) return 'Sem conexão com o servidor. Confira a internet e tente de novo.';
    return m || 'Não foi possível concluir. Tente novamente.';
  }
  const semServidor = () => { mostra('Prévia: o login funciona no site publicado.'); return true; };
  const irParaApp = () => { location.href = APP; };
  function marcaLogado(sessao) { document.documentElement.classList.toggle('logado', !!sessao); }

  document.querySelectorAll('[data-auth]').forEach(b => b.addEventListener('click', () => abrir(b.dataset.auth)));
  caixa.querySelectorAll('[data-aba]').forEach(b => b.addEventListener('click', () => aba(b.dataset.aba)));
  caixa.querySelectorAll('[data-fechar]').forEach(b => b.addEventListener('click', fechar));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !caixa.hidden) fechar(); });

  async function enviando(form, fn) {
    const btn = form.querySelector('button[type="submit"]');
    btn.disabled = true; msg.hidden = true;
    try { await fn(); } catch (err) { mostra(traduz(err)); } finally { btn.disabled = false; }
  }
  formLogin.addEventListener('submit', e => {
    e.preventDefault();
    const email = $('#loginEmail').value.trim(), senha = $('#loginSenha').value;
    if (!email || !senha) return mostra('Preencha e-mail e senha.');
    if (!sb) return semServidor();
    enviando(formLogin, async () => {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha });
      if (error) throw error;
      irParaApp();
    });
  });
  formCadastro.addEventListener('submit', e => {
    e.preventDefault();
    const email = $('#cadastroEmail').value.trim(), senha = $('#cadastroSenha').value;
    if (!email || !senha) return mostra('Preencha e-mail e senha.');
    if (senha.length < 6) return mostra('A senha precisa ter pelo menos 6 caracteres.');
    if (!sb) return semServidor();
    enviando(formCadastro, async () => {
      const { data, error } = await sb.auth.signUp({ email, password: senha, options: { emailRedirectTo: location.origin + '/' } });
      if (error) throw error;
      if (data && data.session) return irParaApp();
      mostra('Conta criada! Enviamos um link para ' + email + '. Clique nele para confirmar e você entra direto no app.', 'ok');
    });
  });
  $('#authGoogle').addEventListener('click', async () => {
    if (!sb) return semServidor();
    try {
      // volta para a raiz (o endereço que o login do Supabase já aceita hoje); a página segue para /app/
      const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + '/' } });
      if (error) throw error;
    } catch (err) { mostra(traduz(err)); }
  });

  if (sb) {
    sb.auth.onAuthStateChange((_ev, sessao) => marcaLogado(sessao));
    sb.auth.getSession().then(({ data }) => {
      const sessao = data && data.session;
      marcaLogado(sessao);
      if (sessao && (voltouDoLogin || params.has('entrar') || params.has('cadastrar'))) return irParaApp();
      if (params.has('entrar')) abrir('login');
      else if (params.has('cadastrar')) abrir('cadastro');
    }).catch(e => console.error('[login] sessão:', e));
  } else if (params.has('entrar') || params.has('cadastrar')) {
    abrir(params.has('cadastrar') ? 'cadastro' : 'login');
  }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
})();
