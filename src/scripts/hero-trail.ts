// Rastro líquido do hero. Mesmos shaders da cena do Unicorn Studio, sem o runtime dele:
// roda só enquanto o ponteiro mexe, e para sozinho quando o rastro some.

const VERT = `#version 300 es
in vec2 aPos;
out vec2 vTextureCoord;
void main() {
  vTextureCoord = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const HSV = `
vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}`;

const TRAIL = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uPingPongTexture;
uniform vec2 uPreviousMousePos;
uniform vec2 uMousePos;
uniform vec2 uResolution;
const float PI = 3.1415926;
const float TWOPI = 6.2831852;
out vec4 fragColor;
${HSV}
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
mat2 rot(float a) { return mat2(cos(a), -sin(a), sin(a), cos(a)); }
vec2 liquify(vec2 st, vec2 dir, float strength) {
  float aspectRatio = uResolution.x / uResolution.y;
  st.x *= aspectRatio;
  st -= dir * 0.005;
  float amplitude = smoothstep(0.0, 1.0, strength) * 0.005;
  for (float i = 1.0; i <= 5.0; i++) {
    st = st * rot(i / 5.0 * PI * 2.0);
    st += vec2(amplitude * cos(i * 5.0 * st.y + strength), amplitude * sin(i * 5.0 * st.x + strength));
  }
  st.x /= aspectRatio;
  return st;
}
vec2 angleToDir(float angle) {
  float rad = angle * 2.0 * PI;
  return vec2(cos(rad), sin(rad));
}
void main() {
  float aspectRatio = uResolution.x / uResolution.y;
  vec2 aspectVec = vec2(aspectRatio, 1.0);
  vec2 uv = vTextureCoord;
  vec2 correctedUv = uv * aspectVec;
  vec2 dir = (uMousePos - uPreviousMousePos) * aspectVec;
  float dist = length(dir);
  if (dist > 0.0) dir = dir / dist; else dir = vec2(1.0, 0.0);
  float rad = 0.53 * 0.4 * mix(aspectRatio, 1.0, 0.5);
  float angle = atan(dir.y, dir.x);
  if (angle < 0.0) angle += TWOPI;
  vec3 lastFrameColor = texture(uPingPongTexture, uv).rgb;
  vec3 hsv = rgb2hsv(lastFrameColor);
  vec2 prevDir = angleToDir(hsv.x);
  uv = mix(uv, liquify(uv, prevDir / length(prevDir), hsv.z), 1.0);
  float t = dist > 0.0 ? clamp(dot(correctedUv - uPreviousMousePos * aspectVec, dir) / dist, 0.0, 1.0) : 0.0;
  vec2 closestPoint = mix(uPreviousMousePos, uMousePos, t) * aspectVec;
  float distanceToLine = distance(correctedUv, closestPoint);
  float shrink = mix(0.5, 1.0, clamp(dist * 20.0, 0.0, 1.0));
  rad *= shrink;
  float s = smoothstep(rad, 0.0, distanceToLine);
  s = s * s;
  vec3 mouseColor = hsv2rgb(vec3(angle / TWOPI, 1.0, 1.0));
  vec2 sampleUv = uv / 1.03 + 0.015;
  float blurRadius = 0.003;
  lastFrameColor = texture(uPingPongTexture, sampleUv).rgb * 0.4;
  lastFrameColor += texture(uPingPongTexture, sampleUv + vec2(blurRadius, 0.0)).rgb * 0.15;
  lastFrameColor += texture(uPingPongTexture, sampleUv + vec2(-blurRadius, 0.0)).rgb * 0.15;
  lastFrameColor += texture(uPingPongTexture, sampleUv + vec2(0.0, blurRadius)).rgb * 0.15;
  lastFrameColor += texture(uPingPongTexture, sampleUv + vec2(0.0, -blurRadius)).rgb * 0.15;
  lastFrameColor = pow(lastFrameColor, vec3(2.2));
  mouseColor = pow(mouseColor, vec3(2.2));
  lastFrameColor *= pow(0.01, 0.2);
  float clampedDist = clamp(min(1.0, dist * 10.0) * s, 0.0, 1.0);
  vec3 draw = mix(lastFrameColor, mouseColor, clampedDist);
  fragColor = vec4(pow(draw, vec3(1.0 / 2.2)), 1.0);
}`;

