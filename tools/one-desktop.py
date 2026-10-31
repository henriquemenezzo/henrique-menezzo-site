# Os cases deixam de trocar de preset em tela grande: de 1440 px para cima vale um layout só,
# e o Base o escala junto com a janela (--zoom). Passada uma vez sobre o que o conversor gerou.
import glob, re

LG = r'\(min-width: ?1920px\) and \(max-width: ?2559\.98px\)'
XL = r'\(min-width: ?2560px\)'
MD = r'\(min-width: ?1440px\) and \(max-width: ?1919\.98px\)'

def drop_blocks(css):
    out, i = [], 0
    for m in re.finditer(rf'@media (?:{LG}|{XL})\s*\{{', css):
        if m.start() < i:
            continue
        depth, j = 1, m.end()
        while depth:
            depth += {'{': 1, '}': -1}.get(css[j], 0)
            j += 1
        out.append(css[i:m.start()])
        i = j
    return ''.join(out) + css[i:]

def split(value):
    parts, depth, last = [], 0, 0
    for i, c in enumerate(value):
        depth += (c == '(') - (c == ')')
        if c == ',' and depth == 0:
            parts.append(value[last:i].strip())
            last = i + 1
    return parts + [value[last:].strip()]

def scale(value):
    return re.sub(r'([\d.]+)px', lambda m: f'max({m[1]}px, calc(100vw * {m[1]} / 1500))', value)

def sizes(match):
    kept = []
    for part in split(match[1]):
        if re.match(LG, part) or re.match(XL, part):
            continue
        hit = re.match(MD, part)
        kept.append(f'(min-width: 1440px) {scale(part[hit.end():].strip())}' if hit else part)
    return f'sizes="{", ".join(kept)}"'

for path in glob.glob('src/styles/cases/*.css'):
    css = drop_blocks(open(path).read())
    css = re.sub(MD, '(min-width: 1440px)', css)
    css = css.replace('100svh', 'calc(100svh / var(--zoom, 1))')
    open(path, 'w').write(css)

for name in ['tex', 'babel', 'dare', 'goldcare', 'playground']:
    path = f'src/pages/{name}.astro'
    page = open(path).read()
    open(path, 'w').write(re.sub(r'sizes="([^"]*)"', sizes, page))
