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
