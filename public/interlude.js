// Interludes for the gaps between scheduled programmes. In the spirit of
// BBC Two's 1990s idents, the channel's own number is the star of a short
// animation; between idents, and for the final stretch, a clock counts down
// to the next programme. Everything is drawn live on a canvas.

import * as sound from './sound.js';

const W = 1024, H = 768;
const IDENT_MS = 7_000;
const CLOCK_MS = 20_000;
const FONT = 'Bedstead, monospace';
const BIG = '900 1px "Helvetica Neue", Arial, sans-serif';
const TELETEXT = ['#f00', '#0f0', '#ff0', '#00f', '#f0f', '#0ff', '#fff'];

let raf = 0;
let run = null;
let conditions = null;

const ease = (p) => 1 - (1 - p) ** 3;
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const rand = (a, b) => a + Math.random() * (b - a);

function bounce(p) {
  const n = 7.5625, d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

function poly(ctx, points, fill) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function text(ctx, str, x, y, size, colour, align = 'center', font = FONT) {
  ctx.font = `${size}px ${font}`;
  ctx.fillStyle = colour;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(str, x, y);
}

// The wordmark and channel name every ident ends on.
function caption(ctx, p, info, dark = false, band = false) {
  const a = clamp((p - 0.62) / 0.12);
  if (!a) return;
  ctx.globalAlpha = a;
  if (band) {
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, H - 155, W, 115);
  }
  text(ctx, 'TELETEXTUAL', W / 2, H - 120, 46, dark ? '#111' : '#fff');
  text(ctx, info.name.toUpperCase(), W / 2, H - 70, 30, dark ? '#a00' : '#0ff');
  ctx.globalAlpha = 1;
}

// A big smooth numeral, drawn as a mask the idents can paint through.
function numberMask(str, height) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const m = c.getContext('2d');
  m.font = BIG.replace('1px', `${height}px`);
  const width = m.measureText(str).width;
  const scale = Math.min(1, (W * 0.8) / width);
  m.font = BIG.replace('1px', `${Math.round(height * scale)}px`);
  m.textAlign = 'center';
  m.textBaseline = 'middle';
  m.fillStyle = '#fff';
  m.fillText(str, W / 2, H * 0.44);
  return c;
}

// --- Mosaic: teletext blocks tumble down and stack into the number --------

const DIGITS = {
  0: ['###', '#.#', '#.#', '#.#', '###'], 1: ['.#.', '##.', '.#.', '.#.', '###'],
  2: ['##.', '..#', '.#.', '#..', '###'], 3: ['##.', '..#', '.#.', '..#', '##.'],
  4: ['#.#', '#.#', '###', '..#', '..#'], 5: ['###', '#..', '##.', '..#', '##.'],
  6: ['.##', '#..', '###', '#.#', '###'], 7: ['###', '..#', '.#.', '.#.', '.#.'],
  8: ['###', '#.#', '###', '#.#', '###'], 9: ['###', '#.#', '###', '..#', '##.'],
};

const mosaic = {
  setup(info) {
    const str = String(info.number);
    const cols = str.length * 4 - 1;
    const pixel = Math.min((W * 0.7) / cols, (H * 0.5) / 5);
    const left = (W - cols * pixel) / 2, top = H * 0.44 - 2.5 * pixel;
    const blocks = [];
    [...str].forEach((d, n) => {
      DIGITS[d].forEach((row, r) => [...row].forEach((on, c) => {
        if (on !== '#') return;
        // Each lit pixel is a 2x3 cell of sextant blocks, as on teletext.
        for (let sy = 0; sy < 3; sy++) for (let sx = 0; sx < 2; sx++) {
          const y = top + r * pixel + (sy * pixel) / 3;
          blocks.push({
            x: left + (n * 4 + c) * pixel + (sx * pixel) / 2,
            y,
            w: pixel / 2, h: pixel / 3,
            from: rand(-H * 0.6, -60),
            delay: ((top + 5 * pixel - y) / (5 * pixel)) * 0.32 + rand(0, 0.1),
            colour: TELETEXT[Math.floor(rand(0, TELETEXT.length))],
          });
        }
      }));
    });
    return { blocks };
  },
  draw(ctx, p, t, info, s) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    for (const b of s.blocks) {
      const local = clamp((p - b.delay) / 0.16);
      if (!local) continue;
      const y = b.from + (b.y - b.from) * bounce(local);
      // Once everything has landed, colours ripple across the number.
      const settled = p > 0.62;
      ctx.fillStyle = settled ? TELETEXT[Math.floor(b.x / 60 + t / 120) % TELETEXT.length] : b.colour;
      ctx.fillRect(b.x + 1, y + 1, b.w - 2, b.h - 2);
    }
    caption(ctx, p, info);
  },
};

// --- Paint: balloons burst on the number, lit as wet paint ---------------
// Splats, drips and droplets are drawn into a colour layer and a thickness
// layer. A WebGL pass then lights them: the thickness gives each point a
// slope, so paint ridges catch the light and wet surfaces shine. The
// numeral gets a bevel and a cast shadow the same way.

const PAINT = ['#e8202a', '#1f6fd6', '#f4c20d', '#22a04b', '#9b2fc2', '#ff7a00'];
const GROW_MS = 140;     // a splat spreading on impact
const GRAVITY = 0.0016;  // px per ms per ms

// Two passes of a separable box blur over one channel.
function blur(src, r) {
  let a = Float32Array.from(src);
  const b = new Float32Array(W * H);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < H; y++) {
      const row = y * W;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += a[row + Math.min(W - 1, Math.max(0, x))];
      for (let x = 0; x < W; x++) {
        b[row + x] = sum / (2 * r + 1);
        sum += a[row + Math.min(W - 1, x + r + 1)] - a[row + Math.max(0, x - r)];
      }
    }
    for (let x = 0; x < W; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += b[Math.min(H - 1, Math.max(0, y)) * W + x];
      for (let y = 0; y < H; y++) {
        a[y * W + x] = sum / (2 * r + 1);
        sum += b[Math.min(H - 1, y + r + 1) * W + x] - b[Math.max(0, y - r) * W + x];
      }
    }
  }
  return a;
}

const VERTEX = `
attribute vec2 pos;
varying vec2 uv;
void main() {
  uv = vec2(pos.x * 0.5 + 0.5, 0.5 - pos.y * 0.5);
  gl_Position = vec4(pos, 0.0, 1.0);
}`;

const FRAGMENT = `
precision mediump float;
varying vec2 uv;
uniform sampler2D paint;   // rgba colour
uniform sampler2D thick;   // r: paint thickness
uniform sampler2D form;    // r: numeral bevel, g: numeral mask, b: cast shadow
uniform vec2 texel;
float height(vec2 p) {
  return texture2D(form, p).r * 0.55 + texture2D(thick, p).r * 0.9;
}
void main() {
  vec4 f = texture2D(form, uv);
  vec4 c = texture2D(paint, uv);
  vec3 wall = mix(vec3(0.95, 0.93, 0.89), vec3(0.79, 0.75, 0.69), uv.y);
  wall *= 1.0 - 0.38 * f.b * (1.0 - f.g);
  vec3 base = mix(wall, vec3(0.97, 0.97, 0.96), f.g);
  vec3 colour = mix(base, c.rgb, c.a);
  float dx = height(uv + vec2(texel.x, 0.0)) - height(uv - vec2(texel.x, 0.0));
  float dy = height(uv + vec2(0.0, texel.y)) - height(uv - vec2(0.0, texel.y));
  vec3 n = normalize(vec3(-dx * 7.0, dy * 7.0, 1.0));
  vec3 light = normalize(vec3(-0.45, 0.55, 0.7));
  float diffuse = 0.72 + 0.4 * dot(n, light);
  float gloss = 0.12 + 0.88 * c.a;
  float spec = pow(max(dot(n, normalize(light + vec3(0.0, 0.0, 1.0))), 0.0), 70.0) * gloss;
  gl_FragColor = vec4(colour * diffuse + spec * 0.85, 1.0);
}`;

// One lighting pass, shared by every paint ident (browsers allow only a few
// WebGL contexts). Null where WebGL isn't available.
let lighting;
function getLighting() {
  if (lighting !== undefined) return lighting;
  lighting = null;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const gl = canvas.getContext('webgl', { preserveDrawingBuffer: true });
  if (!gl) return null;
  const shader = (type, src) => {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    return sh;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, shader(gl.VERTEX_SHADER, VERTEX));
  gl.attachShader(prog, shader(gl.FRAGMENT_SHADER, FRAGMENT));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const pos = gl.getAttribLocation(prog, 'pos');
  gl.enableVertexAttribArray(pos);
  gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
  gl.uniform2f(gl.getUniformLocation(prog, 'texel'), 1.5 / W, 1.5 / H);
  const textures = ['paint', 'thick', 'form'].map((name, i) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    for (const p of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T]) gl.texParameteri(gl.TEXTURE_2D, p, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.uniform1i(gl.getUniformLocation(prog, name), i);
    return tex;
  });
  const upload = (i, source) => {
    gl.activeTexture(gl.TEXTURE0 + i);
    gl.bindTexture(gl.TEXTURE_2D, textures[i]);
    if (source instanceof Uint8Array) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, source);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  };
  lighting = {
    canvas,
    setForm: (data) => upload(2, data),
    render(paintLayer, thickLayer) {
      upload(0, paintLayer);
      upload(1, thickLayer);
      gl.viewport(0, 0, W, H);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    },
  };
  return lighting;
}

