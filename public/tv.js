// The TV picture behind the teletext: TEXT, TV and MIX modes like a real set.
// Live streams play through YouTube's iframe player; as on a real TV, the
// sound carries on while you read teletext.

import { drawTestCard, tone } from './testcard.js';

const glass = document.querySelector('.glass');
const card = document.getElementById('testcard');
const osd = document.getElementById('osd');
const KEYS = { text: 't', tv: 'v', mix: 'x' };

let channels = [];
let current = 0;
let mode = 'text';
let muted = false;
let player = null;
let ready = null;
let osdTimer = 0;
let started = false;
let cardDrawn = false;
let entry = '';      // channel digits typed so far
let entryTimer = 0;

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

// The test card stands in for its own channel and for anything off air;
// only the real test card channel plays the tone.
function showCard(on, withTone) {
  if (on && !cardDrawn) { drawTestCard(card); cardDrawn = true; }
  card.hidden = !on;
  tone(on && withTone, muted);
}

async function tune(i) {
  if (!channels.length) await loadChannels();
  if (!channels.length) return showOsd('NO SIGNAL');
  started = true;
  current = (i + channels.length) % channels.length;
  const ch = channels[current];
  showOsd(`${ch.number} ${ch.name.toUpperCase()}`);
  if (ch.testcard || !ch.videoId) {
    player?.stopVideo();
    showCard(true, ch.testcard);
    if (!ch.testcard) showOsd(`${ch.number} OFF AIR`);
    return;
  }
  showCard(false);
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
  if (next !== 'text' && !started) await tune(current);
  else if (next === 'tv' && was !== 'tv') showOsd(`${channels[current]?.number ?? ''} ${channels[current]?.name.toUpperCase() ?? ''}`);
}

export const channelUp = () => tune(current + 1);
export const channelDown = () => tune(current - 1);

// Like a real set: a digit that could start a longer channel number (1 for
// 10) waits briefly for the next one, showing "1-"; anything else tunes now.
export function channelDigit(d) {
  clearTimeout(entryTimer);
  entry += d;
  const tuneTo = () => {
    const i = channels.findIndex((ch) => String(ch.number) === entry);
    entry = '';
    if (i >= 0) tune(i); else osd.hidden = true;
  };
  const longer = channels.some((ch) => String(ch.number).length > entry.length && String(ch.number).startsWith(entry));
  if (!longer) return tuneTo();
  showOsd(`${entry}-`);
  entryTimer = setTimeout(tuneTo, 1200);
}

export function toggleMute() {
  muted = !muted;
  if (muted) player?.mute(); else player?.unMute();
  tone(!card.hidden && channels[current]?.testcard, muted);
  document.querySelector('.modes [data-key="u"]')?.classList.toggle('on', muted);
  showOsd(muted ? 'MUTE' : 'SOUND');
}
