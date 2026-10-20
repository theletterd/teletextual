// Teletextual client: draws 40x25 teletext pages and handles page entry.

import { imageTiles } from './mosaic.js';
import * as tv from './tv.js';
import * as sound from './sound.js';
import { listings } from './schedule.js';

const COLS = 40;
const ROWS = 25;
const SUBPAGE_SECONDS = 12;

const screen = document.getElementById('screen');
const holdBtn = document.getElementById('hold');
const full = document.getElementById('full');

// Build the grid once; rendering just restyles cells.
const rowEls = [];
const cells = [];
for (let r = 0; r < ROWS; r++) {
  const row = document.createElement('div');
  row.className = 'row';
  const line = [];
  for (let c = 0; c < COLS; c++) {
    const cell = document.createElement('div');
    cell.className = 'cell';
    row.appendChild(cell);
    line.push(cell);
  }
  screen.appendChild(row);
  rowEls.push(row);
  cells.push(line);
}

const state = {
  index: [],          // available page numbers
  cache: new Map(),   // num -> { page, at }
  current: null,      // page object on screen
  sub: 0,
  entry: '',          // digits typed so far
  target: 100,        // page being searched for
  rolling: 100,       // number shown in header while searching
  searching: false,
  hold: false,
  subTimer: 0,
  rollTimer: 0,
  seq: 0,
};

// --- drawing -------------------------------------------------------------

function setCell(cell, ch, fg = 'white', bg = 'black', link = null, mosaic = null) {
  cell.className = `cell fg-${fg} bg-${bg}${link ? ' link' : ''}`;
  if (link) cell.dataset.link = link; else delete cell.dataset.link;
  if (mosaic != null) {
    let html = '<div class="mosaic">';
    for (let b = 0; b < 6; b++) html += `<i${mosaic & (1 << b) ? ` class="bg-${fg}"` : ''}></i>`;
    cell.innerHTML = html + '</div>';
  } else {
    cell.innerHTML = ch === ' ' ? '' : `<span>${ch.replace(/[&<>]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[x])}</span>`;
  }
}

function writeRow(r, segments) {
  let c = 0;
  let lastBg = 'black';
  for (const s of segments) {
    const bg = s.bg ?? 'black';
    lastBg = bg;
    if (s.m) {
      for (const bits of s.m) if (c < COLS) setCell(cells[r][c++], ' ', s.fg, bg, s.link, bits);
    } else {
      for (const ch of s.t) if (c < COLS) setCell(cells[r][c++], ch, s.fg, bg, s.link);
    }
  }
  // Rows with a background keep it to the edge, as a "new background" code would.
  while (c < COLS) setCell(cells[r][c++], ' ', 'white', segments.length && segments.at(-1).bg ? lastBg : 'black');
}

const pad = (s, n) => s.padEnd(n).slice(0, n);

function drawHeader() {
  const now = new Date();
  const day = now.toLocaleDateString('en-GB', { weekday: 'short' });
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  const t = now.toLocaleTimeString('en-GB', { hour12: false });
  const shown = state.entry ? pad(state.entry, 3).replace(/ /g, '-') : String(state.target);
  writeRow(0, [
    { t: `P${shown} `, fg: 'white' },
    { t: 'TELETEXTUAL', fg: 'yellow' },
    { t: ` ${state.searching ? state.rolling : state.current?.num ?? state.target} `, fg: state.searching ? 'green' : 'white' },
    { t: `${day} ${date} `, fg: 'white' },
    { t: `${t.slice(0, 5)}/${t.slice(6)}`, fg: 'yellow' },
  ]);
}

function drawBody() {
  const page = state.current;
  const rows = page ? page.subpages[state.sub] ?? [] : [];
  let skip = false;
  for (let r = 1; r <= 23; r++) {
    const row = rows[r - 1];
    rowEls[r].classList.toggle('dh', !skip && !!row?.dh);
    rowEls[r].classList.toggle('hidden', skip);
    if (skip) { skip = false; continue; }
    writeRow(r, row?.s ?? []);
    skip = !!row?.dh;
  }
  // Subpage counter in the top right of the content area.
  if (page && page.subpages.length > 1 && state.sub >= (page.tileCount ?? 0)) {
    const label = `${state.sub + 1}/${page.subpages.length}`.padStart(5);
    const bg = cells[1][39].className.match(/bg-(\w+)/)?.[1] ?? 'black';
    [...label].forEach((ch, i) => setCell(cells[1][35 + i], ch, bg === 'white' || bg === 'yellow' || bg === 'cyan' ? 'black' : 'white', bg));
  }
}

