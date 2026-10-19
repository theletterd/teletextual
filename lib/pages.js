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

// One region's current conditions plus a three-day outlook on the next page.
// `regions` is the full list, so green can hop to the next one.
export function weatherPages(region, cities, updated, regions) {
  const { page, name, units = 'C' } = region;
  const next = regions[(regions.indexOf(region) + 1) % regions.length];
  const celsius = (t) => (units === 'F' ? ((t - 32) * 5) / 9 : t);
  const fast = (red) => [
    red,
    { label: next === region ? 'Headlines' : next.name, page: next === region ? 101 : next.page, colour: 'green' },
    { label: 'Headlines', page: 101, colour: 'yellow' },
    { label: 'Index', page: 100, colour: 'cyan' },
  ];

  const header = banner('WEATHER', 'green', `${name.toUpperCase()}   CURRENT CONDITIONS   ${fmtTime(updated)}`);
  const rows = [spacer(), { s: [seg(' CITY          TEMP  WIND  CONDITIONS', 'cyan')] }];
  for (const c of cities) {
    const cur = c.current;
    if (!cur) continue;
    const t = `${Math.round(cur.temperature_2m)}${units}`.padStart(4);
    const w = `${Math.round(cur.wind_speed_10m)}mph`.padStart(5);
    const tc = celsius(cur.temperature_2m);
    const tFg = tc >= 20 ? 'red' : tc <= 3 ? 'cyan' : 'yellow';
    rows.push({ s: [seg(' ' + c.name.padEnd(13), 'white'), seg(t + '  ', tFg), seg(w + '  ', 'green'), seg(clip(weatherWord(cur.weather_code), 13), 'white')] });
  }
  const now = { num: page, subpages: paginate(header, rows), fastext: fast({ label: 'Outlook', page: page + 1, colour: 'red' }) };

  const days = cities.find((c) => c.daily)?.daily.time.slice(1, 4) ?? [];
  const dayNames = days.map((d) => new Date(`${d}T12:00`).toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase());
  const oHeader = banner('OUTLOOK', 'green', `${name.toUpperCase()}   MAX / MIN ${units}, NEXT THREE DAYS`);
  const o = [spacer(), { s: [seg(' CITY         ', 'cyan'), ...dayNames.map((n) => seg(n.padEnd(8), 'cyan'))] }];
  for (const c of cities) {
    if (!c.daily) continue;
    const cells = [1, 2, 3].map((i) => seg(`${Math.round(c.daily.temperature_2m_max[i])}/${Math.round(c.daily.temperature_2m_min[i])}`.padEnd(8), 'yellow'));
    o.push({ s: [seg(' ' + c.name.padEnd(13), 'white'), ...cells] });
  }
  const outlook = { num: page + 1, subpages: paginate(oHeader, o), fastext: fast({ label: 'Now', page, colour: 'red' }) };
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

// Comic pages: the client turns `comic.img` into mosaic subpages and puts them
// before the text subpage built here (title, hover text, source).
export function comicPages(page, groups, updated) {
  const pages = [];
  const head = banner('COMICS', 'cyan', `FUNNIES IN MOSAIC   updated ${fmtTime(updated)}`);
  const body = [];
  let num = page + 1;
  const all = [];
  for (const { feed, items } of groups) {
    if (!items.length) continue;
    body.push(spacer(), { s: [seg(' ' + feed.name.toUpperCase(), 'cyan')], keep: true });
    for (const item of items) {
      body.push({ s: [seg('  ' + clip(item.title, 33).padEnd(34), 'white', undefined, num), seg(String(num), 'yellow', undefined, num)] });
      all.push({ item, num: num++ });
    }
  }
  if (!all.length) body.push(spacer(), { s: [seg(' No comics available right now.', 'red')] });
  pages.push({
    num: page,
    subpages: paginate(head, body),
    fastext: [
      { label: 'First', page: page + 1, colour: 'red' },
      { label: 'Headlines', page: 101, colour: 'green' },
      { label: 'Weather', page: 400, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  });

  all.forEach(({ item, num }, i) => {
    const header = banner('COMICS', 'cyan');
    const b = [spacer()];
    for (const l of wrap(item.title, 39)) b.push({ dh: true, s: [seg(' ' + l, 'yellow')] });
    b.push(spacer());
    if (item.image.title) for (const l of wrap(item.image.title, 39)) b.push({ s: [seg(' ' + l, 'white')] });
    b.push(spacer());
    b.push({ s: [seg(' ' + [item.source, fmtDate(item.date)].filter(Boolean).join('  '), 'cyan')] });
    if (item.link) b.push({ s: [seg(' See it on the web >', 'green', undefined, item.link)] });
    pages.push({
      num,
      comic: { img: `/api/img?u=${encodeURIComponent(item.image.src)}`, title: item.title, source: item.source },
      subpages: paginate(header, b),
      fastext: [
        { label: i ? 'Previous' : 'Comics', page: i ? num - 1 : page, colour: 'red' },
        { label: 'Full size', page: num, colour: 'green', link: 'full:' },
        { label: i < all.length - 1 ? 'Next' : 'Comics', page: i < all.length - 1 ? num + 1 : page, colour: 'yellow' },
        { label: 'Index', page: 100, colour: 'cyan' },
      ],
    });
  });
  return pages;
}

const SIGNS = [
  ['Aries', '21 Mar - 19 Apr'], ['Taurus', '20 Apr - 20 May'], ['Gemini', '21 May - 20 Jun'],
  ['Cancer', '21 Jun - 22 Jul'], ['Leo', '23 Jul - 22 Aug'], ['Virgo', '23 Aug - 22 Sep'],
  ['Libra', '23 Sep - 22 Oct'], ['Scorpio', '23 Oct - 21 Nov'], ['Sagittarius', '22 Nov - 21 Dec'],
  ['Capricorn', '22 Dec - 19 Jan'], ['Aquarius', '20 Jan - 18 Feb'], ['Pisces', '19 Feb - 20 Mar'],
];

// One page per sign after the index, in zodiac order. Items are matched by
// the sign named at the start of their title.
export function horoscopePages(page, items, source) {
  const bySign = new Map(items.map((it) => [it.title.split(' ')[0].toLowerCase(), it]));
  const fast = (prev, next) => [
    { label: prev ? SIGNS[prev - page - 1][0] : 'Stars', page: prev ?? page, colour: 'red' },
    { label: next ? SIGNS[next - page - 1][0] : 'Stars', page: next ?? page, colour: 'green' },
    { label: 'Stars', page, colour: 'yellow' },
    { label: 'Index', page: 100, colour: 'cyan' },
  ];

  const date = items[0]?.date;
  const index = [...banner('STARS', 'magenta', `YOUR DAILY HOROSCOPE   ${fmtDate(date).toUpperCase()}`), blank()];
  SIGNS.forEach(([name, dates], i) => {
    const num = page + 1 + i;
    index.push({ s: [seg(' ' + name.padEnd(13), 'yellow', undefined, num), seg(dates.padEnd(21), 'cyan', undefined, num), seg(String(num), 'white', undefined, num)] });
  });
  index.push(blank(), { s: [seg(` Readings from ${source}`, 'magenta')] });
  const pages = [{
    num: page,
    subpages: [index],
    fastext: [
      { label: SIGNS[0][0], page: page + 1, colour: 'red' },
      { label: 'Headlines', page: 101, colour: 'green' },
      { label: 'Weather', page: 400, colour: 'yellow' },
      { label: 'Index', page: 100, colour: 'cyan' },
    ],
  }];

  SIGNS.forEach(([name, dates], i) => {
    const num = page + 1 + i;
    const it = bySign.get(name.toLowerCase());
    const header = banner(name, 'magenta', `${dates.toUpperCase()}   ${fmtDate(it?.date).toUpperCase()}`);
    const body = [spacer()];
    if (it?.body) for (const l of wrap(it.body, 38)) body.push({ s: [seg('  ' + l, 'white')] });
    else body.push({ s: [seg(' The stars are quiet today.', 'red')] });
    pages.push({ num, subpages: paginate(header, body), fastext: fast(i ? num - 1 : null, i < 11 ? num + 1 : null) });
  });
  return pages;
}
