#!/usr/bin/env python3
"""Gera o index.html da raiz do repositório a partir das fontes em src/.

O aplicativo é distribuído como um único arquivo HTML autocontido: o template
(app_template.html) tem dois marcadores, __APP_DATA__ e __APP_JS__, que são
substituídos, respectivamente, pelo conteúdo de app_data.json e de app.js.

Uso (de qualquer diretório):
    python3 src/combine.py

Os caminhos são resolvidos a partir da localização deste arquivo, então o
script funciona em qualquer máquina — não depende de caminhos absolutos.
"""

from pathlib import Path

SRC = Path(__file__).resolve().parent
ROOT = SRC.parent
SAIDA = ROOT / "index.html"

template = (SRC / "app_template.html").read_text(encoding="utf-8")
app_data = (SRC / "app_data.json").read_text(encoding="utf-8")
# fonts.js traz a Carlito em subconjunto (base64) e é embutido ANTES do app.js:
# o registro das faces precisa existir quando o PDF for montado.
fonts_js = (SRC / "fonts.js").read_text(encoding="utf-8")
app_js = fonts_js + "\n" + (SRC / "app.js").read_text(encoding="utf-8")

# app_data.json já é JSON válido; é embutido verbatim como literal JS.
# O escape de "</script" evita que um conteúdo qualquer feche a tag <script>
# do HTML gerado prematuramente.
app_data_js = app_data.replace("</script", "<\\/script")
app_js_safe = app_js.replace("</script", "<\\/script")

for marcador in ("__APP_DATA__", "__APP_JS__"):
    if marcador not in template:
        raise SystemExit(f"ERRO: marcador {marcador} não encontrado em app_template.html")

saida = template.replace("__APP_DATA__", app_data_js).replace("__APP_JS__", app_js_safe)

SAIDA.write_text(saida, encoding="utf-8")
print(f"ok: {SAIDA.relative_to(ROOT)} gerado com {len(saida)} caracteres")