function drawFastext() {
  const links = state.current?.fastext ?? [];
  const segs = [];
  for (const f of links) segs.push({ t: ' ' + pad(f.label, 9), fg: f.colour, link: f.link ?? String(f.page) });
  writeRow(24, segs);
}

function render() {
  drawHeader();
  drawBody();
  drawFastext();
}

// --- data ----------------------------------------------------------------

async function loadIndex() {
  try {
    const res = await fetch('/api/pages');
    const data = await res.json();
    if (state.build && data.build !== state.build) location.reload();
    state.build = data.build;
    state.index = data.pages;
    state.cache.clear();
  } catch { /* offline: keep what we have */ }
}

async function fetchPage(num) {
  const hit = state.cache.get(num);
  if (hit && Date.now() - hit.at < 60_000) return hit.page;
  const res = await fetch(`/api/page/${num}`);
  if (!res.ok) return null;
  const page = await res.json();
  state.cache.set(num, { page, at: Date.now() });
  return page;
}

// Comic pages arrive with an image URL; draw it as mosaic subpages (once,
// the cache keeps the result) ahead of the server's text subpage.
async function expandComic(page) {
  if (!page?.comic || page.tileCount != null) return page;
  let tiles = [];
  try { tiles = await imageTiles(page.comic.img); } catch { /* text page only */ }
  const n = tiles.length + page.subpages.length;
  page.subpages = [
    ...tiles.map((rows, i) => [
      ...rows,
      { s: [{ t: ' ' + page.comic.title.slice(0, 32).padEnd(33), fg: 'yellow' }, { t: `${i + 1}/${n}`.padStart(5), fg: 'white' }] },
      { s: [{ t: ` ${page.comic.source}`, fg: 'cyan' }] },
    ]),
    ...page.subpages,
  ];
  page.tileCount = tiles.length;
  return page;
}

// Now and Next for playlist channels, one subpage each, drawn fresh each
// visit in local time.
async function buildListings(page) {
  if (!tv.getChannels().length) await tv.loadChannels();
  const subpages = [];
  const hhmm = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  for (const ch of tv.getChannels().filter((c) => c.programmes?.length)) {
    const rows = [...page.subpages[0], { s: [] }, { s: [{ t: ` ${ch.number} ${ch.name.toUpperCase()}`, fg: 'cyan' }] }];
    subpages.push(rows);
    const list = listings(ch, Date.now(), 11).filter((p, i) => !(i === 0 && p.interlude)).slice(0, 10);
    list.forEach((p, i) => {
      const when = i === 0 && !p.interlude && p.start <= Date.now() ? { t: ' NOW  ', fg: 'green' } : { t: ` ${hhmm(p.start)}`, fg: 'yellow' };
      const words = p.title.split(' ');
      let line = '';
      const lines = [];
      for (const w of words) {
        if ((line + ' ' + w).trim().length > 33) { lines.push(line); line = w; } else line = (line + ' ' + w).trim();
      }
      lines.push(line);
      rows.push({ s: [when, { t: ' ' + lines[0], fg: 'white' }] });
      if (lines[1]) rows.push({ s: [{ t: '       ' + (lines.length > 2 ? lines.slice(1).join(' ').slice(0, 31) + '..' : lines[1]), fg: 'white' }] });
    });
  }
  return { ...page, subpages: subpages.length ? subpages.map((rows) => rows.slice(0, 23)) : page.subpages };
}

function openFull() {
  if (!state.current?.comic) return;
  full.querySelector('img').src = state.current.comic.img;
  full.hidden = false;
}

function closeFull() {
  full.hidden = true;
}

