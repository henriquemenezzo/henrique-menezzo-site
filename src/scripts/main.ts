import { initScroll } from './scroll';
import { initVideos } from './videos';

const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

initScroll();
initVideos();

if (finePointer) {
  import('./cursor').then(({ initCursor }) => initCursor());
}

// Só no desktop: no celular a rolagem nativa é mais leve e mais fluida.
if (finePointer && !reduced) {
  import('lenis').then(({ default: Lenis }) => {
    const lenis = new Lenis({ lerp: 0.085, autoRaf: false }); // Segue a roda amortecido: suave sem ficar arrastado.

    // O loop só existe durante a rolagem: parado, a página não produz frame nenhum.
    // O relógio é limitado para o primeiro frame após o repouso não pular a animação.
    let frame = 0;
    let clock = 0;
    let last = 0;
    let lastInput = 0;
    const loop = (now: number) => {
      clock += Math.min(now - last, 34);
      last = now;
      lenis.raf(clock);
      frame = lenis.isScrolling || now - lastInput < 150 ? requestAnimationFrame(loop) : 0;
    };
    const wake = () => {
      lastInput = performance.now();
      if (frame) return;
      last = lastInput;
      frame = requestAnimationFrame(loop);
    };
    addEventListener('wheel', wake, { passive: true });

    document.addEventListener('click', (e) => {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href*="#"]');
      if (!link || link.pathname !== location.pathname || !link.hash) return;
      const target = document.querySelector<HTMLElement>(link.hash);
      if (!target) return;
      e.preventDefault();
      lenis.scrollTo(target);
      wake();
    });
  });
}

// Menu do tablet e do celular.
const nav = document.querySelector<HTMLElement>('[data-nav]');
if (nav) {
  const toggle = nav.querySelector<HTMLElement>('[data-menu-toggle]')!;
  const set = (open: boolean) => {
    nav.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
    document.documentElement.classList.toggle('menu-open', open);
  };
  toggle.addEventListener('click', () => set(!nav.classList.contains('open')));
  nav.querySelectorAll('.menu a').forEach((a) => a.addEventListener('click', () => set(false)));

  // Sobre a seção branca a barra inverte, como a variante de scroll do Framer.
  const about = document.querySelector<HTMLElement>('#about');
  if (about) {
    let start = 0;
    let end = 0;
    const invert = () => nav.classList.toggle('light', scrollY >= start && scrollY < end);
    const measure = () => {
      start = about.offsetTop - 1;
      end = start + about.clientHeight;
      invert();
    };
    addEventListener('scroll', invert, { passive: true });
    addEventListener('resize', measure, { passive: true });
    new ResizeObserver(measure).observe(document.body);
  }
}


// O WebGL do hero só existe depois do primeiro movimento do ponteiro.
const canvas = document.querySelector<HTMLCanvasElement>('[data-trail]');
const photo = document.querySelector<HTMLImageElement>('[data-photo] img');
if (canvas && photo && !reduced) {
  const start = (x: number, y: number) => {
    removeEventListener('mousemove', onMouse);
    removeEventListener('touchmove', onTouch);
    const box = canvas.getBoundingClientRect();
    const first = { x: (x - box.left) / box.width, y: 1 - (y - box.top) / box.height };
    const boot = () => import('./hero-trail').then(({ initTrail }) => initTrail(canvas, photo, first));
    if (photo.complete) boot();
    else photo.addEventListener('load', boot, { once: true });
  };
  const onMouse = (e: MouseEvent) => start(e.clientX, e.clientY);
  const onTouch = (e: TouchEvent) => start(e.touches[0].clientX, e.touches[0].clientY);
  addEventListener('mousemove', onMouse, { passive: true });
  addEventListener('touchmove', onTouch, { passive: true });
}
