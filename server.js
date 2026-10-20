// Teletextual: ingests news feeds and serves them as teletext pages.

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchFeed, fetchWeather } from './lib/feeds.js';
import { resolveLive } from './lib/tv.js';
import { fetchPlaylist, embeddable } from './lib/playlist.js';
import { sectionPages, indexPage, weatherPages, statusPage, comicPages, horoscopePages, tvGuidePage, listingsPage } from './lib/pages.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3100;
const config = JSON.parse(await fs.readFile(path.join(ROOT, 'sources.json'), 'utf8'));

let pages = new Map();
let conditions = [];          // first city of each weather region, for the weather ident
let tvChannels = [];          // [{ name, videoId, title, note }]
const lastLive = new Map();   // youtube channel -> last good { videoId, title }
const playlists = new Map();  // playlist id -> { at, programmes }
const PLAYLIST_HOURS = 6;
const embedCache = new Map(); // video id -> may be embedded; rarely changes

// If YouTube can't be asked (rate limits, timeouts), assume the video plays:
// the browser shows the test card for any slot YouTube then refuses.
async function canEmbed(videoId) {
  if (!embedCache.has(videoId)) {
    try {
      embedCache.set(videoId, await embeddable(videoId));
    } catch {
      return true; // not remembered, so it's checked again next time
    }
  }
  return embedCache.get(videoId);
}
let comicImages = new Set();

// A playlist channel's programmes: long enough videos that may be embedded,
// in playlist order. Playlists change rarely, so this is cached for hours.
async function playlistProgrammes(ch) {
  const cached = playlists.get(ch.playlist);
  if (cached && Date.now() - cached.at < PLAYLIST_HOURS * 3_600_000) return cached.programmes;
  const videos = (await fetchPlaylist(ch.playlist)).filter((v) => v.seconds >= (ch.minMinutes ?? 0) * 60);
  const programmes = [];
  for (let i = 0; i < videos.length; i += 8) {
    const batch = videos.slice(i, i + 8);
    const ok = await Promise.all(batch.map((v) => canEmbed(v.videoId)));
    programmes.push(...batch.filter((_, j) => ok[j]));
  }
  playlists.set(ch.playlist, { at: Date.now(), programmes });
  return programmes;
} // image URLs the proxy may fetch
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

  const extras = [{ name: 'Sources', page: 199 }];
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
  if (config.horoscopes) {
    const h = config.horoscopes;
    try {
      // Keep the reading; drop the "More horoscopes!" links that follow it.
      const items = (await fetchFeed(h)).map((it) => ({ ...it, body: it.body.split(/\s*More horoscopes!/)[0] }));
      horoscopePages(h.page, items, h.name).forEach(add);
      status.push({ name: h.name, count: items.length, at: now });
    } catch (err) {
      status.push({ name: h.name, error: err.message, at: now });
    }
    extras.push({ name: 'Horoscopes', page: h.page });
  }
  if (config.tv) {
    const channels = await Promise.all(config.tv.channels.map(async (ch) => {
      if (ch.testcard) return { number: ch.number, name: ch.name, note: ch.note, testcard: true };
      if (ch.idents) return { number: ch.number, name: ch.name, note: ch.note, idents: true };
      if (ch.playlist) {
        try {
          const programmes = await playlistProgrammes(ch);
          status.push({ name: `TV ${ch.name}`, count: programmes.length, at: now });
          return { number: ch.number, name: ch.name, note: ch.note, slotMinutes: ch.slotMinutes, ident: ch.ident, programmes };
        } catch (err) {
          status.push({ name: `TV ${ch.name}`, error: err.message, at: now });
          return { number: ch.number, name: ch.name, note: ch.note, programmes: playlists.get(ch.playlist)?.programmes ?? [] };
        }
      }
      try {
        lastLive.set(ch.youtube, await resolveLive(ch.youtube));
      } catch (err) {
        // Keep the previous stream if one lookup fails; it's probably still on.
        status.push({ name: `TV ${ch.name}`, error: err.message, at: now });
      }
      return { number: ch.number, name: ch.name, note: ch.note, ...lastLive.get(ch.youtube) };
    }));
    tvChannels = channels;
    add(tvGuidePage(config.tv.page, channels));
    add(listingsPage(config.tv.page + 1));
    extras.push({ name: 'On TV', page: config.tv.page });
  }

  const nowConditions = [];
  for (const region of config.weather?.regions ?? []) {
    const label = `Weather ${region.name}`;
    try {
      const cities = await fetchWeather(region.cities, region.units);
      weatherPages(region, cities, now, config.weather.regions).forEach(add);
      const c = cities[0];
      if (c?.current) {
        nowConditions.push({
          region: region.name, city: c.name, timezone: c.timezone, units: region.units ?? 'C',
          code: c.current.weather_code, temp: Math.round(c.current.temperature_2m), isDay: c.current.is_day === 1,
        });
      }
      status.push({ name: label, count: cities.length, at: now });
    } catch (err) {
      status.push({ name: label, error: err.message, at: now });
      console.warn(`${label}: ${err.message}`);
    }
    extras.push({ name: label, page: region.page });
  }

  // Top stories: first story of the first few sections.
  const top = config.sections
    .map((s, i) => ({ item: sectionItems[i][0], page: s.page + 1 }))
    .filter((t) => t.item);
  add(indexPage(config.sections, top, extras));
  add(statusPage(199, status.sort((a, b) => a.name.localeCompare(b.name))));

  pages = next;
  if (nowConditions.length) conditions = nowConditions;
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
  if (url.pathname === '/api/tv') return json(res, 200, tvChannels);
  if (url.pathname === '/api/conditions') return json(res, 200, conditions);
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
