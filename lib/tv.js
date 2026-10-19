// Finds the current live video on each YouTube channel. Live stream IDs change
// whenever a broadcaster restarts its stream, so this runs on every refresh.

import { toTeletext } from './text.js';

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36';

export async function resolveLive(channelId) {
  const res = await fetch(`https://www.youtube.com/channel/${channelId}/live`, {
    // The cookies skip the EU consent interstitial.
    headers: { 'User-Agent': UA, 'Accept-Language': 'en', Cookie: 'CONSENT=YES+1; SOCS=CAI' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();
  const videoId = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/)?.[1];
  if (!videoId || !/"isLive":true/.test(html)) throw new Error('not live');
  const title = toTeletext(html.match(/<meta name="title" content="([^"]*)"/)?.[1] ?? '');
  return { videoId, title };
}
