// Clock-based schedule for playlist channels, shared by the server and the
// browser. The channel "went on air" at EPOCH and has looped its programmes
// ever since, so everyone tuning in at the same moment sees the same thing.
// With slotMinutes set, each programme starts on a slot boundary (on the hour
// and half past for 30) and the gap after it is an interlude.

export const EPOCH = Date.UTC(2026, 0, 1);

function layout(channel) {
  const slot = (channel.slotMinutes ?? 0) * 60_000;
  let offset = 0;
  const items = channel.programmes.map((p) => {
    const length = p.seconds * 1000;
    const span = slot ? Math.ceil(length / slot) * slot : length;
    const item = { ...p, offset, span };
    offset += span;
    return item;
  });
  return { items, loop: offset };
}

// What's on at `time`: the programme, its start and end, how far in we are,
// and whether we're in the interlude after it.
export function onAir(channel, time = Date.now()) {
  const { items, loop } = layout(channel);
  if (!loop) return null;
  const intoLoop = (((time - EPOCH) % loop) + loop) % loop;
  const loopStart = time - intoLoop;
  const item = items.find((it) => intoLoop < it.offset + it.span);
  const start = loopStart + item.offset;
  return {
    ...item,
    start,
    end: start + item.span,
    into: (time - start) / 1000,
    interlude: time - start >= item.seconds * 1000,
  };
}

// The programme on now and the ones after it.
export function listings(channel, time = Date.now(), count = 6) {
  const out = [];
  for (let t = time; out.length < count; ) {
    const p = onAir(channel, t);
    if (!p) break;
    out.push(p);
    t = p.end;
  }
  return out;
}
