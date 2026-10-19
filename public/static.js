// Animated snow for an empty channel: random grey pixels at low resolution,
// stretched over the screen and redrawn every frame.

const W = 240, H = 180;
let frame = 0;

export function startStatic(canvas) {
  if (frame) return;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(W, H);
  const draw = () => {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.random() * 255;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    frame = requestAnimationFrame(draw);
  };
  draw();
}

export function stopStatic() {
  cancelAnimationFrame(frame);
  frame = 0;
}