const SCENE = `#version 300 es
precision highp float;
in vec2 vTextureCoord;
uniform sampler2D uTexture;
uniform sampler2D uPingPongTexture;
const float PI = 3.1415926;
out vec4 fragColor;
${HSV}
vec2 angleToDir(float angle) {
  float rad = angle * 2.0 * PI;
  return vec2(cos(rad), sin(rad));
}
void main() {
  vec2 uv = vTextureCoord;
  vec3 mouseTrail = rgb2hsv(texture(uPingPongTexture, uv).rgb);
  float strength = mouseTrail.z * (0.16 * 1.5);
  vec2 mouseDir = angleToDir(mouseTrail.x) * strength;
  vec2 distorted = mouseDir * 0.4;
  uv -= distorted;
  vec4 color = texture(uTexture, uv);
  vec2 offset = distorted * 0.12;
  color.r = texture(uTexture, uv - offset).r;
  color.b = texture(uTexture, uv + offset).b;
  fragColor = color;
}`;

const IDLE_FRAMES = 45;
const FRAME_MS = 1000 / 61;
const TRAIL_WIDTH = 512;

type Point = { x: number; y: number };

// Desenha a foto inteira com o enquadramento do object-fit: cover. Nunca recorta pela origem:
// com srcset o naturalWidth vem corrigido pela densidade e o recorte sairia ampliado.
function drawCover(ctx: CanvasRenderingContext2D, media: HTMLImageElement, box: DOMRect, dpr: number) {
  const rect = media.getBoundingClientRect();
  const ratio = media.naturalWidth / media.naturalHeight;
  const width = rect.width / rect.height < ratio ? rect.height * ratio : rect.width;
  const height = width / ratio;
  const x = rect.left - box.left + (rect.width - width) / 2;
  const y = rect.top - box.top + (rect.height - height) / 2;
  ctx.drawImage(media, x * dpr, y * dpr, width * dpr, height * dpr);
}