// A splat's outline: a wobbly blob with a few long fingers.
function blobShape() {
  return {
    waves: Array.from({ length: 6 }, (_, k) => ({ k: k + 2, a: rand(0.02, 0.1) / (k + 1) * 3, ph: rand(0, Math.PI * 2) })),
    fingers: Array.from({ length: Math.floor(rand(5, 10)) }, () => ({ at: rand(0, Math.PI * 2), w: rand(0.06, 0.16), len: rand(0.4, 1.2) })),
  };
}

function blobRadius(shape, angle) {
  let r = 1;
  for (const w of shape.waves) r += w.a * Math.sin(w.k * angle + w.ph);
  for (const f of shape.fingers) {
    let d = Math.abs(angle - f.at) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    r += f.len * Math.exp(-((d / f.w) ** 2));
  }
  return r;
}

function blobPath(c, x, y, r, shape) {
  c.beginPath();
  for (let i = 0; i <= 96; i++) {
    const a = (i / 96) * Math.PI * 2, rr = r * blobRadius(shape, a);
    i ? c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr) : c.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
}

// Teardrops thrown off the end of each finger.
function teardrops(c, x, y, r, shape, fill) {
  c.fillStyle = fill;
  for (const f of shape.fingers) {
    for (let j = 1; j <= 3; j++) {
      const d = r * (1 + f.len + 0.22 * j), size = (r * 0.11) / j;
      c.beginPath();
      c.ellipse(x + Math.cos(f.at) * d, y + Math.sin(f.at) * d, size * 1.7, size, f.at, 0, Math.PI * 2);
      c.fill();
    }
  }
}

function insideNumber(s, x, y) {
  const xi = Math.round(x), yi = Math.round(y);
  return xi >= 0 && yi >= 0 && xi < W && yi < H && s.inside[yi * W + xi] > 128;
}

const paint = {
  setup(info) {
    const mask = numberMask(String(info.number), 560);
    const alpha = mask.getContext('2d').getImageData(0, 0, W, H).data;
    const inside = new Uint8Array(W * H);
    const m = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) { inside[i] = alpha[i * 4 + 3]; m[i] = alpha[i * 4 + 3] / 255; }

    const layer = () => {
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      return c;
    };
    const colour = layer(), thick = layer(), tmp = layer();
    const tctx = thick.getContext('2d');
    tctx.fillStyle = '#000';
    tctx.fillRect(0, 0, W, H);

    const light = getLighting();
    if (light) {
      // The numeral's bevel (a softened edge) and the shadow it casts.
      const bevel = blur(m, 7), soft = blur(m, 16);
      const form = new Uint8Array(W * H * 4);
      for (let y = 0; y < H; y++) {
        for (let x = 0; x < W; x++) {
          const i = y * W + x, sx = x - 14, sy = y - 20;
          form[i * 4] = m[i] ? bevel[i] * 255 : 0;
          form[i * 4 + 1] = m[i] * 255;
          form[i * 4 + 2] = sx >= 0 && sy >= 0 ? soft[sy * W + sx] * 255 : 0;
          form[i * 4 + 3] = 255;
        }
      }
      light.setForm(form);
    }

    // Each balloon aims at a point on the numeral, working across it in
    // bands so thin digits get their share.
    const target = (band) => {
      for (let tries = 0; tries < 200; tries++) {
        const x = W * (0.15 + 0.175 * band) + rand(0, W * 0.175), y = rand(H * 0.12, H * 0.78);
        if (insideNumber({ inside }, x, y)) return [x, y];
      }
      return [W / 2, H * 0.44];
    };
    const shots = Array.from({ length: 10 }, (_, i) => {
      const [x, y] = target(i % 4);
      // Lobbed in from below or the sides, by throwers just out of shot.
      const side = Math.floor(rand(0, 3));
      const fromX = side === 0 ? -80 : side === 1 ? W + 80 : rand(W * 0.1, W * 0.9);
      const fromY = side === 2 ? H + 80 : rand(H * 0.55, H + 60);
      const flight = rand(850, 1150);
      // It rises above the target, then drops onto it. Pick how far above,
      // then the gravity and launch speed that fit the flight time.
      const below = fromY - y, apex = Math.max(rand(80, 200), 60 - below);
      const g = (2 * (Math.sqrt(below + apex) + Math.sqrt(apex)) ** 2) / flight ** 2;
      return {
        hit: 1000 + i * 260 + rand(-60, 60),
        x, y, fromX, fromY, flight, g,
        vy0: -Math.sqrt(2 * g * (below + apex)),
        r: rand(38, 70),
        colour: PAINT[i % PAINT.length],
        shape: blobShape(),
        landed: false,
        grown: false,
      };
    });
    return { mask, inside, colour, thick, tmp, light, shots, drops: [], drips: [], scraps: [], last: 0 };
  },

  draw(ctx, p, t, info, s) {
    const now = p * IDENT_MS;
    const dt = clamp(now - s.last, 0, 50);
    s.last = now;
    const cctx = s.colour.getContext('2d'), hctx = s.thick.getContext('2d'), tmp = s.tmp.getContext('2d');

    // Stamp paint into both layers; a splat body only sticks to the numeral.
    const stamp = (drawShape, fill, clipToNumber, thickness) => {
      for (const [target, style, mode] of [[cctx, fill, 'source-over'], [hctx, `rgba(255,255,255,${thickness})`, 'lighten']]) {
        if (clipToNumber) {
          tmp.globalCompositeOperation = 'source-over';
          tmp.clearRect(0, 0, W, H);
          drawShape(tmp, style);
          tmp.globalCompositeOperation = 'destination-in';
          tmp.drawImage(s.mask, 0, 0);
          target.globalCompositeOperation = mode;
          target.drawImage(s.tmp, 0, 0);
        } else {
          target.globalCompositeOperation = mode;
          drawShape(target, style);
        }
        target.globalCompositeOperation = 'source-over';
      }
    };

    for (const shot of s.shots) {
      if (now < shot.hit) continue;
      if (!shot.landed) {
        shot.landed = true;
        sound.splat();
        const away = Math.atan2(shot.vy0 + shot.g * shot.flight, (shot.x - shot.fromX) / shot.flight);
        for (let i = 0; i < 16; i++) {
          const a = away + rand(-1.6, 1.6), v = rand(0.25, 0.8);
          s.drops.push({ x: shot.x, y: shot.y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.2, life: rand(150, 450), age: 0, r: rand(2.5, 6), colour: shot.colour });
        }
        for (let i = 0; i < 5; i++) {
          const a = rand(0, Math.PI * 2);
          s.scraps.push({ x: shot.x, y: shot.y, vx: Math.cos(a) * 0.45, vy: Math.sin(a) * 0.45, spin: rand(-0.02, 0.02), rot: a, age: 0, colour: shot.colour });
        }
        for (let i = 0; i < Math.floor(rand(1, 4)); i++) {
          const x = shot.x + rand(-0.6, 0.6) * shot.r, y = shot.y + rand(0.1, 0.6) * shot.r;
          if (insideNumber(s, x, y)) s.drips.push({ x, y, v: rand(0.05, 0.11), w: rand(5, 9), len: 0, max: rand(60, 190), start: shot.hit + rand(200, 600), colour: shot.colour, done: false });
        }
      }
      if (!shot.grown) {
        const g = ease(clamp((now - shot.hit) / GROW_MS));
        const draw = (c, style) => {
          c.fillStyle = style;
          blobPath(c, shot.x, shot.y, shot.r * g, shot.shape);
          c.fill();
          if (g > 0.6) teardrops(c, shot.x, shot.y, shot.r * g, shot.shape, style);
        };
        stamp(draw, shot.colour, true, 0.75);
        if (g >= 1) shot.grown = true;
      }
    }

    // Droplets fly, then land where they fall, wall or numeral.
    for (const d of s.drops) {
      if (d.age >= d.life) continue;
      d.age += dt;
      d.x += d.vx * dt;
      d.vy += GRAVITY * dt;
      d.y += d.vy * dt;
      if (d.age >= d.life) {
        stamp((c, style) => { c.fillStyle = style; c.beginPath(); c.arc(d.x, d.y, d.r, 0, Math.PI * 2); c.fill(); }, d.colour, false, 0.55);
      }
    }

    // Drips run down the numeral, slowing, and end in a bead (they stop at
    // its edge, so they don't need clipping).
    for (const d of s.drips) {
      if (d.done || now < d.start) continue;
      const step = d.v * dt;
      d.v *= 0.997 ** dt;
      const from = d.y;
      d.y += step;
      d.len += step;
      const end = d.len > d.max || d.v < 0.008 || !insideNumber(s, d.x, d.y);
      stamp((c, style) => { c.fillStyle = style; c.fillRect(d.x - d.w / 2, from - 1, d.w, d.y - from + 2); }, d.colour, false, 0.8);
      if (end) {
        d.done = true;
        stamp((c, style) => { c.fillStyle = style; c.beginPath(); c.arc(d.x, d.y, d.w * 0.8, 0, Math.PI * 2); c.fill(); }, d.colour, false, 1);
      }
    }

    // Light it all.
    if (s.light) {
      s.light.render(s.colour, s.thick);
      ctx.drawImage(s.light.canvas, 0, 0);
    } else {
      const bg = ctx.createLinearGradient(0, 0, 0, H);
      bg.addColorStop(0, '#efece6');
      bg.addColorStop(1, '#cfc8bc');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.25)';
      ctx.shadowBlur = 30;
      ctx.shadowOffsetY = 14;
      ctx.drawImage(s.mask, 0, 0);
      ctx.restore();
      ctx.drawImage(s.colour, 0, 0);
    }

    // In the air: balloons, burst rubber and droplets.
    for (const shot of s.shots) {
      const tau = now - (shot.hit - shot.flight);
      if (tau <= 0 || tau >= shot.flight) continue;
      const k = tau / shot.flight;
      // A ballistic arc: steady sideways, rising then falling.
      const vx = (shot.x - shot.fromX) / shot.flight, vy = shot.vy0 + shot.g * tau;
      const x = shot.fromX + vx * tau, y = shot.fromY + shot.vy0 * tau + 0.5 * shot.g * tau * tau;
      const speed = Math.hypot(vx, vy);
      // Stretch with speed, a rubbery wobble, then squash on impact; it grows
      // a touch as it comes towards us.
      const squash = k > 0.9 ? (k - 0.9) / 0.1 : 0;
      const stretch = 1 + Math.min(0.18, speed * 0.12) + Math.sin(tau / 55) * 0.04;
      const near = 0.75 + 0.25 * k;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(vy, vx));
      ctx.scale(near * stretch * (1 - squash * 0.35), (near / stretch) * (1 + squash * 0.25));
      const g = ctx.createRadialGradient(-8, -10, 4, 0, 0, 38);
      g.addColorStop(0, 'rgba(255,255,255,0.85)');
      g.addColorStop(0.25, shot.colour);
      g.addColorStop(1, 'rgba(0,0,0,0.35)');
      ctx.fillStyle = shot.colour;
      ctx.beginPath();
      ctx.ellipse(0, 0, 34, 28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = g;
      ctx.fill();
      poly(ctx, [[-34, 0], [-44, -6], [-44, 6]], shot.colour);
      ctx.restore();
    }
    for (const sc of s.scraps) {
      if (sc.age > 260) continue;
      sc.age += dt;
      sc.x += sc.vx * dt;
      sc.y += sc.vy * dt;
      sc.rot += sc.spin * dt;
      ctx.save();
      ctx.globalAlpha = 1 - sc.age / 260;
      ctx.translate(sc.x, sc.y);
      ctx.rotate(sc.rot);
      ctx.strokeStyle = sc.colour;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, 1.6);
      ctx.stroke();
      ctx.restore();
    }
    for (const d of s.drops) {
      if (d.age >= d.life) continue;
      ctx.fillStyle = d.colour;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(d.x - d.r * 0.3, d.y - d.r * 0.3, d.r * 0.3, 0, Math.PI * 2);
      ctx.fill();
    }
    caption(ctx, p, info, true);
  },
};

