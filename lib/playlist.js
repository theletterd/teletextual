// Reads a YouTube playlist without an API key: video IDs, titles and lengths
// come from the playlist page, and each video's watch page says whether it
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

// "Ancient tips for Top End survival | Bush Tucker Man | S1 EP2 | ABC Australia"
// becomes "S1 EP2 Ancient tips for Top End survival".
function episodeTitle(raw) {
  const parts = toTeletext(raw).split('|').map((p) => p.trim()).filter(Boolean);
  const code = parts.find((p) => /^S\d+ ?EP?\d+$/i.test(p));
  return code ? `${code} ${parts[0]}` : parts[0] ?? '';
}

export async function fetchPlaylist(id) {
  const html = await page(`https://www.youtube.com/playlist?list=${encodeURIComponent(id)}`);
  const json = html.match(/var ytInitialData = (\{.*?\});<\/script>/s)?.[1];
  if (!json) throw new Error('no playlist data');
  return lockups(JSON.parse(json))
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
    .filter((v) => v.videoId && v.seconds);
}

export async function embeddable(videoId) {
  const html = await page(`https://www.youtube.com/watch?v=${videoId}`);
  return /"playableInEmbed":true/.test(html);
}
