// Diagrammatic — the page.
import { tagText, OVERRIDE_CHOICES, POS_LABEL } from './tagger.js';
import { parseSentence, resetIds } from './parser.js';
import { Draughtsman, toSVG } from './layout.js';
import { analyse } from './analysis.js';

const $ = (sel, el = document) => el.querySelector(sel);
const input = $('#input');
const plates = $('#plates');

// --- measuring type ----------------------------------------------------------
const ctx = document.createElement('canvas').getContext('2d');
const widths = new Map();
function measure(s, size) {
  const k = size + '|' + s;
  let w = widths.get(k);
  if (w == null) {
    ctx.font = `italic ${size}px "IM Fell English", Georgia, serif`;
    w = ctx.measureText(s).width;
    widths.set(k, w);
  }
  return w;
}
const pen = new Draughtsman(measure);
const smallPen = new Draughtsman(measure, { fs: 15, small: 13, pad: 7, gap: 8 });

// --- specimens -----------------------------------------------------------------
const EXERCISES = [
  ['The Simple Sentence', [
    ['Birds sing.'],
    ['The old man walked slowly to the village.'],
    ['The quick brown fox jumps over the lazy dog.'],
    ['The very old woman walked very slowly.'],
  ]],
  ['Objects and Complements', [
    ['Brutus stabbed Caesar.'],
    ['Roses are red, and violets are blue.'],
    ['She gave him a book about birds.'],
    ['They elected Washington president.'],
    ['We painted the barn red.'],
  ]],
  ['Phrases', [
    ['Swimming in the lake is fun.'],
    ['To err is human.'],
    ['The letter written by her was lost.'],
    ['In the beginning God created the heaven and the earth.', 'Genesis'],
    ['I enjoy reading books by the fire.'],
  ]],
  ['Compound Parts and Sentences', [
    ['John and Mary laughed and sang.'],
    ['She washed and dried the dishes.'],
    ['The dog barked loudly, and the cat ran away.'],
    ['Give me liberty or give me death!', 'Patrick Henry'],
  ]],
  ['Complex Sentences', [
    ['The man who lives next door is a doctor.'],
    ['When the sun rose, the birds began to sing.'],
    ['I know that he is right.'],
    ['Mary had a little lamb whose fleece was white as snow.', 'S. J. Hale'],
    ['What he said was true.'],
  ]],
  ['From the Authors', [
    ['Four score and seven years ago our fathers brought forth on this continent a new nation.', 'Lincoln'],
    ['Call me Ishmael.', 'Melville'],
    ['It was the best of times, it was the worst of times.', 'Dickens'],
    ['Happy families are all alike.', 'Tolstoy'],
    ['We hold these truths to be self-evident.', 'Jefferson'],
  ]],
  ['Questions and Exclamations', [
    ['Where did you put my keys?'],
    ['Oh, Mary, close the door!'],
    ['How old are you?'],
    ['What a beautiful day it is!'],
  ]],
];
const ALL_SPECIMENS = EXERCISES.flatMap(g => g[1].map(x => x[0]));

const KEY = [
  ['Birds sing.', 'Subject & Predicate', 'The base line holds the subject and the verb; the upright line that crosses it parts the one from the other.'],
  ['Brutus stabbed Caesar.', 'The Direct Object', 'A short upright resting on the base line sets off the object of the verb.'],
  ['Roses are red.', 'The Complement', 'A line slanting back toward the subject marks a word that completes the verb and describes the subject.'],
  ['The old dog sleeps soundly.', 'Modifiers', 'Adjectives and adverbs stand on slanting lines beneath the words they modify.'],
  ['She sat on the bench.', 'The Phrase', 'The preposition takes the slant; its object, a line of its own.'],
  ['She gave him a book.', 'The Indirect Object', 'It hangs beneath the verb on an empty slant, as though after an unwritten “to.”'],
  ['John and Mary laughed.', 'Compound Parts', 'Joined words divide the line into a fork; the conjunction sits on the dotted line between.'],
  ['Swimming is fun.', 'The Pedestal', 'Gerunds, infinitives, and noun clauses stand upon a pedestal above the place they fill.'],
  ['The boy sitting there smiled.', 'The Participle', 'A participle bends from its slant onto a line of its own.'],
  ['The man who called is here.', 'The Adjective Clause', 'A dependent clause takes a base line of its own, tied by a dotted line to the word it modifies.'],
  ['The dog barked, and the cat ran.', 'The Compound Sentence', 'Independent clauses are joined verb to verb by a dotted step; the conjunction stands on the tread.'],
  ['Oh, John, come here.', 'The Independent Element', 'Interjections and nouns of address float above, attached to nothing; an understood subject stands in parentheses.'],
];

