// Reads a YouTube playlist without an API key: video IDs, titles and lengths
// come from the playlist page, and YouTube's oEmbed lookup says whether each
// may be embedded. Only the first page of a playlist (about 100 videos) is read.

import { toTeletext } from './text.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, 'Accept-Language': 'en', Cookie: 'CONSENT=YES+1; SOCS=CAI' };

async function page(url) {
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function lockups(node, out = []) {
  if (Array.isArray(node)) node.forEach((n) => lockups(n, out));
  else if (node && typeof node === 'object') {
    if (node.lockupViewModel) out.push(node.lockupViewModel);
    Object.values(node).forEach((n) => lockups(n, out));
  }
  return out;
}

const seconds = (clock) => clock.split(':').reduce((t, part) => t * 60 + Number(part), 0);

// Short listing titles:
// "Ancient tips for Top End survival | Bush Tucker Man | S1 EP2 | ABC Australia"
//   -> "S1 EP2 Ancient tips for Top End survival"
// "A Walk in the Woods (Season 1 Episode 1)" -> "S1 EP1 A Walk in the Woods"
// "Series 1, Episode 1 - 'Melon buffet.'" -> "S1 EP1 Melon buffet"
// "Nirvana - Smells Like Teen Spirit (Official Music Video)" -> "Nirvana - Smells Like Teen Spirit"
// "Wicked Game - Single Edit - Official Music Video" -> "Wicked Game"
function episodeTitle(raw) {
  const parts = toTeletext(raw).split('|').map((p) => p.trim()).filter((p) => p && !/^full episode$/i.test(p));
  let code = parts.find((p) => /^S\d+ ?EP?\d+$/i.test(p));
  let title = parts[0] ?? '';
  const season = title.match(/\s*\(Season (\d+),? Episode (\d+)\)/i);
  if (season) {
    code ??= `S${season[1]} EP${season[2]}`;
    title = title.replace(season[0], '');
  }
  const series = title.match(/^(?:.+?\s)?(?:Series|Season) (\d+),? Episode (\d+)\s*-?\s*/i);
  if (series) {
    code ??= `S${series[1]} EP${series[2]}`;
    // "Season 7, Episode 9 | 'The pendulum draws the eye.' | Taskmaster":
    // the name is in a later part, before the trailing brand.
    title = title.slice(series[0].length) || parts.slice(1, parts.length > 2 ? -1 : undefined)[0] || '';
  }
  title = title.replace(/^['"](.*?)\.?['"]$/, '$1');
  title = title.replace(/\s*[([][^)\]]*\b(official|video|audio|lyrics?|remaster(ed)?|hd|4k|hq)\b[^)\]]*[)\]]/gi, '').trim();
  title = title.replace(/\s+-\s+(official [^-]*|single edit|(\d{4} )?remaster(ed)?[^-]*)(?=\s+-|$)/gi, '').trim();
  return code ? `${code} ${title}` : title;
}

// Drop a "Bob Ross - " style prefix that every title in the playlist shares.
function dropSharedPrefix(videos) {
  const prefix = videos[0]?.title.match(/^(S\d+ EP\d+ )?(.+? - )/)?.[2];
  if (!prefix || videos.length < 2 || !videos.every((v) => v.title.includes(prefix))) return videos;
  return videos.map((v) => ({ ...v, title: v.title.replace(prefix, '') }));
}

export async function fetchPlaylist(id) {
  const html = await page(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`);
  const json = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
  if (!json) throw new Error('no playlist data');
  return dropSharedPrefix(lockups(JSON.parse(json))
    .filter((l) => l.contentType === 'LOCKUP_CONTENT_TYPE_VIDEO')
    .map((l) => {
      const s = JSON.stringify(l);
      const clock = s.match(/"text":"(\d+:\d\d(?::\d\d)?)"/)?.[1];
      return {
        videoId: l.contentId,
        title: episodeTitle(l.metadata?.lockupMetadataViewModel?.title?.content ?? ''),
        seconds: clock ? seconds(clock) : 0,
      };
    })
    .filter((v) => v.videoId && v.seconds));
}

// oEmbed answers 401 or 403 for videos whose owners have turned embedding off.
// It's a small JSON reply, far lighter than a watch page.
export async function embeddable(videoId) {
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  const res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(10000) });
  if (res.ok) return true;
  if (res.status === 401 || res.status === 403) return false;
  throw new Error(`HTTP ${res.status}`);
}
