// Teletextual: ingests news feeds and serves them as teletext pages.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFeed, fetchWeather } from './lib/feeds.js';
import { sectionPages, indexPage, weatherPages, statusPage, quizPage, comicPages } from './lib/pages.js';
import { buildQuiz } from './lib/quiz.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3100;
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'sources.json'), 'utf8'));

let pages = new Map();
let comicImages = new Set(); // image URLs the proxy may fetch
const imageCache = new Map(); // url -> Promise<{ type, body }>

function getImage(src) {
  if (!imageCache.has(src)) {
    const p = fetch(src, { headers: { 'User-Agent': 'Teletextual/0.1' }, signal: AbortSignal.timeout(15000) })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return { type: r.headers.get('content-type') ?? 'image/png', body: Buffer.from(await r.arrayBuffer()) };
      });
    p.catch(() => imageCache.delete(src)); // retry next time
    imageCache.set(src, p);
  }
  return imageCache.get(src);
}
// Changes on every restart so open tabs know to reload for new client code.
const build = Date.now().toString(36);
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

  const extras = [{ name: 'Sources', page: 199 }, { name: 'Quiz', page: 700 }];
  const images = new Set();
  if (config.comics) {
    const groups = await Promise.all(config.comics.feeds.map(async (feed) => {
      try {
        let items = (await fetchFeed(feed)).filter((it) => it.image).slice(0, config.comics.perFeed ?? 3);
        // "Saturday Morning Breakfast Cereal - Foo": drop a prefix every item shares.
        const prefix = items[0]?.title.match(/^.+? - /)?.[0];
        if (prefix && items.every((it) => it.title.startsWith(prefix))) {
          items = items.map((it) => ({ ...it, title: it.title.slice(prefix.length) || it.title }));
        }
        status.push({ name: feed.name, count: items.length, at: now });
        items.forEach((it) => images.add(it.image.src));
        return { feed, items };
      } catch (err) {
        status.push({ name: feed.name, error: err.message, at: now });
        return { feed, items: [] };
      }
    }));
    comicPages(config.comics.page, groups, now).forEach(add);
    extras.push({ name: 'Comics', page: config.comics.page });
  }
  let cities = null;
  if (config.weather) {
    try {
      cities = await fetchWeather(config.weather.cities);
      weatherPages(config.weather.page, cities, now).forEach(add);
      status.push({ name: 'Open-Meteo', count: cities.length, at: now });
    } catch (err) {
      status.push({ name: 'Open-Meteo', error: err.message, at: now });
      console.warn(`weather: ${err.message}`);
    }
    extras.push({ name: 'Weather', page: config.weather.page });
  }

  add(quizPage(700, buildQuiz(config.sections, sectionItems, cities, config.weather?.page)));

  // Top stories: first story of the first few sections.
  const top = config.sections
    .map((s, i) => ({ item: sectionItems[i][0], page: s.page + 1 }))
    .filter((t) => t.item);
  add(indexPage(config.sections, top, extras));
  add(statusPage(199, status.sort((a, b) => a.name.localeCompare(b.name))));

  pages = next;
  comicImages = images;
  // Keep only current comics in memory, and fetch new ones ahead of time.
  for (const src of imageCache.keys()) if (!images.has(src)) imageCache.delete(src);
  for (const src of images) getImage(src).catch(() => {});
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
    return json(res, 200, { pages: [...pages.keys()].sort((a, b) => a - b), updated, build });
  }
  // Same-origin copy of comic images so the client can read their pixels.
  // Only URLs from the current feeds, so this isn't an open proxy.
  if (url.pathname === '/api/img') {
    const src = url.searchParams.get('u');
    if (!comicImages.has(src)) return json(res, 404, { error: 'unknown image' });
    try {
      const img = await getImage(src);
      res.writeHead(200, { 'Content-Type': img.type, 'Cache-Control': 'max-age=86400' });
      return res.end(img.body);
    } catch (err) {
      return json(res, 502, { error: err.message });
    }
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
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    json(res, 404, { error: 'not found' });
  }
});

await refresh();
setInterval(() => refresh().catch((e) => console.error(e)), (config.refreshMinutes ?? 5) * 60_000);
server.listen(PORT, () => console.log(`Teletextual on http://localhost:${PORT}`));
