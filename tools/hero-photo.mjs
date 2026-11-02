// Monta a foto do hero a partir da imagem e da máscara extraídas do SVG do Unicorn.
// Nada aqui inventa conteúdo: primeiro limpa o serrilhado das bordas, depois recupera
// nitidez por deconvolução Richardson-Lucy e leva as sombras a preto neutro, de cima para baixo.
// Uso: node tools/hero-photo.mjs <pasta-hero-extraida>
import sharp from 'sharp';
import path from 'node:path';

const [, , DIR] = process.argv;
const ROOT = path.resolve(import.meta.dirname, '..');
const SIZE = 2800;
const PIXELS = SIZE * SIZE;
const k = SIZE / 2048; // Todos os raios abaixo foram calibrados em 2048 px.
const ratio = SIZE / 930;
const upscale = { width: Math.round(1129 * 0.837688 * ratio), height: Math.round(1184 * 0.836782 * ratio), fit: 'fill', kernel: 'lanczos3' };
const crop = { left: Math.round(8.768648 * ratio), top: 0, width: SIZE, height: SIZE };
const raw1 = { raw: { width: SIZE, height: SIZE, channels: 1 } };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

// Convolução gaussiana separável em ponto flutuante: o 8 bits do sharp arredondaria o que a deconvolução precisa.
function gaussian(source, sigma) {
  const radius = Math.ceil(sigma * 3);
  const kernel = new Float32Array(radius * 2 + 1);
  let total = 0;
  for (let i = -radius; i <= radius; i++) total += kernel[i + radius] = Math.exp(-(i * i) / (2 * sigma * sigma));
  for (let i = 0; i < kernel.length; i++) kernel[i] /= total;
  const row = new Float32Array(PIXELS);
  const out = new Float32Array(PIXELS);
  for (let y = 0; y < SIZE; y++) {
    const line = y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let t = -radius; t <= radius; t++) sum += source[line + clamp(x + t, 0, SIZE - 1)] * kernel[t + radius];
      row[line + x] = sum;
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let sum = 0;
      for (let t = -radius; t <= radius; t++) sum += row[clamp(y + t, 0, SIZE - 1) * SIZE + x] * kernel[t + radius];
      out[y * SIZE + x] = sum;
    }
  }
  return out;
}

// Filtro guiado pela própria imagem: apaga contraste menor que epsilon, como os blocos de
// compressão na pele, e deixa bordas de verdade intactas.
function flatten(source, sigma, epsilon) {
  const mean = gaussian(source, sigma);
  const square = new Float32Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) square[i] = source[i] * source[i];
  const meanSquare = gaussian(square, sigma);
  const a = new Float32Array(PIXELS);
  const b = new Float32Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) {
    const variance = Math.max(0, meanSquare[i] - mean[i] * mean[i]);
    a[i] = variance / (variance + epsilon);
    b[i] = mean[i] * (1 - a[i]);
  }
  const meanA = gaussian(a, sigma);
  const meanB = gaussian(b, sigma);
  const out = new Float32Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) out[i] = meanA[i] * source[i] + meanB[i];
  return out;
}

// Mínimo e máximo na vizinhança: a deconvolução não pode ultrapassar o que já existe em volta do pixel.
function localExtreme(source, radius, pick) {
  const pass = new Float32Array(PIXELS);
  const out = new Float32Array(PIXELS);
  for (let y = 0; y < SIZE; y++) {
    const line = y * SIZE;
    for (let x = 0; x < SIZE; x++) {
      let value = source[line + x];
      for (let t = -radius; t <= radius; t++) value = pick(value, source[line + clamp(x + t, 0, SIZE - 1)]);
      pass[line + x] = value;
    }
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let value = pass[y * SIZE + x];
      for (let t = -radius; t <= radius; t++) value = pick(value, pass[clamp(y + t, 0, SIZE - 1) * SIZE + x]);
      out[y * SIZE + x] = value;
    }
  }
  return out;
}