function notFound(num) {
  return {
    num,
    subpages: [[
      { s: [] }, { s: [] },
      { dh: true, s: [{ t: ` Page ${num} is not in service`, fg: 'red' }] }, { s: [] },
      { s: [] },
      { s: [{ t: ' Try the index on page 100, or press', fg: 'white' }] },
      { s: [{ t: ' the cyan button.', fg: 'white' }] },
    ]],
    fastext: [
      { label: 'Headlines', page: 101, colour: 'red' },
      { label: 'Sport', page: 300, colour: 'green' },
      { label: 'Weather', page: 400, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  };
}

// --- navigation ----------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function goto(num, { instant = false } = {}) {
  num = Number(num);
  const seq = ++state.seq;
  state.target = num;
  state.entry = '';
  state.searching = true;
  state.rolling = state.current?.num ?? 100;
  history.replaceState(null, '', `/${num}`);
  clearInterval(state.rollTimer);
  state.rollTimer = setInterval(() => {
    state.rolling = state.rolling >= 899 ? 100 : state.rolling + 1;
    drawHeader();
  }, 40);
  render();

  // Like a real decoder, wait for the page to come round in the carousel.
  const delay = instant ? 0 : 350 + Math.random() * 700;
  const [page] = await Promise.all([fetchPage(num).then(expandComic).catch(() => null), sleep(delay)]);
  if (seq !== state.seq) return;
  closeFull();
  clearInterval(state.rollTimer);
  state.searching = false;
  state.current = page?.listings ? await buildListings(page) : page ?? notFound(num);
  if (page?.subtitles) {
    // Ceefax put subtitles on page 888: switch them on and show the TV.
    await tv.setMode('tv');
    tv.setSubtitles(true);
  }
  state.sub = 0;
  restartSubTimer();
  render();
}

function step(dir) {
  const list = state.index;
  if (!list.length) return;
  const cur = state.current?.num ?? state.target;
  const next = dir > 0 ? list.find((n) => n > cur) ?? list[0] : [...list].reverse().find((n) => n < cur) ?? list.at(-1);
  goto(next, { instant: true });
}

function changeSub(dir) {
  const n = state.current?.subpages.length ?? 1;
  if (n < 2) return;
  state.sub = (state.sub + dir + n) % n;
  restartSubTimer();
  drawBody();
}

function restartSubTimer() {
  clearInterval(state.subTimer);
  state.subTimer = setInterval(() => { if (!state.hold) changeSub(1); }, SUBPAGE_SECONDS * 1000);
}

function fastext(i) {
  const f = state.current?.fastext?.[i];
  if (f?.link === 'full:') full.hidden ? openFull() : closeFull();
  else if (f) goto(f.page);
}

function digit(d) {
  if (!state.entry && d === '0') return; // pages run 100-899
  state.entry += d;
  if (state.entry.length === 3) goto(state.entry);
  else drawHeader();
}

// In TV mode the remote changes channel; MIX behaves like TEXT.
function handleTvKey(key) {
  if (/^\d$/.test(key)) return tv.channelDigit(key);
  switch (key.toLowerCase()) {
    case 'arrowright': case 'arrowup': case '+': return tv.channelUp();
    case 'arrowleft': case 'arrowdown': case '-': return tv.channelDown();
    case 'x': return tv.setMode('mix');
    case 'u': return tv.toggleMute();
    case 'sub': case 'c': return tv.toggleSubtitles();
    case 'i': tv.setMode('text'); return goto(100);
    case 't': case 'escape': return tv.setMode('text');
  }
}

const glass = document.querySelector('.glass');
let poweredOn = true;

function togglePower() {
  sound.unlock();
  poweredOn = !poweredOn;
  if (poweredOn) {
    glass.classList.remove('off');
    glass.classList.add('switching-on');
    setTimeout(() => glass.classList.remove('switching-on'), 500);
    sound.thump();
    tv.powerOn();
    render();
  } else {
    glass.classList.add('switching-off');
    setTimeout(() => { glass.classList.replace('switching-off', 'off'); }, 450);
    tv.powerOff();
  }
}

function handleKey(key) {
  if (key === 'power') return togglePower();
  if (!poweredOn) return;
  if (tv.getMode() === 'tv') return handleTvKey(key);
  if (/^\d$/.test(key)) return digit(key);
  switch (key.toLowerCase()) {
    case 'v': return tv.setMode('tv');
    case 't': return tv.setMode('text');
    case 'x': return tv.setMode(tv.getMode() === 'mix' ? 'text' : 'mix');
    case 'u': return tv.toggleMute();
    case 'arrowright': case '+': return step(1);
    case 'arrowleft': case '-': return step(-1);
    case 'arrowdown': case 'sub': return changeSub(1);
    case 'arrowup': return changeSub(-1);
    case 'r': case 'f1': return fastext(0);
    case 'g': case 'f2': return fastext(1);
    case 'y': case 'f3': return fastext(2);
    case 'c': case 'b': case 'f4': return fastext(3);
    case 'i': case 'home': return goto(100);
    case 's':
      document.querySelector('.glass').classList.toggle('flat');
      return;
    case 'h':
      state.hold = !state.hold;
      holdBtn.classList.toggle('on', state.hold);
      return;
    case 'escape': case 'backspace':
      closeFull();
      state.entry = '';
      return drawHeader();
  }
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (/^(F[1-4]|Arrow\w+)$/.test(e.key)) e.preventDefault();
  handleKey(e.key);
});

