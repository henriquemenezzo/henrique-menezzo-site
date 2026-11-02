// Cursor próprio e card de preview. O loop só roda enquanto o card está se movendo.
const SPRING = { stiffness: 1100, damping: 80, mass: 1.5 }; // Segue o mouse em ~0,15 s.
const STACK = { stiffness: 1200, damping: 62, mass: 1 }; // Troca de projeto em ~0,2 s.
const EDGE = 16;

type Axis = { x: number; v: number };
const step = (a: Axis, target: number, s: typeof SPRING, dt: number) => {
  const force = -s.stiffness * (a.x - target) - s.damping * a.v;
  a.v += (force / s.mass) * dt;
  a.x += a.v * dt;
};

export function initCursor() {
  const dot = document.querySelector<HTMLElement>('.cursor')!;
  const card = document.querySelector<HTMLElement>('.card')!;
  const box = card.querySelector<HTMLElement>('.card-box')!;
  const stack = card.querySelector<HTMLElement>('.card-stack')!;
  const panels = [...card.querySelectorAll<HTMLElement>('.panel')];
  const nextCard = Number(document.body.dataset.next ?? 0);

  document.documentElement.classList.add('custom-cursor');

  // As imagens do card baixam já: no primeiro hover elas estão prontas, sem o fundo vazio piscando.
  card.querySelectorAll('img').forEach((image) => {
    image.loading = 'eager';
    image.decode().catch(() => {});
  });

  const pointer = { x: 0, y: 0 };
  const px: Axis = { x: 0, v: 0 };
  const py: Axis = { x: 0, v: 0 };
  const sy: Axis = { x: 0, v: 0 };
  let stackTarget = 0;
  let active = false;
  let running = false;
  let last = 0;

  // O card sempre cabe inteiro na janela, mesmo com o cursor encostado na borda.
  const targetX = () => Math.max(card.offsetWidth / 2 + EDGE, Math.min(innerWidth - card.offsetWidth / 2 - EDGE, pointer.x));
  const targetY = () => Math.max(card.offsetHeight / 2 + EDGE, Math.min(innerHeight - card.offsetHeight / 2 - EDGE, pointer.y));

  // O card entorta com a própria inércia: inclina e estica para o lado de onde veio, e volta
  // sozinho quando para. Sai da velocidade da mola, então nunca é um corte seco.
  const lean = (v: number, k: number, max: number) => Math.max(-max, Math.min(max, v * k));
  const paint = () => {
    card.style.transform = `translate3d(${px.x}px, ${py.x}px, 0)`;
    box.style.transform = `rotate(${lean(px.v, 0.003, 4)}deg) skew(${lean(-px.v, 0.004, 7)}deg, ${lean(py.v, 0.002, 4)}deg)`;
    stack.style.transform = `translate3d(0, ${sy.x}px, 0)`;
  };

  const tick = (now: number) => {
    const dt = Math.min(0.032, (now - last) / 1000);
    last = now;
    for (let i = 0; i < 4; i++) {
      step(px, targetX(), SPRING, dt / 4);
      step(py, targetY(), SPRING, dt / 4);
      step(sy, stackTarget, STACK, dt / 4);
    }
    paint();
    const settled = Math.abs(px.x - targetX()) + Math.abs(py.x - targetY()) + Math.abs(sy.x - stackTarget) < 0.2 && Math.abs(px.v) + Math.abs(py.v) + Math.abs(sy.v) < 2;
    if (settled && !active) running = false;
    else if (settled) {
      running = false;
      paint();
    } else requestAnimationFrame(tick);
  };

  const wake = () => {
    if (running) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(tick);
  };

  const cardIndex = (el: HTMLElement) => (el.dataset.card ? Number(el.dataset.card) : nextCard);

  // Com a página já em cache a troca não espera a rede.
  const fetched = new Set<string>();
  const prefetch = (el: HTMLElement) => {
    const href = (el as HTMLAnchorElement).href;
    if (!href || fetched.has(href)) return;
    fetched.add(href);
    const hint = document.createElement('link');
    hint.rel = 'prefetch';
    hint.href = href;
    document.head.append(hint);
  };

  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      dot.style.transform = `translate3d(${e.clientX}px, ${e.clientY}px, 0)`;
      if (!active) dot.classList.add('on');
      else wake();
    },
    { passive: true },
  );

  addEventListener(
    'pointerover',
    (e) => {
      const target = e.target as HTMLElement;
      const hit = target.closest<HTMLElement>('[data-cursor-card]');
      if (hit) {
        const index = cardIndex(hit);
        prefetch(hit);
        if (card.hidden) card.hidden = false;
        stackTarget = -index * panels[0].offsetHeight; // Altura de layout: inclinado, o retângulo da tela fica maior.
        box.style.backgroundColor = panels[index].dataset.tint ?? '';
        if (!active) {
          px.x = targetX();
          py.x = targetY();
          px.v = py.v = 0;
          if (!card.classList.contains('show')) {
            sy.x = stackTarget;
            sy.v = 0;
          }
          paint();
          card.classList.add('show');
          dot.classList.remove('on');
          active = true;
        }
        wake();
        return;
      }
      if (active) {
        active = false;
        card.classList.remove('show');
        dot.classList.add('on');
      }
      dot.classList.toggle('big', !!target.closest('a:not(.cta), button'));
    },
    { passive: true },
  );

  addEventListener('pointerdown', () => dot.classList.add('down'), { passive: true });
  addEventListener('pointerup', () => dot.classList.remove('down'), { passive: true });
  document.addEventListener('mouseleave', () => dot.classList.remove('on'));
  document.addEventListener('mouseenter', () => !active && dot.classList.add('on'));
}
