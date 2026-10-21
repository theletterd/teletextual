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
const strap = document.getElementById('strap');
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
let subtitles = false;
let poweredOff = false;

// Volume, 0-100 in tens, remembered between visits where storage allows.
const VOLUME_KEY = 'teletextual-volume';
let volume = 80;
try {
  const saved = Number(localStorage.getItem(VOLUME_KEY));
  if (localStorage.getItem(VOLUME_KEY) !== null && saved >= 0 && saved <= 100) volume = saved;
} catch { /* private mode and the like */ }
sound.setVolume(volume / 100);
let onStream = false;
let strapTimer = 0;
let strapHide = 0;

const STRAP_SHOW_MS = 5000;
const STRAP_EVERY_MS = 15 * 60_000;
const STRAP_NEXT_MS = 5 * 60_000;  // "next" strap this long before a programme ends   // wakes a playlist channel at its next programme

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
      events: { onReady: (e) => { e.target.setVolume(volume); resolve(); }, onStateChange: stateChanged, onError: playbackFailed },
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
  // Any strap on screen belongs to what was on before, so it goes at once.
  onStream = kind === 'stream';
  hideStrap();
  if (onStream) planStrap(4500);
  interlude.hidden = kind !== 'interlude';
  if (kind === 'interlude') startInterlude(interlude, info); else stopInterlude();
  const showCard = kind === 'card' || kind === 'offair';
  if (showCard && !cardDrawn) { drawTestCard(card); cardDrawn = true; }
  card.hidden = !showCard;
  snow.hidden = noSignal.hidden = kind !== 'static';
  if (kind === 'static') startStatic(snow); else stopStatic();
  sound.play(kind === 'card' ? 'tone' : kind === 'static' ? 'hiss' : null);
}

// The strap: "You're watching X on Teletextual", now and then, on whatever's
// streaming. Playlist channels add what's on, or what's next near the end.
const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

function strapLine(text, className, label) {
  const div = document.createElement('div');
  if (className) div.className = className;
  if (label) {
    const span = document.createElement('span');
    span.className = 'label';
    span.textContent = label;
    div.append(span, ' ');
  }
  div.append(text);
  return div;
}

function showStrap() {
  const ch = channels[current];
  if (!ch || !onStream || mode !== 'tv') return;
  const lines = [strapLine(`You're watching ${ch.name}`), strapLine('on Teletextual', 'on-tt')];
  const now = ch.programmes && onAir(ch);
  if (now && !now.interlude) {
    const ending = now.start + now.seconds * 1000 - Date.now() < STRAP_NEXT_MS;
    const next = ending && onAir(ch, now.end);
    lines.push(next ? strapLine(next.title, 'now', `Next ${hhmm(next.start)}:`) : strapLine(now.title, 'now', 'Now:'));
  }
  strap.replaceChildren(...lines);
  strap.classList.add('on');
  clearTimeout(strapHide);
  strapHide = setTimeout(() => strap.classList.remove('on'), STRAP_SHOW_MS);
}

// Every 15 minutes, or sooner if a programme's last five minutes start first.
function nextStrapIn() {
  let delay = STRAP_EVERY_MS;
  const now = channels[current]?.programmes && onAir(channels[current]);
  if (now && !now.interlude) {
    const untilNext = now.start + now.seconds * 1000 - STRAP_NEXT_MS - Date.now();
    if (untilNext > 10_000) delay = Math.min(delay, untilNext);
  }
  return delay;
}

function planStrap(delay) {
  clearTimeout(strapTimer);
  strapTimer = setTimeout(() => { showStrap(); planStrap(nextStrapIn()); }, delay);
}

function hideStrap() {
  clearTimeout(strapTimer);
  clearTimeout(strapHide);
  strap.classList.remove('on');
}

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

// A playlist channel follows the clock: when a programme ends, or one won't
// play, work out what should be on now.
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
  if (poweredOff) return;
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
  if (next !== 'tv') strap.classList.remove('on');
  if (next !== 'text' && !started) await tune(current);
  else if (next === 'tv' && was !== 'tv') {
    showOsd(`${channels[current]?.number ?? ''} ${channels[current]?.name.toUpperCase() ?? ''}`);
    if (onStream) planStrap(4500);
  }
}

// Power off stops every picture and sound; power on retunes, so a live
// stream comes back at its live edge and a schedule at the right moment.
export function powerOff() {
  poweredOff = true;
  ++tuning;
  clearTimeout(slotTimer);
  clearTimeout(entryTimer);
  entry = '';
  osd.hidden = true;
  picture('none');
}

export function powerOn() {
  poweredOff = false;
  if (started) tune(current);
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

// A row of ten blocks under VOLUME, filled to the level, as old sets showed.
function showVolume() {
  const bar = document.createElement('span');
  bar.className = 'bar';
  for (let i = 1; i <= 10; i++) {
    const block = document.createElement('i');
    if (i * 10 > volume) block.className = 'off';
    bar.append(block);
  }
  osd.replaceChildren('VOLUME ', bar);
  osd.hidden = false;
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => { osd.hidden = true; }, 2500);
}

// Turning up the volume while muted unmutes, as on a real TV.
export function changeVolume(step) {
  sound.unlock();
  volume = Math.max(0, Math.min(100, volume + step));
  if (muted && step > 0) toggleMute();
  player?.setVolume(volume);
  sound.setVolume(volume / 100);
  try { localStorage.setItem(VOLUME_KEY, String(volume)); } catch { /* not saved, still set */ }
  showVolume();
}

export function toggleMute() {
  sound.unlock();
  muted = !muted;
  if (muted) player?.mute(); else player?.unMute();
  sound.setMuted(muted);
  document.querySelector('.modes [data-key="u"]')?.classList.toggle('on', muted);
  showOsd(muted ? 'MUTE' : 'SOUND');
}