// --- state ---------------------------------------------------------------------
let overrides = {};
let lastText = null;
let figCounter = 0;

function roman(n) {
  const r = [[1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  let s = '';
  for (const [v, l] of r) while (n >= v) { s += l; n -= v; }
  return s;
}

function diagramOf(sen, p = pen) {
  resetIds();
  const tree = parseSentence(sen.tokens, sen.end);
  const fig = p.sentence(tree);
  return { tree, fig };
}

function render(text, { keepOverrides = false } = {}) {
  text = text.trim();
  if (text !== lastText && !keepOverrides) overrides = {};
  lastText = text;
  plates.innerHTML = '';
  figCounter = 0;
  if (!text) {
    plates.innerHTML = '<p class="empty-plate">Write a sentence above, and its figure will appear here.</p>';
    return;
  }
  let sentences;
  try { sentences = tagText(text, overrides); } catch (e) { console.error(e); sentences = []; }
  sentences.forEach((sen, si) => {
    const words = sen.tokens.filter(t => t.pos !== 'PUNCT');
    if (!words.length) return;
    figCounter++;
    const plate = document.createElement('figure');
    plate.className = 'plate';
    let svgOut = null, tree = null;
    try {
      const d = diagramOf(sen);
      tree = d.tree;
      svgOut = toSVG(d.fig, { title: `Diagram of: ${sen.raw}`, idPrefix: `f${figCounter}` });
    } catch (e) {
      console.error(e);
    }
    const num = document.createElement('div');
    num.className = 'plate-num';
    num.textContent = `Plate ${roman(figCounter)}.`;
    plate.appendChild(num);

    const frame = document.createElement('div');
    frame.className = 'plate-frame';
    const inner = document.createElement('div');
    inner.className = 'plate-inner';
    if (svgOut) inner.innerHTML = svgOut.svg;
    else inner.innerHTML = '<p class="empty-plate">The apparatus could not draw this one.</p>';
    frame.appendChild(inner);
    plate.appendChild(frame);

    const cap = document.createElement('figcaption');
    cap.innerHTML = `<span class="fig">Fig. ${figCounter}.</span> — <i></i>`;
    cap.querySelector('i').textContent = sen.raw;
    plate.appendChild(cap);

    if (svgOut) {
      const tools = document.createElement('div');
      tools.className = 'tools';
      tools.innerHTML = `<button type="button" data-act="svg">Save as SVG</button><button type="button" data-act="png">Save as PNG</button><button type="button" data-act="link">Copy a link</button><button type="button" data-act="print">Print</button>`;
      const svgEl = inner.querySelector('svg');
      tools.addEventListener('click', e => {
        const b = e.target.closest('button');
        if (!b) return;
        const act = b.dataset.act;
        const name = slug(sen.raw);
        if (act === 'svg') saveSVG(svgEl, name);
        if (act === 'png') savePNG(svgEl, name);
        if (act === 'link') copyLink(sen.raw);
        if (act === 'print') window.print();
      });
      plate.appendChild(tools);
    }

    if (tree) {
      const an = document.createElement('div');
      an.className = 'analysis';
      an.innerHTML = `<p><span class="head">Analysis.</span> — ${analyse(tree)}</p>`;
      plate.appendChild(an);
    }
    plate.appendChild(parsingTable(sen, si));
    plates.appendChild(plate);
    const svgEl = inner.querySelector('svg');
    if (svgEl && svgOut) sizeSVG(svgEl, svgOut.width);
  });
}

// figures are drawn at reading size and enlarged to fill the plate, within reason
function sizeSVG(svg, natural) {
  const frame = svg.closest('.plate-frame');
  const avail = frame.clientWidth - 24;
  const grow = window.innerWidth > 720 ? 1.45 : 1.1;
  const s = Math.max(Math.min(grow, avail / natural), 0.6);
  svg.style.width = Math.round(natural * s) + 'px';
}
window.addEventListener('resize', () => {
  document.querySelectorAll('.plate-inner svg').forEach(svg => sizeSVG(svg, +svg.getAttribute('width')));
});

function parsingTable(sen, si) {
  const det = document.createElement('details');
  det.className = 'parsing';
  const changed = Object.keys(overrides).some(k => k.startsWith(si + ':'));
  if (changed) det.open = true;
  det.innerHTML = '<summary>Parsing — correct a part of speech</summary>';
  const grid = document.createElement('div');
  grid.className = 'parse-grid';
  for (const t of sen.tokens) {
    if (t.pos === 'PUNCT') continue;
    const cell = document.createElement('div');
    cell.className = 'pword' + (t.userPos ? ' changed' : '');
    const w = document.createElement('span');
    w.className = 'wtxt';
    w.textContent = t.text;
    const sel = document.createElement('select');
    sel.setAttribute('aria-label', `Part of speech of “${t.text}”`);
    const cur = currentChoice(t);
    const opts = [...OVERRIDE_CHOICES];
    if (!opts.some(o => o[0] === cur)) opts.unshift([cur, POS_LABEL[t.pos] || t.pos]);
    for (const [v, label] of opts) {
      const o = document.createElement('option');
      o.value = v; o.textContent = label.toLowerCase();
      if (v === cur) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      overrides[`${si}:${t.wi}`] = sel.value;
      render(input.value, { keepOverrides: true });
    });
    cell.append(w, sel);
    grid.appendChild(cell);
  }
  det.appendChild(grid);
  const note = document.createElement('p');
  note.className = 'parse-note';
  note.innerHTML = changed ? 'Corrected by hand. <button type="button" class="reset-parse">Restore the apparatus’s reading</button>' : 'Change any word’s part of speech and the figure is redrawn.';
  const rb = note.querySelector('.reset-parse');
  if (rb) rb.addEventListener('click', () => {
    for (const k of Object.keys(overrides)) if (k.startsWith(si + ':')) delete overrides[k];
    render(input.value, { keepOverrides: true });
  });
  det.appendChild(note);
  return det;
}

function currentChoice(t) {
  if (t.userPos) return t.userPos;
  const map = { PROPN: 'NOUN', NUM: 'ADJ', POSS: 'ADJ', MODAL: 'AUX', NEG: 'ADV', PART: 'ADV', THAN: 'SCONJ', REL: 'PRON', WH: 'PRON', TO: 'PREP', EX: 'ADV' };
  const v = map[t.pos] || t.pos;
  if (t.pos === 'DET' && !/^(a|an|the)$/i.test(t.text)) return 'ADJ';
  return v;
}

// --- export ----------------------------------------------------------------------
let fontData = null;
async function fontFace() {
  if (fontData) return fontData;
  try {
    const buf = await (await fetch('fonts/fell-english-italic.woff2')).arrayBuffer();
    let bin = '';
    const bytes = new Uint8Array(buf);
    for (let k = 0; k < bytes.length; k += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(k, k + 0x8000));
    fontData = `@font-face{font-family:'IM Fell English';font-style:italic;src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}`;
  } catch (e) { fontData = ''; }
  return fontData;
}

async function standaloneSVG(svgEl) {
  const cs = getComputedStyle(document.documentElement);
  const ink = cs.getPropertyValue('--ink').trim();
  const soft = cs.getPropertyValue('--ink-soft').trim();
  const plate = cs.getPropertyValue('--plate').trim();
  const stroke = cs.getPropertyValue('--stroke').trim() || '1.3px';
  const clone = svgEl.cloneNode(true);
  clone.removeAttribute('style');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.querySelectorAll('textPath').forEach(tp => tp.setAttribute('xlink:href', tp.getAttribute('href')));
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = `${await fontFace()}
line,path{stroke:${ink};stroke-width:${stroke};fill:none;stroke-linecap:round;stroke-linejoin:round}
.dash{stroke-dasharray:4.5 4;stroke-linecap:butt}
text{font-family:'IM Fell English',Georgia,serif;font-style:italic;fill:${ink}}
text.lbl,text.und{fill:${soft}} rect.knock{fill:${plate}} .loose{opacity:.5} defs path{stroke:none}`;
  clone.insertBefore(style, clone.firstChild);
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
  bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', plate);
  clone.insertBefore(bg, style.nextSibling);
  return new XMLSerializer().serializeToString(clone);
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

async function saveSVG(svgEl, name) {
  const s = await standaloneSVG(svgEl);
  download(new Blob([s], { type: 'image/svg+xml' }), name + '.svg');
}

async function savePNG(svgEl, name) {
  const s = await standaloneSVG(svgEl);
  const w = +svgEl.getAttribute('width'), h = +svgEl.getAttribute('height');
  const scale = 3;
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = w * scale; c.height = h * scale;
    const g = c.getContext('2d');
    g.scale(scale, scale);
    g.drawImage(img, 0, 0, w, h);
    c.toBlob(b => download(b, name + '.png'), 'image/png');
  };
  img.onerror = () => toast('The picture could not be made.');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

function linkFor(text) {
  const u = new URL(location.href);
  u.hash = encodeURIComponent(text);
  return u.toString();
}
async function copyLink(text) {
  const url = linkFor(text);
  try { await navigator.clipboard.writeText(url); toast('A link to this figure is copied.'); }
  catch (e) { prompt('Copy this link:', url); }
}

let toastTimer;
function toast(msg) {
  let t = $('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

const slug = s => 'diagram-' + s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// --- exercises & key --------------------------------------------------------------
function buildExercises() {
  const host = $('#exercise-list');
  EXERCISES.forEach(([title, items], gi) => {
    const g = document.createElement('div');
    g.className = 'ex-group';
    g.innerHTML = `<h3>${roman(gi + 1)}. ${title}.</h3>`;
    const ol = document.createElement('ol');
    for (const [s, src] of items) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = s;
      b.addEventListener('click', () => choose(s));
      li.appendChild(b);
      if (src) { const sp = document.createElement('span'); sp.className = 'src'; sp.textContent = ` — ${src}`; li.appendChild(sp); }
      ol.appendChild(li);
    }
    g.appendChild(ol);
    host.appendChild(g);
  });
}

function buildKey() {
  const host = $('#key-grid');
  for (const [s, title, desc] of KEY) {
    const cell = document.createElement('div');
    cell.className = 'key-cell';
    try {
      const sen = tagText(s)[0];
      const { fig } = diagramOf(sen, smallPen);
      const out = toSVG(fig, { margin: 14, title: `Diagram of: ${s}`, idPrefix: 'k' + host.children.length });
      cell.innerHTML = `<div class="kframe">${out.svg}</div><h4>${title}.</h4><p></p>`;
      const svg = cell.querySelector('svg');
      const k = Math.min(1.25, 290 / out.width, 180 / out.height);
      svg.style.width = Math.round(out.width * k) + 'px';
    } catch (e) {
      console.error(e);
      cell.innerHTML = `<h4>${title}.</h4><p></p>`;
    }
    cell.querySelector('p').innerHTML = `${desc} <i>(${s})</i>`;
    host.appendChild(cell);
  }
}

function choose(s) {
  input.value = s;
  go(true);
  $('#lesson-h').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
}

function go(push) {
  const text = input.value;
  render(text);
  const h = '#' + encodeURIComponent(text.trim());
  if (push && location.hash !== h) history.replaceState(null, '', text.trim() ? h : location.pathname);
}

// --- theme -----------------------------------------------------------------------
function setTheme(t) {
  if (t === 'paper') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  document.querySelectorAll('[data-theme-choice]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.themeChoice === t)));
  try { localStorage.setItem('diagrammatic-theme', t); } catch (e) {}
}

function chalkFilters() {
  const div = document.createElement('div');
  div.innerHTML = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
    <filter id="chalk" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency="1.4" numOctaves="2" seed="3" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.1"/></filter>
    <filter id="chalk-line" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="9" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" result="d"/><feComponentTransfer in="d"><feFuncA type="table" tableValues="0 .85 .95"/></feComponentTransfer></filter>
  </defs></svg>`;
  document.body.appendChild(div.firstChild);
}

// --- boot ------------------------------------------------------------------------
async function boot() {
  chalkFilters();
  const cur = document.documentElement.dataset.theme || 'paper';
  setTheme(cur);
  document.querySelectorAll('[data-theme-choice]').forEach(b => b.addEventListener('click', () => setTheme(b.dataset.themeChoice)));
  try {
    await Promise.race([
      Promise.all([document.fonts.load('italic 17px "IM Fell English"'), document.fonts.load('15px "IM Fell English"')]),
      new Promise(r => setTimeout(r, 2500)),
    ]);
  } catch (e) { /* draw with fallback metrics */ }
  widths.clear();
  buildExercises();
  buildKey();
  const fromHash = decodeURIComponent((location.hash || '').slice(1));
  if (fromHash) input.value = fromHash;
  render(input.value);

  $('#form').addEventListener('submit', e => { e.preventDefault(); go(true); });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(true); }
  });
  $('#random').addEventListener('click', () => {
    let s;
    do { s = ALL_SPECIMENS[Math.floor(Math.random() * ALL_SPECIMENS.length)]; } while (s === input.value && ALL_SPECIMENS.length > 1);
    input.value = s;
    go(true);
  });
  window.addEventListener('hashchange', () => {
    const t = decodeURIComponent(location.hash.slice(1));
    if (t && t !== input.value.trim()) { input.value = t; render(t); }
  });
}

boot();
