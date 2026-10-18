// Bamboozle-style quiz on page 700. The server sends a pool of questions;
// this picks ten and draws each screen as ordinary teletext rows.

const COLOURS = ['red', 'green', 'yellow', 'cyan'];
const QUESTIONS = 10;
const BLOCK = 0b111111; // a solid sextant cell

function wrap(text, width) {
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

const row = (...s) => ({ s });
const blank = () => ({ s: [] });
const t = (text, fg = 'white', extra = {}) => ({ t: text, fg, ...extra });

function rating(score) {
  if (score === QUESTIONS) return ['Perfect! Are you the editor?'];
  if (score >= 8) return ['Excellent. You read every page.'];
  if (score >= 5) return ['Not bad at all. A solid skim.'];
  if (score >= 2) return ['Hmm. Try page 101 with a cup of tea', 'and come back later.'];
  return ['Bamboozled! Start again at page 100.'];
}

export class Quiz {
  constructor(page) {
    this.page = page;
    this.restart();
    this.phase = 'intro';
  }

  restart() {
    const pool = [...this.page.quiz.questions];
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    this.questions = pool.slice(0, QUESTIONS);
    this.i = 0;
    this.results = [];
    this.phase = 'ask';
  }

  get inProgress() {
    return this.phase === 'ask' || this.phase === 'result';
  }

  // Handle colour button i. Returns a page number to go to, if any.
  press(i) {
    switch (this.phase) {
      case 'intro':
        if (i === 0) this.restart();
        else return this.page.fastext[i].page;
        break;
      case 'ask':
        if (i >= this.questions[this.i].options.length) break;
        this.results.push(i === this.questions[this.i].answer);
        this.picked = i;
        this.phase = 'result';
        break;
      case 'result':
        if (i === 1) return this.questions[this.i].page;
        if (i === 3) return 100;
        this.i++;
        this.phase = this.i >= this.questions.length ? 'end' : 'ask';
        break;
      case 'end':
        if (i === 0) this.restart();
        else return this.page.fastext[i].page;
        break;
    }
    return null;
  }

  // The page object to draw for the current phase.
  view() {
    if (this.phase === 'intro') {
      return { ...this.page, fastext: this.page.fastext.map((f, i) => ({ ...f, link: `quiz:${i}` })) };
    }
    const rows = this[this.phase]();
    return { num: this.page.num, subpages: [rows.slice(0, 23)], fastext: this.fastext() };
  }

  header(label) {
    const score = this.results.filter(Boolean).length;
    const right = `SCORE ${score} `;
    return [
      ...this.page.quiz.banner,
      row(t(` ${label}`.padEnd(40 - right.length) + right, 'black', { bg: 'yellow' })),
    ];
  }

  ask() {
    const q = this.questions[this.i];
    const rows = [...this.header(`QUESTION ${this.i + 1} OF ${this.questions.length}`), blank()];
    rows.push(row(t(` ${q.prompt}`, 'cyan')), blank());
    for (const l of wrap(q.text, 38).slice(0, 6)) rows.push(row(t(` ${l}`)));
    rows.push(blank());
    q.options.forEach((opt, i) => {
      const link = `quiz:${i}`;
      rows.push(row(t(' ', 'white', { link }), { m: [BLOCK, BLOCK], fg: COLOURS[i], link }, t(`  ${opt}`, COLOURS[i], { link })));
      rows.push(blank());
    });
    return rows;
  }

  result() {
    const q = this.questions[this.i];
    const right = this.results.at(-1);
    const answer = q.options[q.answer];
    const rows = [...this.header(`QUESTION ${this.i + 1} OF ${this.questions.length}`), blank()];
    rows.push({ dh: true, s: [t(right ? '  CORRECT!' : '  WRONG!', right ? 'green' : 'red')] }, blank(), blank());
    if (!right) rows.push(row(t(' You said ', 'white'), t(q.options[this.picked], COLOURS[this.picked])));
    rows.push(row(t(' The answer was ', 'white'), t(answer, COLOURS[q.answer])), blank());
    const full = q.text.replace(/_+/, answer);
    for (const l of wrap(full, 38).slice(0, 5)) rows.push(row(t(` ${l}`, 'cyan')));
    rows.push(blank());
    rows.push(row(t(` More on page ${q.page} >`, 'green', { link: String(q.page) })));
    return rows;
  }

  end() {
    const score = this.results.filter(Boolean).length;
    const rows = [...this.header('FINAL SCORE'), blank()];
    rows.push({ dh: true, s: [t(`  You scored ${score} out of ${this.questions.length}`, 'yellow')] }, blank(), blank());
    // One coloured block per question: green right, red wrong.
    rows.push(row(t('  '), ...this.results.flatMap((ok) => [{ m: [BLOCK, BLOCK], fg: ok ? 'green' : 'red' }, t('  ')])));
    rows.push(row(t('  '), ...this.results.flatMap((ok) => [{ m: [BLOCK, BLOCK], fg: ok ? 'green' : 'red' }, t('  ')])));
    rows.push(blank());
    for (const l of rating(score)) rows.push(row(t(`  ${l}`)));
    rows.push(blank(), blank());
    rows.push({ dh: true, s: [t('  Press RED to play again', 'cyan')] }, blank());
    return rows;
  }

  fastext() {
    if (this.phase === 'ask') {
      return this.questions[this.i].options.map((o, i) => ({ label: o, colour: COLOURS[i], link: `quiz:${i}` }));
    }
    if (this.phase === 'result') {
      const last = this.i === this.questions.length - 1;
      return [
        { label: last ? 'Results' : 'Next', colour: 'red', link: 'quiz:0' },
        { label: 'Story', colour: 'green', link: 'quiz:1' },
        { label: last ? '' : 'Next', colour: 'yellow', link: 'quiz:2' },
        { label: 'Quit', colour: 'cyan', link: 'quiz:3' },
      ];
    }
    return [
      { label: 'Again', colour: 'red', link: 'quiz:0' },
      ...this.page.fastext.slice(1).map((f, i) => ({ ...f, link: `quiz:${i + 1}` })),
    ];
  }
}
