#!/usr/bin/env python3
"""Converte as provas em PDF (vestibulares enviados pelo professor) em texto, página a página.

Uso: converte_provas.py <pasta_dos_pdfs> <pasta_de_saida> [processos]

- PDF com camada de texto: extrai_texto2.py (pdfplumber separando as duas colunas → poppler → OCR
  por página quando a camada de texto vem ilegível).
- PDF escaneado (menos de ~150 letras por página): OCR da prova inteira (tesseract, português, 300 dpi).
- Gabaritos (nome com "gabarito"): pdftotext -layout.
O texto sai com as marcas "======== PÁGINA N ========" e "[[coluna 2]]", que as instruções de extração
(INSTRUCOES_EXTRACAO.md) usam. Os textos das provas NÃO vão para o repositório: só para o banco.
"""
import os, re, subprocess, sys, tempfile
from multiprocessing import Pool
AQUI = os.path.dirname(os.path.abspath(__file__))
def letras_por_pagina(pdf):
    info = subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout
    m = re.search(r"Pages:\s+(\d+)", info); paginas = int(m.group(1)) if m else 1
    t = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
    return len(re.findall(r"[A-Za-zÀ-ú]", t)) / max(paginas, 1)
def ocr_tudo(pdf, saida):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", pdf, f"{d}/p"], check=False)
        pngs = sorted([p for p in os.listdir(d) if p.endswith(".png")], key=lambda p: int(p.rsplit("-", 1)[1].split(".")[0]))
        partes = []
        for i, p in enumerate(pngs, 1):
            r = subprocess.run(["tesseract", f"{d}/{p}", "stdout", "-l", "por", "--psm", "3"], capture_output=True, text=True,
                               env={**os.environ, "OMP_THREAD_LIMIT": "1"})
            partes.append(f"\n\n======== PÁGINA {i} ========\n\n{r.stdout}")
    open(saida, "w", encoding="utf-8").write("".join(partes))
def converte(args):
    pdf, saida = args
    os.makedirs(os.path.dirname(saida), exist_ok=True)
    if os.path.exists(saida) and os.path.getsize(saida) > 500: return (pdf, "já existe")
    if "gabarito" in os.path.basename(pdf).lower():
        t = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True).stdout
        open(saida, "w", encoding="utf-8").write(t); return (pdf, "gabarito")
    if letras_por_pagina(pdf) < 150:
        ocr_tudo(pdf, saida); return (pdf, "ocr")
    r = subprocess.run([sys.executable, os.path.join(AQUI, "extrai_texto2.py"), pdf, saida], capture_output=True, text=True)
    return (pdf, "texto" if r.returncode == 0 else "ERRO " + r.stderr[-200:])
if __name__ == "__main__":
    origem, destino = sys.argv[1], sys.argv[2]; procs = int(sys.argv[3]) if len(sys.argv) > 3 else 4
    tarefas = []
    for raiz, _, arqs in os.walk(origem):
        for a in sorted(arqs):
            if a.lower().endswith(".pdf"):
                rel = os.path.relpath(os.path.join(raiz, a), origem)
                tarefas.append((os.path.join(raiz, a), os.path.join(destino, rel[:-4] + ".txt")))
    with Pool(procs) as p:
        for pdf, estado in p.imap_unordered(converte, tarefas): print(estado, pdf, flush=True)
    print("FIM", flush=True)