// --- Weather: the number out in today's weather ---------------------------

function sky(code) {
  if (code >= 95) return 'thunder';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if (code === 45 || code === 48) return 'fog';
  if (code === 2 || code === 3) return 'cloud';
  return 'clear';
}

const WORDS = { clear: 'CLEAR', cloud: 'CLOUDY', fog: 'FOG', rain: 'RAIN', snow: 'SNOW', thunder: 'THUNDER' };

function cloudShape(ctx, x, y, s, colour) {
  ctx.fillStyle = colour;
  for (const [dx, dy, r] of [[0, 0, 40], [38, -18, 48], [80, 0, 40], [40, 12, 42]]) {
    ctx.beginPath();
    ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
    ctx.fill();
  }
}

const weather = {
  setup(info) {
    const w = info.weather ?? { code: 0, isDay: true };
    const kind = sky(w.code);
    const mask = numberMask(String(info.number), 520);
    // Tint the numeral so it stands out: red in snow (so settled snow shows),
    // yellow in wet weather, white otherwise.
    const tint = { snow: '#d8252e', rain: '#ffd200', thunder: '#ffd200', fog: '#ffd200' }[kind] ?? '#ffffff';
    const numeral = document.createElement('canvas');
    numeral.width = W;
    numeral.height = H;
    const nctx = numeral.getContext('2d');
    nctx.drawImage(mask, 0, 0);
    nctx.globalCompositeOperation = 'source-in';
    nctx.fillStyle = tint;
    nctx.fillRect(0, 0, W, H);
    // Where each column of the numeral starts, so snow can settle on it.
    const tops = columnTops(mask);
    const count = kind === 'snow' ? 260 : kind === 'rain' || kind === 'thunder' ? 340 : 0;
    const drops = Array.from({ length: count }, () => ({ x: rand(0, W), y: rand(-H, H), v: rand(0.6, 1.2), s: rand(0, 6) }));
    const stars = Array.from({ length: 90 }, () => ({ x: rand(0, W), y: rand(0, H * 0.7), r: rand(0.6, 2), tw: rand(0, 6) }));
    const clouds = Array.from({ length: 6 }, (_, i) => ({ x: rand(-200, W), y: 70 + i * 55, s: rand(0.7, 1.4), v: rand(0.02, 0.05) }));
    // Lumpy snow caps that build up over the ident.
    const lumps = tops.map((_, i) => 0.7 + 0.3 * Math.sin(i * 0.37) * Math.cos(i * 0.13));
    return { w, kind, numeral, tops, lumps, piles: tops.map(() => 0), drops, stars, clouds, flash: 0, last: null };
  },
  draw(ctx, p, t, info, s) {
    const { kind, w } = s;
    const day = w.isDay;
    const dt = s.last == null ? 16 : t - s.last;
    s.last = t;

    const top = { clear: day ? '#2f7fd8' : '#06102a', cloud: day ? '#8b98a8' : '#1a1f2a', fog: day ? '#b9bec4' : '#2a2d33', rain: day ? '#5d6875' : '#151a22', snow: day ? '#a9b7c6' : '#1c2433', thunder: '#20242c' }[kind];
    const bottom = { clear: day ? '#9fd0ff' : '#1b2a55', cloud: day ? '#c7ced6' : '#2b313d', fog: day ? '#dfe2e5' : '#3a3e45', rain: day ? '#8e98a3' : '#262d38', snow: day ? '#e3e9ef' : '#2e3748', thunder: '#3a3f4a' }[kind];
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, top);
    bg.addColorStop(1, bottom);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (kind === 'clear' && day) {
      ctx.save();
      ctx.translate(W * 0.8, H * 0.2);
      ctx.rotate(t / 4000);
      ctx.fillStyle = 'rgba(255,230,120,0.5)';
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.fillRect(70, -6, 60, 12);
      }
      ctx.restore();
      ctx.fillStyle = '#ffd84a';
      ctx.beginPath();
      ctx.arc(W * 0.8, H * 0.2, 62, 0, Math.PI * 2);
      ctx.fill();
    } else if (!day) {
      for (const st of s.stars) {
        ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 400 + st.tw);
        ctx.fillStyle = '#fff';
        ctx.fillRect(st.x, st.y, st.r, st.r);
      }
      ctx.globalAlpha = 1;
      if (kind === 'clear') {
        ctx.fillStyle = '#f2f0dc';
        ctx.beginPath();
        ctx.arc(W * 0.8, H * 0.2, 50, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = top;
        ctx.beginPath();
        ctx.arc(W * 0.8 + 22, H * 0.2 - 12, 46, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (kind === 'cloud' || kind === 'rain' || kind === 'thunder' || kind === 'snow') {
      for (const c of s.clouds) {
        c.x += c.v * dt;
        if (c.x > W + 100) c.x = -260;
        cloudShape(ctx, c.x, c.y, c.s, day ? 'rgba(255,255,255,0.85)' : 'rgba(120,130,150,0.6)');
      }
    }

    // The numeral, with any settled snow along its top edges.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.3)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(s.numeral, 0, 0);
    ctx.restore();
    if (kind === 'snow') {
      ctx.fillStyle = '#fff';
      s.tops.forEach((y, i) => {
        if (y == null) return;
        const cap = Math.max(s.piles[i], 24 * ease(clamp(p / 0.85)) * s.lumps[i]);
        if (cap > 0.5) ctx.fillRect(i * 4 - 1, y - cap, 6, cap + 3);
      });
    }

    if (kind === 'fog') {
      for (let i = 0; i < 4; i++) {
        ctx.fillStyle = 'rgba(230,232,235,0.35)';
        const x = ((t / (30 + i * 10)) % (W + 400)) - 400;
        ctx.fillRect(x, 160 + i * 130, W * 0.9, 70);
      }
    }

    for (const d of s.drops) {
      if (kind === 'snow') {
        d.y += d.v * dt * 0.09;
        d.x += Math.sin(t / 700 + d.s) * 0.4;
        const col = Math.round(d.x / 4);
        const ground = s.tops[col];
        if (ground != null && d.y >= ground - s.piles[col] && d.y < ground + 20) {
          s.piles[col] = Math.min(22, s.piles[col] + 1.6);
          d.y = rand(-80, -10);
        } else if (d.y > H) d.y = rand(-80, -10);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.arc(d.x, d.y, 2.5 + d.s / 3, 0, Math.PI * 2);
        ctx.fill();
      } else {
        d.y += d.v * dt * 1.1;
        d.x -= d.v * dt * 0.15;
        if (d.y > H) { d.y = rand(-60, -10); d.x = rand(0, W + 100); }
        ctx.strokeStyle = 'rgba(200,215,235,0.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x + 5, d.y - 22);
        ctx.stroke();
      }
    }

    if (kind === 'thunder') {
      if (Math.random() < dt / 2500) s.flash = 1;
      if (s.flash > 0) {
        ctx.fillStyle = `rgba(255,255,255,${s.flash * 0.7})`;
        ctx.fillRect(0, 0, W, H);
        s.flash = Math.max(0, s.flash - dt / 250);
      }
    }

    const where = w.city ? `${w.city.toUpperCase()}  ${w.temp}${w.units}  ${WORDS[kind]}` : WORDS[kind];
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 22, W, 56);
    text(ctx, where, W / 2, 50, 26, '#fff');
    caption(ctx, p, info, false, true);
  },
};


