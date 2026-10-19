# Teletextual

News feeds as a Ceefax-style teletext service: 40×25 pages, mosaic graphics,
three-digit page entry, fastext buttons and rolling subpages.

```
npm start          # http://localhost:3100
npm run dev        # restarts on code changes
```

No dependencies; needs Node 20+.

## Using it

- Type a three-digit page number (or use the remote). `100` is the index.
- `←` / `→` previous / next page, `↑` / `↓` subpages, `H` holds the subpage.
- `R` `G` `Y` `C` (or F1–F4) are the fastext buttons on the bottom row.
- `S` toggles the scanlines.
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
| 199 | Feed status |
| 200 | Business |
| 300 | Sport |
| 400–401 | Weather now / outlook (Open-Meteo) |
| 500 | Technology |
| 520 | Science |
| 540 | Hacker News |
| 600 | Entertainment |
| 650 | Comics |
| 700 | Quiz |

Each section's stories are numbered from the page after its index.

## Adding sources

Edit `sources.json`. Each section has a page number, a title (drawn in the
big mosaic font, so A–Z, 0–9, space and `-`), a background colour from the
teletext palette, and one or more RSS/Atom feeds, merged newest-first.
Weather cities are lat/lon pairs. Feeds refresh every `refreshMinutes`.

## Quiz

Page 700 is a Bamboozle-style game: ten multiple-choice questions built from
the current feeds (fill in a headline's missing word, which section ran a
story, which city is warmest). Answer with the coloured buttons or by clicking.

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
- `lib/quiz.js` – builds the quiz question pool from the day's stories
- `public/mosaic.js` – converts images to teletext mosaic rows
- `public/` – the TV, the remote, the renderer and the quiz game
