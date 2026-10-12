#!/usr/bin/env python3
"""Gera pagina/index.html (a página inicial publicada na raiz do site) a partir destas fontes.

As fontes da página inicial do Gera Enem ficam aqui: src/style.css, src/body.html,
src/app.js (efeitos da página), src/auth.js (login e cadastro), src/sheet.py (o
cartão-resposta do topo) e src/favicon.txt. As imagens e os vídeos ficam em pagina/assets/.

Uso (de qualquer diretório):  python3 pagina_fonte/montar.py
"""
from pathlib import Path
import sys

AQUI = Path(__file__).resolve().parent
SAIDA = AQUI.parent / 'pagina' / 'index.html'
ORIGEM = 'https://simuladorenem159753.netlify.app'
sys.path.insert(0, str(AQUI / 'src'))
import sheet  # noqa: E402

css = (AQUI / 'src/style.css').read_text(encoding='utf-8')
js = (AQUI / 'src/app.js').read_text(encoding='utf-8') + '\n' + (AQUI / 'src/auth.js').read_text(encoding='utf-8')
body = (AQUI / 'src/body.html').read_text(encoding='utf-8').replace('<!--SHEET-->', sheet.build())
assert '<!--SHEET-->' not in body
fav = (AQUI / 'src/favicon.txt').read_text(encoding='utf-8').strip()
head = f'''<title>Gera Enem</title>
<meta name="description" content="Simulados no padrão do ENEM para professores: questões inéditas com texto-base, gráfico, cinco alternativas, gabarito conferido e resolução comentada, num caderno pronto para imprimir.">
<meta name="theme-color" content="#0F1C2B">
<link rel="icon" href="{fav}">
<meta property="og:type" content="website">
<meta property="og:locale" content="pt_BR">
<meta property="og:site_name" content="Gera Enem">
<meta property="og:title" content="Gera Enem">
<meta property="og:description" content="O simulado fica pronto. Você volta para os alunos.">
<meta property="og:image" content="{ORIGEM}/assets/og.jpg">
<meta property="og:url" content="{ORIGEM}/">
<meta name="twitter:card" content="summary_large_image">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,600..800&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Carlito:wght@400;700&display=swap">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&display=swap">
<script>document.documentElement.lang='pt-BR';</script>
<style>
{css}</style>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js" defer></script>
'''
html = ('<!doctype html>\n<html lang="pt-BR">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n' + head +
        '</head>\n<body>\n' + body + '\n<script>\n' + js + '</script>\n</body>\n</html>\n')
SAIDA.write_text(html, encoding='utf-8')
print(f'ok: {SAIDA.relative_to(AQUI.parent)} gerado com {len(html)} caracteres')
