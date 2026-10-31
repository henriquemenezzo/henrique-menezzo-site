// Parallax e transformações ligadas ao scroll, com as fórmulas do runtime do Framer.
// Cada frame escreve só nos elementos visíveis e nunca lê layout.

const BREAKPOINTS: [string, string][] = [
  ['Xl', '(min-width: 2560px)'],
  ['Lg', '(min-width: 1920px) and (max-width: 2559.98px)'],
  ['Md', '(min-width: 1440px) and (max-width: 1919.98px)'],
  ['Sm', '(min-width: 1200px) and (max-width: 1439.98px)'],
  ['T', '(min-width: 768px) and (max-width: 1199.98px)'],
  ['P', '(max-width: 767.98px)'],
];

type Item = {
  el: HTMLElement;
  rate: number;
  base: number;
  from?: number;
  to?: number;
  visible: boolean;
};

// Nos cases, de 1440 px para cima o layout é um só e quem cresce é o --zoom do Base.
const zoom = () => parseFloat(document.documentElement.style.getPropertyValue('--zoom')) || 1;
const currentBreakpoint = () => {
  const bp = BREAKPOINTS.find(([, q]) => matchMedia(q).matches)?.[0] ?? 'Sm';
  return document.body.dataset.page !== 'home' && (bp === 'Xl' || bp === 'Lg') ? 'Md' : bp;
};
const read = (el: HTMLElement, key: string, bp: string) => el.dataset[`${key}${bp}`] ?? el.dataset[key];

let items: Item[] = [];
let ranges: { el: HTMLElement; stops: number[]; values: number[] }[] = [];
let maxScroll = 1;
let frame = 0;
let observer: IntersectionObserver;

const docTop = (el: HTMLElement) => {
  const previous = el.style.translate;
  el.style.translate = 'none';
  const top = el.getBoundingClientRect().top + scrollY;
  el.style.translate = previous;
  return top;
};

// No Playground o Framer mede o rodapé com os vídeos ainda vazios, a 150 px de altura.
function emptyVideoShift() {
  const rows = new Map<number, number>();
  const rowTop = (el: Element) => Math.round(el.getBoundingClientRect().top + scrollY);
  document.querySelectorAll('video').forEach((video) => {
    rows.set(rowTop(video), video.getBoundingClientRect().height - 150 * zoom());
  });
  // Numa linha com imagem, a altura já vem da imagem e não cresce com o vídeo.
  document.querySelectorAll('main img, [data-page] img').forEach((img) => {
    if (!img.closest('.card')) rows.delete(rowTop(img));
  });
  return [...rows.values()].reduce((sum, growth) => sum + growth, 0);
}

function build() {
  const bp = currentBreakpoint();
  observer?.disconnect();
  items = [];
  // Observa o pai: o próprio elemento pode nascer recortado e só entrar na tela pelo deslocamento.
  observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        for (const item of items) if (item.el.parentElement === entry.target) item.visible = entry.isIntersecting;
      }
      schedule();
    },
    { rootMargin: '25% 0px' },
  );

  document.querySelectorAll<HTMLElement>('[data-speed],[data-x]').forEach((el) => {
    const speed = Number(read(el, 'speed', bp) ?? 100);
    const span = read(el, 'x', bp)?.split(',').map(Number);
    if (speed === 100 && !span) {
      el.style.translate = '';
      return;
    }
    const rate = 1 - speed / 100;
    const adjust = 'adjust' in el.dataset;
    const offset = Number(read(el, 'offset', bp) ?? 0);
    const shift = 'videoShift' in el.dataset ? emptyVideoShift() : 0;
    const item: Item = { el, rate, base: adjust ? docTop(el) - offset * zoom() - shift : 0, from: span?.[0], to: span?.[1], visible: false };
    items.push(item);
    observer.observe(el.parentElement!);
  });
  measure();
}

function measure() {
  maxScroll = Math.max(1, document.documentElement.scrollHeight - innerHeight);
  document.querySelectorAll<HTMLElement>('[data-range]').forEach(rangeSetup);
  schedule();
}

// Linhas de vídeo da home: faixas calculadas como o onScrollTarget do Framer (seção - viewport).
function rangeSetup(el: HTMLElement) {
  ranges = ranges.filter((r) => r.el !== el);
  const [a, b] = el.dataset.range!.split(',').map((s) => document.querySelector<HTMLElement>(s)!);
  const values = el.dataset.values!.split(',').map(Number);
  const startA = a.offsetTop - 1 - innerHeight;
  const startB = b.offsetTop - 1 - innerHeight;
  ranges.push({
    el,
    stops: [Math.max(startA, 0), Math.min(startA + a.clientHeight, startB - 1), Math.max(startB, 0), startB + b.clientHeight],
    values: [values[0], values[1], values[1], values[2]],
  });
}

const lerpStops = (y: number, stops: number[], values: number[]) => {
  if (y <= stops[0]) return values[0];
  for (let i = 1; i < stops.length; i++) {
    if (y <= stops[i]) {
      const span = stops[i] - stops[i - 1] || 1;
      return values[i - 1] + ((y - stops[i - 1]) / span) * (values[i] - values[i - 1]);
    }
  }
  return values[values.length - 1];
};

function update() {
  frame = 0;
  const y = scrollY;
  const scale = zoom(); // O zoom multiplica o translate: a conta da rolagem volta para a escala do layout.
  const progress = Math.min(1, Math.max(0, y / maxScroll));
  for (const item of items) {
    if (!item.visible) continue;
    const dy = ((item.base ? y - item.base : y) * item.rate) / scale;
    const dx = item.from === undefined ? 0 : item.from + (item.to! - item.from) * progress;
    item.el.style.translate = `${dx}px ${dy}px`;
  }
  for (const r of ranges) r.el.style.translate = `${lerpStops(y, r.stops, r.values)}px 0`;
}

function schedule() {
  if (!frame) frame = requestAnimationFrame(update);
}

export function initScroll() {
  addEventListener('scroll', schedule, { passive: true });
  build();
  let timer = 0;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = window.setTimeout(build, 150);
  });
  new ResizeObserver(measure).observe(document.body);
}
