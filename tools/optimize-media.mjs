// Converte os originais do Framer em AVIF/WebP e H.264 leves, e grava src/data/media.json.
// Uso: node tools/optimize-media.mjs <pasta-originais> <pasta-site-raw> <pasta-dumps>
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import sharp from 'sharp';

const [, , ORIG, RAW, DUMPS] = process.argv;
const ROOT = path.resolve(import.meta.dirname, '..');
const PAGES = ['home', 'tex', 'babel', 'dare', 'goldcare', 'playground'];
const HASH = /https:\/\/framerusercontent\.com\/(?:images|assets)\/([A-Za-z0-9_-]+\.(?:png|jpe?g|gif|mp4))/g;

// Ordem de aparição por página, para nomes legíveis (tex-01, tile-03...).
const owner = new Map();
const bundle = fs.readdirSync(`${RAW}/js`).filter((f) => /shared-lib|xz2cdR8yC|JuyYCTbtS|^bHd/.test(f));
for (const page of PAGES) {
  const html = fs.readFileSync(`${RAW}/pages/${page}.html`, 'utf8');
  for (const [, file] of html.matchAll(HASH)) if (!owner.has(file)) owner.set(file, page);
}
for (const f of bundle) {
  const src = fs.readFileSync(`${RAW}/js/${f}`, 'utf8');
  for (const [, file] of src.matchAll(HASH)) if (!owner.has(file)) owner.set(file, 'card');
}

// Tamanho renderizado real em cada largura de tela vem das medições do site original.
const need = new Map();
// 1440 a 2.7x cobre o layout maior de 1920+ em tela retina, como o iMac 4.5K.
const SCALE = { 1440: 2.7, 1024: 2, 390: 3 };
for (const dump of fs.readdirSync(DUMPS)) {
  const vw = +dump.match(/-(\d+)\.txt$/)[1];
  for (const line of fs.readFileSync(`${DUMPS}/${dump}`, 'utf8').split('\n')) {
    const m = line.match(/ (-?[\d.]+),(-?[\d.]+),([\d.]+),([\d.]+) .*src=([A-Za-z0-9_-]+\.\w+)/);
    if (!m) continue;
    const [, , , w, h, file] = m;
    const prev = need.get(file) ?? [];
    prev.push({ w: +w * SCALE[vw], h: +h * SCALE[vw] });
    need.set(file, prev);
  }
}

const out = {};
const counters = {};
const nameFor = (file, kind) => {
  const group = owner.get(file) ?? 'misc';
  const key = kind === 'video' && group === 'home' ? 'tile' : group;
  counters[key] = (counters[key] ?? 0) + 1;
  return `${key}-${String(counters[key]).padStart(2, '0')}`;
};

const images = [...owner.keys()].filter((f) => /\.(png|jpe?g)$/.test(f) && fs.existsSync(`${ORIG}/${f}`));
const videos = [...owner.keys()].filter((f) => /\.(mp4|gif)$/.test(f) && fs.existsSync(`${ORIG}/${f}`));

await Promise.all(
  images.map(async (file) => {
    const name = nameFor(file, 'image');
    const input = `${ORIG}/${file}`;
    const { width, height, hasAlpha } = await sharp(input).metadata();
    const ratio = width / height;
    const asks = need.get(file) ?? [{ w: 1400, h: 0 }];
    const target = Math.max(...asks.map((a) => Math.max(a.w, a.h * ratio)));
    const cap = Math.min(width, Math.max(320, Math.ceil(target)));
    const widths = cap >= 1000 ? [Math.round(cap / 2), cap] : [cap];
    for (const w of widths) {
      const base = sharp(input).resize({ width: w, withoutEnlargement: true });
      await base.clone().avif({ quality: 74, effort: 6, chromaSubsampling: '4:4:4' }).toFile(`${ROOT}/public/img/${name}-${w}.avif`);
      await base.clone().webp({ quality: 88, effort: 5, alphaQuality: 95 }).toFile(`${ROOT}/public/img/${name}-${w}.webp`);
    }
    out[file] = { kind: 'image', name, w: cap, h: Math.round(cap / ratio), widths, alpha: !!hasAlpha };
  }),
);

for (const file of videos) {
  const name = nameFor(file, 'video');
  const probe = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', `${ORIG}/${file}`]).toString().trim().split('\n')[0].split(',').map(Number);
  const [w, h] = probe;
  const tile = w === 1310;
  const gif = file.endsWith('.gif');
  const phone = h > w;
  const width = gif ? w : tile ? 1100 : phone ? 864 : Math.min(w, 1794);
  const fps = gif ? 25 : 60;
  out[file] = { kind: 'video', name, w: width, h: Math.round((width * h) / w / 2) * 2, fps, crf: gif ? 22 : 23 };
}

fs.writeFileSync(`${ROOT}/src/data/media.json`, JSON.stringify(out, null, 1));

// Fila de vídeos para rodar em paralelo fora do processo Node.
const jobs = Object.entries(out).filter(([, v]) => v.kind === 'video').map(([file, v]) => [file, v.name, v.w, v.fps, v.crf].join('\t'));
fs.writeFileSync(`${ROOT}/tools/video-jobs.tsv`, jobs.join('\n') + '\n');
console.log('imagens', images.length, 'videos', videos.length, 'sem uso', fs.readdirSync(ORIG).filter((f) => /\.(png|jpe?g|gif|mp4)$/.test(f) && !owner.has(f)).length);