// --- Bob Ross: the landscape painted stroke by stroke ---------------------
// Every stroke is laid down a little each frame as a spread of bristle
// marks, so the picture builds up the way paint does, and the tool doing
// the work (two-inch brush, palette knife or fan brush) is drawn at the
// head of the stroke. Strokes are planned in setup and timed across the ident.

// Blend two #rrggbb colours; k = 0 gives a, 1 gives b.
function mixHex(a, b, k) {
  const pa = a.match(/\w\w/g).map((h) => parseInt(h, 16)), pb = b.match(/\w\w/g).map((h) => parseInt(h, 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * k).toString(16).padStart(2, '0')).join('');
}

// One stroke: a path, a width, a colour, and bristles that each carry a
// slightly different shade and sit at their own offset across the brush.
function makeStroke(tool, pts, width, colour, start, end, extra = {}) {
  const lengths = [0];
  for (let i = 1; i < pts.length; i++) lengths.push(lengths[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
  const count = tool === 'knife' ? 6 : tool === 'fan' ? 9 : 14;
  const bristles = Array.from({ length: count }, (_, i) => ({
    offset: (i / (count - 1) - 0.5) * (tool === 'fan' ? 1.6 : 1) + rand(-0.04, 0.04),
    size: rand(0.6, 1.2),
    alpha: rand(0.45, 0.9),
    colour: mixHex(colour, rand(0, 1) < 0.5 ? '#000000' : '#ffffff', rand(0, 0.18)),
  }));
  return { tool, pts, lengths, total: lengths.at(-1), width, start, end, bristles, done: 0, ...extra };
}

function pointAt(stroke, d) {
  const { pts, lengths } = stroke;
  let i = 1;
  while (i < lengths.length - 1 && lengths[i] < d) i++;
  const k = (d - lengths[i - 1]) / ((lengths[i] - lengths[i - 1]) || 1);
  const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
  return { x: x0 + (x1 - x0) * k, y: y0 + (y1 - y0) * k, angle: Math.atan2(y1 - y0, x1 - x0) };
}

// Lay the stroke down from where it got to last frame up to `upto` (0-1).
// Each bristle's marks for the frame go into one path, filled once: a few
// dozen draw calls per frame rather than thousands of tiny ones.
function paintStroke(ctx, stroke, upto, allowed) {
  const from = stroke.done * stroke.total, to = upto * stroke.total;
  const samples = [];
  for (let d = from; d <= to; d += 3) {
    const t = d / (stroke.total || 1);
    // Full width through the middle of the stroke, tapering only at each end.
    const taper = stroke.tool === 'knife' ? 1 : 0.35 + 0.65 * Math.min(1, 2.2 * Math.sin(Math.PI * t));
    const { x, y, angle } = pointAt(stroke, d);
    samples.push({ x, y, nx: -Math.sin(angle), ny: Math.cos(angle), taper });
  }
  for (const b of stroke.bristles) {
    const r = (stroke.width / stroke.bristles.length) * b.size * (stroke.tool === 'knife' ? 1.6 : 1.1) + 0.6;
    ctx.beginPath();
    for (const sm of samples) {
      const bx = sm.x + sm.nx * b.offset * stroke.width * sm.taper, by = sm.y + sm.ny * b.offset * stroke.width * sm.taper;
      if (!allowed(bx, by)) continue;
      ctx.rect(bx - r, by - r, r * 2, r * 2);
    }
    ctx.globalAlpha = b.alpha * (stroke.tool === 'knife' ? 1 : 0.8);
    ctx.fillStyle = b.colour;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  stroke.done = upto;
}

// The tool in hand, at the head of the stroke being painted.
function drawTool(ctx, stroke) {
  const { x, y, angle } = pointAt(stroke, stroke.done * stroke.total);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle + Math.PI / 2 + 0.5);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 6;
  const paint = stroke.bristles[0].colour;
  if (stroke.tool === 'knife') {
    poly(ctx, [[-10, 0], [10, 0], [6, -46], [-6, -46]], '#c8ccd2');
    ctx.fillStyle = '#7a7f86';
    ctx.fillRect(-2, -80, 4, 36);
    ctx.fillStyle = '#5b3a24';
    ctx.fillRect(-6, -150, 12, 72);
  } else if (stroke.tool === 'fan') {
    ctx.fillStyle = paint;
    ctx.beginPath();
    ctx.moveTo(0, -28);
    ctx.arc(0, -28, 30, Math.PI * 0.2, Math.PI * 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#b9bcc2';
    ctx.fillRect(-5, -44, 10, 18);
    ctx.fillStyle = '#5b3a24';
    ctx.fillRect(-4, -150, 8, 108);
  } else {
    ctx.fillStyle = paint;
    ctx.fillRect(-24, -26, 48, 26);
    ctx.fillStyle = '#b9bcc2';
    ctx.fillRect(-26, -50, 52, 26);
    ctx.fillStyle = '#5b3a24';
    ctx.fillRect(-9, -170, 18, 122);
  }
  ctx.restore();
}

const bobross = {
  setup(info) {
    const left = W * 0.1, top = H * 0.06, cw = W * 0.8, ch = H * 0.64, base = top + ch;
    const strokes = [];
    const span = (from, to, list) => list.forEach((st, i) => {
      st.start = from + ((to - from) * i) / list.length;
      st.end = from + ((to - from) * (i + 1.4)) / list.length;
    });

    // Sky: criss-cross strokes, Prussian blue at the top lightening to the
    // horizon. They start and end off the canvas, as Bob's do, so the tapered
    // ends don't leave gaps at the sides.
    const sky = [];
    for (let i = 0; i < 13; i++) {
      const y = top + 8 + i * (ch * 0.62 / 13), dir = i % 2 ? 1 : -1;
      sky.push(makeStroke('brush', [[left - 160, y - dir * 50], [left + cw + 160, y + dir * 50]], ch * 0.12, mixHex('#1b2f5c', '#cfdcea', i / 12), 0, 0));
    }
    span(0, 0.22, sky);

    // Mountains: knife strokes fanning down from each peak, then snow pulled
    // down the lit side.
    const mountains = [
      { px: left + cw * 0.32, py: top + ch * 0.24, x0: left - 20, x1: left + cw * 0.62 },
      { px: left + cw * 0.7, py: top + ch * 0.16, x0: left + cw * 0.42, x1: left + cw + 20 },
    ];
    const rock = [], snow = [];
    for (const m of mountains) {
      for (let k = 0; k <= 10; k++) {
        const bx = m.x0 + ((m.x1 - m.x0) * k) / 10;
        rock.push(makeStroke('knife', [[m.px, m.py], [bx, base - ch * 0.18]], 22, rand(0, 1) < 0.5 ? '#4a4858' : '#3c3a4a', 0, 0));
      }
      for (let k = 0; k < 4; k++) {
        const bx = m.px - (m.px - m.x0) * (0.12 + k * 0.07);
        snow.push(makeStroke('knife', [[m.px, m.py + 2], [bx, m.py + ch * (0.12 + k * 0.03)]], 9, '#f4f6fa', 0, 0));
      }
    }
    span(0.2, 0.36, rock);
    span(0.34, 0.42, snow);

    // Meadow: broad horizontal strokes along the bottom.
    const ground = [];
    for (let i = 0; i < 5; i++) {
      const y = base - ch * 0.2 + i * (ch * 0.05), dir = i % 2;
      ground.push(makeStroke('brush', dir ? [[left + cw + 120, y], [left - 120, y + 6]] : [[left - 120, y], [left + cw + 120, y - 6]], ch * 0.075, i % 2 ? '#2f5a26' : '#3e6e2d', 0, 0));
    }
    span(0.38, 0.46, ground);

    // The number, brushed on in titanium white, only where the numeral is.
    const mask = numberMask(String(info.number), 300);
    const alpha = mask.getContext('2d').getImageData(0, 0, W, H).data;
    const shift = Math.round(H * 0.1);
    const allowed = (x, y) => {
      const xi = Math.round(x), yi = Math.round(y + shift);
      return xi >= 0 && yi >= 0 && xi < W && yi < H && alpha[(yi * W + xi) * 4 + 3] > 128;
    };
    let y0 = H, y1 = 0;
    for (let y = 0; y < H; y += 4) for (let x = 0; x < W; x += 4) if (alpha[(y * W + x) * 4 + 3] > 128) { y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    const number = [];
    for (let y = y0 - shift; y <= y1 - shift; y += 16) {
      number.push(makeStroke('brush', number.length % 2 ? [[W * 0.8, y], [W * 0.2, y + 4]] : [[W * 0.2, y], [W * 0.8, y + 4]], 22, '#f7f5ef', 0, 0, { allowed }));
    }
    span(0.42, 0.6, number);

    // Happy little trees: a trunk, then the fan brush tapping in tiers from
    // the top down, then a few highlights.
    const trees = [
      { x: left + cw * 0.12, h: ch * 0.55 },
      { x: left + cw * 0.24, h: ch * 0.42 },
      { x: left + cw * 0.87, h: ch * 0.5 },
    ];
    const treeStrokes = [];
    for (const t of trees) {
      const crown = base - t.h;
      treeStrokes.push(makeStroke('brush', [[t.x, crown + 10], [t.x, base - 4]], 6, '#3a2414', 0, 0));
      for (let k = 0; k < 9; k++) {
        const y = crown + (k * t.h * 0.82) / 9, half = 6 + (k / 8) * t.h * 0.3;
        const green = k % 2 ? '#1c3f22' : '#24502a';
        treeStrokes.push(makeStroke('fan', [[t.x, y], [t.x - half, y + t.h * 0.07]], 16, green, 0, 0));
        treeStrokes.push(makeStroke('fan', [[t.x, y], [t.x + half, y + t.h * 0.07]], 16, green, 0, 0));
      }
      for (let k = 2; k < 8; k += 2) {
        const y = crown + (k * t.h * 0.82) / 9, half = (k / 8) * t.h * 0.22;
        treeStrokes.push(makeStroke('fan', [[t.x + 4, y + 4], [t.x + half, y + t.h * 0.06]], 8, '#6f9a3a', 0, 0));
      }
    }
    span(0.5, 0.86, treeStrokes);

    // Faint canvas weave over everything.
    const weave = document.createElement('canvas');
    weave.width = W;
    weave.height = H;
    const wctx = weave.getContext('2d');
    wctx.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = 0; x < W; x += 3) wctx.fillRect(x, 0, 1, H);
    for (let y = 0; y < H; y += 3) wctx.fillRect(0, y, W, 1);

    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    return { left, top, cw, ch, layer, weave, strokes: [...sky, ...rock, ...snow, ...ground, ...number, ...treeStrokes] };
  },

  draw(ctx, p, t, info, s) {
    const { left, top, cw, ch } = s;
    ctx.fillStyle = '#3a2718';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(left, top, cw, ch);

    // Paint this frame's share of every stroke in progress, inside the canvas.
    const l = s.layer.getContext('2d');
    let active = null;
    const inCanvas = (x, y) => x >= left && x <= left + cw && y >= top && y <= top + ch;
    for (const st of s.strokes) {
      const k = clamp((p - st.start) / (st.end - st.start));
      if (k > st.done) {
        paintStroke(l, st, k, st.allowed ? (x, y) => inCanvas(x, y) && st.allowed(x, y) : inCanvas);
        if (k < 1) active = st;
      }
    }
    ctx.drawImage(s.layer, 0, 0);
    ctx.drawImage(s.weave, left, top, cw, ch, left, top, cw, ch);
    if (active) drawTool(ctx, active);
    caption(ctx, p, info);
  },
};

// --- Taskmaster: a sealed envelope, a task inside ------------------------

const TASKS = [
  'Make this interlude feel as short as possible. Fastest wins.',
  'Put the kettle on before the next programme starts. Best brew wins.',
  'Find the most surprising channel on this television. Your time starts now.',
  'Paint a happy little tree on channel 12. Most joyful tree wins.',
  'Bring back the test card. You have ten seconds.',
];

function seal(ctx, x, y, r, number, alpha = 1, split = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  for (const side of split ? [-1, 1] : [0]) {
    ctx.save();
    if (side) {
      // Each half drops and tips away from the middle, turning about the seal.
      ctx.translate(x + side * split * 30, y + split * 50);
      ctx.rotate(side * split * 0.5);
      ctx.translate(-x, -y);
      ctx.beginPath();
      ctx.rect(side < 0 ? x - r * 2 : x, y - r * 2, r * 2, r * 4);
      ctx.clip();
    }
    // Wax: a lumpy red disc with a pressed ring and number.
    ctx.fillStyle = '#b3121b';
    ctx.beginPath();
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2, wob = r * (1 + 0.08 * Math.sin(i * 2.7));
      ctx.lineTo(x + Math.cos(a) * wob, y + Math.sin(a) * wob);
    }
    ctx.fill();
    ctx.strokeStyle = '#7d0a10';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = BIG.replace('1px', `${Math.round(r * 0.75)}px`);
    ctx.fillStyle = '#7d0a10';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(number), x, y + 2);
    ctx.restore();
  }
  ctx.restore();
}

const taskmaster = {
  setup() {
    return { task: TASKS[Math.floor(rand(0, TASKS.length))] };
  },
  draw(ctx, p, t, info, s) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#4a2c1a');
    bg.addColorStop(1, '#22140c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const ew = 520, eh = 300, ex = (W - ew) / 2;
    const ey = H * 0.5 - eh / 2 + (1 - ease(clamp(p / 0.14))) * H;
    const open = clamp((p - 0.3) / 0.12);   // flap opening
    const card = ease(clamp((p - 0.42) / 0.14));

    // Back of the envelope; an open flap folds up behind the card.
    ctx.fillStyle = '#d9c9a3';
    ctx.fillRect(ex, ey, ew, eh);
    const tipY = ey + eh * 0.5 * (1 - 2 * open);
    if (open > 0.5) poly(ctx, [[ex, ey], [ex + ew, ey], [ex + ew / 2, tipY]], '#cdbb92');

    // The card rises out with the task typed on it.
    if (card) {
      const cy = ey + 20 - card * 210;
      ctx.fillStyle = '#fbf8f1';
      ctx.fillRect(ex + 30, cy, ew - 60, eh - 30);
      const chars = Math.floor(clamp((p - 0.55) / 0.3) * s.task.length);
      const words = s.task.slice(0, chars).split(' ');
      let line = '', y = cy + 42;
      ctx.font = '24px "Courier New", monospace';
      ctx.fillStyle = '#222';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      for (const word of words) {
        if (ctx.measureText(`${line} ${word}`).width > ew - 120) { ctx.fillText(line, ex + 60, y); y += 34; line = word; }
        else line = line ? `${line} ${word}` : word;
      }
      ctx.fillText(line, ex + 60, y);
    }

    // Front pocket, then a closed flap over everything.
    poly(ctx, [[ex, ey + eh * 0.3], [ex, ey + eh], [ex + ew, ey + eh], [ex + ew, ey + eh * 0.3], [ex + ew / 2, ey + eh * 0.62]], '#eadcb8');
    if (open <= 0.5) poly(ctx, [[ex, ey], [ex + ew, ey], [ex + ew / 2, tipY]], '#f1e6c8');

    // The seal sits on the flap's tip, then cracks and falls away.
    const crack = clamp((p - 0.24) / 0.1);
    if (crack < 1) seal(ctx, ex + ew / 2, ey + eh * 0.5, 52, info.number, 1 - crack * 0.6, crack);
    caption(ctx, p, info);
  },
};

// --- Oscilloscope: a wave on a green screen settles into the number ------

function numberOutline(str, height, colour) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const m = c.getContext('2d');
  m.font = BIG.replace('1px', `${height}px`);
  const scale = Math.min(1, (W * 0.8) / m.measureText(str).width);
  m.font = BIG.replace('1px', `${Math.round(height * scale)}px`);
  m.textAlign = 'center';
  m.textBaseline = 'middle';
  m.strokeStyle = colour;
  m.lineWidth = 6;
  m.shadowColor = colour;
  m.shadowBlur = 18;
  m.strokeText(str, W / 2, H * 0.44);
  return c;
}

