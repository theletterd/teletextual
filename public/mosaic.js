// Turns an image into teletext mosaic rows: each character cell is 2x3
// pixels in one foreground and one background colour from the 8-colour palette.

const PALETTE = [
  ['black', [0, 0, 0]], ['red', [255, 0, 0]], ['green', [0, 255, 0]], ['yellow', [255, 255, 0]],
  ['blue', [0, 0, 255]], ['magenta', [255, 0, 255]], ['cyan', [0, 255, 255]], ['white', [255, 255, 255]],
];

const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

const INK = 100;          // luminance below this counts as ink
const INK_SHARE = 0.08;   // a block this inky is drawn as ink, so thin lines survive
const SATURATE = 2.2;     // pushes pastels towards the teletext primaries

// Downsample to pw x ph. Blocks with enough ink take the ink's colour;
// the rest take their mean colour, saturated.
function sample(img, pw, ph) {
  const sw = Math.min(img.naturalWidth, pw * 8);
  const sh = Math.max(1, Math.round((img.naturalHeight * sw) / img.naturalWidth));
  const canvas = document.createElement('canvas');
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; // transparent PNGs sit on white paper
  ctx.fillRect(0, 0, sw, sh);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, sw, sh);
  const src = ctx.getImageData(0, 0, sw, sh).data;

  const out = new Uint8ClampedArray(pw * ph * 3);
  for (let y = 0; y < ph; y++) {
    const y0 = Math.floor((y * sh) / ph), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / ph));
    for (let x = 0; x < pw; x++) {
      const x0 = Math.floor((x * sw) / pw), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / pw));
      let r = 0, g = 0, b = 0, n = 0, ir = 0, ig = 0, ib = 0, ink = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * sw + xx) * 4;
          r += src[i]; g += src[i + 1]; b += src[i + 2]; n++;
          if (lum(src[i], src[i + 1], src[i + 2]) < INK) { ir += src[i]; ig += src[i + 1]; ib += src[i + 2]; ink++; }
        }
      }
      const o = (y * pw + x) * 3;
      if (ink / n > INK_SHARE) {
        out[o] = ir / ink; out[o + 1] = ig / ink; out[o + 2] = ib / ink;
      } else {
        r /= n; g /= n; b /= n;
        const l = lum(r, g, b);
        out[o] = l + (r - l) * SATURATE;
        out[o + 1] = l + (g - l) * SATURATE;
        out[o + 2] = l + (b - l) * SATURATE;
      }
    }
  }
  return out;
}

const dist = (p, c) => (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2 + (p[2] - c[2]) ** 2;

// Best two-colour fit for a cell's six pixels.
function quantise(pixels) {
  let best = null;
  for (let a = 0; a < PALETTE.length; a++) {
    for (let b = a; b < PALETTE.length; b++) {
      let err = 0, bits = 0;
      pixels.forEach((p, i) => {
        const da = dist(p, PALETTE[a][1]), db = dist(p, PALETTE[b][1]);
        if (da < db) { err += da; bits |= 1 << i; } else err += db;
      });
      if (!best || err < best.err) best = { err, bits, fg: PALETTE[a][0], bg: PALETTE[b][0] };
    }
  }
  return best;
}

// Returns tiles of `rows` mosaic rows each. Wide images are cut into
// side-by-side tiles, tall ones into stacked tiles, up to maxTiles.
export async function imageTiles(src, { cols = 40, rows = 21, pixelAspect = 1.17, maxTiles = 4 } = {}) {
  // onload rather than img.decode(): decode() can wait for a paint that a
  // background tab never does.
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
  const W = cols * 2, H = rows * 3;
  const aspect = img.naturalWidth / img.naturalHeight / pixelAspect; // in mosaic pixels
  // Size the picture to a whole number of tiles along its long side, so no
  // tile is mostly margin.
  const clampTiles = (n) => Math.max(1, Math.min(maxTiles, Math.floor(n)));
  let pw, ph;
  if (aspect > W / H) {
    pw = clampTiles((H * aspect) / W) * W;
    ph = Math.min(H, Math.round(pw / aspect));
  } else {
    ph = clampTiles(W / aspect / H) * H;
    pw = Math.min(W, Math.round(ph * aspect));
  }
  const px = sample(img, pw, ph);
  const tilesX = Math.ceil(pw / W), tilesY = Math.ceil(ph / H);
  // Centre the picture in the tiled area; the margin is black.
  const ox = Math.floor((tilesX * W - pw) / 2), oy = Math.floor((tilesY * H - ph) / 2);
  const at = (x, y) => {
    x -= ox; y -= oy;
    if (x < 0 || y < 0 || x >= pw || y >= ph) return [0, 0, 0];
    const o = (y * pw + x) * 3;
    return [px[o], px[o + 1], px[o + 2]];
  };

  const tiles = [];
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      const tile = [];
      for (let r = 0; r < rows; r++) {
        const s = [];
        for (let c = 0; c < cols; c++) {
          const x = tx * W + c * 2, y = ty * H + r * 3;
          const cell = quantise([at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1), at(x, y + 2), at(x + 1, y + 2)]);
          s.push({ m: [cell.bits], fg: cell.fg, bg: cell.bg });
        }
        tile.push({ s });
      }
      tiles.push(tile);
    }
  }
  return tiles;
}
