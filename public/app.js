// Teletextual client: draws 40x25 teletext pages and handles page entry.

import { Quiz } from './quiz.js';

const COLS = 40;
const ROWS = 25;
const SUBPAGE_SECONDS = 12;

const screen = document.getElementById('screen');
const holdBtn = document.getElementById('hold');

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
  quiz: null,         // game in progress on the quiz page
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
  if (page && page.subpages.length > 1) {
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
  const [page] = await Promise.all([fetchPage(num).catch(() => null), sleep(delay)]);
  if (seq !== state.seq) return;
  clearInterval(state.rollTimer);
  state.searching = false;
  if (page?.quiz && !state.quiz?.inProgress) state.quiz = new Quiz(page);
  state.current = page?.quiz ? state.quiz.view() : page ?? notFound(num);
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
  if (f?.link?.startsWith('quiz:')) quizPress(i);
  else if (f) goto(f.page);
}

function quizPress(i) {
  const dest = state.quiz.press(i);
  if (dest) return goto(dest);
  state.current = state.quiz.view();
  state.sub = 0;
  render();
}

function digit(d) {
  if (!state.entry && d === '0') return; // pages run 100-899
  state.entry += d;
  if (state.entry.length === 3) goto(state.entry);
  else drawHeader();
}

function handleKey(key) {
  if (/^\d$/.test(key)) return digit(key);
  switch (key.toLowerCase()) {
    case 'arrowright': case '+': return step(1);
    case 'arrowleft': case '-': return step(-1);
    case 'arrowdown': return changeSub(1);
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

screen.addEventListener('click', (e) => {
  const link = e.target.closest('.cell')?.dataset.link;
  if (!link) return;
  if (link.startsWith('quiz:')) quizPress(Number(link.slice(5)));
  else if (/^\d{3}$/.test(link)) goto(link);
  else window.open(link, '_blank', 'noopener');
});

// --- sizing --------------------------------------------------------------

// Whole-pixel cells (width even, height a multiple of 3) so mosaics and
// backgrounds butt together without seams.
function fit() {
  const remoteBeside = window.innerWidth > 700;
  const availW = window.innerWidth - (remoteBeside ? 300 : 32) - 44;
  const availH = window.innerHeight - (remoteBeside ? 80 : 360);
  const third = Math.max(4, Math.min(Math.floor(availH / 26.25 / 3), Math.floor(availW / 42 / 2.5)));
  const ch = third * 3;
  const cw = 2 * Math.round((ch * 0.833) / 2);
  document.documentElement.style.setProperty('--cw', `${cw}px`);
  document.documentElement.style.setProperty('--ch', `${ch}px`);
}
window.addEventListener('resize', fit);
fit();

// --- start ---------------------------------------------------------------

setInterval(drawHeader, 1000);
setInterval(loadIndex, 60_000);
await loadIndex();
const start = location.pathname.match(/^\/(\d{3})$/)?.[1] ?? 100;
goto(start, { instant: true });
