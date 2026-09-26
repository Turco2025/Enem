#!/usr/bin/env python3
"""Extrai, de um PDF exportado do Super Professor, SÓ os textos-base e a fonte de cada
questão (mais o comando, as alternativas e o gabarito originais, guardados apenas para a
conferência anti-cópia). Não guarda resolução nem comentário do Super Professor.

Uso: python3 tests/extrair_textos_professor.py arquivo.pdf [rotulo_da_pasta] > lote.json
(v74.28, 26/09/2026 — biblioteca de textos do professor. Os textos extraídos NÃO vão para o
repositório, que é público: ficam só no banco, na tabela textos_enem, com a coluna "prova".)
Saída: lista de blocos {textoBase, referenciaImpressa, questoes:[{spId, banca, ano, numero,
materia, dificuldade, comando, alternativas, gabarito}], temImagem, avisos}.
A classificação (disciplina, tipo de texto, temas, autor, obra, referência final) é feita
depois, na revisão de cada lote."""
import json, re, subprocess, sys, unicodedata

LIG = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl"}

def texto_layout(pdf):
    t = subprocess.run(["pdftotext", "-layout", pdf, "-"], capture_output=True, text=True, check=True).stdout
    for a, b in LIG.items(): t = t.replace(a, b)
    return unicodedata.normalize("NFC", t)

def limpa_linhas(bloco):
    """Junta as linhas de cada parágrafo, preserva as quebras de parágrafo (linha em branco)
    e os versos (linhas curtas sem ponto final seguidas de linha curta)."""
    paras, atual = [], []
    for ln in bloco.split("\n"):
        s = re.sub(r"\s{2,}", " ", ln).strip()
        if re.fullmatch(r"Página \d+ de \d+", s): continue
        if not s:
            if atual: paras.append(atual); atual = []
            continue
        atual.append(s)
    if atual: paras.append(atual)
    out = []
    for p in paras:
        txt = ""
        for s in p:
            if not txt: txt = s
            elif txt.endswith("-") and s[:1].islower(): txt += s          # hífen real (ex.: horrorizá-lo)
            else: txt += " " + s
        out.append(txt)
    return "\n\n".join(out).strip()

RE_Q = re.compile(r"^\s*(\d+)\s*\[(\d+)\]\.\s*\(([^)]+)\)\s*(.*)$")
RE_TXT = re.compile(r"^\s*TEXTO(S)? PARA (A PRÓXIMA QUESTÃO|AS PRÓXIMAS (\d+) QUESTÕES)\.?\s*$", re.I)
RE_ALT = re.compile(r"^\s*([a-e])\)\s*(.*)$")
RE_REF = re.compile(r"^[A-ZÁÉÍÓÚÂÊÔÃÕÇ][A-ZÁÉÍÓÚÂÊÔÃÕÇ' -]{2,},\s+[A-ZÁÉÍÓÚ]")   # SOBRENOME, Nome/Inicial...

def separa_referencia(texto):
    """Última(s) linha(s) em estilo ABNT (SOBRENOME, X. ... / Disponível em: ...) viram a referência."""
    paras = texto.split("\n\n")
    ref = []
    while paras:
        ult = paras[-1].strip()
        if RE_REF.match(ult) or re.search(r"(Disponível em|Acesso em)\s*:", ult) or re.match(r"^\(?[A-ZÁÉÍÓÚ][^.]{0,80}\.\s*In:", ult):
            ref.insert(0, ult); paras.pop()
        else:
            break
    return "\n\n".join(paras).strip(), " ".join(ref).strip()

