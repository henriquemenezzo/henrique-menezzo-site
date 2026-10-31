// Converte o SSR do Framer de um case em uma página Astro + CSS próprios, sem o runtime.
// Roda uma vez por página; depois disso o resultado em src/ é a fonte de verdade.
// Uso: node tools/convert-case.mjs <pasta-site-raw> <pagina> <chunk.mjs>
import fs from 'node:fs';
import path from 'node:path';
import * as cheerio from 'cheerio';
import { parse } from '@babel/parser';

const [, , RAW, PAGE, CHUNK] = process.argv;
const ROOT = path.resolve(import.meta.dirname, '..');
const media = JSON.parse(fs.readFileSync(`${ROOT}/src/data/media.json`, 'utf8'));
const html = fs.readFileSync(`${RAW}/pages/${PAGE}.html`, 'utf8');
const $ = cheerio.load(html, { decodeEntities: false });

const bpList = JSON.parse($('#main').attr('data-framer-hydrate-v2').replace(/&quot;/g, '"')).breakpoints;
const allBps = bpList.map((b) => b.hash);
const mqOf = Object.fromEntries(bpList.map((b) => [b.hash, b.mediaQuery]));
const bpKey = (q) => {
  if (q.includes('2560px') && !q.includes('max')) return 'xl';
  if (q.includes('min-width: 1920px')) return 'lg';
  if (q.includes('min-width: 1440px')) return 'md';
  if (q.includes('min-width: 1200px')) return 'sm';
  if (q.includes('min-width: 768px')) return 't';
  return 'p';
};

// ---------- movimento: lê parallax e scroll transforms do bundle pelo AST ----------
const chunkCode = fs.readFileSync(CHUNK, 'utf8');
const ast = parse(chunkCode, { sourceType: 'module', errorRecovery: true });
const walk = (node, fn) => {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) return node.forEach((n) => walk(n, fn));
  if (node.type) fn(node);
  for (const key in node) if (key !== 'loc' && key !== 'extra') walk(node[key], fn);
};
const keyOf = (p) => p.key?.name ?? p.key?.value;
const propOf = (obj, name) => obj.properties?.find((p) => keyOf(p) === name)?.value;
const strOf = (n) => (n?.type === 'TemplateLiteral' ? n.quasis[0].value.cooked : n?.type === 'StringLiteral' ? n.value : undefined);
const litOf = (n) => {
  if (!n) return undefined;
  if (n.type === 'NumericLiteral') return n.value;
  if (n.type === 'UnaryExpression' && n.operator === '!') return !n.argument.value;
  if (n.type === 'UnaryExpression' && n.operator === 'void') return null;
  if (n.type === 'UnaryExpression' && n.operator === '-') return -n.argument.value;
  return strOf(n);
};
const motionOf = (obj) => {
  const out = {};
  for (const p of obj.properties ?? []) {
    const k = keyOf(p);
    if (typeof k !== 'string' || !k.startsWith('__framer__')) continue;
    if (k === '__framer__transformTargets') {
      out.targets = p.value.elements?.map((e) => {
        const t = propOf(e, 'target');
        return { x: litOf(propOf(t, 'x')), y: litOf(propOf(t, 'y')), opacity: litOf(propOf(t, 'opacity')), scale: litOf(propOf(t, 'scale')) };
      });
    } else out[k.replace('__framer__', '')] = litOf(p.value);
  }
  return out;
};