// Alisa ao longo de cada borda, nunca através dela: é o que tira o degrau de pixel da ampliação.
function alongEdges(source, passes) {
  let current = source;
  const sample = (from, x, y) => {
    const x0 = clamp(Math.floor(x), 0, SIZE - 2);
    const y0 = clamp(Math.floor(y), 0, SIZE - 2);
    const fx = clamp(x - x0, 0, 1);
    const fy = clamp(y - y0, 0, 1);
    const i = y0 * SIZE + x0;
    return (from[i] * (1 - fx) + from[i + 1] * fx) * (1 - fy) + (from[i + SIZE] * (1 - fx) + from[i + SIZE + 1] * fx) * fy;
  };
  for (let pass = 0; pass < passes; pass++) {
    const guide = gaussian(current, 2 * k);
    const next = Float32Array.from(current);
    for (let y = 1; y < SIZE - 1; y++) {
      for (let x = 1; x < SIZE - 1; x++) {
        const i = y * SIZE + x;
        const gx = (guide[i + 1] - guide[i - 1]) / 2;
        const gy = (guide[i + SIZE] - guide[i - SIZE]) / 2;
        const strength = Math.hypot(gx, gy);
        const weight = smooth(0.01, 0.032, strength); // Só bordas fortes: em pele isso desenharia ruído em forma de linhas.
        if (weight === 0) continue;
        const tx = -gy / strength;
        const ty = gx / strength;
        let sum = current[i] * 0.12; // Com os pares abaixo, os pesos somam exatamente 1.
        for (const [step, share] of [
          [1.2 * k, 0.2],
          [2.4 * k, 0.15],
          [3.6 * k, 0.09],
        ]) {
          sum += (sample(current, x + tx * step, y + ty * step) + sample(current, x - tx * step, y - ty * step)) * share;
        }
        next[i] = current[i] + (sum - current[i]) * weight;
      }
    }
    current = next;
  }
  return current;
}

function richardsonLucy(observed, sigma, iterations) {
  const estimate = Float32Array.from(observed);
  const relative = new Float32Array(PIXELS);
  for (let n = 0; n < iterations; n++) {
    const blurred = gaussian(estimate, sigma);
    for (let i = 0; i < PIXELS; i++) relative[i] = observed[i] / Math.max(blurred[i], 1e-4);
    const correction = gaussian(relative, sigma);
    for (let i = 0; i < PIXELS; i++) estimate[i] = clamp(estimate[i] * correction[i], 0, 1.4);
  }
  return estimate;
}

const rgbBytes = await sharp(`${DIR}/img1.png`).removeAlpha().resize(upscale).extract(crop).raw().toBuffer();
const maskBytes = await sharp(`${DIR}/img0.png`).extractChannel(0).resize(upscale).extract(crop).blur(1.2 * k).raw().toBuffer();
// Duas versões afastadas da borda: uma curta para cabelo e mão, outra longa para ombros e braços.
const nearEdge = await sharp(maskBytes, raw1).blur(5 * k).extractChannel(0).raw().toBuffer();
const farEdge = await sharp(maskBytes, raw1).blur(34 * k).extractChannel(0).raw().toBuffer();

// Contraste 1.08 da cena do Unicorn.
const contrast = (v) => clamp(1.08 * (v / 255 - 0.5) + 0.5, 0, 1);
const red = new Float32Array(PIXELS);
const green = new Float32Array(PIXELS);
const blue = new Float32Array(PIXELS);
const luma = new Float32Array(PIXELS);
for (let i = 0; i < PIXELS; i++) {
  red[i] = contrast(rgbBytes[i * 3]);
  green[i] = contrast(rgbBytes[i * 3 + 1]);
  blue[i] = contrast(rgbBytes[i * 3 + 2]);
  luma[i] = 0.2126 * red[i] + 0.7152 * green[i] + 0.0722 * blue[i];
}

// A cor vem separada da luz e levemente suavizada: é nela que moram os blocos de compressão.
const chroma = (channel) => {
  const diff = new Float32Array(PIXELS);
  for (let i = 0; i < PIXELS; i++) diff[i] = channel[i] - luma[i];
  return gaussian(diff, 1.8 * k);
};
const [cr, cg, cb] = [chroma(red), chroma(green), chroma(blue)];

