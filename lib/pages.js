// Builds teletext pages. A page is { num, subpages: [rows], fastext: [{label, page, colour}] }.
// Each subpage is up to 23 content rows (screen rows 1-23; row 0 is the live header and
// row 24 the fastext bar, both drawn by the client).
// A row is { s: [segment], dh?: true }. A segment is { t: text } or { m: [sextant bits] }
// plus fg / bg colours and an optional link (page number or URL).

import { wrap, clip } from './text.js';
import { weatherWord } from './feeds.js';
import { bigRows } from './font.js';

export const COLS = 40;
const ROWS = 23;

const seg = (t, fg = 'white', bg, link) => ({ t, fg, ...(bg && { bg }), ...(link && { link }) });
const blank = () => ({ s: [] });
const width = (row) => row.s.reduce((n, s) => n + (s.t ? s.t.length : s.m.length), 0);

function fill(row, bg) {
  const w = width(row);
  if (w < COLS) row.s.push(seg(' '.repeat(COLS - w), 'white', bg));
  return row;
}

const fmtTime = (d) => d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '';
const fmtDate = (d) => d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' }) : '';

function banner(title, colour, sub) {
  const rows = bigRows(title, ['white'], colour);
  rows.forEach((r) => fill(r, colour));
  if (sub) rows.push(fill({ s: [seg(' ' + sub, 'black', 'yellow')] }, 'yellow'));
  return rows;
}

// Split body rows across subpages under a repeated header, never splitting a
// double-height row from its spacer.
function paginate(header, body) {
  const room = ROWS - header.length;
  const pages = [];
  let cur = [];
  for (const r of body) {
    const need = r.dh ? 2 : 1;
    if (cur.length + need > room) { pages.push(cur); cur = []; }
    if (r.keep && cur.length === 0 && pages.length) continue; // drop leading spacers
    cur.push(r);
    if (r.dh) cur.push(blank());
  }
  if (cur.length || !pages.length) pages.push(cur);
  return pages.map((p) => [...header, ...p]);
}

const spacer = () => ({ s: [], keep: true });

function headlineRows(item, page, numFg = 'yellow') {
  const all = wrap(item.title, 34);
  const lines = all.slice(0, 2);
  if (all.length > 2) lines[1] = clip(all.slice(1).join(' '), 34);
  return lines.map((l, i) => ({
    s: [
      seg(' ' + l.padEnd(35), 'white', undefined, page),
      seg(i === 0 ? String(page) : '   ', numFg, undefined, page),
    ],
  }));
}

