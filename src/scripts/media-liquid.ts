// Distorção de imagens e vídeos: o mouse escreve a própria velocidade numa textura pequena, que
// se dissolve sozinha, e a imagem é lida deslocada por ela. É um rastro, como água: entorta onde o
// mouse passou, inclusive a borda do container, e volta ao lugar devagar. Parado, nada disso existe.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FLOW = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uFlow;
uniform vec2 uFrom;
uniform vec2 uTo;
uniform vec2 uVelocity;
uniform float uAspect;
uniform float uRadius;
uniform float uStrength;
uniform float uFade;
out vec4 color;

// Distância até o trecho percorrido no frame: mouse rápido deixa traço, não bolinhas.
float toPath(vec2 p, vec2 a, vec2 b) {
  vec2 path = b - a;
  float t = clamp(dot(p - a, path) / max(dot(path, path), 1e-6), 0.0, 1.0);
  return distance(p, a + path * t);
}

void main() {
  vec2 ratio = vec2(uAspect, 1.0);
  vec2 previous = texture(uFlow, vUv).xy * uFade;
  float near = 1.0 - smoothstep(0.0, uRadius, toPath(vUv * ratio, uFrom * ratio, uTo * ratio));
  color = vec4(mix(previous, uVelocity, near * near * uStrength), 0.0, 1.0);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTexture;
uniform sampler2D uFlow;
uniform vec4 uBox;
uniform vec4 uMap;
uniform vec2 uSize;
out vec4 color;

// Lê o container na posição dele dentro do canvas, com a borda suavizada em 1 px.
vec4 read(vec2 uv) {
  vec2 q = (uv - uBox.xy) / uBox.zw;
  vec2 pixel = 1.0 / (uSize * uBox.zw);
  vec2 edge = smoothstep(vec2(0.0), pixel, q) * smoothstep(vec2(0.0), pixel, 1.0 - q);
  return texture(uTexture, uMap.xy + q * uMap.zw) * edge.x * edge.y;
}

void main() {
  vec2 shift = texture(uFlow, vUv).xy / uSize;
  vec4 r = read(vUv - shift * 1.07);
  vec4 g = read(vUv - shift);
  vec4 b = read(vUv - shift * 0.93);
  color = vec4(r.r, g.g, b.b, max(r.a, max(g.a, b.a)));
}`;

const MARGIN = 56; // Folga em volta do container: é onde a borda entorta.
const MAX_FLOW = 40; // Deslocamento máximo, em px.
const RESPONSE = 3.2; // Sobe rápido no começo: até um mouse devagar entorta na hora.
const FLOW_WIDTH = 96;
const LENSES = 3; // Passar o mouse de card em card deixa os anteriores assentarem sozinhos.
const SCROLL_QUIET = 150; // ms sem rolagem até o efeito poder abrir de novo.

type Media = HTMLImageElement | HTMLVideoElement;
type Lens = NonNullable<ReturnType<typeof createLens>>;

const solid = (color: string) => color !== 'transparent' && !/, 0\)$/.test(color);
const sameSize = (a: DOMRect, b: DOMRect) => Math.abs(a.width - b.width) < 2 && Math.abs(a.height - b.height) < 2;
const corner = (value: string, size: number) => (value.endsWith('%') ? (parseFloat(value) / 100) * size : parseFloat(value));

// Desenhar imagem ainda não decodificada trava o primeiro hover: o decode roda antes, fora da thread principal.
const decoded = new WeakSet<Element>();
const ready = (media: Media) => {
  if (media instanceof HTMLVideoElement) return media.readyState >= 2;
  if (decoded.has(media)) return true;
  decode(media);
  return false;
};
const decode = (image: HTMLImageElement) => {
  image.decode().then(
    () => decoded.add(image),
    () => {},
  );
};

// Sobe da mídia até a caixa que o olho enxerga como dela: o card do carrossel, o bloco colorido
// em volta da tela. Para antes de pegar texto, ícone, faixa inteira ou a seção da página.
const boxes = new WeakMap<Element, HTMLElement>();
function containerOf(media: Media) {
  const known = boxes.get(media);
  if (known) return known;
  let box: HTMLElement = media;
  let rect = media.getBoundingClientRect();
  for (let el = media.parentElement; el && el !== document.body; el = el.parentElement) {
    const next = el.getBoundingClientRect();
    if (next.width >= innerWidth * 0.96 || el.textContent!.trim() || el.querySelector('svg')) break;
    if (solid(getComputedStyle(el).backgroundColor) || sameSize(next, rect)) {
      box = el;
      rect = next;
    }
  }
  boxes.set(media, box);
  return box;
}

function rounded(ctx: CanvasRenderingContext2D, style: CSSStyleDeclaration, rect: DOMRect, x: number, y: number) {
  const { borderTopLeftRadius: tl, borderTopRightRadius: tr, borderBottomRightRadius: br, borderBottomLeftRadius: bl } = style;
  ctx.beginPath();
  ctx.roundRect(x, y, rect.width, rect.height, [tl, tr, br, bl].map((v) => corner(v, rect.width)));
}

// Redesenha o container no canvas 2D exatamente como está na tela. Desenha sempre a mídia inteira:
// com srcset o naturalWidth vem corrigido pela densidade e recortar pela origem ampliaria a imagem.
function paint(ctx: CanvasRenderingContext2D, el: Element, left: number, top: number, bounds: DOMRect, root = false) {
  const rect = el.getBoundingClientRect();
  const media = el instanceof HTMLImageElement || el instanceof HTMLVideoElement;
  // Só a mídia pode ser descartada: a caixa de um pai pode estar fora e os filhos, dentro.
  if (media && (rect.right <= bounds.left || rect.left >= bounds.right || rect.bottom <= bounds.top || rect.top >= bounds.bottom)) return;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return;
  const opacity = root ? 1 : Number(style.opacity);
  if (!opacity) return;
  const x = rect.left - left;
  const y = rect.top - top;
  ctx.save();
  ctx.globalAlpha *= opacity;
  if (solid(style.backgroundColor)) {
    rounded(ctx, style, rect, x, y);
    ctx.fillStyle = style.backgroundColor;
    ctx.fill();
  }
  if (media) {
    const ratio = el instanceof HTMLVideoElement ? el.videoWidth / el.videoHeight : el.naturalWidth / el.naturalHeight;
    const width = rect.width / rect.height < ratio ? rect.height * ratio : rect.width;
    const height = width / ratio;
    rounded(ctx, style, rect, x, y);
    ctx.clip();
    ctx.drawImage(el, x + (rect.width - width) / 2, y + (rect.height - height) / 2, width, height);
  } else {
    if (style.overflow !== 'visible') {
      rounded(ctx, style, rect, x, y);
      ctx.clip();
    }
    for (const child of el.children) paint(ctx, child, left, top, bounds);
  }
  ctx.restore();
}

function createLens() {
  const canvas = document.createElement('canvas');
  canvas.className = 'liquid';
  canvas.setAttribute('aria-hidden', 'true');
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl || !(gl.getExtension('EXT_color_buffer_float') || gl.getExtension('EXT_color_buffer_half_float'))) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const link = (fragment: string) => {
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(program, 0, 'aPos');
    gl.linkProgram(program);
    return program;
  };
  const flow = link(FLOW);
  const display = link(FRAG);
  const inFlow = (name: string) => gl.getUniformLocation(flow, name);
  const f = {
    flow: inFlow('uFlow'),
    from: inFlow('uFrom'),
    to: inFlow('uTo'),
    velocity: inFlow('uVelocity'),
    aspect: inFlow('uAspect'),
    radius: inFlow('uRadius'),
    strength: inFlow('uStrength'),
    fade: inFlow('uFade'),
  };
  const inDisplay = (name: string) => gl.getUniformLocation(display, name);
  const u = { texture: inDisplay('uTexture'), flow: inDisplay('uFlow'), size: inDisplay('uSize'), box: inDisplay('uBox'), map: inDisplay('uMap') };

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };
  const flowTextures = [texture(), texture()];
  const flowBuffers = flowTextures.map(() => gl.createFramebuffer()!);
  const image = texture();
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  let flowIndex = 0;
  let flowHeight = 0;

  // A textura de fluxo guarda números com sinal, em px: precisa de ponto flutuante.
  const clearFlow = (height: number) => {
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    flowTextures.forEach((t, i) => {
      gl.bindTexture(gl.TEXTURE_2D, t);
      if (height !== flowHeight) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, FLOW_WIDTH, height, 0, gl.RGBA, gl.HALF_FLOAT, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, flowBuffers[i]);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    });
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    flowHeight = height;
  };

  clearFlow(FLOW_WIDTH);
  gl.useProgram(display);
  gl.drawArrays(gl.TRIANGLES, 0, 3); // Compila os shaders agora, e não no primeiro hover.
  gl.useProgram(flow);
  gl.drawArrays(gl.TRIANGLES, 0, 3);

  const shot = document.createElement('canvas');
  const ctx = shot.getContext('2d')!;

  let box: HTMLElement | null = null;
  let anchor: HTMLElement | null = null;
  const base = { x: 0, y: 0 };
  let margin = MARGIN;
  let inPlace = false;
  let video: HTMLVideoElement | null = null;
  let live = false;
  let scale = 1;
  let place = '';
  let dpr = 1;
  let shown = false;
  let opacity = '';
  let energy = 0;
  const velocity = { x: 0, y: 0 };
  const last = { x: 0, y: 0 };

  const upload = (rect: DOMRect) => {
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, image);
    if (video) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, shot.width, shot.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingQuality = 'high';
    paint(ctx, box!, rect.left - margin, rect.top - margin, rect, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, shot);
  };

  // Vídeo sozinho no container vai direto para a textura, sem passar pelo canvas 2D.
  const frameUp = (next: HTMLElement, rect: DOMRect) => {
    const media = next.matches('img, video') ? [next] : [...next.querySelectorAll('img, video')];
    video = media.length === 1 && media[0] instanceof HTMLVideoElement && !solid(getComputedStyle(next).backgroundColor) ? media[0] : null;
    live = !!video || media.some((m) => m instanceof HTMLVideoElement);
    const width = rect.width + margin * 2;
    const height = rect.height + margin * 2;
    gl.useProgram(display);
    if (!video) {
      gl.uniform4f(u.box, 0, 0, 1, 1);
      gl.uniform4f(u.map, 0, 0, 1, 1);
      return;
    }
    const ratio = video.videoWidth / video.videoHeight;
    const shownWidth = rect.width / rect.height < ratio ? rect.height * ratio : rect.width;
    const scaleX = rect.width / shownWidth;
    const scaleY = rect.height / (shownWidth / ratio);
    gl.uniform4f(u.box, margin / width, margin / height, rect.width / width, rect.height / height);
    gl.uniform4f(u.map, (1 - scaleX) / 2, (1 - scaleY) / 2, scaleX, scaleY);
  };

  return {
    canvas,
    get box() {
      return box;
    },
    open(next: HTMLElement, x: number, y: number) {
      const rect = next.getBoundingClientRect();
      const onCard = !!next.closest('.card');
      box = next;
      inPlace = rect.width >= innerWidth * 0.96;
      margin = inPlace ? 0 : MARGIN;
      dpr = Math.min(devicePixelRatio, 2);
      // Dentro do layout escalado dos cases, px de CSS valem zoom vezes mais na tela.
      scale = onCard ? 1 : parseFloat(document.documentElement.style.getPropertyValue('--zoom')) || 1;
      const width = Math.round((rect.width + margin * 2) * dpr);
      const height = Math.round((rect.height + margin * 2) * dpr);
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = shot.width = width;
        canvas.height = shot.height = height;
      }
      canvas.style.width = `${canvas.width / dpr / scale}px`;
      canvas.style.height = `${canvas.height / dpr / scale}px`;
      canvas.style.transform = 'none';
      // Fica ao lado do container, na mesma camada: recorte, ordem e rolagem vêm de graça do layout.
      if (onCard) next.parentElement!.append(canvas);
      else next.after(canvas);
      anchor = next.parentElement!;
      while (getComputedStyle(anchor).display === 'contents') anchor = anchor.parentElement!;
      const origin = canvas.getBoundingClientRect();
      const parent = anchor.getBoundingClientRect();
      base.x = origin.left - parent.left;
      base.y = origin.top - parent.top;
      frameUp(next, rect);
      upload(rect);
      clearFlow(Math.max(8, Math.round((FLOW_WIDTH * height) / width)));
      place = '';
      last.x = x;
      last.y = y;
      velocity.x = velocity.y = 0;
      energy = 2; // Vida mínima: mouse devagar não abre e fecha a cada frame.
      shown = false;
    },
    close() {
      if (!box) return;
      if (shown && !inPlace) box.style.opacity = opacity;
      canvas.remove();
      box = null;
      video = null;
      shown = false;
    },
    // Devolve false quando o rastro se dissolveu e a mídia original pode voltar.
    render(step: number, x: number, y: number, moved: { x: number; y: number }, over: boolean, scrolling: boolean) {
      const rect = box!.getBoundingClientRect();
      const left = Math.round((rect.left - margin) * dpr) / dpr;
      const top = Math.round((rect.top - margin) * dpr) / dpr;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;

      const follow = 1 - 0.5 ** step;
      const distance = Math.hypot(moved.x, moved.y);
      const push = over && distance ? Math.min(MAX_FLOW, RESPONSE * distance ** 0.8) / distance : 0;
      velocity.x += (moved.x * push - velocity.x) * follow;
      velocity.y += (moved.y * push - velocity.y) * follow;
      const fade = (scrolling ? 0.8 : 0.925) ** step;
      energy = Math.max(energy * fade, Math.hypot(velocity.x, velocity.y));
      if (energy < 0.4) return false;

      if (live) upload(rect);
      const parent = anchor!.getBoundingClientRect();
      const next = `translate3d(${(left - parent.left - base.x) / scale}px, ${(top - parent.top - base.y) / scale}px, 0)`;
      if (next !== place) canvas.style.transform = place = next;

      gl.useProgram(flow);
      gl.bindFramebuffer(gl.FRAMEBUFFER, flowBuffers[1 - flowIndex]);
      gl.viewport(0, 0, FLOW_WIDTH, flowHeight);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, flowTextures[flowIndex]);
      gl.uniform1i(f.flow, 1);
      gl.uniform2f(f.from, (last.x - left) / width, 1 - (last.y - top) / height);
      gl.uniform2f(f.to, (x - left) / width, 1 - (y - top) / height);
      gl.uniform2f(f.velocity, velocity.x, -velocity.y);
      gl.uniform1f(f.aspect, width / height);
      // O card anda com o mouse, que fica sempre no meio dele: precisa de alcance até a borda.
      gl.uniform1f(f.radius, Math.min(Math.min(rect.width, rect.height) * (scale === 1 && box!.matches('.card-box') ? 0.85 : 0.5), 420) / height);
      gl.uniform1f(f.strength, over ? 0.9 : 0);
      gl.uniform1f(f.fade, fade);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      flowIndex = 1 - flowIndex;
      last.x = x;
      last.y = y;

      gl.useProgram(display);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, flowTextures[flowIndex]);
      gl.uniform1i(u.flow, 1);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, image);
      gl.uniform1i(u.texture, 0);
      gl.uniform2f(u.size, width, height);
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      if (!shown) {
        shown = true;
        if (!inPlace) {
          opacity = box!.style.opacity;
          box!.style.opacity = '0';
        }
      }
      return true;
    },
  };
}

export function initMediaLiquid() {
  const card = document.querySelector<HTMLElement>('.card');
  const cardBox = document.querySelector<HTMLElement>('.card-box');
  const stack = document.querySelector<HTMLElement>('.card-stack');
  const pool: Lens[] = [];
  const active: Lens[] = [];
  const pointer = { x: 0, y: 0 };
  const seen = { x: 0, y: 0 };
  let frame = 0;
  let last = 0;
  let leaving = false;
  let scrolledAt = -Infinity;
  let over: HTMLElement | null = null;
  let stackAt = '';
  let frames = 0;

  const release = (lens: Lens) => {
    lens.close();
    active.splice(active.indexOf(lens), 1);
    pool.push(lens);
  };

  const boxAt = (x: number, y: number) => {
    if (card?.classList.contains('show')) {
      const panel = [...card.querySelectorAll<HTMLElement>('.panel')].find((item) => Math.abs(item.getBoundingClientRect().top - card.getBoundingClientRect().top) < 2);
      return !panel || [...panel.querySelectorAll('img')].map(ready).every(Boolean) ? cardBox : null;
    }
    for (const el of document.elementsFromPoint(x, y)) {
      if (el.closest('[data-photo], .card, [data-nav]')) continue;
      const media = (el.matches('img, video') ? el : el.querySelector('img, video')) as Media | null;
      if (!media) continue;
      const box = containerOf(media);
      if (!box.contains(el)) continue;
      if (box.getBoundingClientRect().width < 120) return null;
      const all = (box.matches('img, video') ? [box] : [...box.querySelectorAll('img, video')]) as Media[];
      return all.map(ready).every(Boolean) ? box : null;
    }
    return null;
  };

  const tick = (now: number) => {
    if (leaving) {
      frame = 0;
      return;
    }
    // O horário do frame pode ser anterior ao do evento que o pediu: sem o piso, o passo sai negativo.
    const step = Math.min(3, Math.max(0.25, (now - last) / 16.67));
    last = now;
    const moved = { x: pointer.x - seen.x, y: pointer.y - seen.y };
    seen.x = pointer.x;
    seen.y = pointer.y;

    // O ponto sob o mouse só muda quando ele anda; rolando, basta conferir de vez em quando.
    const speed = Math.hypot(moved.x, moved.y);
    if (speed || !(++frames % 8)) over = boxAt(pointer.x, pointer.y);
    const scrolling = now - scrolledAt < SCROLL_QUIET;
    const cardOn = !!over && over === cardBox;

    // Trocar de projeto desliza os painéis: nesse meio tempo o card é o DOM de verdade.
    const stackNow = stack?.style.transform ?? '';
    const sliding = stackNow !== stackAt;
    stackAt = stackNow;
    if (sliding) {
      const lens = active.find((item) => item.box === cardBox);
      if (lens) release(lens);
    }

    if (over && !scrolling && !(cardOn && sliding) && speed && !active.some((lens) => lens.box === over)) {
      const lens = take();
      if (lens) {
        lens.open(over, pointer.x - moved.x, pointer.y - moved.y);
        active.push(lens);
      }
    }

    for (let i = active.length - 1; i >= 0; i--) {
      if (!active[i].render(step, pointer.x, pointer.y, moved, active[i].box === over && !scrolling, scrolling)) release(active[i]);
    }
    frame = active.length ? requestAnimationFrame(tick) : 0;
  };

  // Sem lente livre, a mais antiga que já não está sob o mouse cede a vez: o hover nunca espera.
  const take = () => {
    if (!pool.length) {
      const oldest = active.find((lens) => lens.box !== over);
      if (oldest) release(oldest);
    }
    return pool.pop() ?? null;
  };

  const closeAll = () => {
    while (active.length) release(active[0]);
  };

  addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') return;
      pointer.x = e.clientX;
      pointer.y = e.clientY;
      if (frame || leaving) return;
      last = performance.now();
      frame = requestAnimationFrame(tick);
    },
    { passive: true },
  );
  addEventListener('scroll', () => (scrolledAt = performance.now()), { passive: true });
  addEventListener('resize', closeAll, { passive: true });
  // O WebGL demora para nascer: as lentes ficam prontas, uma por vez, antes de serem precisas.
  const later = (run: () => void) => ('requestIdleCallback' in window ? requestIdleCallback(run) : setTimeout(run, 200));
  // As imagens são decodificadas antes de chegarem perto do mouse, e as do card nem esperam o hover.
  const nearby = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        nearby.unobserve(entry.target);
        decode(entry.target as HTMLImageElement);
      }
    },
    { rootMargin: '50%' },
  );
  document.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
    if (image.closest('[data-photo]')) return;
    if (!image.closest('.card')) return nearby.observe(image);
    image.loading = 'eager';
    decode(image);
  });

  const prepare = () => {
    const lens = createLens();
    if (lens) pool.push(lens);
    if (lens && pool.length < LENSES) later(prepare);
  };
  later(prepare);
  // A página vai embora: o efeito não pode reabrir enquanto ela é fotografada.
  addEventListener('pageswap', () => {
    leaving = true;
    closeAll();
  });
  addEventListener('pageshow', () => (leaving = false));
}