// The first opaque row in each 4px column of a mask, or null.
function columnTops(mask) {
  const data = mask.getContext('2d').getImageData(0, 0, W, H).data;
  const tops = [];
  for (let x = 0; x < W; x += 4) {
    let y = 0;
    while (y < H && data[(y * W + x) * 4 + 3] < 128) y++;
    tops.push(y < H ? y : null);
  }
  return tops;
}

const oscilloscope = {
  setup(info) {
    const outline = numberOutline(String(info.number), 520, '#5dff7a');
    return { outline, tops: columnTops(outline) };
  },
  draw(ctx, p, t, info, s) {
    ctx.fillStyle = '#020a03';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = '#0b3d14';
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 64) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
    for (let y = 0; y <= H; y += 64) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

    // The trace: a wave that flattens out as the number is drawn.
    const wave = 1 - clamp((p - 0.25) / 0.2);
    if (wave) {
      ctx.save();
      ctx.globalAlpha = wave;
      ctx.strokeStyle = '#5dff7a';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#5dff7a';
      ctx.shadowBlur = 14;
      ctx.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const y = H * 0.44 + Math.sin(x / 38 + t / 140) * 90 * Math.sin(x / 300 + t / 900);
        x ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
      ctx.restore();
    }
    // The number, traced left to right with a bright spot at the beam.
    const reveal = clamp((p - 0.25) / 0.35);
    if (reveal) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W * reveal, H);
      ctx.clip();
      ctx.drawImage(s.outline, 0, 0);
      ctx.restore();
      const col = Math.min(s.tops.length - 1, Math.floor((W * reveal) / 4));
      const y = s.tops[col];
      if (reveal < 1 && y != null) {
        ctx.fillStyle = '#eaffef';
        ctx.shadowColor = '#5dff7a';
        ctx.shadowBlur = 25;
        ctx.beginPath();
        ctx.arc(W * reveal, y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    caption(ctx, p, info);
  },
};

