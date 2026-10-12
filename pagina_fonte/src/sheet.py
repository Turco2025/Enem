"""Cartão-resposta do hero (SVG estático, 600 x 800). O preenchimento já vem
desenhado: sem JavaScript ou com movimento reduzido, a folha aparece gabaritada."""

GAB = 'ACEBD' 'EADCB' 'DBAEC' 'BECDA'
Q = len(GAB)
R = 13
COLS = (58, 322)
ROW0, ROWH = 262, 48
INK = '#1B1D29'


def check_gab():
    assert Q == 20
    for b in range(0, Q, 5):
        assert sorted(GAB[b:b + 5]) == list('ABCDE'), GAB[b:b + 5]
    for i in range(1, Q):
        assert GAB[i] != GAB[i - 1], i


def bubble_xy(q, letter_idx):
    col, row = divmod(q, 10)
    x0 = COLS[col]
    return x0 + 66 + letter_idx * 42, ROW0 + row * ROWH


def zigzag(cx, cy):
    pts = []
    for k in range(9):
        x = cx - R + k * (2 * R / 8)
        y = cy + R if k % 2 else cy - R
        pts.append(f'{x:.2f} {y:.2f}')
    return 'M' + ' L'.join(pts)


def build():
    check_gab()
    o = []
    o.append('<svg class="sheet-svg" viewBox="0 0 600 800" role="img" aria-label="Cartão-resposta preenchido: 20 questões marcadas e conferidas">')
    o.append('<defs><clipPath id="cb" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath></defs>')
    o.append('<rect width="600" height="800" fill="#FFFFFF"/>')
    # tarja lateral e marcas de sincronismo
    o.append('<rect x="589" y="40" width="11" height="60" fill="#B9E5FA"/>')
    for y in (44, 92, 140, 188):
        o.append(f'<rect x="14" y="{y - 4}" width="16" height="8" fill="#231F20"/>')
    for r in range(10):
        o.append(f'<rect x="14" y="{ROW0 + r * ROWH - 4}" width="16" height="8" fill="#231F20"/>')
    # cabeçalho
    o.append('<g transform="translate(44 30)">')
    for i in range(5):
        fill = '#231F20' if i == 1 else 'none'
        o.append(f'<circle cx="{5 + i * 12}" cy="8" r="4.4" fill="{fill}" stroke="#231F20" stroke-width="1.6"/>')
    o.append('</g>')
    o.append('<text class="sv-brand" x="112" y="44">Gera <tspan class="sv-brand2">Enem</tspan></text>')
    o.append('<text class="sv-small" x="556" y="44" text-anchor="end">SIMULADO 07 · 3º ANO</text>')
    o.append('<text class="sv-title" x="44" y="94">CARTÃO-RESPOSTA</text>')
    o.append('<rect x="276" y="81" width="237" height="13" fill="#B9E5FA"/><rect x="513" y="81" width="61" height="13" fill="#231F20"/>')
    # campos
    fields = [(44, 330, 'NOME DO PARTICIPANTE', 'Ana Clara Souza'), (384, 80, 'TURMA', '3º A'), (474, 100, 'DATA', '07/10')]
    for x, w, lab, val in fields:
        o.append(f'<rect x="{x}" y="114" width="{w}" height="46" fill="none" stroke="#231F20" stroke-width="1.2"/>')
        o.append(f'<text class="sv-lab" x="{x + 7}" y="126">{lab}</text>')
        o.append(f'<text class="sv-hand" x="{x + 10}" y="151">{val}</text>')
    o.append('<text class="sv-small" x="44" y="186">BIOLOGIA · 20 QUESTÕES · CIÊNCIAS DA NATUREZA</text>')
    o.append('<text class="sv-ins" x="44" y="206">Preencha todo o círculo com caneta esferográfica de tinta preta.</text>')
    o.append('<line x1="44" y1="226" x2="574" y2="226" stroke="#231F20" stroke-width="1"/>')
    o.append('<line x1="300" y1="238" x2="300" y2="710" stroke="#231F20" stroke-width=".8"/>')
    # grade
    for q in range(Q):
        col, row = divmod(q, 10)
        x0, y = COLS[col], ROW0 + row * ROWH
        o.append(f'<rect class="nb" x="{x0}" y="{y - 14}" width="40" height="28" fill="none" stroke="#231F20" stroke-width="1.1"/>')
        o.append(f'<text class="sv-num" x="{x0 + 20}" y="{y + 5.5}" text-anchor="middle">{q + 1:02d}</text>')
        for li, L in enumerate('ABCDE'):
            cx, cy = bubble_xy(q, li)
            o.append(f'<circle cx="{cx}" cy="{cy}" r="{R}" fill="none" stroke="#231F20" stroke-width="1.2"/>')
            o.append(f'<text class="sv-let" x="{cx}" y="{cy + 3.6}" text-anchor="middle">{L}</text>')
    # tinta (por cima da grade)
    o.append('<g class="inks">')
    for q in range(Q):
        li = 'ABCDE'.index(GAB[q])
        cx, cy = bubble_xy(q, li)
        o.append(f'<path class="zz" d="{zigzag(cx, cy)}" data-cx="{cx}" data-cy="{cy}" data-l="{GAB[q]}" clip-path="url(#cb)" pathLength="1" fill="none" stroke="{INK}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1" stroke-dashoffset="0"/>')
        o.append(f'<circle class="dot" cx="{cx}" cy="{cy}" r="{R - 0.6}" fill="{INK}"/>')
    o.append('</g>')
    # conferência
    o.append('<g class="rings">')
    for q in range(Q):
        li = 'ABCDE'.index(GAB[q])
        cx, cy = bubble_xy(q, li)
        o.append(f'<circle class="ring" cx="{cx}" cy="{cy}" r="{R + 5}" fill="none" stroke="#178A4C" stroke-width="2.6" pathLength="1" stroke-dasharray="1" stroke-dashoffset="0" transform="rotate(-100 {cx} {cy})"/>')
    o.append('</g>')
    # rodapé
    o.append('<line x1="44" y1="726" x2="574" y2="726" stroke="#231F20" stroke-width="1"/>')
    o.append('<text class="sv-lab" x="44" y="752">NÃO AMASSE, NÃO DOBRE E NÃO RASURE ESTE CARTÃO.</text>')
    x, s = 440, 7
    while x < 572:
        s = (s * 1103515245 + 12345) % 2147483648
        w = 1 + (s >> 16) % 3
        o.append(f'<rect x="{x}" y="740" width="{w}" height="26" fill="#231F20"/>')
        x += w + 1 + (s >> 20) % 3
    # carimbo verde de conferência, grande, sobre a grade
    o.append('<defs><filter id="ink" x="-8%" y="-8%" width="116%" height="116%">'
             '<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>'
             '<feDisplacementMap in="SourceGraphic" in2="n" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="d"/>'
             '<feTurbulence type="fractalNoise" baseFrequency="0.32" numOctaves="1" seed="11" result="n2"/>'
             '<feColorMatrix in="n2" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -1.6 1.95" result="m"/>'
             '<feComposite in="d" in2="m" operator="in"/></filter></defs>')
    o.append('<g class="stamp"><g transform="rotate(-13 300 470)" filter="url(#ink)" opacity=".96">')
    o.append('<rect x="78" y="378" width="444" height="184" rx="16" fill="rgba(244,248,244,.78)" stroke="#178A4C" stroke-width="8"/>')
    o.append('<rect x="92" y="392" width="416" height="156" rx="9" fill="none" stroke="#178A4C" stroke-width="2.5"/>')
    o.append('<text class="sv-stamp" x="300" y="477" text-anchor="middle">GABARITADO</text>')
    o.append('<line x1="128" y1="497" x2="472" y2="497" stroke="#178A4C" stroke-width="2.5"/>')
    o.append('<text class="sv-stamp2" x="300" y="532" text-anchor="middle">20/20 · CONFERIDO</text>')
    o.append('</g></g>')
    o.append('</svg>')
    return '\n'.join(o)


if __name__ == '__main__':
    print(len(build()))