let variantToHash = {};
walk(ast, (n) => {
  if (n.type !== 'ObjectExpression' || n.properties.length < 3) return;
  const vals = n.properties.map((p) => strOf(p.value));
  if (vals.every((v) => v?.startsWith('framer-v-')) && vals.some((v) => allBps.includes(v.replace('framer-v-', '')))) {
    n.properties.forEach((p) => (variantToHash[keyOf(p)] = strOf(p.value).replace('framer-v-', '')));
  }
});
const motion = new Map();
const note = (cls, base, overrides) => {
  if (!cls) return;
  const has = Object.keys(base).length || Object.keys(overrides).length;
  if (!has) return;
  const prev = motion.get(cls);
  motion.set(cls, { base: { ...prev?.base, ...base }, overrides: { ...prev?.overrides, ...overrides } });
};
walk(ast, (n) => {
  if (n.type !== 'ObjectExpression') return;
  const overrides = propOf(n, 'overrides');
  const child = propOf(n, 'children');
  if (overrides && child?.type === 'CallExpression') {
    const target = child.arguments[1];
    if (target?.type !== 'ObjectExpression') return;
    const map = {};
    for (const p of overrides.properties ?? []) {
      const m = motionOf(p.value);
      const hash = variantToHash[keyOf(p)];
      if (hash && Object.keys(m).length) map[hash] = m;
    }
    note(strOf(propOf(target, 'className')), motionOf(target), map);
  } else if (propOf(n, 'className')) {
    note(strOf(propOf(n, 'className')), motionOf(n), {});
  }
});

const appear = {};
for (const block of $('script[type="framer/appear"]').toArray()) {
  const data = JSON.parse($(block).html());
  if (Array.isArray(data)) continue;
  for (const [id, v] of Object.entries(data)) appear[id] = v.default ?? Object.values(v)[0];
}

// ---------- CSS: variáveis ----------
const rawCss = $('style[data-framer-css-ssr-minified]').html();
const scopes = new Set(($('style[data-framer-css-ssr-minified]').attr('data-framer-components') ?? '').split(/\s+/).filter((c) => c.startsWith('framer-')));
const tokens = {};
for (const [, name, value] of rawCss.matchAll(/(--token-[\w-]+):([^;}]+)/g)) tokens[name] = value.trim();

const splitArgs = (s) => {
  let depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++;
    if (s[i] === ')') depth--;
    if (s[i] === ',' && depth === 0) return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
  }
  return [s.trim(), undefined];
};
const resolve = (value, env = {}) => {
  let out = value;
  for (let guard = 0; guard < 12 && out.includes('var('); guard++) {
    const i = out.lastIndexOf('var(');
    let depth = 0;
    let j = i + 3;
    for (; j < out.length; j++) {
      if (out[j] === '(') depth++;
      if (out[j] === ')' && --depth === 0) break;
    }
    const [name, fallback] = splitArgs(out.slice(i + 4, j));
    const special = { '--overflow-clip-fallback': 'clip', '--framer-aspect-ratio-supported': 'auto', '--framer-viewport-height': '100vh' };
    const hit = env[name] ?? tokens[name] ?? special[name] ?? fallback ?? '';
    out = out.slice(0, i) + hit + out.slice(j + 1);
  }
  return out.replace(/(\d+\.\d{3})\d+/g, '$1').replace(/50\.000%/g, '50%').trim();
};

