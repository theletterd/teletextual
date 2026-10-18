// Minimal RSS / Atom fetcher. No XML library: feeds are regular enough for regexes.

import { toTeletext } from './text.js';

const UA = 'Teletextual/0.1 (+https://localhost)';

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}

function link(block) {
  const atom = block.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
  const rss = tag(block, 'link').replace(/<!\[CDATA\[|\]\]>/g, '').trim();
  return rss || (atom ? atom[1] : '');
}

export function parseFeed(xml, sourceName) {
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>|<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  return blocks.map((b) => {
    const date = new Date(tag(b, 'pubDate') || tag(b, 'updated') || tag(b, 'published') || tag(b, 'dc:date'));
    return {
      title: toTeletext(tag(b, 'title')),
      body: toTeletext(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')),
      link: link(b),
      date: isNaN(date) ? null : date,
      source: sourceName,
    };
  }).filter((i) => i.title);
}

export async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return parseFeed(await res.text(), feed.name);
}

const WMO = {
  0: 'Clear', 1: 'Mostly clear', 2: 'Part cloudy', 3: 'Overcast', 45: 'Fog', 48: 'Freezing fog',
  51: 'Drizzle', 53: 'Drizzle', 55: 'Heavy drizzle', 56: 'Frz drizzle', 57: 'Frz drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Frz rain', 67: 'Frz rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 77: 'Snow grains',
  80: 'Showers', 81: 'Showers', 82: 'Heavy showers', 85: 'Snow showers', 86: 'Snow showers',
  95: 'Thunder', 96: 'Thunder, hail', 99: 'Thunder, hail',
};
export const weatherWord = (code) => WMO[code] ?? '?';

export async function fetchWeather(cities) {
  const q = new URLSearchParams({
    latitude: cities.map((c) => c.lat).join(','),
    longitude: cities.map((c) => c.lon).join(','),
    current: 'temperature_2m,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    wind_speed_unit: 'mph',
    timezone: 'auto',
    forecast_days: '4',
  });
  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${q}`, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const list = Array.isArray(data) ? data : [data];
  return cities.map((c, i) => ({ ...c, ...list[i] }));
}
