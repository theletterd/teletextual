// The TV picture behind the teletext: TEXT, TV and MIX modes like a real set.
// Live streams play through YouTube's iframe player; as on a real TV, the
// sound carries on while you read teletext.

const glass = document.querySelector('.glass');
const osd = document.getElementById('osd');
const KEYS = { text: 't', tv: 'v', mix: 'x' };

let channels = [];
let current = 0;
let mode = 'text';
let muted = false;
let player = null;
let ready = null;
let osdTimer = 0;

export const getMode = () => mode;

export async function loadChannels() {
  try {
    channels = await (await fetch('/api/tv')).json();
  } catch { /* keep the last list */ }
}

// Load YouTube's player API on first use, so text-only visitors never fetch it.
function loadPlayer() {
  ready ??= new Promise((resolve) => {
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    document.head.appendChild(script);
  }).then(() => new Promise((resolve) => {
    player = new window.YT.Player('player', {
      width: '100%',
      height: '100%',
      playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, rel: 0, playsinline: 1, iv_load_policy: 3 },
      events: { onReady: resolve },
    });
  }));
  return ready;
}

function showOsd(text) {
  osd.textContent = text;
  osd.hidden = false;
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => { osd.hidden = true; }, 3000);
}

const channelKey = (i) => String((i + 1) % 10);

async function tune(i) {
  if (!channels.length) await loadChannels();
  if (!channels.length) return showOsd('NO SIGNAL');
  current = (i + channels.length) % channels.length;
  const ch = channels[current];
  showOsd(`${channelKey(current)} ${ch.name.toUpperCase()}`);
  if (!ch.videoId) return showOsd(`${channelKey(current)} OFF AIR`);
  await loadPlayer();
  player.loadVideoById(ch.videoId);
  if (!muted) player.unMute();
}

export async function setMode(next) {
  const was = mode;
  mode = next;
  glass.dataset.mode = next;
  for (const [m, key] of Object.entries(KEYS)) {
    document.querySelector(`.modes [data-key="${key}"]`)?.classList.toggle('on', m === next);
  }
  // Start the picture the first time it's wanted; after that it keeps running.
  if (next !== 'text' && !player) await tune(current);
  else if (next === 'tv' && was !== 'tv') showOsd(`${channelKey(current)} ${channels[current]?.name.toUpperCase() ?? ''}`);
}

export const channelUp = () => tune(current + 1);
export const channelDown = () => tune(current - 1);

export function channelByKey(d) {
  const i = d === '0' ? 9 : Number(d) - 1;
  if (i < channels.length) tune(i);
}

export function toggleMute() {
  muted = !muted;
  if (muted) player?.mute(); else player?.unMute();
  document.querySelector('.modes [data-key="u"]')?.classList.toggle('on', muted);
  showOsd(muted ? 'MUTE' : 'SOUND');
}
