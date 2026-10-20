// The TV picture behind the teletext: TEXT, TV and MIX modes like a real set.
// Live streams play through YouTube's iframe player; as on a real TV, the
// sound carries on while you read teletext.

import { drawTestCard } from './testcard.js';
import { startStatic, stopStatic } from './static.js';
import * as sound from './sound.js';
import { onAir } from './schedule.js';
import { startInterlude, stopInterlude } from './interlude.js';

const glass = document.querySelector('.glass');
const card = document.getElementById('testcard');
const snow = document.getElementById('static');
const interlude = document.getElementById('interlude');
const noSignal = document.getElementById('nosignal');
const osd = document.getElementById('osd');
const KEYS = { text: 't', tv: 'v', mix: 'x' };

let channels = [];
let current = 0;     // index of the last real channel tuned
let mode = 'text';
let muted = false;
let player = null;
let ready = null;
let osdTimer = 0;
let started = false;
let cardDrawn = false;
let tuning = 0;      // bumps on every tune so a slow stream load can't land late
let entry = '';      // channel digits typed so far
let entryTimer = 0;
let slotTimer = 0;
let subtitles = false;   // wakes a playlist channel at its next programme

export const getMode = () => mode;
export const getChannels = () => channels;

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
      events: { onReady: resolve, onStateChange: stateChanged, onError: playbackFailed },
    });
  }));
  return ready;
}

// Shows text top left; it fades after a few seconds unless `stay` is set.
function showOsd(text, stay = false) {
  osd.textContent = text;
  osd.hidden = false;
  clearTimeout(osdTimer);
  if (!stay) osdTimer = setTimeout(() => { osd.hidden = true; }, 3000);
}

// What's behind the glass: 'stream', 'card' (with tone), 'offair' (card,
// silent), 'static' (snow, hiss and NO SIGNAL) or 'interlude' (idents and a
// clock until the next programme; `info` says which).
function picture(kind, info) {
  if (kind !== 'stream') player?.stopVideo();
  interlude.hidden = kind !== 'interlude';
  if (kind === 'interlude') startInterlude(interlude, info); else stopInterlude();
  const showCard = kind === 'card' || kind === 'offair';
  if (showCard && !cardDrawn) { drawTestCard(card); cardDrawn = true; }
  card.hidden = !showCard;
  snow.hidden = noSignal.hidden = kind !== 'static';
  if (kind === 'static') startStatic(snow); else stopStatic();
  sound.play(kind === 'card' ? 'tone' : kind === 'static' ? 'hiss' : null);
}

// A playlist channel follows the clock: when a programme ends, or one won't
// play, work out what should be on now.
// Captions go through the player's captions module. Turning it on and off
// mid-video isn't in YouTube's documented API but is widely used; each new
// video resets it, so it's reapplied whenever playback starts.
function applySubtitles() {
  if (!player?.loadModule) return;
  if (subtitles) {
    player.loadModule('captions');
    player.setOption?.('captions', 'track', { languageCode: 'en' });
  } else {
    player.unloadModule('captions');
  }
}

export function setSubtitles(on) {
  subtitles = on;
  applySubtitles();
  showOsd(on ? 'SUBTITLES ON' : 'SUBTITLES OFF');
}

export const toggleSubtitles = () => setSubtitles(!subtitles);

function stateChanged(e) {
  if (e.data === window.YT.PlayerState.PLAYING) applySubtitles();
  if (e.data === window.YT.PlayerState.ENDED && channels[current]?.programmes) tune(current, { quiet: true });
}

function playbackFailed() {
  const ch = channels[current];
  if (!ch?.programmes) return;
  picture('offair');
  const now = onAir(ch);
  if (now) wakeAt(now.end);
}

function wakeAt(time) {
  clearTimeout(slotTimer);
  slotTimer = setTimeout(() => tune(current, { quiet: true }), Math.max(0, time - Date.now()) + 500);
}

// Plays whatever the schedule says is on now, from the right second; between
// programmes the test card holds the slot until the next one.
async function playScheduled(ch, seq) {
  const now = onAir(ch);
  if (!now) return picture('offair');
  if (now.interlude) {
    const next = onAir(ch, now.end);
    picture('interlude', { number: ch.number, name: ch.name, ident: ch.ident, next: { title: next.title, start: next.start } });
    return wakeAt(now.end);
  }
  picture('stream');
  await loadPlayer();
  if (seq !== tuning) return;
  player.loadVideoById({ videoId: now.videoId, startSeconds: Math.floor(now.into) });
  if (!muted) player.unMute();
}

async function tune(i, { quiet = false } = {}) {
  clearTimeout(slotTimer);
  const seq = ++tuning;
  if (!channels.length) await loadChannels();
  if (!channels.length) return noSignalOn('');
  started = true;
  current = (i + channels.length) % channels.length;
  const ch = channels[current];
  if (!quiet) showOsd(`${ch.number} ${ch.name.toUpperCase()}`);
  if (ch.testcard) return picture('card');
  if (ch.idents) {
    // Show off the channel idents too, each with its own channel's number.
    const own = channels.filter((c) => c.ident).map((c) => ({ ident: c.ident, number: c.number, name: c.name }));
    return picture('interlude', { number: ch.number, name: ch.name, showcase: true, own });
  }
  if (ch.programmes) return playScheduled(ch, seq);
  if (!ch.videoId) {
    showOsd(`${ch.number} OFF AIR`);
    return picture('offair');
  }
  picture('stream');
  await loadPlayer();
  if (seq !== tuning) return;
  player.loadVideoById(ch.videoId);
  if (!muted) player.unMute();
}

function noSignalOn(number) {
  clearTimeout(slotTimer);
  ++tuning;
  started = true;
  showOsd(String(number));
  picture('static');
}

export async function setMode(next) {
  sound.unlock();
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

export const channelUp = () => { sound.unlock(); tune(current + 1); };
export const channelDown = () => { sound.unlock(); tune(current - 1); };

// Like a real set: up to two digits. The first waits a second for a second
// one ("3-"), then tunes; "01" is channel 1. Numbers with no channel get snow.
export function channelDigit(d) {
  sound.unlock();
  clearTimeout(entryTimer);
  entry += d;
  const finish = () => {
    const number = Number(entry);
    entry = '';
    const i = channels.findIndex((ch) => ch.number === number);
    if (i >= 0) tune(i); else noSignalOn(number);
  };
  if (entry.length === 2) return finish();
  showOsd(`${entry}-`, true);
  entryTimer = setTimeout(finish, 1000);
}

export function toggleMute() {
  sound.unlock();
  muted = !muted;
  if (muted) player?.mute(); else player?.unMute();
  sound.setMuted(muted);
  document.querySelector('.modes [data-key="u"]')?.classList.toggle('on', muted);
  showOsd(muted ? 'MUTE' : 'SOUND');
}
