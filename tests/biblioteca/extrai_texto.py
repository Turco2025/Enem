#!/usr/bin/env python3
"""Texto em ordem de leitura, página a página, separando as duas colunas quando há.
Uso: extrai_texto.py <pdf> <saida.txt>"""
import sys, pdfplumber, re, unicodedata
LIG = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", "‐": "-", "­": ""}
def limpa(t):
    for a, b in LIG.items(): t = t.replace(a, b)
    return unicodedata.normalize("NFC", t)
def acha_divisao(page):
    w = page.width
    words = page.extract_words(keep_blank_chars=False, use_text_flow=False)
    if len(words) < 30: return None
    melhor, melhor_x = None, None
    for frac in [i / 100 for i in range(38, 63)]:
        x = w * frac
        cruzam = sum(1 for wd in words if wd["x0"] < x - 1 and wd["x1"] > x + 1)
        esq = sum(1 for wd in words if wd["x1"] <= x); dir_ = sum(1 for wd in words if wd["x0"] >= x)
        if esq < 10 or dir_ < 10: continue
        if melhor is None or cruzam < melhor: melhor, melhor_x = cruzam, x
    if melhor is not None and melhor <= max(2, 0.02 * len(words)): return melhor_x
    return None
def main(pdf, saida):
    out = []
    with pdfplumber.open(pdf) as doc:
        for i, page in enumerate(doc.pages, 1):
            try:
                x = acha_divisao(page)
                if x:
                    a = page.crop((0, 0, x, page.height)).extract_text() or ""
                    b = page.crop((x, 0, page.width, page.height)).extract_text() or ""
                    txt = a + "\n\n[[coluna 2]]\n\n" + b
                else:
                    txt = page.extract_text() or ""
            except Exception as e:
                txt = f"[[erro na página: {e}]]"
            out.append(f"\n\n======== PÁGINA {i} ========\n\n" + limpa(txt))
    open(saida, "w", encoding="utf-8").write("".join(out))
if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
