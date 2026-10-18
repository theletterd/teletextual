// Teletextual: ingests news feeds and serves them as teletext pages.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFeed, fetchWeather } from './lib/feeds.js';
import { sectionPages, indexPage, weatherPages, statusPage } from './lib/pages.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3100;
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'sources.json'), 'utf8'));

let pages = new Map();
let updated = null;

async function refresh() {
  const started = Date.now();
  const status = [];
  const sectionItems = await Promise.all(config.sections.map(async (section) => {
    const results = await Promise.all(section.feeds.map(async (feed) => {
      try {
        const items = await fetchFeed(feed);
        status.push({ name: feed.name, count: items.length, at: new Date() });
        return items;
      } catch (err) {
        status.push({ name: feed.name, error: err.message, at: new Date() });
        console.warn(`feed ${feed.name}: ${err.message}`);
        return [];
      }
    }));
    // Interleave sources newest-first and drop duplicate headlines.
    const seen = new Set();
    return results.flat()
      .sort((a, b) => (b.date ?? 0) - (a.date ?? 0))
      .filter((it) => !seen.has(it.title.toLowerCase()) && seen.add(it.title.toLowerCase()));
  }));

  const now = new Date();
  const next = new Map();
  const add = (p) => next.set(p.num, p);
  config.sections.forEach((s, i) => sectionPages(s, sectionItems[i], now).forEach(add));

  const extras = [{ name: 'Sources', page: 199 }];
  if (config.weather) {
    try {
      const cities = await fetchWeather(config.weather.cities);
      weatherPages(config.weather.page, cities, now).forEach(add);
      status.push({ name: 'Open-Meteo', count: cities.length, at: now });
    } catch (err) {
      status.push({ name: 'Open-Meteo', error: err.message, at: now });
      console.warn(`weather: ${err.message}`);
    }
    extras.push({ name: 'Weather', page: config.weather.page });
  }

  // Top stories: first story of the first few sections.
  const top = config.sections
    .map((s, i) => ({ item: sectionItems[i][0], page: s.page + 1 }))
    .filter((t) => t.item);
  add(indexPage(config.sections, top, extras));
  add(statusPage(199, status.sort((a, b) => a.name.localeCompare(b.name))));

  pages = next;
  updated = now;
  console.log(`refreshed ${next.size} pages in ${Date.now() - started}ms`);
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.woff': 'font/woff', '.otf': 'font/otf', '.ttf': 'font/ttf' };

function json(res, code, body) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/pages') {
    return json(res, 200, { pages: [...pages.keys()].sort((a, b) => a - b), updated });
  }
  const m = url.pathname.match(/^\/api\/page\/(\d{3})$/);
  if (m) {
    const page = pages.get(Number(m[1]));
    return page ? json(res, 200, page) : json(res, 404, { error: 'not found' });
  }
  // Static files; every other path serves the app so /123 deep-links work.
  const rel = path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(ROOT, 'public', rel);
  if (!file.startsWith(path.join(ROOT, 'public'))) return json(res, 403, { error: 'forbidden' });
  try {
    if ((await fs.stat(file)).isDirectory()) file = path.join(file, 'index.html');
  } catch {
    file = path.join(ROOT, 'public', 'index.html');
  }
  try {
    const data = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found' });
  }
});

await refresh();
setInterval(() => refresh().catch((e) => console.error(e)), (config.refreshMinutes ?? 5) * 60_000);
server.listen(PORT, () => console.log(`Teletextual on http://localhost:${PORT}`));
