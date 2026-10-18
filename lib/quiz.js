// Builds a pool of multiple-choice questions from today's stories and weather.
// The client picks ten at random for each game.

const shuffle = (a) => {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

const STOP = new Set(['This', 'That', 'There', 'These', 'Those', 'What', 'When', 'Where', 'Which', 'While', 'Why', 'How', 'Who', 'With', 'From', 'After', 'Before', 'Over', 'Into', 'Will', 'Could', 'Would', 'Should', 'Says', 'Said', 'Live', 'Watch', 'More', 'Most', 'Some', 'Just', 'They', 'Their', 'Have', 'Been', 'Than', 'Then', 'Here', 'Week', 'Year', 'Today', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Inside', 'Behind', 'Under', 'About', 'Among', 'Against', 'Amid', 'Still', 'Every', 'Only', 'Even', 'First', 'Last', 'Next', 'Another', 'Other', 'Former', 'Fresh', 'Major', 'Latest', 'Breaking', 'Analysis', 'Opinion', 'Review', 'Editorial']);

// Capitalised words worth blanking out: names, places, organisations.
function keywords(title) {
  return title.split(' ').map((raw, i) => {
    const m = raw.match(/^([A-Z][a-zA-Z]{3,})([,:;.?!]|'s)?$/);
    return m && i > 0 && !STOP.has(m[1]) ? { i, word: m[1], tail: m[2] ?? '' } : null;
  }).filter(Boolean);
}

function gapQuestions(stories) {
  const pool = [...new Set(stories.flatMap((s) => keywords(s.item.title).map((k) => k.word)))];
  const out = [];
  for (const s of shuffle(stories)) {
    const ks = keywords(s.item.title);
    if (!ks.length) continue;
    const k = ks[Math.floor(Math.random() * ks.length)];
    const inTitle = new Set(ks.map((x) => x.word));
    const decoys = shuffle(pool.filter((w) => !inTitle.has(w)))
      .sort((a, b) => Math.abs(a.length - k.word.length) - Math.abs(b.length - k.word.length))
      .slice(0, 6);
    if (decoys.length < 3) continue;
    const words = s.item.title.split(' ');
    words[k.i] = '_'.repeat(Math.min(k.word.length, 10)) + k.tail;
    const options = shuffle([k.word, ...shuffle(decoys).slice(0, 3)]);
    out.push({
      prompt: 'Fill in the missing word:',
      text: words.join(' '),
      options,
      answer: options.indexOf(k.word),
      page: s.page,
    });
  }
  return out;
}

function sectionQuestions(stories, sections) {
  const names = sections.map((s) => s.name);
  const out = [];
  for (const s of shuffle(stories)) {
    const right = s.section.name;
    const options = shuffle([right, ...shuffle(names.filter((n) => n !== right)).slice(0, 3)]);
    out.push({
      prompt: 'Which section ran this story?',
      text: s.item.title,
      options,
      answer: options.indexOf(right),
      page: s.page,
    });
  }
  return out;
}

function weatherQuestions(cities, weatherPage) {
  const out = [];
  for (const [word, pick] of [['warmest', Math.max], ['coldest', Math.min]]) {
    const seen = new Set();
    const four = shuffle(cities.filter((c) => c.current)).filter((c) => {
      const t = Math.round(c.current.temperature_2m);
      return !seen.has(t) && seen.add(t);
    }).slice(0, 4);
    if (four.length < 4) continue;
    const best = pick(...four.map((c) => c.current.temperature_2m));
    const options = four.map((c) => c.name);
    out.push({
      prompt: 'Weather watch:',
      text: `Which of these is ${word} right now?`,
      options,
      answer: four.findIndex((c) => c.current.temperature_2m === best),
      page: weatherPage,
    });
  }
  return out;
}

// sections: config sections; sectionItems: stories per section (same order);
// cities: weather data or null.
export function buildQuiz(sections, sectionItems, cities, weatherPage) {
  // Stories that appear in exactly one topical section, so the answer is unambiguous.
  const count = new Map();
  const stories = [];
  sections.forEach((section, si) => {
    sectionItems[si].slice(0, section.max ?? 19).forEach((item, i) => {
      const key = item.title.toLowerCase();
      count.set(key, (count.get(key) ?? 0) + 1);
      // Drop Guardian-style " | Editorial" tags so they don't give the game away.
      const title = item.title.replace(/\s+\|\s+[^|]+$/, '');
      stories.push({ item: { ...item, title }, section, page: section.page + 1 + i, key, primary: item.source === section.feeds[0].name });
    });
  });
  const unique = stories.filter((s) => count.get(s.key) === 1);
  const topical = sections.filter((s) => !s.general);
  // Only each section's main feed: Al Jazeera's sport stories sit under World, say.
  const sectionPool = unique.filter((s) => !s.section.general && s.primary);

  return [
    ...gapQuestions(stories.filter((s, i) => s.item.title.length <= 110 && stories.findIndex((t) => t.key === s.key) === i)).slice(0, 14),
    ...sectionQuestions(sectionPool, topical).slice(0, 8),
    ...(cities ? weatherQuestions(cities, weatherPage) : []),
  ];
}