// --- Film leader: 3, 2, 1 with a sweeping hand, then the number ----------

const filmleader = {
  setup(info) {
    return { mask: numberMask(String(info.number), 520), beeped: false };
  },
  draw(ctx, p, t, info, s) {
    // Jitter, as film does in the gate.
    ctx.save();
    ctx.translate(0, rand(-2, 2));
    const count = Math.floor(p / 0.18);
    if (count < 3) {
      const local = (p % 0.18) / 0.18;
      ctx.fillStyle = '#8c8c8c';
      ctx.fillRect(0, -4, W, H + 8);
      // The sweep: a darker wedge from twelve o'clock round to the hand.
      ctx.fillStyle = '#6a6a6a';
      ctx.beginPath();
      ctx.moveTo(W / 2, H / 2);
      ctx.arc(W / 2, H / 2, W, -Math.PI / 2, -Math.PI / 2 + local * Math.PI * 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 6;
      for (const r of [230, 270]) { ctx.beginPath(); ctx.arc(W / 2, H / 2, r, 0, Math.PI * 2); ctx.stroke(); }
      ctx.font = BIG.replace('1px', '300px');
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(3 - count), W / 2, H / 2 + 10);
      // The leader's beep comes on the 2.
      if (count === 1 && !s.beeped) { s.beeped = true; sound.pip(); }
    } else {
      ctx.fillStyle = '#141414';
      ctx.fillRect(0, -4, W, H + 8);
      ctx.globalAlpha = 0.85 + Math.random() * 0.15;
      ctx.drawImage(s.mask, 0, 0);
      ctx.globalAlpha = 1;
    }
    // Grain and the odd scratch.
    ctx.fillStyle = count < 3 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.25)';
    for (let i = 0; i < 260; i++) ctx.fillRect(rand(0, W), rand(0, H), 2, 2);
    if (Math.random() < 0.3) {
      ctx.fillStyle = 'rgba(255,255,255,0.4)';
      ctx.fillRect(rand(0, W), 0, 1.5, H);
    }
    ctx.restore();
    if (count >= 3) caption(ctx, p, info);
  },
};

// --- Starfield: stars drift into the shape of the number ------------------

