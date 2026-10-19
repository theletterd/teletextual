// An homage to BBC Test Card F, drawn from scratch: grid, castellations,
// colour bars, frequency gratings, greyscale, and a girl playing noughts and
// crosses on a blackboard with her clown. Its 1 kHz tone lives in sound.js.

const W = 1024, H = 768;
const CX = W / 2, CY = H / 2, R = 300;

function rect(ctx, x, y, w, h, fill) {
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, h);
}

function ellipse(ctx, x, y, rx, ry, fill, rot = 0) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function poly(ctx, points, fill) {
  ctx.beginPath();
  points.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

function background(ctx) {
  rect(ctx, 0, 0, W, H, '#7a7a7a');
  // White grid.
  ctx.fillStyle = '#e8e8e8';
  for (let x = 32; x < W; x += 64) ctx.fillRect(x - 2, 0, 4, H);
  for (let y = 32; y < H; y += 64) ctx.fillRect(0, y - 2, W, 4);
  // Castellations: alternating blocks round the edge.
  for (let x = 0, i = 0; x < W; x += 64, i++) {
    rect(ctx, x, 0, 64, 28, i % 2 ? '#fff' : '#111');
    rect(ctx, x, H - 28, 64, 28, i % 2 ? '#111' : '#fff');
  }
  for (let y = 0, i = 0; y < H; y += 64, i++) {
    rect(ctx, 0, y, 28, 64, i % 2 ? '#fff' : '#111');
    rect(ctx, W - 28, y, 28, 64, i % 2 ? '#111' : '#fff');
  }
  // Greyscale steps either side of the circle.
  const steps = ['#fff', '#d0d0d0', '#a0a0a0', '#707070', '#404040', '#101010'];
  steps.forEach((c, i) => {
    rect(ctx, 64, 160 + i * 75, 96, 75, c);
    rect(ctx, W - 160, 160 + (5 - i) * 75, 96, 75, c);
  });
}

function bars(ctx) {
  const colours = ['#c0c0c0', '#c0c000', '#00c0c0', '#00c000', '#c000c0', '#c00000', '#0000c0', '#101010'];
  const w = (R * 2) / colours.length;
  colours.forEach((c, i) => rect(ctx, CX - R + i * w, CY - R, w + 1, R * 0.42, c));
}

function gratings(ctx) {
  // Bands of vertical stripes, each finer than the last.
  const top = CY + R * 0.56, h = R * 0.5, bandW = (R * 2) / 6;
  for (let b = 0; b < 6; b++) {
    const x0 = CX - R + b * bandW, stripe = 14 - b * 2.2;
    rect(ctx, x0, top, bandW + 1, h, '#808080');
    ctx.fillStyle = '#f0f0f0';
    for (let x = x0; x < x0 + bandW; x += stripe * 2) ctx.fillRect(x, top, stripe, h);
  }
}

function picture(ctx) {
  const x0 = CX - R, y0 = CY - R * 0.58, w = R * 2, h = R * 1.14;
  rect(ctx, x0, y0, w, h, '#8fa6b8');

  // Blackboard with a game of noughts and crosses.
  const bx = CX + 20, by = y0 + 40, bw = 230, bh = 210;
  rect(ctx, bx - 12, by - 12, bw + 24, bh + 24, '#6b4423');
  rect(ctx, bx, by, bw, bh, '#1f3b2c');
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = 6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const t of [1, 2]) {
    ctx.moveTo(bx + 30 + (t * (bw - 60)) / 3, by + 25);
    ctx.lineTo(bx + 30 + (t * (bw - 60)) / 3, by + bh - 25);
    ctx.moveTo(bx + 30, by + 25 + (t * (bh - 50)) / 3);
    ctx.lineTo(bx + bw - 30, by + 25 + (t * (bh - 50)) / 3);
  }
  ctx.stroke();
  const cell = (c, r) => [bx + 30 + ((c + 0.5) * (bw - 60)) / 3, by + 25 + ((r + 0.5) * (bh - 50)) / 3];
  const cross = (c, r) => {
    const [x, y] = cell(c, r);
    ctx.beginPath();
    ctx.moveTo(x - 18, y - 18); ctx.lineTo(x + 18, y + 18);
    ctx.moveTo(x + 18, y - 18); ctx.lineTo(x - 18, y + 18);
    ctx.stroke();
  };
  const nought = (c, r) => {
    const [x, y] = cell(c, r);
    ctx.beginPath();
    ctx.arc(x, y, 19, 0, Math.PI * 2);
    ctx.stroke();
  };
  cross(1, 1); nought(0, 0); cross(2, 0); nought(0, 2);

  // The girl: dark hair, red hairband, red dress, reaching to the board with chalk.
  const gx = CX - 70, gy = y0 + 150;
  poly(ctx, [[gx - 85, y0 + h], [gx - 60, gy + 95], [gx + 60, gy + 95], [gx + 90, y0 + h]], '#c4262e');
  ellipse(ctx, gx, gy + 92, 26, 12, '#f1c6a8');
  ellipse(ctx, gx, gy - 6, 74, 86, '#3b2416');
  ellipse(ctx, gx, gy + 10, 52, 62, '#f3cdb0');
  ctx.strokeStyle = '#d02030';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(gx, gy + 10, 58, Math.PI * 1.12, Math.PI * 1.88);
  ctx.stroke();
  ellipse(ctx, gx - 50, gy + 40, 26, 54, '#3b2416');
  ellipse(ctx, gx + 50, gy + 40, 26, 54, '#3b2416');
  ellipse(ctx, gx - 19, gy + 6, 6, 7, '#2a1a12');
  ellipse(ctx, gx + 19, gy + 6, 6, 7, '#2a1a12');
  ellipse(ctx, gx - 28, gy + 28, 9, 6, 'rgba(230,120,120,0.5)');
  ellipse(ctx, gx + 28, gy + 28, 9, 6, 'rgba(230,120,120,0.5)');
  ctx.strokeStyle = '#a0403a';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(gx, gy + 30, 14, Math.PI * 0.15, Math.PI * 0.85);
  ctx.stroke();
  // Arm up to the board, chalk in hand.
  ctx.strokeStyle = '#c4262e';
  ctx.lineWidth = 26;
  ctx.beginPath();
  ctx.moveTo(gx + 45, gy + 120);
  ctx.lineTo(bx + 50, by + bh / 2 + 30);
  ctx.stroke();
  ellipse(ctx, bx + 54, by + bh / 2 + 26, 14, 14, '#f3cdb0');
  rect(ctx, bx + 58, by + bh / 2 + 8, 8, 20, '#fff');

  // The clown: green suit, white face, red nose, pointed hat.
  const kx = x0 + 110, ky = y0 + h - 90;
  poly(ctx, [[kx - 60, y0 + h], [kx - 40, ky + 20], [kx + 40, ky + 20], [kx + 60, y0 + h]], '#2f8f3a');
  ellipse(ctx, kx, ky + 22, 30, 10, '#fff');
  ellipse(ctx, kx, ky - 18, 36, 38, '#f7f2ea');
  ellipse(ctx, kx - 34, ky - 30, 16, 14, '#2fb04a');
  ellipse(ctx, kx + 34, ky - 30, 16, 14, '#2fb04a');
  poly(ctx, [[kx - 26, ky - 46], [kx + 26, ky - 46], [kx + 4, ky - 112]], '#2f8f3a');
  ellipse(ctx, kx + 4, ky - 114, 9, 9, '#f2d22e');
  ellipse(ctx, kx, ky - 14, 9, 9, '#e02020');
  ellipse(ctx, kx - 13, ky - 30, 4, 5, '#222');
  ellipse(ctx, kx + 13, ky - 30, 4, 5, '#222');
  ctx.strokeStyle = '#e02020';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(kx, ky - 6, 16, Math.PI * 0.1, Math.PI * 0.9);
  ctx.stroke();
}

export function drawTestCard(canvas) {
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  background(ctx);

  ctx.save();
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.clip();
  rect(ctx, CX - R, CY - R, R * 2, R * 2, '#808080');
  bars(ctx);
  picture(ctx);
  gratings(ctx);
  ctx.restore();

  ctx.strokeStyle = '#f0f0f0';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(CX, CY, R, 0, Math.PI * 2);
  ctx.stroke();

  // Station ident.
  rect(ctx, CX - 130, CY + R - 34, 260, 44, '#000');
  ctx.fillStyle = '#fff';
  ctx.font = `28px Bedstead, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('TELETEXTUAL', CX, CY + R - 12);
}