document.querySelector('.remote').addEventListener('click', (e) => {
  const key = e.target.closest('button')?.dataset.key;
  if (key) handleKey(key);
});

full.addEventListener('click', closeFull);

screen.addEventListener('click', (e) => {
  if (!poweredOn || swiped) return;
  const link = e.target.closest('.cell')?.dataset.link;
  if (!link) return;
  if (link === 'full:') openFull();
  else if (/^\d{3}$/.test(link)) goto(link);
  else window.open(link, '_blank', 'noopener');
});

// --- sizing --------------------------------------------------------------

// Three layouts: desktop (remote beside the TV), phone portrait (TV above a
// compact remote) and phone landscape (TV fills the screen, remote in a
// pull-out drawer).
// Measured from the page itself: on phones innerWidth grows if anything
// overflows (the browser zooms out), which would feed back into the sizing.
const viewport = () => [document.documentElement.clientWidth, document.documentElement.clientHeight];

function layout() {
  const [w, h] = viewport();
  if (w > 700 && h > 500) return 'desktop';
  return w > h ? 'landscape' : 'portrait';
}

function fit() {
  const mode = layout();
  const [vw, vh] = viewport();
  document.body.dataset.layout = mode;
  const root = document.documentElement.style;
  if (mode === 'desktop') {
    // Whole-pixel cells (width even, height a multiple of 3) so mosaics and
    // backgrounds butt together without seams.
    const availW = vw - 300 - 44;
    const availH = vh - 80;
    const third = Math.max(4, Math.min(Math.floor(availH / 26.25 / 3), Math.floor(availW / 42 / 2.5)));
    const ch = third * 3;
    root.setProperty('--ch', `${ch}px`);
    root.setProperty('--cw', `${2 * Math.round((ch * 0.833) / 2)}px`);
    root.setProperty('--gap', '16px');
    return;
  }
  // Phones: every pixel counts, so cells take whatever size fills the space.
  const gap = 8, frame = 2 * (8 + 6 + gap);  // page margin, bezel and gap, both sides
  const availW = vw - frame;
  const availH = (mode === 'landscape' ? vh : vh - 300) - frame;
  const cw = Math.min(availW / 40, (availH / 25) * 0.833);
  root.setProperty('--cw', `${cw.toFixed(2)}px`);
  root.setProperty('--ch', `${(cw / 0.833).toFixed(2)}px`);
  root.setProperty('--gap', `${gap}px`);
}
// The landscape drawer: the toggle opens and closes it; touching the TV
// puts the remote down.
const remote = document.querySelector('.remote');
const remoteToggle = document.querySelector('.remote-toggle');
function setRemote(open) {
  remote.classList.toggle('open', open);
  remoteToggle.setAttribute('aria-expanded', String(open));
}
remoteToggle.addEventListener('click', () => setRemote(!remote.classList.contains('open')));
glass.addEventListener('pointerdown', () => setRemote(false));

// Swipes on the screen: left and right step pages (channels on the TV);
// up and down step subpages in text, channels on the TV. A swipe doesn't
// also count as a tap on a link.
let swipeStart = null;
let swiped = false;
glass.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  swipeStart = { x: t.clientX, y: t.clientY, at: Date.now() };
  swiped = false;
}, { passive: true });
glass.addEventListener('touchend', (e) => {
  if (!swipeStart) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - swipeStart.x, dy = t.clientY - swipeStart.y;
  const quick = Date.now() - swipeStart.at < 700;
  swipeStart = null;
  if (!quick || Math.max(Math.abs(dx), Math.abs(dy)) < 40) return;
  swiped = true;
  const onTv = tv.getMode() === 'tv';
  if (Math.abs(dx) > Math.abs(dy)) handleKey(dx < 0 ? 'ArrowRight' : 'ArrowLeft');
  else if (onTv) handleKey(dy < 0 ? 'ArrowUp' : 'ArrowDown');
  else handleKey(dy < 0 ? 'ArrowDown' : 'ArrowUp');
}, { passive: true });

window.addEventListener('resize', fit);
fit();

// --- start ---------------------------------------------------------------

setInterval(drawHeader, 1000);
setInterval(loadIndex, 60_000);
setInterval(tv.loadChannels, 5 * 60_000);
tv.loadChannels();
await loadIndex();
const start = location.pathname.match(/^\/(\d{3})$/)?.[1] ?? 100;
goto(start, { instant: true });
