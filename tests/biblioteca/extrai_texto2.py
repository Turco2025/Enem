#!/usr/bin/env python3
"""Como extrai_texto.py, mas página a página com cadeia de recuperação:
pdfplumber (colunas) → pdftotext/poppler (mesmas colunas) → OCR (tesseract por).
Uso: extrai_texto2.py <pdf> <saida.txt>"""
import sys, re, subprocess, tempfile, os, unicodedata, pdfplumber
sys.path.insert(0, os.path.dirname(__file__))
from extrai_texto import acha_divisao, limpa
PT = set("de a o que e do da em um para é com não uma os no se na por mais as dos como mas foi ao ele das tem à seu sua ou ser quando muito há nos já está também só pelo pela até isso ela entre era depois sem mesmo aos ter seus quem nas me esse eles estão você tinha foram essa num nem suas meu às minha têm numa pelos elas havia seja qual será nós tenho lhe deles essas esses pelas este fosse dele the of and to in is".split())
def ruim(t):
    if t.count("(cid:") > 20: return True
    toks = re.findall(r"[a-zà-úA-ZÀ-Ú]+", t)
    if len(toks) < 40: return False
    pt = sum(1 for w in toks if w.lower() in PT)
    return pt / len(toks) < 0.06
def poppler(pdf, n, x0, x1, h):
    r = subprocess.run(["pdftotext", "-f", str(n), "-l", str(n), "-x", str(int(x0)), "-y", "0", "-W", str(int(x1 - x0)), "-H", str(int(h)), pdf, "-"], capture_output=True, text=True)
    return r.stdout
def ocr(pdf, n):
    with tempfile.TemporaryDirectory() as d:
        subprocess.run(["pdftoppm", "-r", "300", "-gray", "-png", "-f", str(n), "-l", str(n), pdf, f"{d}/p"], check=False)
        pngs = [f for f in os.listdir(d) if f.endswith(".png")]
        if not pngs: return ""
        r = subprocess.run(["tesseract", f"{d}/{pngs[0]}", "stdout", "-l", "por", "--psm", "3"], capture_output=True, text=True, env={**os.environ, "OMP_THREAD_LIMIT": "1"})
        return r.stdout
def main(pdf, saida):
    out, metodos = [], []
    with pdfplumber.open(pdf) as doc:
        for i, page in enumerate(doc.pages, 1):
            W, H = page.width, page.height
            try: x = acha_divisao(page)
            except Exception: x = None
            try:
                if x:
                    a = page.crop((0, 0, x, H)).extract_text() or ""; b = page.crop((x, 0, W, H)).extract_text() or ""
                    txt = a + "\n\n[[coluna 2]]\n\n" + b
                else: txt = page.extract_text() or ""
            except Exception: txt = "(cid:0)" * 50
            metodo = "pdfplumber"
            if ruim(txt):
                # poppler usa pontos a 72 dpi (-r padrão 72): mesmas coordenadas do pdfplumber
                if x: t2 = poppler(pdf, i, 0, x, H) + "\n\n[[coluna 2]]\n\n" + poppler(pdf, i, x, W, H)
                else: t2 = poppler(pdf, i, 0, W, H)
                if not ruim(t2): txt, metodo = t2, "poppler"
                else: txt, metodo = ocr(pdf, i), "ocr"
            metodos.append(metodo)
            out.append(f"\n\n======== PÁGINA {i} ========\n\n" + limpa(txt))
    open(saida, "w", encoding="utf-8").write("".join(out))
    print(os.path.basename(pdf), " ".join(f"{m[0]}" for m in metodos))
if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
