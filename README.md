# Teletextual

News feeds as a Ceefax-style teletext service: 40×25 pages, mosaic graphics,
three-digit page entry, fastext buttons and rolling subpages.

```
npm start          # http://localhost:3100
npm run dev        # restarts on code changes
```

No dependencies; needs Node 20+.

## Using it

- The red button on the remote is the power: off collapses the picture to a
  dot, as an old CRT did, and silences everything; on retunes.
- Type a three-digit page number (or use the remote). `100` is the index.
- `←` / `→` previous / next page, `↑` / `↓` subpages, `H` holds the subpage.
- `R` `G` `Y` `C` (or F1–F4) are the fastext buttons on the bottom row.
- `S` toggles the scanlines.
- `V` TV, `T` text, `X` mix (text over the picture), `U` mute. In TV mode
  number keys change channel (up to two digits), arrows go up and down, and
  Sub or `C` toggles subtitles. Page 888 also turns subtitles on, as on Ceefax.
- Click any headline or page number. "Full story at source" opens the article.
- Pages deep-link: `/300` opens Sport.

## Pages

| Page | Section |
| --- | --- |
| 100 | Index |
| 101 | Headlines (BBC) |
| 120 | UK (BBC) |
| 140 | World (BBC, Al Jazeera) |
| 160 | The Guardian |
| 180 | US News (NPR, NYT, BBC US) |
| 199 | Feed status |
| 200 | Business |
| 300 | Sport |
| 400–401 | UK weather now / outlook (Open-Meteo) |
| 410–411 | US weather now / outlook, in °F |
| 500 | Technology |
| 520 | Science |
| 540 | Hacker News |
| 600 | Entertainment |
| 650 | Comics |
| 670–682 | Horoscopes (Astrology.com) |
| 690 | On TV: channel guide |
| 691 | Listings: Now and Next for playlist channels |
| 888 | Subtitles: switches YouTube captions on and goes to the TV |

Each section's stories are numbered from the page after its index.

## Adding sources

Edit `sources.json`. Each section has a page number, a title (drawn in the
big mosaic font, so A–Z, 0–9, space and `-`), a background colour from the
teletext palette, and one or more RSS/Atom feeds, merged newest-first.
Weather is grouped into regions, each with its own page, units (`C` or `F`)
and lat/lon cities. Feeds refresh every `refreshMinutes`.

## TV

The remote's TV, Text and Mix buttons work like a real teletext set: TV shows
a live YouTube stream, Text shows the pages (the sound keeps playing), and Mix
lays the pages over the picture with their black background see-through.
Channels are YouTube channel IDs under `tv` in `sources.json`. The server
looks up each channel's current live video on every refresh, because stream
IDs change when a broadcaster restarts. BBC News's YouTube stream only plays
in the US.

While a stream is on screen in TV mode, a strap slides in at the top left:
"You're watching X on Teletextual", shortly after tuning in and every 15
minutes. Playlist channels add what's on now, or what's next during a
programme's last five minutes.

Channel 0 is a test card, an homage to BBC Test Card F drawn on a canvas
(`public/testcard.js`), with a 1 kHz tone. Channels that are off air show it
silently.

Each channel has a `number`. As on a real set, channels take up to two
digits: a single digit waits a second for a second one (`01` is channel 1),
and a number with no channel shows static and NO SIGNAL, with a hiss. P+ and
P- step through channels in the order they're listed.

A channel can also be a YouTube playlist (`playlist`, plus optional
`slotMinutes` and `minMinutes`). It runs to a clock-based schedule, shared by
the server and browser in `public/schedule.js`: the channel went on air at a
fixed moment and has looped its programmes since, so tuning in at 18:05 drops
you five minutes into the 18:00 programme, the same for everyone. With
`slotMinutes`, programmes start on slot boundaries and an interlude fills the
gap after each: idents in the spirit of BBC Two's, where the channel number
stars in a short animation (teletext blocks stacking up, balloons of paint
lobbed at a bevelled numeral and lit as wet paint with WebGL, the
viewer's current weather, an oscilloscope trace, a film leader countdown, a
starfield, or today's headlines), alternating with a clock that counts down to
the next programme, with time pips at the end. They're drawn live in
`public/interlude.js`. A channel can also have its own ident (`"ident"`: `bobross`,
`taskmaster`, `bushtucker`, `rockhits`, `infomercial`, `lofi` or `nasa`), which
opens each of its interludes. Channel 99
(`"idents": true`) flips through every ident in turn, channel ones under
their own numbers, for showing them off. Videos shorter than `minMinutes`, or that YouTube won't let
other sites embed, are skipped. Playlists are re-read every six hours.

## Comics

Page 650 lists the latest strips from xkcd, SMBC, Poorly Drawn Lines,
Dinosaur Comics and Questionable Content. Each comic page redraws the image
as teletext mosaics (2×3 pixels per character, two of the eight teletext
colours per cell), cut into subpages for wide or tall strips. Green shows the
original image at full size. Any RSS feed with an `<img>` in its items can be
added under `comics` in `sources.json`. Images are fetched through
`/api/img`, which only serves images from the current feeds.

## Font

The screen uses [Bedstead](https://bjh21.me.uk/bedstead/) by Ben Harris, a
public-domain recreation of the SAA5050 teletext character generator, in
`public/fonts/`.

## Layout

- `server.js` – fetches feeds, builds pages, serves `/api/pages` and `/api/page/NNN`
- `lib/feeds.js` – RSS/Atom and Open-Meteo fetching
- `lib/pages.js` – page layouts (index, section, story, weather, status)
- `lib/font.js` – 3×5 pixel font rendered as sextant mosaics
- `lib/tv.js` – finds each YouTube channel's current live stream
- `lib/playlist.js` – reads a YouTube playlist's videos and lengths
- `public/mosaic.js` – converts images to teletext mosaic rows
- `public/tv.js` – the TV picture, channel changes and TEXT / TV / MIX
- `public/sound.js`, `public/static.js` – test card tone, chimes, pips, hiss and snow
- `public/interlude.js` – idents and the countdown clock
- `public/` – the TV, the remote, and the renderer