// ---------- tipografia ----------
const familyOf = (v) => (/Medium/.test(v) ? 'var(--medium)' : /Book/.test(v) ? 'var(--book)' : /Inter Display/.test(v) ? 'var(--inter)' : /Inter/.test(v) ? 'var(--inter)' : v);
const typeFrom = (vars, env) => {
  const css = {};
  const set = (k, v) => v !== undefined && v !== '' && v !== 'inherit' && (css[k] = v);
  const get = (k) => (vars[k] === undefined ? undefined : resolve(vars[k], env));
  if (vars['--framer-font-family']) set('font-family', familyOf(vars['--framer-font-family']));
  set('font-size', get('--framer-font-size'));
  // No Framer o valor é uma variável recalculada em cada elemento; sem unidade o CSS faz o mesmo.
  const lh = get('--framer-line-height');
  set('line-height', /(%|em)$/.test(lh ?? '') ? String(parseFloat(lh) / (lh.endsWith('%') ? 100 : 1)) : lh);
  const ls = get('--framer-letter-spacing');
  // Zero também conta: dentro de um breakpoint ele desfaz o espaçamento do preset base.
  if (ls) set('letter-spacing', parseFloat(ls) === 0 ? '0' : ls);
  const align = get('--framer-text-alignment');
  if (align && align !== 'start') set('text-align', align);
  set('color', get('--framer-text-color'));
  const w = get('--framer-font-weight');
  if (w && w !== '400') set('font-weight', w);
  const st = get('--framer-font-style');
  if (st && st !== 'normal') set('font-style', st);
  const tt = get('--framer-text-transform');
  if (tt && tt !== 'none') set('text-transform', tt);
  const td = get('--framer-text-decoration');
  if (td && td !== 'none') set('text-decoration', td);
  return css;
};
const parseStyle = (s = '') => {
  const out = {};
  let depth = 0;
  let start = 0;
  const parts = [];
  const text = s.replace(/&quot;/g, '"');
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    if (text[i] === ')') depth--;
    if (text[i] === ';' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  for (const p of parts) {
    const i = p.indexOf(':');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return out;
};
const toCss = (o) => Object.entries(o).map(([k, v]) => `${k}:${v}`).join(';');

// ---------- funde as variantes ssr de cada breakpoint num nó só ----------
const visibleOf = (el) => {
  const hidden = (($(el).attr('class') ?? '').match(/hidden-(\w+)/g) ?? []).map((c) => c.replace('hidden-', ''));
  return allBps.filter((b) => !hidden.includes(b));
};
const shape = (node) => {
  if (node.type === 'text') return node.data;
  if (node.type !== 'tag') return '';
  const a = node.attribs;
  const cls = (a.class ?? '').split(/\s+/).filter((c) => !c.startsWith('hidden-')).sort().join('.');
  const kids = (node.children ?? []).map(shape).join('');
  const src = (a.src ?? '').split('?')[0];
  return `<${node.name}.${cls} ${src} ${a.href ?? ''}>${kids}</>`;
};
const zip = (nodes, fn) => {
  fn(nodes);
  const kids = nodes.map((n) => (n.children ?? []).filter((c) => c.type === 'tag'));
  kids[0]?.forEach((_, i) => zip(kids.map((k) => k[i]), fn));
};
const perBp = new Map();
const mergeGroup = (group) => {
  const roots = group.map((g) => g.children.filter((c) => c.type === 'tag'));
  const same = roots.every((r) => r.length === roots[0].length && r.map(shape).join('') === roots[0].map(shape).join(''));
  if (!same) return false;
  roots[0].forEach((_, i) => {
    zip(roots.map((r) => r[i]), (nodes) => {
      const styles = nodes.map((n) => n.attribs.style ?? '');
      if (new Set(styles).size > 1) {
        perBp.set(nodes[0], nodes.map((n, k) => ({ style: n.attribs.style ?? '', bps: visibleOf(group[k]) })));
      }
      const sizes = nodes.map((n) => n.attribs.sizes).filter(Boolean);
      if (sizes.length) nodes[0].attribs.sizes = sizes.sort((a, b) => b.length - a.length)[0];
    });
  });
  return true;
};
const mergeVariants = (parent) => {
  const kids = (parent.children ?? []).filter((c) => c.type === 'tag');
  let i = 0;
  while (i < kids.length) {
    if (!(kids[i].attribs.class ?? '').split(' ').includes('ssr-variant')) {
      i++;
      continue;
    }
    const group = [kids[i]];
    const seen = new Set(visibleOf(kids[i]));
    let j = i + 1;
    while (j < kids.length && (kids[j].attribs.class ?? '').split(' ').includes('ssr-variant')) {
      const vis = visibleOf(kids[j]);
      if (vis.some((v) => seen.has(v))) break;
      vis.forEach((v) => seen.add(v));
      group.push(kids[j]);
      j++;
    }
    if (seen.size === allBps.length && mergeGroup(group)) {
      group.slice(1).forEach((g) => $(g).remove());
      $(group[0]).replaceWith(group[0].children);
    }
    i = j;
  }
  for (const k of parent.children ?? []) if (k.type === 'tag') mergeVariants(k);
};
const root = $('[data-framer-root]').first();
mergeVariants(root[0]);

// ---------- ícones que o Framer só desenha no cliente ----------
const icons = JSON.parse(fs.readFileSync(`${ROOT}/src/data/icons.json`, 'utf8'));
root.find('[class*="-container"]').each((_, el) => {
  const $el = $(el);
  if ($el.find('video,img,svg').length || $el.text().trim()) return;
  const link = $el.closest('a');
  const href = link.attr('href') ?? '';
  const label = link.text().trim().toLowerCase();
  let icon;
  if (href.startsWith('./#hero') && link.parents('nav').length) icon = icons.close;
  else if (label.includes('linkedin')) icon = icons.linkedin;
  else if (label.includes('dribbble')) icon = icons.dribbble;
  else if (label.includes('resume')) icon = icons.note;
  else if (label.includes('whatsapp')) icon = icons.whatsapp;
  if (icon) $el.html(icon);
});

// ---------- rodapé: um componente só, no lugar das cinco cópias por breakpoint ----------
const footers = root.find('.ssr-variant').filter((_, el) => $(el).text().includes("Let's talk?"));
if (process.env.KEEP_FOOTER) {
  // Só para inspecionar o rodapé original.
} else if (footers.length) {
  footers.slice(1).remove();
  // Sobe até o filho direto da raiz: em alguns cases o azul fica num bloco acima das variantes.
  const top = footers.first().parents().filter((_, el) => el.parent === root[0]).first();
  (top.length ? top : footers.first()).replaceWith('<footer-slot></footer-slot>');
} else {
  const logo = root.find('[data-framer-name]').filter((_, el) => $(el).text().trim() === "Let's talk?").first();
  logo.parents().filter((_, el) => el.parent === root[0]).first().replaceWith('<footer-slot></footer-slot>');
}

// ---------- imagens, vídeos e svgs ----------
const hashOf = (src) => src?.match(/\/(?:images|assets)\/([A-Za-z0-9_-]+\.\w+)/)?.[1];
const missing = new Set();
const videoTag = (file, extra = '') => {
  const m = media[file];
  if (!m) return missing.add(file), '';
  return `<video data-src="/video/${m.name}.mp4" data-poster="/video/${m.name}.avif" width="${m.w}" height="${m.h}" loop muted playsinline preload="none"${extra}></video>`;
};
const pictureTag = (file, img, cls) => {
  const m = media[file];
  if (!m) return missing.add(file), '';
  const set = (ext) => m.widths.map((w) => `/img/${m.name}-${w}.${ext} ${w}w`).join(', ');
  const sizes = img.attr('sizes') ?? '100vw';
  const top = root.find('#hero').find(img).length > 0;
  const load = top ? 'fetchpriority="high"' : 'loading="lazy"';
  const fit = parseStyle(img.attr('style'))['object-fit'];
  const fitClass = fit && fit !== 'cover' ? ` fit-${fit}` : '';
  const big = m.widths.at(-1);
  return `<picture class="${cls}${fitClass}"><source type="image/avif" srcset="${set('avif')}" sizes="${sizes}"><img src="/img/${m.name}-${big}.webp" srcset="${set('webp')}" sizes="${sizes}" width="${m.w}" height="${m.h}" alt="${img.attr('alt') ?? ''}" decoding="async" ${load}></picture>`;
};
root.find('video').each((_, el) => {
  const $v = $(el);
  const st = parseStyle($v.attr('style'));
  const radius = st['border-radius'] && st['border-radius'] !== '0px' ? ` style="border-radius:${st['border-radius']}"` : '';
  $v.replaceWith(videoTag(hashOf($v.attr('src')), radius));
});
root.find('[data-framer-background-image-wrapper]').each((_, el) => {
  const $w = $(el);
  const img = $w.find('img').first();
  const file = hashOf(img.attr('src'));
  if (file?.endsWith('.gif')) $w.replaceWith(`<div class="bg">${videoTag(file)}</div>`);
  else $w.replaceWith(pictureTag(file, img, 'bg'));
});
root.find('img').each((_, el) => {
  const img = $(el);
  if (img.closest('picture').length) return;
  const file = hashOf(img.attr('src'));
  if (file?.endsWith('.gif')) img.replaceWith(videoTag(file));
  else if (file) img.replaceWith(pictureTag(file, img, 'pic'));
});
root.find('svg use').each((_, el) => {
  const id = $(el).attr('href')?.slice(1);
  const tpl = id && $(`#${CSS_escape(id)}`);
  if (tpl?.length) {
    const svg = $(el).closest('svg');
    svg.attr('viewBox', tpl.attr('viewBox') ?? svg.attr('viewBox'));
    svg.html(tpl.html());
  }
});
function CSS_escape(id) {
  return id.replace(/([^\w-])/g, '\\$1');
}

// ---------- regras CSS da página ----------
const parseRules = (css) => {
  const rules = [];
  let i = 0;
  const readBlock = (from) => {
    let depth = 0;
    for (let j = from; j < css.length; j++) {
      if (css[j] === '{') depth++;
      if (css[j] === '}' && --depth === 0) return j;
    }
    return css.length;
  };
  while (i < css.length) {
    const open = css.indexOf('{', i);
    if (open < 0) break;
    const sel = css.slice(i, open).trim();
    const close = readBlock(open);
    const body = css.slice(open + 1, close);
    if (sel.startsWith('@media')) rules.push({ media: sel, rules: parseRules(body) });
    else if (!sel.startsWith('@')) rules.push({ sel, body });
    i = close + 1;
  }
  return rules;
};
const SKIP = new Set(['align-content', 'flex-wrap', 'will-change']);
const cleanDecls = (body, sel) => {
  const decl = parseStyle(body);
  const out = {};
  for (const [k, raw] of Object.entries(decl)) {
    if (SKIP.has(k) || k.startsWith('--framer-will-change')) continue;
    const v = resolve(raw).replace(/calc\(50% - 100% \/ 2\)/g, '0');
    if (k === 'flex-wrap' && v === 'nowrap') continue;
    if (k === 'overflow' && v === 'visible') continue;
    if (k === 'padding' && /^0px( 0px)*$/.test(v)) continue;
    if (k === 'flex' && v === 'none') {
      out[k] = v;
      continue;
    }
    out[k] = v;
  }
  return out;
};
const domHas = (cls) => root.find(`.${cls}`).length > 0 || root.hasClass(cls);
const kept = new Set();
const ruleOut = (rule, rootClass) => {
  const parts = rule.sel.split(',').map((s) => s.trim());
  const sels = [];
  for (const part of parts) {
    if (/\[data-border|\.hidden-|^html|^body|^\*/.test(part)) continue;
    if (!part.startsWith('.framer-')) continue;
    const classes = [...part.matchAll(/\.(framer-[\w-]+)/g)].map((m) => m[1]);
    const real = classes.filter((c) => !scopes.has(c));
    if (!real.length || !real.every(domHas)) continue;
    real.forEach((c) => kept.add(c));
    let out = part.replace(/\.(framer-[\w-]+)/g, (m, c) => (scopes.has(c) ? '' : m)).trim();
    out = out.replace(/\.framer-/g, '.f-').replace(/\.hover\b/g, ':hover').replace(/\.pressed\b/g, ':active').replace(/\s+/g, ' ');
    sels.push(out);
  }
  if (!sels.length) return '';
  const decl = cleanDecls(rule.body);
  // 100svh: a altura não pula quando a barra do navegador some no celular.
  for (const k of Object.keys(decl)) if (decl[k] === '100vh') decl[k] = '100svh';
  if (sels.some((s) => s === `.f-${rootClass}`)) delete decl.width;
  if (!Object.keys(decl).length) return '';
  return `${[...new Set(sels)].join(',')}{${toCss(decl)}}`;
};
const presetRules = [];
const allRules = parseRules(rawCss.replace(/^[\s\S]*?<style[^>]*>/, ''));
const emitPreset = (rule, media) => {
  const m = rule.sel.match(/\.framer-styles-preset-(\w+)/);
  if (!m || !domHas(`framer-styles-preset-${m[1]}`)) return;
  const css = typeFrom(parseStyle(rule.body), {});
  if (Object.keys(css).length) presetRules.push({ media, text: `.p-${m[1]}{${toCss(css)}}` });
};
const rootClass = root.attr('class').split(' ').find((c) => c.startsWith('framer-') && allBps.includes(c.replace('framer-', ''))).replace('framer-', '');
const cssBase = [];
const cssMedia = {};
for (const rule of allRules) {
  if (rule.media) {
    for (const r of rule.rules) {
      if (r.sel.includes('framer-styles-preset')) {
        emitPreset(r, rule.media);
        continue;
      }
      const t = ruleOut(r, rootClass);
      if (t) (cssMedia[rule.media] ??= []).push(t);
    }
  } else if (rule.sel.includes('framer-styles-preset')) emitPreset(rule);
  else {
    const t = ruleOut(rule, rootClass);
    if (t) cssBase.push(t);
  }
}

// ---------- nós: classes, estilos, atributos, movimento ----------
const typeClasses = new Map();
const typeClass = (css) => {
  const key = toCss(css);
  if (!typeClasses.has(key)) typeClasses.set(key, `t${typeClasses.size + 1}`);
  return typeClasses.get(key);
};
const bpRules = [];
let bpCount = 0;
const inheritedEnv = (el) => {
  const env = {};
  for (const p of [...$(el).parents().toArray().reverse(), el]) {
    for (const [k, v] of Object.entries(parseStyle(p.attribs?.style))) if (k.startsWith('--extracted')) env[k] = v;
  }
  return env;
};
const TAGS_TEXT = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'strong', 'em', 'li']);
const structural = (st) => {
  const out = {};
  for (const [k, v] of Object.entries(st)) {
    if (k.startsWith('--framer') || k.startsWith('--font') || k.startsWith('--extracted') || k === 'will-change' || k === 'corner-shape') continue;
    if (k === 'opacity' && v === '1') continue;
    if (k === 'transform' && (v === 'none' || v.includes('perspective'))) continue;
    if (k.startsWith('border-') && k.endsWith('-radius')) {
      out[k] = resolve(v);
      continue;
    }
    if (k.startsWith('--border')) {
      out[k] = resolve(v);
      continue;
    }
    out[k] = resolve(v);
  }
  const radii = ['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'].map((k) => out[k]);
  if (radii.every(Boolean)) {
    radii.forEach((_, i) => delete out[['border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius'][i]]);
    out['border-radius'] = new Set(radii).size === 1 ? radii[0] : radii.join(' ');
  }
  return out;
};
const motionAttrs = (el, cls) => {
  const m = motion.get(cls);
  if (!m) return;
  const base = m.base;
  const on = base.parallaxTransformEnabled !== null && (base.speed !== undefined || base.parallaxTransformEnabled);
  if (on) el.attribs['data-speed'] = String(base.speed ?? 100);
  if (base.adjustPosition) {
    el.attribs['data-adjust'] = '';
    el.attribs['data-offset'] = String(base.offset ?? 0);
  }
  for (const [hash, o] of Object.entries(m.overrides)) {
    const key = bpKey(mqOf[hash]);
    if ('speed' in o) el.attribs[`data-speed-${key}`] = String(o.speed ?? 100);
    else if ('parallaxTransformEnabled' in o) el.attribs[`data-speed-${key}`] = o.parallaxTransformEnabled === null ? '100' : String(base.speed ?? 100);
    if ('offset' in o) el.attribs[`data-offset-${key}`] = String(o.offset);
  }
  if (base.targets && base.transformTrigger === 'onScroll') {
    el.attribs['data-x'] = base.targets.map((t) => t.x).join(',');
    for (const [hash, o] of Object.entries(m.overrides)) {
      if (o.targets) el.attribs[`data-x-${bpKey(mqOf[hash])}`] = o.targets.map((t) => t.x).join(',');
    }
  }
};
const nodes = [root[0], ...root.find('*').toArray()];
for (const el of nodes) {
  if (el.type !== 'tag' || ['picture', 'source', 'img', 'video', 'svg', 'path', 'g', 'defs', 'use', 'mask', 'rect', 'clipPath'].includes(el.name)) continue;
  if ($(el).closest('svg').length) continue;
  const a = el.attribs;
  const classes = (a.class ?? '').split(/\s+/).filter(Boolean);
  const out = [];
  const isText = TAGS_TEXT.has(el.name) || classes.includes('framer-text');
  for (const c of classes) {
    if (c.startsWith('framer-styles-preset-')) out.push(`p-${c.replace('framer-styles-preset-', '')}`);
    else if (c.startsWith('hidden-') || c === 'ssr-variant') out.push(c);
    else if (c === 'bg' || c === 'pic') out.push(c);
    else if (c === 'framer-text' || c === 'trailing-break') continue;
    else if (kept.has(c)) out.push(c.replace('framer-', 'f-'));
    if (c.startsWith('framer-')) motionAttrs(el, c.replace('framer-', ''));
    if (c.endsWith('-container') && motion.has(c)) motionAttrs(el, c);
  }
  for (const c of classes) if (motion.has(c)) motionAttrs(el, c);
  if (a['data-framer-component-type'] === 'RichTextContainer') out.push('rt');
  const env = inheritedEnv(el);
  const st = parseStyle(a.style);
  const type = typeFrom(st, env);
  const variantsByBp = perBp.get(el);
  if (variantsByBp) {
    const cls = `b${++bpCount}`;
    const decls = variantsByBp.map((v) => {
      const css = { ...typeFrom(parseStyle(v.style), env), ...structural(parseStyle(v.style)) };
      if (a['data-x']) delete css.transform;
      return { ...v, css };
    });
    const shared = Object.fromEntries(Object.entries(decls[0].css).filter(([k, v]) => decls.every((d) => d.css[k] === v)));
    for (const d of decls) {
      const only = Object.fromEntries(Object.entries(d.css).filter(([k]) => !(k in shared)));
      if (!Object.keys(only).length) continue;
      for (const bp of d.bps) bpRules.push(`@media ${mqOf[bp]}{.${cls}{${toCss(only)}}}`);
    }
    out.push(cls);
    if (Object.keys(shared).length) a.style = toCss(shared);
    else delete a.style;
  } else {
    if (isText && Object.keys(type).length) out.push(typeClass(type));
    else if (Object.keys(type).length) {
      a.style = toCss({ ...type, ...structural(st) });
    }
    const rest = structural(st);
    if (isText || !Object.keys(type).length) {
      if (Object.keys(rest).length) a.style = toCss(rest);
      else delete a.style;
    }
  }
  if (a['data-x'] && a.style) {
    const rest = parseStyle(a.style);
    delete rest.transform;
    if (Object.keys(rest).length) a.style = toCss(rest);
    else delete a.style;
  }
  const appearId = a['data-framer-appear-id'];
  if (appearId && appear[appearId]) {
    const ini = appear[appearId].initial;
    if (ini.y === -300) out.push('a-rise');
    else if (ini.scale && ini.scale !== 1) out.push('a-settle');
  }
  const keep = {};
  for (const k of ['id', 'href', 'target', 'rel', 'style', 'data-speed', 'data-adjust', 'data-offset', 'data-x']) if (a[k] !== undefined) keep[k] = a[k];
  for (const k of Object.keys(a)) if (/^data-(speed|offset|x)-/.test(k)) keep[k] = a[k];
  if (a['data-framer-cursor'] && !['g5cpko', '1l9hhzs'].includes(a['data-framer-cursor'])) keep['data-cursor-card'] = '';
  if (a['data-border']) keep['data-border'] = 'true';
  if (keep.href) keep.href = keep.href.replace(/^\.\//, '/').replace(/^\/#/, '/#');
  if (keep.href === '/#hero' && $(el).parents('nav').length) keep['aria-label'] = 'Back to home';
  if (out.length) keep.class = [...new Set(out)].join(' ');
  el.attribs = keep;
}

// Remove os invólucros vazios deixados pelo SSR.
root.find('div').each((_, el) => {
  if (!el.attribs.class && !Object.keys(el.attribs).length && !el.children.length) $(el).remove();
});
const stripComments = (n) => {
  for (const c of [...(n.children ?? [])]) {
    if (c.type === 'comment') $(c).remove();
    else stripComments(c);
  }
};
stripComments(root[0]);

// ---------- saída ----------
const FOOTERS = {
  goldcare: `<Footer kind="home" fixedHeight={515} motion={{ 'data-speed': 89, 'data-speed-lg': 87, 'data-speed-t': 85, 'data-speed-p': 78 }} />`,
  playground: `<Footer largeCredit motion={{ 'data-speed': 75, 'data-adjust': '', 'data-video-shift': '', 'data-offset': -400, 'data-offset-md': -600, 'data-offset-lg': -600, 'data-speed-xl': 80, 'data-speed-t': 70, 'data-offset-t': 80, 'data-speed-p': 70, 'data-offset-p': 100 }} />`,
};
const name = PAGE[0].toUpperCase() + PAGE.slice(1);
const title = `${name} | Henrique Menezzo`;
const description = $('meta[name="description"]').attr('content');
const body = root.prop('outerHTML').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace('<footer-slot></footer-slot>', FOOTERS[PAGE] ?? '<Footer />');
const astro = `---
import Base from '../layouts/Base.astro';
import Footer from '../components/Footer.astro';
import '../styles/cases/${PAGE}.css';
---

<Base title="${title.replace(/"/g, '&quot;')}" description="${(description ?? '').replace(/"/g, '&quot;')}" page="${PAGE}">
${body}
</Base>
`;
fs.writeFileSync(`${process.env.OUT ?? ROOT}/src/pages/${PAGE}.astro`, astro);

// Ordem importa: presets primeiro, para a cor própria de cada texto vencer em qualquer breakpoint.
const lines = [];
lines.push(...presetRules.filter((r) => !r.media).map((r) => r.text));
const presetMedia = {};
for (const r of presetRules.filter((x) => x.media)) (presetMedia[r.media] ??= []).push(r.text);
for (const [q, list] of Object.entries(presetMedia)) lines.push(`${q}{${list.join('')}}`);
for (const [k, v] of typeClasses) lines.push(`.${v}{${k}}`);
lines.push(...cssBase);
for (const [q, list] of Object.entries(cssMedia)) lines.push(`${q}{${list.join('')}}`);
lines.push(...bpRules);
const hiddenUsed = new Set((body.match(/hidden-\w+/g) ?? []));
for (const h of hiddenUsed) lines.push(`@media ${mqOf[h.replace('hidden-', '')]}{.${h}{display:none!important}}`);
fs.writeFileSync(`${process.env.OUT ?? ROOT}/src/styles/cases/${PAGE}.css`, lines.join('\n') + '\n');

console.log(PAGE, 'html', (body.length / 1024).toFixed(1) + 'KB', 'css', (lines.join('\n').length / 1024).toFixed(1) + 'KB', 'variantes restantes', (body.match(/ssr-variant/g) ?? []).length, 'motion', motion.size, 'sem mídia', [...missing]);