export function createTrail(canvas: HTMLCanvasElement) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
  if (!gl) return null;

  const compile = (type: number, source: string) => {
    const shader = gl.createShader(type)!;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return shader;
  };
  const program = (fragment: string) => {
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fragment));
    gl.bindAttribLocation(p, 0, 'aPos');
    gl.linkProgram(p);
    return p;
  };

  const trail = program(TRAIL);
  const scene = program(SCENE);
  const u = {
    pingpong: gl.getUniformLocation(trail, 'uPingPongTexture'),
    mouse: gl.getUniformLocation(trail, 'uMousePos'),
    previous: gl.getUniformLocation(trail, 'uPreviousMousePos'),
    resolution: gl.getUniformLocation(trail, 'uResolution'),
    texture: gl.getUniformLocation(scene, 'uTexture'),
    scenePing: gl.getUniformLocation(scene, 'uPingPongTexture'),
  };

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  const texture = (filter: number) => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  };

  const photoTexture = texture(gl.LINEAR);
  const ping = [texture(gl.LINEAR), texture(gl.LINEAR)];
  const buffers = ping.map(() => gl.createFramebuffer()!);
  let pingIndex = 0;
  let trailHeight = 1;
  let photo: HTMLImageElement | null = null;
  const shot = document.createElement('canvas');
  const ctx = shot.getContext('2d')!;

  // A mídia entra na textura exatamente onde está na tela, com transparência preservada.
  function upload() {
    const box = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, shot.width, shot.height);
    ctx.imageSmoothingQuality = 'high';
    drawCover(ctx, photo!, box, Math.min(devicePixelRatio, 2));
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, photoTexture);
    gl!.pixelStorei(gl!.UNPACK_FLIP_Y_WEBGL, true);
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA, gl!.RGBA, gl!.UNSIGNED_BYTE, shot);
    gl!.pixelStorei(gl!.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl!.activeTexture(gl!.TEXTURE0);
  }

  function resize() {
    if (!photo) return;
    const box = canvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio, 2);
    canvas.width = shot.width = Math.round(box.width * dpr);
    canvas.height = shot.height = Math.round(box.height * dpr);
    trailHeight = Math.max(2, Math.round((TRAIL_WIDTH * box.height) / box.width));
    upload();

    ping.forEach((t, i) => {
      gl!.bindTexture(gl!.TEXTURE_2D, t);
      gl!.texImage2D(gl!.TEXTURE_2D, 0, gl!.RGBA8, TRAIL_WIDTH, trailHeight, 0, gl!.RGBA, gl!.UNSIGNED_BYTE, null);
      gl!.bindFramebuffer(gl!.FRAMEBUFFER, buffers[i]);
      gl!.framebufferTexture2D(gl!.FRAMEBUFFER, gl!.COLOR_ATTACHMENT0, gl!.TEXTURE_2D, t, 0);
      gl!.clearColor(0, 0, 0, 1);
      gl!.clear(gl!.COLOR_BUFFER_BIT);
    });
  }

  const target: Point = { x: 0.5, y: 0.5 };
  const mouse: Point = { x: 0.5, y: 0.5 };
  const previous: Point = { x: 0.5, y: 0.5 };
  let ticks = 0;
  let idle = 0;
  let running = false;
  let lastFrame = 0;

  const render = (now: number) => {
    if (now - lastFrame < FRAME_MS) {
      requestAnimationFrame(render);
      return;
    }
    lastFrame = now;

    // Suavização do Unicorn: momentum 1 equivale a se aproximar 1/8 do alvo por frame.
    const nextX = mouse.x + (target.x - mouse.x) / 8;
    const nextY = mouse.y + (target.y - mouse.y) / 8;
    if (ticks > 16) {
      previous.x = mouse.x;
      previous.y = mouse.y;
    } else {
      previous.x = nextX;
      previous.y = nextY;
    }
    mouse.x = nextX;
    mouse.y = nextY;
    ticks++;

    gl!.useProgram(trail);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, buffers[1 - pingIndex]);
    gl!.viewport(0, 0, TRAIL_WIDTH, trailHeight);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, ping[pingIndex]);
    gl!.uniform1i(u.pingpong, 0);
    gl!.uniform2f(u.mouse, mouse.x, mouse.y);
    gl!.uniform2f(u.previous, previous.x, previous.y);
    gl!.uniform2f(u.resolution, canvas.width, canvas.height);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    pingIndex = 1 - pingIndex;

    gl!.useProgram(scene);
    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    gl!.viewport(0, 0, canvas.width, canvas.height);
    gl!.bindTexture(gl!.TEXTURE_2D, ping[pingIndex]);
    gl!.uniform1i(u.scenePing, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, photoTexture);
    gl!.uniform1i(u.texture, 1);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
    canvas.style.opacity = '1';

    const moving = Math.abs(target.x - mouse.x) + Math.abs(target.y - mouse.y) > 0.0005;
    idle = moving ? 0 : idle + 1;
    if (idle > IDLE_FRAMES) {
      running = false;
      canvas.style.opacity = '0';
      return;
    }
    requestAnimationFrame(render);
  };

  const wake = () => {
    idle = 0;
    if (running) return;
    running = true;
    requestAnimationFrame(render);
  };

  return {
    resize,
    isRunning: () => running,
    show(media: HTMLImageElement, first: Point) {
      photo = media;
      resize();
      target.x = mouse.x = previous.x = first.x;
      target.y = mouse.y = previous.y = first.y;
      ticks = 0;
    },
    move(clientX: number, clientY: number) {
      const box = canvas.getBoundingClientRect();
      target.x = (clientX - box.left) / box.width;
      target.y = 1 - (clientY - box.top) / box.height;
      wake();
    },
  };
}

export function initTrail(canvas: HTMLCanvasElement, photo: HTMLImageElement, first: Point) {
  const trail = createTrail(canvas);
  if (!trail) return;
  trail.show(photo, first);

  let visible = true;
  new IntersectionObserver(([entry]) => (visible = entry.isIntersecting)).observe(canvas);

  addEventListener('mousemove', (e) => visible && trail.move(e.clientX, e.clientY), { passive: true });
  addEventListener('touchmove', (e) => visible && trail.move(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  addEventListener('resize', () => {
    if (!trail.isRunning()) trail.resize();
  });
  trail.move(innerWidth / 2, innerHeight / 2);
}
