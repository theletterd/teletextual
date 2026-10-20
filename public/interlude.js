// Interludes for the gaps between scheduled programmes. In the spirit of
// BBC Two's 1990s idents, the channel's own number is the star of a short
// animation; between idents, and for the final stretch, a clock counts down
// to the next programme. Everything is drawn live on a canvas.

import * as sound from './sound.js';

const W = 1024, H = 768;
const IDENT_MS = 10_000;
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

// --- Paint: balloons fly in and splat the number ---------------------------

const PAINT = ['#e8202a', '#1f6fd6', '#f4c20d', '#22a04b', '#9b2fc2', '#ff7a00'];

function splat(ctx, x, y, r, colour) {
  ctx.fillStyle = colour;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = rand(0, Math.PI * 2), d = rand(r * 0.6, r * 1.9), dr = rand(r * 0.08, r * 0.3);
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, dr, 0, Math.PI * 2);
    ctx.fill();
  }
}

const paint = {
  setup(info) {
    const mask = numberMask(String(info.number), 560);
    const layer = document.createElement('canvas');
    layer.width = W;
    layer.height = H;
    const shots = Array.from({ length: 14 }, (_, i) => {
      const angle = rand(0, Math.PI * 2);
      return {
        hit: 0.06 + i * 0.04,
        x: rand(W * 0.3, W * 0.7), y: rand(H * 0.25, H * 0.62),
        fromX: W / 2 + Math.cos(angle) * W, fromY: H / 2 + Math.sin(angle) * H,
        r: rand(80, 140),
        colour: PAINT[i % PAINT.length],
        done: false,
      };
    });
    return { mask, layer, shots, tmp: document.createElement('canvas') };
  },
  draw(ctx, p, t, info, s) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#efece6');
    bg.addColorStop(1, '#cfc8bc');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // The white numeral with a soft shadow.
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 14;
    ctx.drawImage(s.mask, 0, 0);
    ctx.restore();

    const lctx = s.layer.getContext('2d');
    for (const shot of s.shots) {
      if (p < shot.hit) {
        // Balloon on its way in.
        const k = clamp(1 - (shot.hit - p) / 0.12);
        if (!k) continue;
        const bx = shot.fromX + (shot.x - shot.fromX) * k, by = shot.fromY + (shot.y - shot.fromY) * k;
        ctx.fillStyle = shot.colour;
        ctx.beginPath();
        ctx.ellipse(bx, by, 26, 32, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (!shot.done) {
        splat(lctx, shot.x, shot.y, shot.r, shot.colour);
        shot.done = true;
      }
    }
    // Paint only sticks to the numeral.
    s.tmp.width = W;
    s.tmp.height = H;
    const tctx = s.tmp.getContext('2d');
    tctx.drawImage(s.layer, 0, 0);
    tctx.globalCompositeOperation = 'destination-in';
    tctx.drawImage(s.mask, 0, 0);
    ctx.drawImage(s.tmp, 0, 0);
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
    const data = mask.getContext('2d').getImageData(0, 0, W, H).data;
    const tops = [];
    for (let x = 0; x < W; x += 4) {
      let y = 0;
      while (y < H && data[(y * W + x) * 4 + 3] < 128) y++;
      tops.push(y < H ? y : null);
    }
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


// --- Bob Ross: a little landscape painted in, happy little trees and all ---

const bobross = {
  setup(info) {
    const left = W * 0.1, top = H * 0.06, cw = W * 0.8, ch = H * 0.64;
    const trees = [
      { x: left + cw * 0.12, base: top + ch * 0.97, h: ch * 0.55, at: 0.42 },
      { x: left + cw * 0.24, base: top + ch * 0.99, h: ch * 0.42, at: 0.5 },
      { x: left + cw * 0.86, base: top + ch * 0.98, h: ch * 0.5, at: 0.58 },
    ];
    return { left, top, cw, ch, trees, mask: numberMask(String(info.number), 300) };
  },
  draw(ctx, p, t, info, s) {
    const { left, top, cw, ch } = s;
    ctx.fillStyle = '#3a2718';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#f4efe2';
    ctx.fillRect(left, top, cw, ch);
    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, cw, ch);
    ctx.clip();

    // Sky, in broad strokes from left to right.
    const sky = clamp(p / 0.25);
    const g = ctx.createLinearGradient(0, top, 0, top + ch * 0.7);
    g.addColorStop(0, '#1d3b6e');
    g.addColorStop(1, '#f6e7c8');
    ctx.fillStyle = g;
    for (let i = 0; i < 6; i++) {
      const k = clamp(sky * 1.4 - i * 0.08);
      ctx.fillRect(left, top + i * ch * 0.12, cw * k, ch * 0.13);
    }

    // Mountains, revealed top down.
    const mtn = clamp((p - 0.2) / 0.22);
    if (mtn) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, cw, ch * 0.35 + ch * 0.65 * mtn);
      ctx.clip();
      poly(ctx, [[left, top + ch * 0.75], [left + cw * 0.3, top + ch * 0.25], [left + cw * 0.5, top + ch * 0.55], [left + cw * 0.7, top + ch * 0.18], [left + cw, top + ch * 0.7], [left + cw, top + ch], [left, top + ch]], '#4b4a5a');
      poly(ctx, [[left + cw * 0.3, top + ch * 0.25], [left + cw * 0.36, top + ch * 0.36], [left + cw * 0.27, top + ch * 0.34]], '#fff');
      poly(ctx, [[left + cw * 0.7, top + ch * 0.18], [left + cw * 0.77, top + ch * 0.31], [left + cw * 0.65, top + ch * 0.28]], '#fff');
      ctx.restore();
    }
    // Meadow.
    const field = clamp((p - 0.35) / 0.12);
    if (field) {
      ctx.fillStyle = '#3f6b2e';
      ctx.fillRect(left, top + ch * (1 - 0.22 * field), cw, ch * 0.22);
    }
    // Happy little trees, a tier at a time from the bottom up.
    for (const tree of s.trees) {
      const k = clamp((p - tree.at) / 0.14);
      if (!k) continue;
      ctx.fillStyle = '#4a2f1b';
      ctx.fillRect(tree.x - 4, tree.base - tree.h * 0.12, 8, tree.h * 0.12);
      const tiers = 5;
      for (let i = 0; i < Math.ceil(tiers * k); i++) {
        const y = tree.base - tree.h * 0.1 - (i * tree.h * 0.85) / tiers;
        const w = tree.h * 0.32 * (1 - i / (tiers + 1));
        poly(ctx, [[tree.x - w, y], [tree.x + w, y], [tree.x, y - tree.h * 0.28]], i % 2 ? '#1f4a26' : '#2a5e30');
      }
    }
    ctx.restore();

    // The channel number, painted on in titanium white.
    const num = clamp((p - 0.3) / 0.28);
    if (num) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, W * num, H);
      ctx.clip();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 12;
      ctx.drawImage(s.mask, 0, -H * 0.1);
      ctx.restore();
    }
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

// Shared idents, then ones a channel can claim with "ident" in sources.json.
const SHARED = ['mosaic', 'paint', 'weather'];
const IDENTS = { mosaic, paint, weather, bobross, taskmaster };

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
  if (!info.weather) loadConditions().then(() => { if (run) for (const o of run.order) o.info.weather = conditions; });
  document.fonts.load(`20px ${FONT}`).finally(() => { if (run) raf = requestAnimationFrame(frame); });
}

export function stopInterlude() {
  cancelAnimationFrame(raf);
  raf = 0;
  run = null;
}
