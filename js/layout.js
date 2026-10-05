// Diagrammatic — the draughtsman.
// Lays a parsed sentence out as a Reed–Kellogg diagram.  Every piece of the
// drawing is a Fig: a bag of primitives (lines, words, paths) plus collision
// boxes, named anchor points and in/out ports on its base line.  Pieces are
// packed against one another by their boxes, so modifiers, phrases and clauses
// sit as close together as they can without touching.

const DEG = Math.PI / 180;
const ANG = 60 * DEG;
const COS = Math.cos(ANG), SIN = Math.sin(ANG);
const UPX = SIN, UPY = -COS;            // the "up" side of a down-right slant

export const STYLE = {
  fs: 17,           // word size
  small: 14,        // conjunction labels
  pad: 12,          // breathing room either side of a word on its line
  minLine: 42,
  minSlant: 34,
  gap: 9,           // clearance between unrelated parts
  divUp: 24, divDown: 13,
  objUp: 21,
};

let BOXSTEP = 10;

// ---------------------------------------------------------------------------
class Fig {
  constructor() {
    this.items = []; this.boxes = []; this.anchors = {}; this.pending = [];
    this.inP = { x: 0, y: 0 }; this.outP = { x: 0, y: 0 };
  }
  addBox(x0, y0, x1, y1) {
    this.boxes.push({ x0: Math.min(x0, x1), y0: Math.min(y0, y1), x1: Math.max(x0, x1), y1: Math.max(y0, y1) });
  }
  segBoxes(x1, y1, x2, y2, r = 1.5) {
    const len = Math.hypot(x2 - x1, y2 - y1);
    if (Math.abs(y2 - y1) < 0.01 || Math.abs(x2 - x1) < 0.01 || len < BOXSTEP * 1.5) {
      this.addBox(Math.min(x1, x2) - r, Math.min(y1, y2) - r, Math.max(x1, x2) + r, Math.max(y1, y2) + r);
      return;
    }
    const n = Math.ceil(len / BOXSTEP);
    for (let k = 0; k < n; k++) {
      const ax = x1 + (x2 - x1) * k / n, ay = y1 + (y2 - y1) * k / n;
      const bx = x1 + (x2 - x1) * (k + 1) / n, by = y1 + (y2 - y1) * (k + 1) / n;
      this.addBox(Math.min(ax, bx) - r, Math.min(ay, by) - r, Math.max(ax, bx) + r, Math.max(ay, by) + r);
    }
  }
  line(x1, y1, x2, y2, cls = '', boxes = true) {
    this.items.push({ t: 'line', x1, y1, x2, y2, cls });
    if (boxes) this.segBoxes(x1, y1, x2, y2);
    return this;
  }
  path(cmds, cls = '', boxPts = null) {
    this.items.push({ t: 'path', cmds, cls });
    if (boxPts) for (let k = 0; k + 1 < boxPts.length; k++) this.segBoxes(boxPts[k][0], boxPts[k][1], boxPts[k + 1][0], boxPts[k + 1][1]);
    return this;
  }
  shift(dx, dy) {
    if (!dx && !dy) return this;
    for (const it of this.items) shiftItem(it, dx, dy);
    for (const b of this.boxes) { b.x0 += dx; b.x1 += dx; b.y0 += dy; b.y1 += dy; }
    for (const k in this.anchors) { const a = this.anchors[k]; this.anchors[k] = { x: a.x + dx, y: a.y + dy }; }
    this.inP = { x: this.inP.x + dx, y: this.inP.y + dy };
    this.outP = { x: this.outP.x + dx, y: this.outP.y + dy };
    return this;
  }
  absorb(o, dx = 0, dy = 0) {
    o.shift(dx, dy);
    for (const it of o.items) this.items.push(it);
    for (const b of o.boxes) this.boxes.push(b);
    Object.assign(this.anchors, o.anchors);
    for (const p of o.pending) this.pending.push(p);
    return this;
  }
  bbox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of this.boxes) { x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0); x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1); }
    if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0 };
    return { x0, y0, x1, y1 };
  }
}

function shiftItem(it, dx, dy) {
  if (it.t === 'line') { it.x1 += dx; it.x2 += dx; it.y1 += dy; it.y2 += dy; }
  else if (it.t === 'text' || it.t === 'rect') { it.x += dx; it.y += dy; }
  else if (it.t === 'path' || it.t === 'textpath') {
    for (const c of it.cmds) for (let k = 1; k < c.length; k += 2) { c[k] += dx; c[k + 1] += dy; }
  }
}