const starfield = {
  setup(info) {
    const data = numberMask(String(info.number), 520).getContext('2d').getImageData(0, 0, W, H).data;
    const stars = [];
    for (let y = 0; y < H; y += 10) {
      for (let x = 0; x < W; x += 10) {
        if (data[(y * W + x) * 4 + 3] > 128) stars.push({ tx: x + rand(-2, 2), ty: y + rand(-2, 2), x: rand(0, W), y: rand(0, H), tw: rand(0, 6), r: rand(1.2, 2.6) });
      }
    }
    const sky = Array.from({ length: 220 }, () => ({ x: rand(0, W), y: rand(0, H), tw: rand(0, 6), r: rand(0.5, 1.6) }));
    return { stars, sky };
  },
  draw(ctx, p, t, info, s) {
    ctx.fillStyle = '#01010a';
    ctx.fillRect(0, 0, W, H);
    for (const st of s.sky) {
      ctx.globalAlpha = 0.4 + 0.4 * Math.sin(t / 500 + st.tw);
      ctx.fillStyle = '#fff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    const k = ease(clamp((p - 0.12) / 0.45));
    for (const st of s.stars) {
      const x = st.x + (st.tx - st.x) * k, y = st.y + (st.ty - st.y) * k;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 300 + st.tw);
      ctx.fillStyle = k > 0.98 ? '#fff7c2' : '#fff';
      ctx.beginPath();
      ctx.arc(x, y, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    caption(ctx, p, info);
  },
};

// --- Headlines: the number picked out from today's news, scrolling past ---

let headlines = [];
async function loadHeadlines() {
  try {
    const page = await (await fetch('/api/page/101')).json();
    headlines = page.subpages.flat()
      .map((row) => row.s.filter((seg) => seg.t && seg.fg === 'white').map((seg) => seg.t).join('').trim())
      .filter((line) => line.length > 3);
  } catch { /* keep any we had */ }
}

const headlinesIdent = {
  setup(info) {
    const pool = headlines.length ? headlines : ['TELETEXTUAL', 'THE NEWS IN FORTY COLUMNS'];
    const rows = Array.from({ length: 22 }, (_, i) => ({
      text: [...pool].sort(() => Math.random() - 0.5).join('  *  ').toUpperCase(),
      speed: (i % 2 ? 1 : -1) * rand(0.04, 0.09),
      offset: rand(0, 2000),
    }));
    const mask = numberMask(String(info.number), 560);
    const shape = document.createElement('canvas');
    shape.width = W;
    shape.height = H;
    const sctx = shape.getContext('2d');
    sctx.drawImage(mask, 0, 0);
    sctx.globalCompositeOperation = 'source-in';
    sctx.fillStyle = '#2a3f9a';
    sctx.fillRect(0, 0, W, H);
    return { rows, mask, shape, layer: document.createElement('canvas') };
  },
  draw(ctx, p, t, info, s) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    s.layer.width = W;
    s.layer.height = H;
    const l = s.layer.getContext('2d');
    l.font = `30px ${FONT}`;
    l.textBaseline = 'top';
    const paint = (target, colour) => {
      target.font = `30px ${FONT}`;
      target.textBaseline = 'top';
      target.fillStyle = colour;
      s.rows.forEach((row, i) => target.fillText(row.text, ((row.offset + t * row.speed) % 2000) - 2000, 8 + i * 35));
    };
    // A faint fill of the number's shape, then the news in dim blue over it.
    ctx.globalAlpha = 0.5;
    ctx.drawImage(s.shape, 0, 0);
    ctx.globalAlpha = 1;
    paint(ctx, '#18295e');
    // The same text, bright, but only inside the number.
    paint(l, ['#ff0', '#0ff', '#fff'][Math.floor(t / 900) % 3]);
    l.globalCompositeOperation = 'destination-in';
    l.globalAlpha = clamp(p / 0.3);
    l.drawImage(s.mask, 0, 0);
    ctx.drawImage(s.layer, 0, 0);
    caption(ctx, p, info, false, true);
  },
};

// --- Bush Tucker Man: an outback sunset, a hat, a goanna -------------------

const bushtucker = {
  setup(info) {
    const mask = numberMask(String(info.number), 480);
    const tops = columnTops(mask);
    let peak = 0;
    tops.forEach((y, i) => { if (y != null && (tops[peak] == null || y < tops[peak])) peak = i; });
    const dark = document.createElement('canvas');
    dark.width = W;
    dark.height = H;
    const d = dark.getContext('2d');
    d.drawImage(mask, 0, 0);
    d.globalCompositeOperation = 'source-in';
    d.fillStyle = '#1a0d08';
    d.fillRect(0, 0, W, H);
    return { dark, hatX: peak * 4, hatY: tops[peak] ?? H * 0.3 };
  },
  draw(ctx, p, t, info, s) {
    const sky = ctx.createLinearGradient(0, 0, 0, H * 0.7);
    sky.addColorStop(0, '#2b1b4f');
    sky.addColorStop(0.55, '#c2456b');
    sky.addColorStop(1, '#ff9a3d');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ffd36a';
    ctx.beginPath();
    ctx.arc(W * 0.5, H * (0.58 + p * 0.04), 150, 0, Math.PI * 2);
    ctx.fill();

    ctx.drawImage(s.dark, 0, 0);

    // Red earth, spinifex and a gum tree.
    ctx.fillStyle = '#2a120a';
    ctx.beginPath();
    ctx.moveTo(0, H * 0.7);
    for (let x = 0; x <= W; x += 32) ctx.lineTo(x, H * 0.69 + Math.sin(x / 90) * 6);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.fill();
    for (const x of [80, 160, 330, 610, 720, 940]) {
      for (let k = -3; k <= 3; k++) poly(ctx, [[x + k * 5, H * 0.7], [x + k * 5 + 3, H * 0.7], [x + k * 9, H * 0.7 - 28 + Math.abs(k) * 4]], '#2a120a');
    }
    ctx.fillStyle = '#1d0c06';
    ctx.fillRect(W * 0.86, H * 0.42, 14, H * 0.3);
    for (const [dx, dy, r] of [[0, -10, 55], [-50, 10, 40], [50, 15, 42], [10, 30, 38]]) {
      ctx.beginPath();
      ctx.arc(W * 0.86 + 7 + dx, H * 0.38 + dy, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // The slouch hat drops onto the top of the number.
    const drop = clamp((p - 0.28) / 0.16);
    if (drop) {
      const y = s.hatY - 14 - (1 - bounce(drop)) * 300;
      ctx.save();
      ctx.translate(s.hatX, y);
      ctx.rotate(-0.12);
      ctx.fillStyle = '#6b4a2b';
      ctx.beginPath();
      ctx.ellipse(0, 0, 95, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-50, -2);
      ctx.quadraticCurveTo(-48, -62, 0, -64);
      ctx.quadraticCurveTo(48, -62, 50, -2);
      ctx.fill();
      ctx.fillStyle = '#3b2716';
      ctx.fillRect(-49, -20, 98, 12);
      ctx.restore();
    }

    // A goanna scuttles across.
    const run = clamp((p - 0.48) / 0.45);
    if (run > 0 && run < 1) {
      // Along the horizon, so it's silhouetted against the sunset.
      const gx = -150 + run * (W + 300), gy = H * 0.665, leg = Math.sin(t / 50) * 10;
      ctx.fillStyle = '#120804';
      ctx.beginPath();
      ctx.ellipse(gx, gy, 55, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      poly(ctx, [[gx - 50, gy - 6], [gx - 50, gy + 6], [gx - 150, gy + 2]], '#120804');
      ctx.beginPath();
      ctx.ellipse(gx + 62, gy - 3, 18, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#120804';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(gx + 25, gy); ctx.lineTo(gx + 35 + leg, gy + 22);
      ctx.moveTo(gx - 25, gy); ctx.lineTo(gx - 35 - leg, gy + 22);
      ctx.stroke();
    }
    caption(ctx, p, info, false, true);
  },
};

// --- Rock Hits: spotlights, VU meters, and a number on the beat ------------

const rockhits = {
  setup(info) {
    return { mask: numberMask(String(info.number), 500), seeds: Array.from({ length: 24 }, () => rand(0, 10)) };
  },
  draw(ctx, p, t, info, s) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#12051f');
    bg.addColorStop(1, '#2a0a3a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // Sweeping spotlights.
    ['rgba(255,60,200,0.18)', 'rgba(60,200,255,0.18)', 'rgba(255,230,80,0.15)'].forEach((colour, i) => {
      const a = Math.sin(t / 900 + i * 2) * 0.5;
      const x = W * (0.2 + i * 0.3);
      ctx.fillStyle = colour;
      poly(ctx, [[x, -20], [x + Math.sin(a) * H - 120, H], [x + Math.sin(a) * H + 120, H]], colour);
    });
    // VU meters along the bottom, in teletext blocks.
    const bars = 24, bw = W / bars, beat = (t % 500) / 500;
    s.seeds.forEach((seed, i) => {
      const level = 0.25 + 0.75 * Math.abs(Math.sin(t / 180 + seed) * Math.cos(t / 330 + seed * 2)) * (1 - beat * 0.5);
      const blocks = Math.round(level * 10);
      for (let b = 0; b < blocks; b++) {
        ctx.fillStyle = b > 7 ? '#f00' : b > 5 ? '#ff0' : '#0f0';
        ctx.fillRect(i * bw + 4, H - 20 - (b + 1) * 18, bw - 8, 14);
      }
    });
    // The number thumps on every beat (120 bpm).
    const pulse = 1 + 0.07 * Math.max(0, Math.cos(beat * Math.PI));
    ctx.save();
    ctx.translate(W / 2, H * 0.44);
    ctx.scale(pulse, pulse);
    ctx.translate(-W / 2, -H * 0.44);
    ctx.shadowColor = '#ff3cc8';
    ctx.shadowBlur = 30;
    ctx.drawImage(s.mask, 0, 0);
    ctx.restore();
    caption(ctx, p, info, false, true);
  },
};

// --- Infomercials: a starburst, a price tag, and there's more -------------

const infomercial = {
  setup() {
    return {};
  },
  draw(ctx, p, t, info) {
    const bg = ctx.createRadialGradient(W / 2, H * 0.45, 40, W / 2, H * 0.45, W * 0.7);
    bg.addColorStop(0, '#fff36b');
    bg.addColorStop(1, '#ff8a00');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    // A rotating starburst.
    ctx.save();
    ctx.translate(W / 2, H * 0.44);
    ctx.rotate(t / 3000);
    ctx.fillStyle = '#e8202a';
    ctx.beginPath();
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2, r = i % 2 ? 190 : 260;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.fill();
    ctx.restore();
    // The price tag, swinging slightly on its string.
    const pop = bounce(clamp(p / 0.2));
    ctx.save();
    ctx.translate(W / 2, H * 0.44);
    ctx.rotate(-0.12 + Math.sin(t / 400) * 0.03);
    ctx.scale(pop, pop);
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = '#111';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(-170, -95); ctx.lineTo(150, -95); ctx.lineTo(210, 0); ctx.lineTo(150, 95); ctx.lineTo(-170, 95); ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(165, 0, 14, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#111';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = BIG.replace('1px', '34px');
    ctx.fillText('ONLY', -20, -62);
    ctx.font = BIG.replace('1px', '150px');
    ctx.fillText(String(info.number), -45, 22);
    ctx.font = BIG.replace('1px', '60px');
    ctx.fillText('.99', 85, -10);
    ctx.restore();
    // CALL NOW!, flashing.
    if (p > 0.15) text(ctx, 'CALL NOW!', W / 2, 70, 64, Math.floor(t / 300) % 2 ? '#e8202a' : '#1f3cff', 'center', BIG.replace('1px ', '').replace('900 ', ''));
    // BUT WAIT, THERE'S MORE! spins in.
    const more = clamp((p - 0.42) / 0.16);
    if (more) {
      ctx.save();
      ctx.translate(W / 2, H * 0.68);
      ctx.rotate((1 - ease(more)) * Math.PI * 4);
      ctx.scale(ease(more), ease(more));
      ctx.font = BIG.replace('1px', '48px');
      ctx.fillStyle = '#1f3cff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText("BUT WAIT, THERE'S MORE!", 0, 0);
      ctx.restore();
    }
    caption(ctx, p, info, false, true);
  },
};

// --- Lofi: a rainy window, a desk lamp and a steaming mug ----------------

const lofi = {
  setup(info) {
    const mask = numberMask(String(info.number), 360);
    const warm = document.createElement('canvas');
    warm.width = W;
    warm.height = H;
    const w = warm.getContext('2d');
    w.drawImage(mask, 0, 0);
    w.globalCompositeOperation = 'source-in';
    w.fillStyle = '#ffd9a0';
    w.fillRect(0, 0, W, H);
    const drops = Array.from({ length: 70 }, () => ({ x: rand(W * 0.15, W * 0.85), y: rand(H * 0.06, H * 0.5), v: rand(0.02, 0.08), len: rand(8, 30) }));
    return { warm, drops };
  },
  draw(ctx, p, t, info, s) {
    ctx.fillStyle = '#161a33';
    ctx.fillRect(0, 0, W, H);
    // Window onto a rainy night.
    const wx = W * 0.15, wy = H * 0.06, ww = W * 0.7, wh = H * 0.48;
    const night = ctx.createLinearGradient(0, wy, 0, wy + wh);
    night.addColorStop(0, '#22325f');
    night.addColorStop(1, '#4a5a92');
    ctx.fillStyle = night;
    ctx.fillRect(wx, wy, ww, wh);
    for (let i = 0; i < 14; i++) {
      ctx.fillStyle = Math.floor(t / 1500 + i) % 5 ? '#ffd27a' : '#2a3560';
      ctx.fillRect(wx + 30 + i * 46, wy + wh - 40 - (i % 3) * 25, 10, 12);
    }
    ctx.strokeStyle = 'rgba(200,215,255,0.5)';
    ctx.lineWidth = 2;
    for (const d of s.drops) {
      d.y += d.v * 16;
      if (d.y > wy + wh) d.y = wy;
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x, d.y + d.len);
      ctx.stroke();
    }
    ctx.fillStyle = '#0d1022';
    ctx.fillRect(wx + ww / 2 - 5, wy, 10, wh);
    ctx.fillRect(wx, wy + wh / 2 - 5, ww, 10);
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#0d1022';
    ctx.strokeRect(wx, wy, ww, wh);

    // The number glows warm in the window.
    ctx.save();
    ctx.shadowColor = '#ffb050';
    ctx.shadowBlur = 30;
    ctx.globalAlpha = clamp(p / 0.25);
    ctx.drawImage(s.warm, 0, -H * 0.13);
    ctx.restore();

    // Desk, lamp light and a mug with steam.
    ctx.fillStyle = '#4a2f22';
    ctx.fillRect(0, H * 0.6, W, H * 0.4);
    const lamp = ctx.createRadialGradient(W * 0.15, H * 0.62, 10, W * 0.15, H * 0.62, 380);
    lamp.addColorStop(0, 'rgba(255,190,110,0.45)');
    lamp.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, W, H);
    const mx = W * 0.75, my = H * 0.6;
    ctx.fillStyle = '#e9e2d6';
    ctx.fillRect(mx - 40, my - 70, 80, 80);
    ctx.strokeStyle = '#e9e2d6';
    ctx.lineWidth = 10;
    ctx.beginPath();
    ctx.arc(mx + 45, my - 30, 20, -Math.PI / 2, Math.PI / 2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.4)';
    ctx.lineWidth = 4;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      for (let k = 0; k < 30; k++) {
        const y = my - 80 - k * 4, x = mx - 20 + i * 20 + Math.sin(k / 4 + t / 400 + i) * 8;
        k ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    caption(ctx, p, info, false, true);
  },
};

// --- NASA: the number in orbit, the space station passing ----------------

const nasa = {
  setup(info) {
    const land = Array.from({ length: 16 }, () => ({ a: rand(0, Math.PI * 2), d: rand(0.2, 0.95), rx: rand(30, 90), ry: rand(20, 50) }));
    const stars = Array.from({ length: 180 }, () => ({ x: rand(0, W), y: rand(0, H * 0.7), r: rand(0.6, 1.8), tw: rand(0, 6) }));
    return { mask: numberMask(String(info.number), 420), land, stars };
  },
  draw(ctx, p, t, info, s) {
    ctx.fillStyle = '#000005';
    ctx.fillRect(0, 0, W, H);
    for (const st of s.stars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 600 + st.tw);
      ctx.fillStyle = '#fff';
      ctx.fillRect(st.x, st.y, st.r, st.r);
    }
    ctx.globalAlpha = 1;
    // Earth, turning slowly below.
    const ex = W / 2, ey = H * 1.45, er = H * 0.95;
    ctx.save();
    ctx.shadowColor = '#7ab8ff';
    ctx.shadowBlur = 60;
    const sea = ctx.createRadialGradient(ex, ey - er * 0.5, er * 0.2, ex, ey, er);
    sea.addColorStop(0, '#2f7fe0');
    sea.addColorStop(1, '#0a2a66');
    ctx.fillStyle = sea;
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.beginPath();
    ctx.arc(ex, ey, er, 0, Math.PI * 2);
    ctx.clip();
    for (const l of s.land) {
      const a = l.a + t / 40000;
      ctx.fillStyle = '#3d8a4a';
      ctx.beginPath();
      ctx.ellipse(ex + Math.cos(a) * er * l.d, ey + Math.sin(a) * er * l.d * 0.4 - er * 0.55, l.rx, l.ry, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    ctx.drawImage(s.mask, 0, -H * 0.06);

    // The space station crosses on a curving orbit.
    const k = clamp((p - 0.15) / 0.75);
    if (k > 0 && k < 1) {
      const x = -120 + k * (W + 240), y = H * 0.2 + Math.sin(k * Math.PI) * -40 + 60;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(-0.15 + k * 0.3);
      ctx.fillStyle = '#c9c9c9';
      ctx.fillRect(-60, -3, 120, 6);
      ctx.fillRect(-12, -10, 24, 20);
      ctx.fillStyle = '#c9a23a';
      for (const dx of [-55, -38, 38, 55]) ctx.fillRect(dx - 6, -32, 12, 64);
      ctx.restore();
    }
    caption(ctx, p, info);
  },
};

// Shared idents, then ones a channel can claim with "ident" in sources.json.
const SHARED = ['mosaic', 'paint', 'weather', 'oscilloscope', 'filmleader', 'starfield', 'headlines'];
const IDENTS = {
  mosaic, paint, weather, oscilloscope, filmleader, starfield, headlines: headlinesIdent,
  bobross, taskmaster, bushtucker, rockhits, infomercial, lofi, nasa,
};

// --- The clock -------------------------------------------------------------

function clock(ctx, info) {
  const now = new Date();
  const bg = ctx.createRadialGradient(W / 2, H * 0.4, 50, W / 2, H * 0.4, W * 0.75);
  bg.addColorStop(0, '#13306e');
  bg.addColorStop(1, '#030a1c');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const cx = W / 2, cy = H * 0.4, r = 220;
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'butt';
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2;
    const major = i % 5 === 0;
    ctx.lineWidth = major ? (i % 15 === 0 ? 12 : 7) : 2;
    const inner = r - (major ? 34 : 12);
    ctx.beginPath();
    ctx.moveTo(cx + Math.sin(a) * inner, cy - Math.cos(a) * inner);
    ctx.lineTo(cx + Math.sin(a) * r, cy - Math.cos(a) * r);
    ctx.stroke();
  }
  const ms = now.getMilliseconds();
  const sec = now.getSeconds() + ms / 1000;
  const min = now.getMinutes() + sec / 60;
  const hr = (now.getHours() % 12) + min / 60;
  const hand = (turn, length, width, colour) => {
    const a = turn * Math.PI * 2;
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx - Math.sin(a) * 20, cy + Math.cos(a) * 20);
    ctx.lineTo(cx + Math.sin(a) * length, cy - Math.cos(a) * length);
    ctx.stroke();
  };
  hand(hr / 12, r * 0.55, 14, '#fff');
  hand(min / 60, r * 0.82, 9, '#fff');
  hand(sec / 60, r * 0.9, 3, '#ffd200');
  ctx.fillStyle = '#ffd200';
  ctx.beginPath();
  ctx.arc(cx, cy, 9, 0, Math.PI * 2);
  ctx.fill();

  const left = Math.max(0, info.next.start - Date.now());
  const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
  const title = info.next.title.length > 34 ? `${info.next.title.slice(0, 32)}..` : info.next.title;
  text(ctx, `${info.number} ${info.name.toUpperCase()}`, W / 2, H * 0.4 + r + 50, 28, '#ffd200');
  text(ctx, `NEXT: ${title}`, W / 2, H * 0.4 + r + 100, 26, '#fff');
  text(ctx, left > 0 ? `STARTS IN ${m}:${String(s).padStart(2, '0')}` : 'STARTING NOW', W / 2, H * 0.4 + r + 145, 26, '#0ff');
}

// --- Running order -----------------------------------------------------------

function nextSegment(now) {
  // A showcase flips through the idents one after another. Otherwise: clock
  // only near the end, and before that alternate ident and clock.
  const left = run.info.showcase ? Infinity : run.info.next.start - Date.now();
  const ident = run.info.showcase || (run.seg?.kind !== 'ident' && left > IDENT_MS + 3000);
  if (ident) {
    const { name, info } = run.order[run.turn++ % run.order.length];
    const def = IDENTS[name];
    run.seg = { kind: 'ident', name, info, start: now, length: IDENT_MS, state: def.setup(info) };
    sound.chime();
  } else {
    run.seg = { kind: 'clock', start: now, length: left < CLOCK_MS + IDENT_MS ? Infinity : CLOCK_MS };
  }
}

// Which idents play, and as which channel. A channel's own ident goes first;
// a showcase plays every shared ident, then each channel's under its number.
function runningOrder(info) {
  if (info.showcase) {
    return [
      ...SHARED.map((name) => ({ name, info })),
      ...(info.own ?? []).filter((o) => IDENTS[o.ident]).map((o) => ({ name: o.ident, info: { ...info, number: o.number, name: o.name } })),
    ];
  }
  const shared = [...SHARED].sort(() => Math.random() - 0.5).map((name) => ({ name, info }));
  return IDENTS[info.ident] ? [{ name: info.ident, info }, ...shared] : shared;
}

function frame(now) {
  if (!run) return;
  if (!run.seg || now - run.seg.start >= run.seg.length) nextSegment(now);
  const { ctx, info, seg } = run;
  if (seg.kind === 'ident') {
    IDENTS[seg.name].draw(ctx, (now - seg.start) / seg.length, now, seg.info, seg.state);
  } else {
    clock(ctx, info);
    // Pips over the last five seconds, a long one as the programme starts.
    const left = Math.ceil((info.next.start - Date.now()) / 1000);
    if (left !== run.lastPip && left >= 0 && left <= 5) {
      run.lastPip = left;
      sound.pip(left === 0);
    }
  }
  raf = requestAnimationFrame(frame);
}

async function loadConditions() {
  try {
    const all = await (await fetch('/api/conditions')).json();
    // The viewer's side of the world: Americas get the US region, others the first.
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? '';
    const continent = zone.split('/')[0];
    conditions = all.find((c) => c.timezone?.startsWith(`${continent}/`)) ?? all[0] ?? null;
  } catch { /* the weather ident falls back to a clear sky */ }
}

// info: { number, name, next: { title, start }, weather? }, or
// { number, name, showcase: true } to flip through the idents with no clock.
// Without weather, the viewer's nearest region from /api/conditions is used.
export function startInterlude(canvas, info) {
  stopInterlude();
  canvas.width = W;
  canvas.height = H;
  run = {
    ctx: canvas.getContext('2d'),
    info: { ...info, weather: info.weather ?? conditions },
    order: [],
    turn: 0,
    seg: null,
    lastPip: null,
  };
  run.order = runningOrder(run.info);
  loadHeadlines();
  if (!info.weather) loadConditions().then(() => { if (run) for (const o of run.order) o.info.weather = conditions; });
  document.fonts.load(`20px ${FONT}`).finally(() => { if (run) raf = requestAnimationFrame(frame); });
}

export function stopInterlude() {
  cancelAnimationFrame(raf);
  raf = 0;
  run = null;
}
