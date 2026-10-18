// Text clean-up: turn feed HTML into plain teletext-safe strings and wrap them.

const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  pound: '£', euro: 'EUR', hellip: '...', mdash: '-', ndash: '-',
  lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', copy: '(c)',
};

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return NAMED[e.toLowerCase()] ?? m;
  });
}

export function stripHtml(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>|<\/p>/gi, ' ')
    .replace(/<[^>]+>/g, '');
}

// Reduce to the characters a teletext set could plausibly show.
export function toTeletext(s) {
  return decodeEntities(stripHtml(decodeEntities(s)))
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/€/g, 'EUR')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7E£]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function wrap(text, width) {
  const lines = [];
  let line = '';
  for (let word of text.split(' ')) {
    while (word.length > width) {
      if (line) { lines.push(line); line = ''; }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (!word) continue;
    if (!line) line = word;
    else if (line.length + 1 + word.length <= width) line += ' ' + word;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

// Shorten to fit, preferring a word boundary.
export function clip(text, width) {
  if (text.length <= width) return text;
  let cut = text.slice(0, width - 2);
  const space = cut.lastIndexOf(' ');
  if (space > width - 14) cut = cut.slice(0, space);
  return cut.replace(/[\s,;:.\-]+$/, '') + '..';
}