// smallest dx that puts B clear of A (to the right) wherever they overlap vertically
function packX(A, B, gap) {
  let dx = -Infinity;
  for (const a of A.boxes) for (const b of B.boxes) {
    if (a.y0 < b.y1 + gap && b.y0 < a.y1 + gap) { const d = a.x1 + gap - b.x0; if (d > dx) dx = d; }
  }
  return dx;
}
// smallest dy that puts B clear of A (below) wherever they overlap horizontally
function packY(A, B, gap) {
  let dy = -Infinity;
  for (const a of A.boxes) for (const b of B.boxes) {
    if (a.x0 < b.x1 + gap && b.x0 < a.x1 + gap) { const d = a.y1 + gap - b.y0; if (d > dy) dy = d; }
  }
  return dy;
}
function collides(A, B, gap = 0) {
  for (const a of A.boxes) for (const b of B.boxes) {
    if (a.x0 < b.x1 + gap && b.x0 < a.x1 + gap && a.y0 < b.y1 + gap && b.y0 < a.y1 + gap) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
export class Draughtsman {
  constructor(measure, style = {}) {
    this.S = { ...STYLE, ...style };
    this.measure = measure;
    this.asc = this.S.fs * 0.74;
    this.desc = this.S.fs * 0.26;
  }
  tw(s, size) { return this.measure(s, size || this.S.fs); }

  // A word written horizontally with its baseline at (x, y)
  textH(f, x, y, s, { size, cls = 'w', anchor = 'start' } = {}) {
    const sz = size || this.S.fs;
    const w = this.tw(s, sz);
    const x0 = anchor === 'middle' ? x - w / 2 : x;
    f.items.push({ t: 'text', x: x0, y, s, size: sz, cls });
    const a = sz * 0.74, d = sz * 0.26;
    f.addBox(x0 - 1, y - a, x0 + w + 1, y + d);
    return w;
  }
  // A word written along a slant from (ox, oy), angle a (radians), offset s along it
  textSlant(f, ox, oy, s, along, { size, cls = 'w', lift = 6 } = {}) {
    const sz = size || this.S.fs;
    const w = this.tw(s, sz);
    const c = Math.cos(ANG), sn = Math.sin(ANG);
    const bx = ox + along * c + lift * UPX, by = oy + along * sn + lift * UPY;
    f.items.push({ t: 'text', x: bx, y: by, s, size: sz, cls, rot: 60 });
    const a = sz * 0.74, d = sz * 0.2;
    for (let k = 0; k < w; k += 12) {
      const k2 = Math.min(w, k + 12);
      const pts = [];
      for (const kk of [k, k2]) for (const h of [-a, d]) pts.push([bx + kk * c - h * UPX, by + kk * sn - h * UPY]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      f.addBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
    return w;
  }
  label(f, x, y, s, { knock = true } = {}) {
    // a conjunction set across a dotted line, with paper knocked out behind it
    const sz = this.S.small;
    const w = this.tw(s, sz);
    if (knock) f.items.push({ t: 'rect', x: x - w / 2 - 3, y: y - sz * 0.62, w: w + 6, h: sz * 1.05, cls: 'knock' });
    f.items.push({ t: 'text', x: x - w / 2, y: y + sz * 0.3, s, size: sz, cls: 'lbl' });
    f.addBox(x - w / 2 - 2, y - sz * 0.6, x + w / 2 + 2, y + sz * 0.45);
    return w;
  }

  // -------------------------------------------------------------------------
  // horizontal word slot with its modifiers hanging beneath
  hWord(node, opts = {}) {
    const S = this.S;
    const f = new Fig();
    const text = opts.text != null ? opts.text : (node.understood ? `(${node.text})` : node.text);
    const tw = text ? this.tw(text) : 0;
    const allMods = [...(node.mods || []), ...(opts.extraMods || [])];
    const mods = allMods.filter(m => m.kind !== 'relclause' && m.kind !== 'advclause');
    const pend = allMods.filter(m => m.kind === 'relclause' || m.kind === 'advclause');
    const shape = opts.shape || 'line';

    // how much of the line the word itself occupies
    let wordSpan = tw + 2 * S.pad;
    let lead = 0;            // for bent/step shapes, text that rides outside the horizontal
    if (shape === 'bent') { const [, b] = splitWord(text, opts.leadSplit); lead = tw - this.tw(b); wordSpan = this.tw(b) + S.pad + 6; }
    if (shape === 'step') { wordSpan = tw + 2 * S.pad + 14; }

    const hang = this.hangGroup(mods);
    let W = Math.max(S.minLine, wordSpan);
    let off = 0;
    if (hang) {
      const minStart = shape === 'bent' ? Math.max(S.pad, tw - lead + 10) : shape === 'step' ? tw + S.pad + 16 : S.pad;
      W = Math.max(W, minStart + hang.span + S.pad + 4);
      const free = W - S.pad - 4 - hang.span - minStart;
      off = minStart + (shape === 'line' ? Math.max(0, free / 2 - 4) : 0);
      if (opts.minW) W = Math.max(W, opts.minW);
    }
    if (opts.minW) W = Math.max(W, opts.minW);

    if (shape === 'line') {
      f.line(0, 0, W, 0, 'ln');
      if (text) this.textH(f, (W - tw) / 2, -6, text, { cls: node.understood ? 'w und' : 'w' });
    } else if (shape === 'bent') {
      // the participle bends from its slant onto its own line; the word follows the bend
      const L = opts.leadLen;
      const sx = -L * COS, sy = -L * SIN;
      const r = 6;
      f.path([['M', sx, sy], ['L', -r * COS, -r * SIN], ['Q', 0, 0, r, 0], ['L', W, 0]], 'ln', [[sx, sy], [0, 0], [W, 0]]);
      const [a, b] = splitWord(text, opts.leadSplit);
      if (a) this.textSlant(f, sx, sy, a, Math.max(S.pad - 4, L - this.tw(a) - 15), {});
      if (b) this.textH(f, a ? 5 : 9, -6, b, {});
      f.attach = { x: sx, y: sy };
    } else if (shape === 'step') {
      // the gerund's stair-step: the word steps down with its line
      const up = 12;
      const [a, b] = splitWord(text, 0.5);
      const wa = this.tw(a);
      const xs = S.pad + wa + 3;
      f.line(0, -up, xs, -up, 'ln');
      f.line(xs, -up, xs + 3, 0, 'ln');
      f.line(xs + 3, 0, W, 0, 'ln');
      this.textH(f, S.pad, -up - 6, a, {});
      this.textH(f, xs + 6, -6, b, {});
      f.stand = { x: xs + 3 + Math.max(10, (W - xs - 3) / 2), y: 0 };
    }
    if (hang) f.absorb(hang, off, 0);
    f.anchors[node.id] = { x: shape === 'bent' ? Math.max(6, (tw - lead) / 2) : W / 2, y: 0 };
    f.anchors['top:' + node.id] = { x: shape === 'bent' ? Math.max(6, (tw - lead) / 2) : W / 2, y: -5 - this.asc - 2 };
    f.inP = { x: 0, y: 0 };
    f.outP = { x: W, y: 0 };
    f.W = W;
    f.anchors['s0:' + node.id] = { x: 0, y: 0 };
    f.anchors['s1:' + node.id] = { x: W, y: 0 };
    for (const m of pend) f.pending.push({ from: node.id, mod: m });

    if (node.appos && !opts.noAppos && node.appos.kind === 'compound' && node.appos.items.every(x => x.kind === 'nounclause')) {
      // several clauses in apposition: each on its own pedestal, standing in a row along the line
      let x = W;
      for (const item of node.appos.items) {
        const p = this.slot(item, {});
        p.shift(-p.inP.x, -p.inP.y);
        const dx = Math.max(x + S.gap, packX(stripLine(f, 0), stripLine(p, 0), S.gap * 2));
        f.line(x, 0, dx, 0, 'ln');
        f.absorb(p, dx, 0);
        x = p.outP.x;          // absorb has already moved p into place
      }
      f.outP = { x, y: 0 };
      f.W = x;
    } else if (node.appos && !opts.noAppos) {
      const ap = node.appos.kind === 'word' ? this.hWord(node.appos, { text: `(${node.appos.text})` }) : this.slot(node.appos, {});
      ap.shift(-ap.inP.x, -ap.inP.y);
      ap.W = ap.W || ap.outP.x;
      const dx = Math.max(W, packX(f, ap, S.gap));
      if (dx > W) f.line(W, 0, dx, 0, 'ln');
      f.absorb(ap, dx, 0);
      f.outP = { x: dx + ap.W, y: 0 };
      f.W = dx + ap.W;
    }
    return f;
  }

  textBoxesSlant(f, ox, oy, from, len) {
    const a = this.asc;
    for (let k = from; k < from + len; k += 12) {
      const k2 = Math.min(from + len, k + 12);
      const pts = [];
      for (const kk of [k, k2]) for (const h of [0, a + 5]) pts.push([ox + kk * COS + h * UPX, oy + kk * SIN + h * UPY]);
      const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
      f.addBox(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
    }
  }

  // modifiers hanging from a line, packed left to right; attach points along y=0
  hangGroup(mods) {
    let acc = null, last = 0, lastSpan = 0;
    for (const m of mods) {
      const g = this.hang(m);
      if (!g) continue;
      if (!acc) { acc = g; last = 0; lastSpan = g.attachSpan || 0; continue; }
      let x = Math.max(last + lastSpan + 20, packX(acc, g, this.S.gap));
      acc.absorb(g, x, 0);
      last = x;
      lastSpan = g.attachSpan || 0;
    }
    if (acc) acc.span = last + lastSpan;
    return acc;
  }

  hang(m) {
    switch (m.kind) {
      case 'word': return this.slantWord(m);
      case 'pp': return this.slantPP(m.prep ? m.prep.text : '', m.obj, m);
      case 'infinitive': return this.slantInf(m);
      case 'participle': return this.bentParticiple(m);
      case 'compound': return this.compoundSlants(m);
      case 'gerund': return this.slantPP('', m, m);
      case 'nounclause': return this.slantPP('', m, m);
      default: return null;
    }
  }

  slantWord(w) {
    const S = this.S;
    const f = new Fig();
    const text = w.text;
    const tw = this.tw(text);
    const subs = (w.mods || []).filter(m => m.kind !== 'relclause' && m.kind !== 'advclause');
    const pend = (w.mods || []).filter(m => m.kind === 'relclause' || m.kind === 'advclause');
    let L = Math.max(S.minSlant, tw + S.pad + 10);
    const body = new Fig();
    let t = S.pad + tw + 6;
    for (const sm of subs) {
      const g = this.hang(sm);
      if (!g) continue;
      const C = 12;
      let guard = 0;
      // slide down the slant until the elbow and its load are clear of the word and of earlier loads
      while (guard++ < 60) {
        const px = t * COS, py = t * SIN;
        const probe = new Fig();
        probe.line(px, py, px + C, py, 'ln');
        const gg = cloneFig(g); gg.shift(px + C, py);
        probe.absorb(gg);
        const wordZone = new Fig();
        this.textBoxesSlant(wordZone, 0, 0, S.pad - 2, tw + 4);
        if (!collides(probe, body, 3) && !collides(probe, wordZone, 2)) {
          body.absorb(probe);
          break;
        }
        t += 5;
      }
      t += 14;
    }
    L = Math.max(L, t - 4);
    f.line(0, 0, L * COS, L * SIN, 'ln');
    this.textSlant(f, 0, 0, text, S.pad, {});
    f.absorb(body);
    const mid = S.pad + tw / 2;
    f.anchors[w.id] = { x: mid * COS, y: mid * SIN };
    f.anchors['top:' + w.id] = { x: mid * COS + (this.asc + 6) * UPX, y: mid * SIN + (this.asc + 6) * UPY };
    for (const m of pend) f.pending.push({ from: w.id, mod: m });
    return f;
  }

  slantPP(prepText, obj, node, minLen = 0) {
    const S = this.S;
    const tw = prepText ? this.tw(prepText) : 0;
    let L = Math.max(S.minSlant + 8, tw + 2 * S.pad + 4, minLen);
    let objSeg = obj ? this.slot(obj, { forkLeft: true }) : this.emptyLine(34);
    // lengthen the slant until the object's own furniture clears it
    for (let guard = 0; guard < 40; guard++) {
      const f = new Fig();
      const bx = L * COS, by = L * SIN;
      f.line(0, 0, bx, by, 'ln');
      if (prepText) this.textSlant(f, 0, 0, prepText, S.pad, {});
      const probe = cloneFig(objSeg);
      probe.shift(bx - probe.inP.x, by - probe.inP.y);
      const slantOnly = new Fig(); slantOnly.segBoxes(0, 0, bx - 12 * COS, by - 12 * SIN, 1);
      if (prepText) this.textSlant(slantOnly, 0, 0, prepText, S.pad, {});
      const probeNoLine = new Fig();
      probeNoLine.boxes = probe.boxes.filter(b => !(b.y0 > by - 2.5 && b.y1 < by + 2.5) && Math.hypot((b.x0 + b.x1) / 2 - bx, (b.y0 + b.y1) / 2 - by) > 16);
      if (guard < 39 && collides(slantOnly, probeNoLine, 3)) { L += 8; continue; }
      f.absorb(objSeg, bx - objSeg.inP.x, by - objSeg.inP.y);
      if (node && node.id) f.anchors[node.id] = { x: bx / 2, y: by / 2 };
      f.slantLen = L;
      f.slantText = tw;
      return f;
    }
    return new Fig();
  }

  emptyLine(w) {
    const f = new Fig();
    f.line(0, 0, w, 0, 'ln');
    f.outP = { x: w, y: 0 };
    f.W = w;
    return f;
  }

  infPredicate(inf) {
    if (!inf.more || !inf.more.length) return this.predicate(inf.pred);
    return this.compound([inf.pred, ...inf.more].map(p => this.predicate(p)), inf.conj || 'and', { forkLeft: true });
  }

  slantInf(inf) {
    const pred = this.infPredicate(inf);
    const label = inf.to ? inf.to.text : '';
    const S = this.S;
    const tw = label ? this.tw(label) : 0;
    let L = Math.max(S.minSlant + 8, tw + 2 * S.pad + 4);
    for (let guard = 0; guard < 40; guard++) {
      const bx = L * COS, by = L * SIN;
      const slantOnly = new Fig(); slantOnly.segBoxes(0, 0, bx - 6 * COS, by - 6 * SIN, 1);
      if (label) this.textSlant(slantOnly, 0, 0, label, S.pad, {});
      const probe = cloneFig(pred); probe.shift(bx, by);
      probe.boxes = probe.boxes.filter(b => !(b.y0 > by - 2.5 && b.y1 < by + 2.5) && Math.hypot((b.x0 + b.x1) / 2 - bx, (b.y0 + b.y1) / 2 - by) > 16);
      if (guard < 39 && collides(slantOnly, probe, 3)) { L += 8; continue; }
      const f = new Fig();
      f.line(0, 0, bx, by, 'ln');
      if (label) this.textSlant(f, 0, 0, label, S.pad, {});
      f.absorb(pred, bx, by);
      f.anchors[inf.id] = { x: bx / 2, y: by / 2 };
      return f;
    }
    return new Fig();
  }

  bentParticiple(part, whole = false) {
    const S = this.S;
    const frac = whole ? 0 : 0.45;
    const [a] = splitWord(part.pred.verb.text, frac);
    const L = whole ? 52 : Math.max(S.minSlant + 6, this.tw(a) + S.pad + 16);
    const pred = this.predicate(part.pred, { verbShape: 'bent', leadLen: L, leadSplit: frac });
    // the predicate's verb line starts at (0,0); its slant begins up and to the left
    pred.shift(L * COS, L * SIN);
    pred.anchors[part.id] = { x: L * COS / 2, y: L * SIN / 2 };
    pred.slantLen = L;
    pred.slantText = a ? this.tw(a) + 4 : 0;
    return pred;
  }

  compoundSlants(c) {
    const S = this.S;
    const conj = c.conj && c.conj !== ',' ? c.conj : '';
    const cw = conj ? this.tw(conj, S.small) : 0;
    const words = c.items;
    const maxTw = Math.max(...words.map(w => (w.kind === 'word' ? this.tw(w.text) : 40)));
    const maxPrep = Math.max(0, ...words.map(w => (w.kind === 'pp' && w.prep ? this.tw(w.prep.text) : 0)));
    let depthAlong = S.pad + maxTw + 10;           // where the dotted rung crosses
    const figs = words.map(w => {
      if (w.kind === 'word' && !(w.mods || []).length) {
        const f = new Fig();
        const L = depthAlong + 16;
        f.line(0, 0, L * COS, L * SIN, 'ln');
        this.textSlant(f, 0, 0, w.text, S.pad, {});
        const mid = S.pad + this.tw(w.text) / 2;
        f.anchors[w.id] = { x: mid * COS, y: mid * SIN };
        f.anchors['top:' + w.id] = { x: mid * COS + (this.asc + 6) * UPX, y: mid * SIN + (this.asc + 6) * UPY };
        return f;
      }
      if (w.kind === 'participle') return this.bentParticiple(w, true);
      // phrases get slants long enough for the dotted rung to pass between preposition and object
      if (w.kind === 'pp') return this.slantPP(w.prep ? w.prep.text : '', w.obj, w, S.pad + maxPrep + 34);
      return this.hang(w);
    });
    // phrases joined by a conjunction: the rung crosses their slants below the prepositions
    if (words.some(w => w.kind !== 'word')) {
      const below = Math.max(...figs.map(g => S.pad + (g.slantText || 0) + 6));
      const room = Math.min(...figs.map(g => (g.slantLen || depthAlong + 16) - (g.slantText != null && g.slantLen ? 24 : 8)));
      depthAlong = Math.min(Math.max(below, 18), room);
    }
    let acc = null, xs = [];
    for (const g of figs) {
      if (!acc) { acc = g; xs.push(0); continue; }
      const x = Math.max(xs[xs.length - 1] + Math.max(26, cw + 22), packX(acc, g, S.gap));
      acc.absorb(g, x, 0);
      xs.push(x);
    }
    const dy = depthAlong * SIN, dxs = depthAlong * COS;
    const xa = xs[0] + dxs, xb = xs[xs.length - 1] + dxs;
    acc.line(xa, dy, xb, dy, 'dash', false);
    if (conj) {
      const n = xs.length;
      const mx = (xs[n - 2] + xs[n - 1]) / 2 + dxs;
      this.label(acc, mx, dy, conj);
    }
    acc.anchors[c.id] = { x: xa, y: dy };
    acc.attachSpan = xs[xs.length - 1];
    return acc;
  }

  // -------------------------------------------------------------------------
  // a noun slot on a base line: word, compound, or something on a pedestal
  slot(nom, opts = {}) {
    if (!nom) return this.emptyLine(30);
    switch (nom.kind) {
      case 'word': return this.hWord(nom);
      case 'compound': {
        const items = nom.items.map(it => this.slot(it, {}));
        return this.compound(items, nom.conj, { forkLeft: !!opts.forkLeft, forkRight: !!opts.forkRight, id: nom.id });
      }
      case 'gerund': {
        const inner = this.predicate(nom.pred, { verbShape: 'step', extraMods: nom.mods });
        return this.pedestal(inner, inner.stand || inner.inP, nom.id);
      }
      case 'infinitive': {
        const inner = this.infOnPedestal(nom);
        return this.pedestal(inner, inner.stand, nom.id);
      }
      case 'nounclause': {
        const inner = this.clauseFull(nom.clause, { connector: nom.connector });
        return this.pedestal(inner, inner.stand, nom.id);
      }
      case 'pp': {
        const f = this.hWord({ kind: 'word', id: nom.id + ':h', text: '', mods: [nom] }, { text: '' });
        return f;
      }
      case 'participle': {
        return this.hWord({ kind: 'word', id: nom.id + ':h', text: '', mods: [nom] }, { text: '' });
      }
      default: return this.emptyLine(30);
    }
  }

  infOnPedestal(inf) {
    const S = this.S;
    if (!inf.to) {
      const p = this.infPredicate(inf);
      p.stand = { x: Math.min(p.anchors[inf.pred.verb.id] ? p.anchors[inf.pred.verb.id].x : 20, 40), y: 0 };
      return p;
    }
    const f = this.slantInf(inf);
    // a short cap on which the "to" hangs
    f.line(-10, 0, 10, 0, 'ln');
    const vid = inf.pred.verb.kind === 'compound' ? inf.pred.verb.items[0].id : inf.pred.verb.id;
    f.stand = this.departure(f, vid, 0, true);
    return f;
  }

  pedestal(inner, stand, id) {
    const S = this.S;
    const f = new Fig();
    stand = stand || { x: 20, y: 0 };
    const below = Math.max(0, ...inner.boxes.map(b => b.y1 - stand.y));
    const H = below + 34;
    const Ws = 48;
    const c = Ws / 2;
    f.line(0, 0, Ws, 0, 'ln');
    // the stilt, standing on a little forked foot
    f.line(c, -H, c, -7, 'ln');
    f.line(c, -7, c - 6, 0, 'ln');
    f.line(c, -7, c + 6, 0, 'ln');
    f.absorb(inner, c - stand.x, -H - stand.y);
    f.inP = { x: 0, y: 0 };
    f.outP = { x: Ws, y: 0 };
    f.W = Ws;
    if (id) f.anchors[id] = { x: c, y: 0 };
    return f;
  }

  // stack items (each with inP at its own origin) into a fork
  compound(items, conj, { forkLeft = false, forkRight = false, id } = {}) {
    const S = this.S;
    const label = conj && conj !== ',' ? conj : '';
    const cw = label ? this.tw(label, S.small) : 0;
    items.forEach(it => it.shift(-it.inP.x, -it.inP.y));
    const n = items.length;
    // stack
    const ys = [0];
    const stack = new Fig();
    stack.absorb(cloneFig(items[0]));
    for (let k = 1; k < n; k++) {
      const probe = cloneFig(items[k]);
      let dy = Math.max(ys[k - 1] + 44, packY(stack, probe, S.gap + 6));
      ys.push(dy);
      stack.absorb(probe, 0, dy);
    }
    const mid = (ys[0] + ys[n - 1]) / 2;
    for (let k = 0; k < n; k++) ys[k] -= mid;
    const spread = ys[n - 1] - ys[0];
    const D = n > 1 ? ys[n - 1] - ys[n - 2] : 40;
    const forkRun = Math.max(26, (cw + 4) / Math.max(0.35, 1 - 18 / D) + 4, spread * 0.32);
    const FL = forkLeft ? forkRun : 0;
    const f = new Fig();
    const outs = items.map((it, k) => ({ x: FL + it.outP.x, y: ys[k] }));
    const Xr = Math.max(...outs.map(o => o.x));
    items.forEach((it, k) => f.absorb(it, FL, ys[k]));
    if (forkLeft) for (let k = 0; k < n; k++) f.line(0, 0, FL, ys[k], 'ln');
    let J = null;
    if (forkRight) {
      const FR = forkRun;
      J = { x: Xr + FR, y: 0 };
      for (let k = 0; k < n; k++) {
        if (outs[k].x < Xr) f.line(outs[k].x, ys[k], Xr, ys[k], 'ln');
        f.line(Xr, ys[k], J.x, 0, 'ln');
      }
    }
    // the dotted line and its conjunction, set in the fork
    if (n > 1) {
      if (forkLeft || !forkRight) {
        const base = forkLeft ? 0 : 0;
        const xd = forkLeft ? Math.max(FL * 0.5, FL - cw / 2 - 5) : -4;
        const yAt = k => (forkLeft ? ys[k] * xd / FL : ys[k]);
        if (forkLeft) {
          f.line(xd, yAt(0), xd, yAt(n - 1), 'dash', false);
          if (label) this.label(f, xd, (yAt(n - 2) + yAt(n - 1)) / 2, label);
        } else {
          // no fork at all: a dotted line just before the lines begin
          const x = base - 6;
          f.line(x + 6, ys[0], x, ys[0], 'ln');
          f.line(x, ys[0], x, ys[n - 1], 'dash', false);
          if (label) this.label(f, x - cw / 2 - 6, (ys[n - 2] + ys[n - 1]) / 2, label, { knock: false });
        }
      } else {
        const FR = J.x - Xr;
        const xd = Xr + Math.min(FR * 0.5, cw / 2 + 5);
        const tt = (xd - Xr) / FR;
        const yAt = k => ys[k] * (1 - tt);
        f.line(xd, yAt(0), xd, yAt(n - 1), 'dash', false);
        if (label) this.label(f, xd, (yAt(n - 2) + yAt(n - 1)) / 2, label);
      }
    }
    f.inP = { x: 0, y: 0 };
    f.outP = J ? J : { x: Xr, y: 0 };
    f.W = f.outP.x;
    if (id) f.anchors[id] = { x: FL / 2, y: 0 };
    return f;
  }

  // join two base-line pieces with a divider between them
  joinH(left, right, divider) {
    const S = this.S;
    right.shift(-right.inP.x, left.outP.y - right.inP.y);
    const minGap = { subj: 0, do: 0, pc: 10, oc: 10, none: 0 }[divider] || 0;
    const x = Math.max(left.outP.x + minGap, packX(stripLine(left, left.outP.y), stripLine(right, left.outP.y), S.gap));
    const y = left.outP.y;
    const f = left;
    if (x > left.outP.x) f.line(left.outP.x, y, x, y, 'ln');
    if (divider === 'subj') f.line(x, y - S.divUp, x, y + S.divDown, 'ln');
    else if (divider === 'do') f.line(x, y - S.objUp, x, y, 'ln');
    else if (divider === 'pc' || divider === 'oc') f.line(x, y, x - S.objUp / Math.tan(ANG), y - S.objUp, 'ln');
    const out = right.outP;
    f.absorb(right, x, 0);
    f.outP = { x: out.x + x, y: out.y + 0 };
    f.joint = x;
    return f;
  }

  predicate(pred, opts = {}) {
    const extra = [...(opts.extraMods || [])];
    if (pred.io) extra.unshift({ kind: 'pp', id: (pred.io.id || 'io') + ':io', prep: null, obj: pred.io, io: true });
    let v;
    const verb = pred.verb;
    if (verb.kind === 'compound') {
      const items = verb.items.map((it, k) => this.hWord(it, k === 0 ? { extraMods: extra } : {}));
      v = this.compound(items, verb.conj, { forkLeft: true, forkRight: !!pred.comp, id: verb.id });
    } else {
      v = this.hWord(verb, { shape: opts.verbShape || 'line', leadLen: opts.leadLen, leadSplit: opts.leadSplit, extraMods: extra });
    }
    let f = v;
    const stand = v.stand;
    const attach = v.attach;
    if (pred.comp) {
      const c = this.slot(pred.comp, { forkLeft: true });
      f = this.joinH(f, c, pred.compType === 'do' ? 'do' : 'pc');
    }
    if (pred.oc) {
      const c = this.slot(pred.oc, { forkLeft: true });
      f = this.joinH(f, c, 'oc');
    }
    f.inP = { x: 0, y: 0 };
    if (stand) f.stand = stand;
    if (attach) f.attach = attach;
    return f;
  }

  clause(clause) {
    const S = this.S;
    const subj = clause.subject ? this.slot(clause.subject, { forkRight: true }) : this.emptyLine(30);
    let p;
    if (clause.preds.length === 1) p = this.predicate(clause.preds[0]);
    else p = this.compound(clause.preds.map(pr => this.predicate(pr)), clause.predConj || 'and', { forkLeft: true });
    const f = this.joinH(subj, p, 'subj');
    const vx = f.joint;
    f.anchors['vin:' + clause.id] = { x: vx + 7, y: 0 };
    const v0 = clause.preds[0] && (clause.preds[0].verb.kind === 'compound' ? clause.preds[0].verb.items[0] : clause.preds[0].verb);
    f.anchors['vtop:' + clause.id] = (v0 && f.anchors['top:' + v0.id]) || { x: vx + 7, y: -20 };
    f.stand = { x: vx, y: 0 };
    if (clause.expletive) {
      const e = this.hWord(clause.expletive);
      const dy = Math.min(-34, packY(e, f, 10) * -1);
      const top = f.bbox().y0;
      const ey = Math.min(top - 12, -S.divUp - 14);
      f.absorb(e, f.inP.x - 6, ey);
      // a short stilt down toward the subject
      void dy;
    }
    if (clause.floating) {
      const e = this.hWord(clause.floating);
      const top = f.bbox().y0;
      f.absorb(e, vx + 8, top - 16);
    }
    return f;
  }

  // a clause with its dependent (adjective and adverb) clauses hung beneath it
  clauseFull(clause, opts = {}) {
    const S = this.S;
    const f = this.clause(clause);
    if (opts.connector) {
      // "that", "whether" — floating above the clause, tied to its verb by a dotted line
      const c = this.hWord(opts.connector);
      const vx = f.anchors['vin:' + clause.id].x;
      const cx = vx - c.W / 2 + 8;
      const probe = cloneFig(c); probe.shift(cx, 0);
      let cy = Math.min(-S.divUp - 16, -packY(probe, f, 8) - 0);
      cy = Math.min(cy, f.bbox().y0 - 12);
      f.absorb(c, cx, cy);
      f.line(vx + 8, cy + 2, vx + 8, -4, 'dash', false);
    }
    this.hangClauses(f);
    return f;
  }

  hangClauses(f) {
    const S = this.S;
    let guard = 0;
    while (f.pending.length && guard++ < 20) {
      const p = f.pending.shift();
      const sub = this.clauseFull(p.mod.clause);
      const rel = p.mod.kind === 'relclause';
      const tgt = rel ? (sub.anchors['top:' + p.mod.link] || sub.anchors[p.mod.link]) : sub.anchors['vtop:' + p.mod.clause.id];
      const target = tgt || sub.inP;
      const conjText = !rel && p.mod.conj ? p.mod.conj.text : '';
      let from, offset;
      if (rel) { from = this.departure(f, p.from, 0); offset = 0; }
      else ({ from, offset } = this.route(f, p.from, Math.max(30, this.tw(conjText, S.small) * 0.75 + 16)));
      const dx = from.x + offset - target.x;
      sub.shift(dx, 0);
      let dy = packY(f, sub, 26);
      dy = Math.max(dy, from.y - target.y + 40);
      sub.shift(0, dy);
      const t2 = { x: target.x + dx, y: target.y + dy };
      f.absorb(sub);
      f.line(from.x, from.y + 1.5, t2.x, t2.y, 'dash', false);
      if (conjText) {
        // the conjunction written along the dotted line
        const ang = Math.atan2(t2.y - from.y, t2.x - from.x);
        const len = Math.hypot(t2.x - from.x, t2.y - from.y);
        const w = this.tw(conjText, S.small);
        const s0 = Math.max(4, (len - w) / 2);
        const ux = Math.cos(ang), uy = Math.sin(ang);
        const nx = Math.sin(ang), ny = -Math.cos(ang);
        f.items.push({ t: 'text', x: from.x + ux * s0 + nx * 4, y: from.y + uy * s0 + ny * 4, s: conjText, size: S.small, cls: 'lbl', rot: ang / DEG });
        for (let k = 0; k < w; k += 10) {
          const bx = from.x + ux * (s0 + k) + nx * 8, by = from.y + uy * (s0 + k) + ny * 8;
          f.addBox(bx - 6, by - 6, bx + 6, by + 6);
        }
      }
    }
  }

  // a slanting connector for an adverb clause: try departures and leans, keep the cleanest
  route(f, id, lean) {
    const a0 = f.anchors['s0:' + id], a1 = f.anchors['s1:' + id], mid = f.anchors[id];
    if (!a0 || !a1) return { from: mid || f.outP, offset: lean };
    const y = a0.y;
    const bottom = f.bbox().y1 + 34;
    const centre = mid ? mid.x : (a0.x + a1.x) / 2;
    let best = null;
    for (let x = a0.x + 4; x <= a1.x - 4; x += 3) {
      for (const off of [lean, lean * 0.6, lean * 1.5, lean * 2.2, 8, -lean * 0.6]) {
        let hits = 0;
        const steps = 24;
        for (let k = 1; k <= steps; k++) {
          const t = k / steps;
          const px = x + off * t, py = y + 3 + (bottom - y - 3) * t;
          for (const b of f.boxes) if (b.x0 < px + 2 && b.x1 > px - 2 && b.y0 < py + 2 && b.y1 > py - 2) { hits++; break; }
        }
        const score = hits * 1000 + Math.abs(x - centre) * 0.6 + Math.abs(off - lean) * 0.4;
        if (!best || score < best.score) best = { x, off, score };
      }
    }
    return { from: { x: best.x, y }, offset: best.off };
  }

  // where a dotted connector leaves a word's line: the clearest spot beneath it
  departure(f, id, bias, preferLeft = false) {
    const a0 = f.anchors['s0:' + id], a1 = f.anchors['s1:' + id], mid = f.anchors[id];
    if (!a0 || !a1) return mid || f.outP;
    const y = a0.y;
    const bottom = f.bbox().y1 + 30;
    const centre = preferLeft ? a0.x + 14 : mid ? mid.x : (a0.x + a1.x) / 2;
    let best = null;
    for (let x = a0.x + (preferLeft ? 10 : 3); x <= a1.x - 3; x += 2) {
      let hits = 0;
      for (const b of f.boxes) if (b.x0 < x + 1 && b.x1 > x - 1 && b.y1 > y + 3 && b.y0 < bottom) hits++;
      const score = hits * 1000 + Math.abs(x - centre) - (bias ? 0 : 0);
      if (!best || score < best.score) best = { x, score };
    }
    return { x: best ? best.x : centre, y };
  }

  // -------------------------------------------------------------------------
  sentence(s) {
    const S = this.S;
    let f;
    if (s.fragment) {
      f = this.fragment(s.fragment);
    } else if (s.clauses.length) {
      f = this.clauseFull(s.clauses[0]);
      for (let k = 1; k < s.clauses.length; k++) {
        const prev = s.clauses[k - 1], cur = s.clauses[k];
        const g = this.clauseFull(cur);
        const v1 = f.anchors['vin:' + prev.id];
        const v2 = g.anchors['vin:' + cur.id];
        const conj = s.conjs[k - 1] || '';
        const cw = conj ? this.tw(conj, S.small) : 0;
        const stepW = Math.max(30, cw + 18);
        const dx = v1.x + stepW - v2.x;
        g.shift(dx, 0);
        // the step sits below everything already drawn in its corridor
        let ys = v1.y + 20;
        for (const b of f.boxes) if (b.x1 > v1.x - 3 && b.x0 < v1.x + stepW + 3 && b.y1 > v1.y) ys = Math.max(ys, b.y1 + 10);
        const step = new Fig();
        step.line(v1.x - 1, ys, v1.x + stepW + 1, ys, 'ln');
        if (conj) this.textH(step, v1.x + stepW / 2, ys - 4, conj, { size: S.small, cls: 'lbl', anchor: 'middle' });
        const v2top = v2.y;
        let dy = packY(f, g, 30);
        const probeStep = cloneFig(step);
        dy = Math.max(dy, packY(probeStep, g, 14), ys + 24 - v2top);
        g.shift(0, dy);
        const v2s = { x: v2.x + dx, y: v2.y + dy };
        f.absorb(step);
        f.line(v1.x, v1.y + 2, v1.x, ys, 'dash', false);
        f.line(v1.x + stepW, ys, v2s.x, v2s.y - 2, 'dash', false);
        f.absorb(g);
      }
    } else {
      f = new Fig();
    }
    // interjections, nouns of address and parentheses float above, unattached
    const floats = [...(s.leadConj ? [s.leadConj] : []), ...s.interjections, ...s.vocatives, ...(s.parens || [])];
    if (floats.length) {
      let x = f.boxes.length ? f.bbox().x0 : 0;
      const top = f.boxes.length ? f.bbox().y0 : 0;
      const row = new Fig();
      let cx = 0;
      for (const w of floats) {
        const isParen = (s.parens || []).includes(w);
        const e = w.kind === 'word' ? this.hWord(w, isParen ? { text: `(${w.text})` } : {}) : this.fragment(w);
        e.shift(-e.bbox().x0, 0);
        const px = row.boxes.length ? Math.max(cx, packX(row, e, 22)) : 0;
        row.absorb(e, px, 0);
        cx = px + (e.W || e.bbox().x1) + 22;
      }
      const dy = f.boxes.length ? Math.min(top - 18, -S.divUp - 20) : 0;
      f.absorb(row, x - 10, dy);
    }
    if (s.tag) {
      const e = this.hWord({ kind: 'word', id: 'tag', text: s.tag, mods: [] });
      const bb = f.bbox();
      f.absorb(e, bb.x1 + 24, Math.min(bb.y0 + 20, -S.divUp - 20));
    }
    // words that would not be placed
    if (s.loose && s.loose.length) {
      let bb = f.bbox();
      let cx = bb.x0;
      const row = new Fig();
      for (const w of s.loose) {
        const e = w.kind === 'word' ? this.hWord(w) : this.fragment(w);
        e.items.forEach(it => { it.cls = (it.cls || '') + ' loose'; });
        const x = row.boxes.length ? packX(row, e, 22) : 0;
        row.absorb(e, x, 0);
        cx = x;
      }
      void cx;
      const dy = f.boxes.length ? packY(f, row, 30) : 0;
      f.absorb(row, 0, dy);
    }
    this.hangClauses(f);
    return f;
  }

  fragment(node) {
    if (node.kind === 'pp' || node.kind === 'participle' || node.kind === 'infinitive') {
      return this.hWord({ kind: 'word', id: node.id + ':h', text: '', mods: [node] }, { text: '', minW: 30 });
    }
    return this.slot(node, { forkRight: false });
  }
}

// split a word for a bent or stepped line, where a compositor would hyphenate it
function splitWord(w, frac = 0.5) {
  if (!w) return ['', ''];
  const parts = w.split(' ');
  if (parts.length > 1) return [parts.slice(0, -1).join(' '), parts[parts.length - 1]];
  if (w.length < 4) return [w, ''];
  const lw = w.toLowerCase();
  const vowels = /[aeiouy]/;
  if (frac === 0) return ['', w];
  for (const suf of ['ing', 'ed', 'en', 'est', 'er', 'ly', 'ness', 'ment', 'tion']) {
    // a bare "-ed" or "-en" makes a poor second half: break at a syllable instead
    if ((suf === 'ed' || suf === 'en') && lw.endsWith(suf) && !/(.)\1(ed|en)$/.test(lw)) {
      // after t or d, "-ed" is a syllable of its own: paint-ed, grant-ed
      if (suf === 'ed' && /[td]ed$/.test(lw) && lw.length <= 7) return [w.slice(0, -2), w.slice(-2)];
      const target = w.length * frac;
      let best = -1;
      for (let j = 2; j <= w.length - 3; j++) {
        if (suf === 'ed' && /^[^aeiouy]+ed$/.test(lw.slice(j))) continue;   // a silent "-ed" never stands alone: re-tained, not retai-ned
        const vc = /[aeiouy]/.test(lw[j - 1]) && !/[aeiouy]/.test(lw[j]) && /[aeiouy]/.test(lw[j + 1]);      // V|CV
        const cc = !/[aeiouy]/.test(lw[j - 1]) && !/[aeiouy]/.test(lw[j]) && /[aeiouy]/.test(lw[j - 2] || '') && /[aeiouy]/.test(lw[j + 1]); // VC|CV
        const onset = /[aeiouy]/.test(lw[j - 1]) && /^(str|scr|spr|spl|shr|thr|sc|st|sp|sk|sl|sm|sn|sw|pr|br|tr|dr|cr|gr|fr|pl|bl|cl|fl|gl|sh|ch|th|wh|ph|qu)[aeiouy]/.test(lw.slice(j)); // V|CCV: pre-scribed
        if ((vc || cc || onset) && (best < 0 || Math.abs(j - target) < Math.abs(best - target))) best = j;
      }
      if (best > 0) return [w.slice(0, best), w.slice(best)];
    }
    if (lw.endsWith(suf) && lw.length - suf.length >= 3) {
      let k = lw.length - suf.length;
      if (suf === 'ed' && /(ss|ll|ff|zz)ed$/.test(lw)) return [w.slice(0, k), w.slice(k)];     // cross-ed, fill-ed
      // a doubled consonant splits between the pair: swim-ming, writ-ten
      if (lw[k - 1] === lw[k - 2] && !vowels.test(lw[k - 1])) k -= 1;
      // a consonant cluster before the suffix stays with the stem
      return [w.slice(0, k), w.slice(k)];
    }
  }
  let k = Math.round(w.length * frac);
  for (const d of [0, 1, -1, 2, -2]) {
    const j = k + d;
    if (j > 1 && j < w.length - 1 && vowels.test(lw[j - 1]) && !vowels.test(lw[j]) && vowels.test(lw[j + 1] || '')) { k = j; break; }
    if (j > 1 && j < w.length - 1 && !vowels.test(lw[j - 1]) && !vowels.test(lw[j]) && vowels.test(lw[j - 2] || '')) { k = j; break; }
  }
  k = Math.max(2, Math.min(w.length - 2, k));
  return [w.slice(0, k), w.slice(k)];
}

function cloneFig(f) {
  const g = new Fig();
  g.items = f.items.map(it => (it.cmds ? { ...it, cmds: it.cmds.map(c => [...c]) } : { ...it }));
  g.boxes = f.boxes.map(b => ({ ...b }));
  g.anchors = { ...f.anchors };
  g.pending = [...f.pending];
  g.inP = { ...f.inP }; g.outP = { ...f.outP };
  g.W = f.W; g.stand = f.stand; g.attach = f.attach; g.span = f.span;
  return g;
}

// a copy without the boxes of the base line itself (so adjoining lines may meet)
function stripLine(f, y) {
  const g = new Fig();
  g.boxes = f.boxes.filter(b => !(b.y0 > y - 2 && b.y1 < y + 2 && (b.x1 - b.x0) > 3));
  return g;
}

// ---------------------------------------------------------------------------
// SVG serialisation
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const r2 = v => Math.round(v * 10) / 10;
function cmdsToD(cmds) { return cmds.map(c => c[0] + c.slice(1).map(r2).join(' ')).join(' '); }

let PATH_SEQ = 0;
export function toSVG(fig, { margin = 22, title = '', idPrefix = 'p' } = {}) {
  const bb = fig.bbox();
  const dx = margin - bb.x0, dy = margin - bb.y0;
  const W = Math.ceil(bb.x1 - bb.x0 + margin * 2), H = Math.ceil(bb.y1 - bb.y0 + margin * 2);
  const lines = [], words = [], defs = [], knocks = [];
  for (const it of fig.items) {
    const cls = it.cls || '';
    if (it.t === 'line') {
      lines.push(`<line class="${cls}" x1="${r2(it.x1 + dx)}" y1="${r2(it.y1 + dy)}" x2="${r2(it.x2 + dx)}" y2="${r2(it.y2 + dy)}"/>`);
    } else if (it.t === 'path') {
      const cm = it.cmds.map(c => [c[0], ...c.slice(1).map((v, k) => v + (k % 2 === 0 ? dx : dy))]);
      lines.push(`<path class="${cls}" d="${cmdsToD(cm)}"/>`);
    } else if (it.t === 'rect') {
      knocks.push(`<rect class="${cls}" x="${r2(it.x + dx)}" y="${r2(it.y + dy)}" width="${r2(it.w)}" height="${r2(it.h)}" rx="2"/>`);
    } else if (it.t === 'text') {
      const x = r2(it.x + dx), y = r2(it.y + dy);
      const tr = it.rot ? ` transform="rotate(${r2(it.rot)} ${x} ${y})"` : '';
      words.push(`<text class="${cls}" x="${x}" y="${y}" font-size="${it.size}"${tr}>${esc(it.s)}</text>`);
    } else if (it.t === 'textpath') {
      const id = `${idPrefix}tp${PATH_SEQ++}`;
      const cm = it.cmds.map(c => [c[0], ...c.slice(1).map((v, k) => v + (k % 2 === 0 ? dx : dy))]);
      defs.push(`<path id="${id}" d="${cmdsToD(cm)}"/>`);
      words.push(`<text class="${cls}" font-size="${it.size}" dy="-5"><textPath href="#${id}" startOffset="${r2(it.offset)}">${esc(it.s)}</textPath></text>`);
    }
  }
  return {
    width: W, height: H,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" class="rk" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(title)}">` +
      `<defs>${defs.join('')}</defs><g class="rk-lines">${lines.join('')}</g><g class="rk-knock">${knocks.join('')}</g><g class="rk-words">${words.join('')}</g></svg>`,
  };
}