def extrai(pdf, rotulo=""):
    t = texto_layout(pdf)
    t = t.replace("\f", "\n")
    partes = re.split(r"\n\s*Gabarito\s*\n", t, maxsplit=1)
    corpo, resto = (partes[0], partes[1]) if len(partes) == 2 else (t, "")
    gabaritos = {int(n): g for n, g in re.findall(r"Resposta da questão (\d+):\s*\n\s*\[([A-E])\]", resto)}
    # tabela-resumo: número da questão -> (Q/DB, grau, matéria, fonte, tipo)
    resumo = {}
    for m in re.finditer(r"^\s*(\d+)\s+(\d{4,})\s+(\S+)\s+(.+?)\s{2,}(\S+/\d{4})\s+(.+?)\s*$", resto.split("Resumo das questões")[-1], re.M):
        resumo[int(m.group(1))] = {"spId": m.group(2), "dificuldade": m.group(3), "materia": m.group(4).strip(), "fonte": m.group(5), "tipo": m.group(6).strip()}
    linhas = corpo.split("\n")
    blocos, atual_txt, i = [], None, 0
    questoes_soltas = []
    while i < len(linhas):
        ln = linhas[i]
        if RE_TXT.match(ln):
            atual_txt = {"linhas": [], "questoes": []}; blocos.append(atual_txt); i += 1
            while i < len(linhas) and not RE_Q.match(linhas[i]) and not RE_TXT.match(linhas[i]):
                atual_txt["linhas"].append(linhas[i]); i += 1
            continue
        m = RE_Q.match(ln)
        if m:
            q = {"numero": int(m.group(1)), "spId": m.group(2), "banca": m.group(3).strip(), "enunciado": [m.group(4)], "alternativas": {}}
            i += 1; letra = None
            while i < len(linhas) and not RE_Q.match(linhas[i]) and not RE_TXT.match(linhas[i]):
                a = RE_ALT.match(linhas[i])
                if a: letra = a.group(1).upper(); q["alternativas"][letra] = a.group(2).strip()
                elif letra and linhas[i].strip() and not re.fullmatch(r"\s*Página \d+ de \d+\s*", linhas[i]): q["alternativas"][letra] += " " + linhas[i].strip()
                elif not letra: q["enunciado"].append(linhas[i])
                i += 1
            enun = limpa_linhas("\n".join(q["enunciado"]))
            q["alternativas"] = {k: re.sub(r"\s{2,}", " ", v).strip() for k, v in q["alternativas"].items()}
            r = resumo.get(q["numero"], {})
            fonte = r.get("fonte", "")
            q.update({"enunciado": enun, "gabarito": gabaritos.get(q["numero"], ""), "materia": r.get("materia", ""), "dificuldade": r.get("dificuldade", ""),
                      "fonteProva": fonte, "ano": int(fonte.split("/")[-1]) if re.search(r"/\d{4}$", fonte) else None})
            if atual_txt is not None and len(atual_txt["questoes"]) < 99 and (not atual_txt.get("fechado")):
                atual_txt["questoes"].append(q)
            else:
                questoes_soltas.append(q)
            continue
        i += 1
    saida = []
    for b in blocos:
        texto, ref = separa_referencia(limpa_linhas("\n".join(b["linhas"])))
        saida.append({"arquivo": pdf.split("/")[-1], "rotulo": rotulo, "textoBase": texto, "referenciaImpressa": ref, "questoes": b["questoes"],
                      "temImagem": bool(re.search(r"\b(imagem|figura|charge|tirinha|cartum|quadro|pintura|fotografia|gráfico|mapa)\b", " ".join(q["enunciado"] for q in b["questoes"]), re.I)),
                      "avisos": ([] if ref else ["referência não impressa no PDF"])})
    for q in questoes_soltas:   # texto dentro do próprio enunciado: a revisão separa texto e comando
        saida.append({"arquivo": pdf.split("/")[-1], "rotulo": rotulo, "textoBase": "", "referenciaImpressa": "", "questoes": [q], "temImagem": False,
                      "avisos": ["questão sem bloco de texto próprio — o texto, se houver, está no enunciado"]})
    return saida

if __name__ == "__main__":
    print(json.dumps(extrai(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ""), ensure_ascii=False, indent=1))
