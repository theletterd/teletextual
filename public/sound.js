// TV sound effects through one AudioContext: the test card's 1 kHz tone and
// the hiss of an empty channel. Browsers only let audio start from a key
// press or click, so callers run unlock() from those handlers.

const LEVEL = { tone: 0.05, hiss: 0.03 };

let ctx = null;
let gain = null;
let source = null;
let playing = null;
let muted = false;

export function unlock() {
  ctx ??= new AudioContext();
  if (ctx.state === 'suspended') ctx.resume();
}

function make(kind) {
  if (kind === 'tone') {
    const osc = ctx.createOscillator();
    osc.frequency.value = 1000;
    return osc;
  }
  // Two seconds of white noise, looped.
  const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  const noise = ctx.createBufferSource();
  noise.buffer = buffer;
  noise.loop = true;
  return noise;
}

// kind: 'tone', 'hiss' or null for silence.
export function play(kind) {
  if (kind === playing) return;
  source?.stop();
  source = null;
  playing = kind;
  if (!kind) return;
  unlock();
  if (!gain) {
    gain = ctx.createGain();
    gain.connect(ctx.destination);
  }
  gain.gain.value = muted ? 0 : LEVEL[kind];
  source = make(kind);
  source.connect(gain);
  source.start();
}

export function setMuted(on) {
  muted = on;
  if (gain && playing) gain.gain.value = on ? 0 : LEVEL[playing];
}

// One-shot sounds for interludes. They need audio already unlocked by a key
// press, and stay quiet when muted.
function note(freq, at, length, level, type = 'sine', flat = false) {
  if (!ctx || muted) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  const t = ctx.currentTime + at;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(level, t + 0.01);
  if (flat) {
    env.gain.setValueAtTime(level, t + length - 0.01);
    env.gain.linearRampToValueAtTime(0, t + length);
  } else {
    env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  }
  osc.connect(env).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + length + 0.05);
}

// A rising four-note arpeggio for the start of an ident.
export function chime() {
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => note(f, i * 0.12, 0.9, 0.05, 'triangle'));
}

// Time pips: short ones counting down, a long one on the hour.
export function pip(long = false) {
  note(1000, 0, long ? 0.5 : 0.1, 0.05, 'sine', true);
}

// Filtered noise bursts: a balloon's pop, a wet splat, a set's power thump.
let noiseBuffer = null;
function burst(length, type, from, to, level, at = 0) {
  if (!ctx || muted) return;
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  const t = ctx.currentTime + at;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + length);
  const env = ctx.createGain();
  env.gain.setValueAtTime(level, t);
  env.gain.exponentialRampToValueAtTime(0.0001, t + length);
  src.connect(filter).connect(env).connect(ctx.destination);
  src.start(t);
  src.stop(t + length + 0.05);
}

export function splat() {
  burst(0.04, 'highpass', 3500, 2500, 0.05);           // the balloon pops
  burst(0.32, 'lowpass', 2600, 220, 0.09, 0.01);      // paint hits
}

export function thump() {
  burst(0.18, 'lowpass', 300, 60, 0.12);
  note(55, 0, 0.25, 0.06);
}