// Limpeza mínima: o filtro só tira o degrau dos blocos de compressão e deixa a textura da pele.
// Alisar mais que isso deixa o rosto com cara de retoque.
const clean = alongEdges(flatten(luma, 2 * k, 0.00006), 2);

const restored = richardsonLucy(clean, 1.45 * k, 13);
const lowest = localExtreme(clean, Math.round(3 * k), Math.min);
const highest = localExtreme(clean, Math.round(3 * k), Math.max);
const soft = gaussian(clean, 1.6 * k);
const broad = gaussian(clean, 28 * k);
const gap = Math.round(2 * k);

// A restauração entra forte em bordas (cílios, óculos, cabelo) e de leve na pele, para ela
// continuar com textura de foto sem virar resto de compressão.
const out = Buffer.alloc(PIXELS * 3);
for (let y = 0; y < SIZE; y++) {
  const down = smooth(0.5, 0.74, y / SIZE);
  for (let x = 0; x < SIZE; x++) {
    const i = y * SIZE + x;
    const alpha = maskBytes[i] / 255;
    if (alpha === 0) continue;

    const left = soft[clamp(i - gap, 0, PIXELS - 1)];
    const right = soft[clamp(i + gap, 0, PIXELS - 1)];
    const up = soft[clamp(i - gap * SIZE, 0, PIXELS - 1)];
    const under = soft[clamp(i + gap * SIZE, 0, PIXELS - 1)];
    const edge = smooth(0.012, 0.075, Math.hypot(right - left, under - up));
    const amount = 0.18 + 0.55 * edge;

    const limited = clamp(restored[i], lowest[i] - 0.045, highest[i] + 0.045);
    let l = clean[i] + (limited - clean[i]) * amount;
    l += (clean[i] - broad[i]) * 0.08; // Claridade: contraste local em raio largo.

    // Sombra profunda usa a versão suave, para os blocos de compressão não aparecerem ao escurecer.
    l = soft[i] + (l - soft[i]) * smooth(0.03, 0.14, l);
    // Sombras viram preto de verdade, cada vez mais forte para baixo.
    l *= smooth(0.004 + 0.018 * down, 0.03 + 0.09 * down, l);

    // Vinheta em volta do rosto e da mão: o corpo afunda no fundo.
    const distance = Math.hypot((x / SIZE - 0.5) / 0.6, (y / SIZE - 0.38) / 0.62);
    const vignette = 1 - 0.9 * smooth(0.68, 1.2, distance);

    // Borda: curta em cima, longa nos ombros, sempre sobre a máscara original.
    const fade = smooth(0.08, 0.55, nearEdge[i] / 255) * (1 - down) + smooth(0.34, 1, farEdge[i] / 255) * down;

    const body = alpha * fade * vignette;
    const saturation = smooth(0.03, 0.24, l); // Sombra neutra: sem o verde da blusa.
    out[i * 3] = clamp((l + cr[i] * saturation) * body, 0, 1) * 255;
    out[i * 3 + 1] = clamp((l + cg[i] * saturation) * body, 0, 1) * 255;
    out[i * 3 + 2] = clamp((l + cb[i] * saturation) * body, 0, 1) * 255;
  }
}

const master = await sharp(out, { raw: { width: SIZE, height: SIZE, channels: 3 } }).png().toBuffer();
for (const [w, quality] of [
  [1400, 84],
  [2000, 86],
  [SIZE, 88],
]) {
  const img = sharp(master).resize(w, null, { kernel: 'lanczos3' });
  await img.clone().avif({ quality, effort: 8, chromaSubsampling: '4:4:4' }).toFile(`${ROOT}/public/img/hero-${w}.avif`);
  await img.clone().webp({ quality: Math.min(96, quality + 8), effort: 6 }).toFile(`${ROOT}/public/img/hero-${w}.webp`);
}
