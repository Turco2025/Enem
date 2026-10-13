#!/usr/bin/env python3
"""Gera as três páginas do site do Gera Enem (pasta pagina/) a partir destas fontes.

  pagina/index.html            /            tela de escolha: Aluno ou Professor (com Entrar e Cadastrar)
  pagina/professor/index.html  /professor/  página do professor
  pagina/aluno/index.html      /aluno/      página do aluno

As fontes ficam em src/: style.css (visual das três), escolha.css (só a tela de escolha),
body.html (professor), body_aluno.html (aluno), escolha.html (tela de escolha), app.js (efeitos
das páginas do professor e do aluno; o aluno é marcado com <html data-pagina="aluno">),
escolha.js e escolha_inicio.js (tela de escolha), auth.js (login e cadastro, nas três),
sheet.py (o cartão-resposta da seção 2) e favicon.txt. As imagens e os vídeos ficam em
pagina/assets/; as páginas em subpasta usam ../assets/.

O login (Google e link do e-mail de confirmação) sempre volta para a raiz, o endereço já liberado
no Supabase; a tela de escolha tem o auth.js e segue para /app/. O app manda quem chega sem login
para /?entrar, que abre a janela de login na própria tela de escolha.

Uso (de qualquer diretório):  python3 pagina_fonte/montar.py
"""
from pathlib import Path
import re
import sys

AQUI = Path(__file__).resolve().parent
PAGINA = AQUI.parent / 'pagina'
ORIGEM = 'https://simuladorenem159753.netlify.app'
sys.path.insert(0, str(AQUI / 'src'))
sys.dont_write_bytecode = True
import sheet  # noqa: E402


def ler(nome):
    return (AQUI / 'src' / nome).read_text(encoding='utf-8')


css = ler('style.css')
auth = ler('auth.js')
fav = ler('favicon.txt').strip()
FONTES = '''<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Carlito:wght@400;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap">'''
SUPABASE = '<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" defer></script>\n'


def pagina(*, html_attr, titulo, descricao, og_desc, caminho, estilo, corpo, scripts, cabeca_js=''):
    head = f'''<title>{titulo}</title>
<meta name="description" content="{descricao}">
<meta name="theme-color" content="#0F1C2B">
<link rel="icon" href="{fav}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Gera Enem">
<meta property="og:title" content="{titulo}">
<meta property="og:description" content="{og_desc}">
<meta property="og:image" content="{ORIGEM}/assets/og.jpg">
<meta property="og:url" content="{ORIGEM}{caminho}">
<meta name="twitter:card" content="summary_large_image">
{FONTES}
<script>document.documentElement.lang='pt-BR';</script>
{cabeca_js}<style>
{estilo}</style>
{SUPABASE}'''
    return ('<!doctype html>\n<html lang="pt-BR"' + html_attr + '>\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + head +
            '</head>\n<body>\n' + corpo + '\n<script>\n' + scripts + '</script>\n</body>\n</html>\n')


def em_subpasta(html):
    """páginas em /professor/ e /aluno/: assets/... vira ../assets/... (em src, poster, url() e no JS)"""
    return re.sub(r'(?<=["\'(])assets/', '../assets/', html)


def corpo_com_cartao(nome):
    b = ler(nome).replace('<!--SHEET-->', sheet.build())
    assert '<!--SHEET-->' not in b
    return b


# a janela de login é a mesma nas três páginas: vem do body.html do professor
prof_body = corpo_com_cartao('body.html')
ini = prof_body.index('<!-- login e cadastro:')
fim = prof_body.index('<div class="toast"', ini)
janela_login = prof_body[ini:fim].rstrip() + '\n'

app_js = ler('app.js')
saidas = {
    'index.html': pagina(
        html_attr=' data-pagina="escolha"',
        titulo='Gera Enem',
        descricao='Gera Enem: simulados no padrão do ENEM para estudantes e professores. Questões inéditas com gráfico, cinco alternativas, gabarito conferido e resolução comentada.',
        og_desc='Seu tema. Seu desafio. Seu simulado. Para estudantes e professores.',
        caminho='/',
        estilo=css + ler('escolha.css'),
        corpo=ler('escolha.html').replace('<!--AUTH-->', janela_login),
        scripts=ler('escolha.js') + '\n' + auth,
        cabeca_js='<script>\n' + ler('escolha_inicio.js') + '</script>\n'),
    'professor/index.html': em_subpasta(pagina(
        html_attr='',
        titulo='Gera Enem para professores',
        descricao='Simulados no padrão do ENEM para professores: questões inéditas com texto-base, gráfico, cinco alternativas, gabarito conferido e resolução comentada, num caderno pronto para imprimir.',
        og_desc='O simulado fica pronto. Você volta para os alunos.',
        caminho='/professor/',
        estilo=css,
        corpo=prof_body,
        scripts=app_js + '\n' + auth)),
    'aluno/index.html': em_subpasta(pagina(
        html_attr=' data-pagina="aluno"',
        titulo='Gera Enem para estudantes',
        descricao='Simulados no padrão do ENEM para estudantes: questões inéditas do conteúdo que você escolher, com gráfico, cinco alternativas, gabarito conferido e resolução comentada.',
        og_desc='Escolha o tema. Resolva. Entenda cada erro.',
        caminho='/aluno/',
        estilo=css,
        corpo=corpo_com_cartao('body_aluno.html'),
        scripts=app_js + '\n' + auth)),
}
assert '<!--AUTH-->' not in saidas['index.html'] and 'id="auth"' in saidas['index.html']
for nome, html in saidas.items():
    destino = PAGINA / nome
    destino.parent.mkdir(parents=True, exist_ok=True)
    destino.write_text(html, encoding='utf-8')
    # todo arquivo citado (assets/...) precisa existir em pagina/assets/
    for ref in set(re.findall(r'(?<=["\'(])(?:\.\./)?assets/[A-Za-z0-9_./-]+\.(?:webp|mp4|webm|jpg|png)', html)):
        assert (destino.parent / ref).resolve().exists(), (nome, ref)
    print(f'ok: pagina/{nome} gerado com {len(html)} caracteres')