export function sectionPages(section, items, updated) {
  const pages = [];
  const max = section.max ?? 19;
  const stories = items.slice(0, max);
  const first = section.page + 1;
  const short = section.short ?? section.name;
  const fast = (prev, next) => [
    { label: prev ? 'Previous' : 'Back', page: prev ?? section.page, colour: 'red' },
    { label: next ? 'Next' : 'Back', page: next ?? section.page, colour: 'green' },
    { label: short, page: section.page, colour: 'yellow' },
    { label: 'Index', page: 100, colour: 'cyan' },
  ];

  // Section index page.
  const head = banner(section.title, section.colour, `${section.name.toUpperCase()}   updated ${fmtTime(updated)}`);
  const body = [];
  stories.forEach((it, i) => {
    body.push(spacer());
    body.push(...headlineRows(it, first + i));
  });
  if (!stories.length) body.push(spacer(), { s: [seg(' No stories available right now.', 'red')] });
  pages.push({
    num: section.page,
    subpages: paginate([...head], body),
    fastext: [
      { label: 'Top story', page: first, colour: 'red' },
      { label: 'Headlines', page: 101, colour: 'green' },
      { label: 'Weather', page: 400, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  });

  // Story pages.
  stories.forEach((it, i) => {
    const num = first + i;
    const header = banner(section.title, section.colour);
    const b = [spacer()];
    for (const l of wrap(it.title, 39)) b.push({ dh: true, s: [seg(' ' + l, 'yellow')] });
    b.push(spacer());
    const text = it.body && it.body !== it.title ? it.body : '';
    for (const l of wrap(text, 39)) b.push({ s: [seg(' ' + l, 'white')] });
    b.push(spacer());
    const meta = [it.source, fmtTime(it.date), fmtDate(it.date)].filter(Boolean).join('  ');
    b.push({ s: [seg(' ' + meta, 'cyan')] });
    if (it.link) b.push({ s: [seg(' Full story at source >', 'green', undefined, it.link)] });
    pages.push({
      num,
      subpages: paginate(header, b),
      fastext: fast(i > 0 ? num - 1 : null, i < stories.length - 1 ? num + 1 : null),
    });
  });
  return pages;
}

export function indexPage(sections, topItems, extras) {
  const rows = [];
  const logo = bigRows('TELETEXTUAL', ['yellow', 'cyan', 'green', 'magenta', 'white', 'red'], 'blue');
  logo.forEach((r) => fill(r, 'blue'));
  rows.push(...logo);
  rows.push(fill({ s: [seg(' The news in forty columns', 'black', 'cyan')] }, 'cyan'));
  rows.push(blank());
  rows.push({ s: [seg(' TOP STORIES', 'cyan')] });
  topItems.slice(0, 4).forEach(({ item, page }) => {
    rows.push({ s: [seg(' ' + clip(item.title, 34).padEnd(35), 'white', undefined, page), seg(String(page), 'yellow', undefined, page)] });
  });
  rows.push(blank());
  rows.push(fill({ s: [seg(' DIRECTORY', 'black', 'yellow')] }, 'yellow'));
  const entries = [...sections.map((s) => ({ name: s.name, page: s.page })), ...extras].sort((a, b) => a.page - b.page);
  const half = Math.ceil(entries.length / 2);
  for (let i = 0; i < half; i++) {
    const row = { s: [] };
    for (const e of [entries[i], entries[i + half]]) {
      if (!e) continue;
      row.s.push(seg(' ' + clip(e.name, 14).padEnd(15), 'white', undefined, e.page), seg(String(e.page) + ' ', 'cyan', undefined, e.page));
    }
    rows.push(row);
  }
  return {
    num: 100,
    subpages: [rows.slice(0, ROWS)],
    fastext: [
      { label: 'Headlines', page: 101, colour: 'red' },
      { label: 'Sport', page: 300, colour: 'green' },
      { label: 'Weather', page: 400, colour: 'yellow' },
      { label: 'Tech', page: 500, colour: 'cyan' },
    ],
  };
}

export function weatherPages(page, cities, updated) {
  const header = banner('WEATHER', 'green', `CURRENT CONDITIONS   ${fmtTime(updated)}`);
  const rows = [spacer(), { s: [seg(' CITY          TEMP  WIND  CONDITIONS', 'cyan')] }];
  for (const c of cities) {
    const cur = c.current;
    if (!cur) continue;
    const t = `${Math.round(cur.temperature_2m)}C`.padStart(4);
    const w = `${Math.round(cur.wind_speed_10m)}mph`.padStart(5);
    const tFg = cur.temperature_2m >= 20 ? 'red' : cur.temperature_2m <= 3 ? 'cyan' : 'yellow';
    rows.push({ s: [seg(' ' + c.name.padEnd(13), 'white'), seg(t + '  ', tFg), seg(w + '  ', 'green'), seg(clip(weatherWord(cur.weather_code), 13), 'white')] });
  }
  const now = {
    num: page,
    subpages: paginate(header, rows),
    fastext: [
      { label: 'Outlook', page: page + 1, colour: 'red' },
      { label: 'Headlines', page: 101, colour: 'green' },
      { label: 'Sport', page: 300, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  };

  const days = cities.find((c) => c.daily)?.daily.time.slice(1, 4) ?? [];
  const dayNames = days.map((d) => new Date(`${d}T12:00`).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase());
  const oHeader = banner('OUTLOOK', 'green', 'MAX / MIN TEMPERATURES, NEXT THREE DAYS');
  const o = [spacer(), { s: [seg(' CITY         ', 'cyan'), ...dayNames.map((n) => seg(n.padEnd(8), 'cyan'))] }];
  for (const c of cities) {
    if (!c.daily) continue;
    const cells = [1, 2, 3].map((i) => seg(`${Math.round(c.daily.temperature_2m_max[i])}/${Math.round(c.daily.temperature_2m_min[i])}`.padEnd(8), 'yellow'));
    o.push({ s: [seg(' ' + c.name.padEnd(12), 'white'), ...cells] });
  }
  const outlook = {
    num: page + 1,
    subpages: paginate(oHeader, o),
    fastext: [
      { label: 'Now', page, colour: 'red' },
      { label: 'Headlines', page: 101, colour: 'green' },
      { label: 'Sport', page: 300, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  };
  return [now, outlook];
}

export function statusPage(num, status) {
  const header = banner('SOURCES', 'magenta', 'FEED STATUS');
  const rows = [spacer()];
  for (const s of status) {
    const ok = !s.error;
    rows.push({ s: [seg(' ' + clip(s.name, 16).padEnd(17), 'white'), seg(ok ? `${String(s.count).padStart(3)} items ` : ' FAILED   ', ok ? 'green' : 'red'), seg(fmtTime(s.at), 'cyan')] });
    if (!ok) rows.push({ s: [seg('   ' + clip(s.error, 36), 'red')] });
  }
  return {
    num,
    subpages: paginate(header, rows),
    fastext: [
      { label: 'Headlines', page: 101, colour: 'red' },
      { label: 'Sport', page: 300, colour: 'green' },
      { label: 'Weather', page: 400, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  };
}

// The quiz itself is played in the browser; this page carries the question pool,
// the banner for the client to draw under, and an intro screen.
export function quizPage(num, questions) {
  const header = banner('QUIZ', 'magenta', 'HOW CLOSELY HAVE YOU READ THE NEWS?');
  const rows = [
    ...header,
    blank(),
    { s: [seg(' Ten questions from today\'s pages.', 'white')] },
    blank(),
    { s: [seg(' Answer with the coloured buttons:', 'white')] },
    blank(),
    { s: [seg('   RED  ', 'red'), seg(' GREEN  ', 'green'), seg(' YELLOW  ', 'yellow'), seg(' CYAN', 'cyan')] },
    blank(),
    { s: [seg(' or click an answer.', 'white')] },
    blank(), blank(),
    { dh: true, s: [seg(' Press RED to play', 'yellow', undefined, 'quiz:0')] }, blank(),
  ];
  return {
    num,
    quiz: { questions, banner: header.slice(0, 2) },
    subpages: [rows],
    fastext: [
      { label: 'Play', page: num, colour: 'red' },
      { label: 'Headlines', page: 101, colour: 'green' },
      { label: 'Weather', page: 400, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  };
}
