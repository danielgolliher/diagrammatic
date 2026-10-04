// Diagrammatic — the parser.
// A forgiving recursive-descent parser that turns tagged tokens into the
// structure a Reed–Kellogg diagram needs: subject, predicate, complements,
// modifiers, phrases and clauses.
//
// Node shapes
//   word        { kind:'word', id, text, role, mods:[], appos? }
//   compound    { kind:'compound', id, items:[], conj }
//   gerund      { kind:'gerund', id, pred, mods:[] }
//   infinitive  { kind:'infinitive', id, to, pred }
//   nounclause  { kind:'nounclause', id, connector, clause }
//   pp          { kind:'pp', id, prep, obj }          (prep null = indirect object / adverbial noun)
//   participle  { kind:'participle', id, pred }
//   relclause   { kind:'relclause', id, clause, link }
//   advclause   { kind:'advclause', id, conj, clause }
//   predicate   { verb, compType:'do'|'pn'|'pa'|null, comp, io, oc, linking }
//   clause      { kind:'clause', id, subject, preds:[], predConj, expletive }

import { canBeVerb, retag } from './tagger.js';

let NID = 0;
const nid = () => 'n' + (NID++);
export function resetIds() { NID = 0; }

function W(tok, role, extra = {}) {
  return { kind: 'word', id: nid(), text: typeof tok === 'string' ? tok : tok.text, role, mods: [], ...extra };
}

const set = s => new Set(s.split(/\s+/).filter(Boolean));
const LINK_FULL = set('be become remain seem appear');
const LINK_ADJ = set('look feel sound taste smell grow get stay turn prove go fall keep seem appear become remain come run lie sit stand wax');
const OC_ALWAYS = set('elect name call appoint crown dub consider declare deem label proclaim nominate christen title term vote style');
const OC_IF_BARE = set('make find keep leave think prove choose select believe judge render paint color colour dye turn set get want like prefer hold');
const OC_ADJ = set('make keep find leave paint color colour dye turn set drive get consider call think believe prove render hold push pull wipe sweep declare deem judge like want prefer have');
const INF_OBJ = set(`want need like love hate try begin start decide hope plan learn refuse agree promise expect prefer fail forget
  remember choose deserve intend manage offer prepare pretend continue attempt wish desire arrange claim dare demand long mean
  neglect threaten vow yearn seek strive afford care tend hesitate swear volunteer wait have ought used`);
const GER_OBJ = set(`enjoy like love hate stop start begin finish avoid keep mind miss practice practise consider suggest quit imagine risk
  deny admit appreciate delay discuss dislike postpone recall recommend regret resent resist tolerate understand prefer
  remember forget try continue fancy`);
const OBJ_INF = set(`tell ask want allow expect order invite help force persuade encourage urge teach remind warn advise need like cause
  get enable permit require beg command forbid instruct oblige compel tempt train challenge dare wish prefer`);
const BARE_INF = set('let make help have watch see hear feel notice bid');
const CLAUSE_VERBS = set(`say think know believe hope wish feel realize realise notice see hear suppose guess understand remember forget
  explain show tell ask wonder decide learn discover find mean doubt fear expect promise claim argue insist suggest admit deny
  agree announce report reply answer write read dream imagine pretend prove recognize recognise reveal confirm assume conclude
  declare determine ensure figure hold indicate maintain observe predict recall reckon regret state suspect swear teach warn
  worry demand see judge trust bet care`);
const IO_VERBS = set(`give send tell show buy bring teach offer hand lend pass write sell pay ask read make get find leave owe promise grant
  award cook bake build sing throw toss feed serve deny allow save fetch order reserve wish bid cost lend mail email`);
const TIME_NOUNS = set(`morning evening night afternoon day week month year summer winter spring autumn time hour minute moment season
  decade century weekend today tomorrow yesterday tonight while noon midnight dawn dusk`);
const TIME_DETS = set('last next this that every each all one some the');
const INF_NOUNS = set(`time way place money chance opportunity right reason decision ability need desire plan attempt effort power
  permission wish urge courage strength something anything nothing someone anyone nobody everything one book water food work
  house room means duty task job order promise advice tendency freedom capacity much more less nothing plenty lot`);
const PLACE_NOUNS = set(`house place town city room country spot home land village street world school office building garden park
  church table island field forest city valley hill road river sea shore station town shop store hotel kitchen bed`);
const ADJ_PREPS = set('of about at with to for from than');
const SUBJ_PRON = set('i he she we they thou ye');
const VOC_NOUNS = set('sir madam madame friends friend children boys girls ladies gentlemen class everyone everybody mother father mom dad mama papa doctor captain son daughter brother sister darling dear lord master teacher reader');
const MULTI_PREP = [['because', 'of'], ['instead', 'of'], ['out', 'of'], ['in', 'front', 'of'], ['according', 'to'], ['next', 'to'],
  ['due', 'to'], ['away', 'from'], ['apart', 'from'], ['ahead', 'of'], ['on', 'top', 'of'], ['in', 'spite', 'of'], ['as', 'for'],
  ['in', 'addition', 'to'], ['by', 'means', 'of'], ['on', 'account', 'of'], ['in', 'place', 'of'], ['up', 'to'], ['close', 'to'],
  ['along', 'with'], ['together', 'with'], ['prior', 'to'], ['rather', 'than'], ['such', 'as'], ['on', 'behalf', 'of'],
  ['inside', 'of'], ['outside', 'of'], ['in', 'case', 'of'], ['out', 'from'], ['from', 'behind'], ['from', 'under']];
const MULTI_SCONJ = [['so', 'that'], ['as', 'if'], ['as', 'though'], ['even', 'though'], ['even', 'if'], ['in', 'order', 'that'],
  ['now', 'that'], ['as', 'soon', 'as'], ['as', 'long', 'as'], ['so', 'long', 'as'], ['provided', 'that'], ['given', 'that'],
  ['except', 'that'], ['in', 'case'], ['ever', 'since']];
const SCONJ_WORDS = set('because although though if unless while whilst whereas whether lest whenever wherever when where after before since until till as once');
const INTERJ_ADV_WH = set('where when why how');

const EOF = { pos: 'EOF', text: '', lower: '', tags: new Set(), sw: '' };

function verbWord(pred) {
  // the word node that carries a predicate's verb modifiers
  if (!pred) return null;
  const v = pred.verb;
  if (v.kind === 'compound') return v.items[v.items.length - 1];
  return v;
}

function hasDeterminer(np) {
  if (!np || np.kind !== 'word') return false;
  return np.mods.some(m => m.kind === 'word' && (m.role === 'article' || m.role === 'possessive' || m.role === 'numeral' || m.role === 'adjective' && /^(this|that|these|those|every|each|some|any|no|another)$/i.test(m.text)));
}

export class Parser {
  constructor(tokens) {
    this.t = tokens;
    this.i = 0;
    this.gap = 0;
  }
  peek(k = 0) { return this.t[this.i + k] || EOF; }
  next() { return this.t[this.i++] || EOF; }
  get done() { return this.i >= this.t.length; }
  isComma(k = 0) { const p = this.peek(k); return p.pos === 'PUNCT' && p.text === ','; }
  isPunct(k = 0) { return this.peek(k).pos === 'PUNCT'; }
  isEnd(k = 0) { const p = this.peek(k); return p.pos === 'EOF' || (p.pos === 'PUNCT' && p.text !== '(' ); }

  matchSeq(list) {
    for (const seq of list) {
      if (seq.every((w, k) => this.peek(k).lower === w)) return seq;
    }
    return null;
  }

  // --- predicates over upcoming tokens --------------------------------------
  isFiniteTok(t) {
    return t.pos === 'AUX' || t.pos === 'MODAL' || (t.pos === 'VERB' && t.form !== 'ing' && t.form !== 'pp');
  }
  verbStart(k = 0) {
    let j = k;
    while (['ADV', 'NEG'].includes(this.peek(j).pos)) j++;
    const t = this.peek(j);
    return this.isFiniteTok(t);
  }
  npStart(k = 0) {
    const t = this.peek(k);
    if (['DET', 'POSS', 'NUM', 'NOUN', 'PROPN', 'PRON'].includes(t.pos)) return true;
    if (t.pos === 'ADJ') return true;
    if (t.pos === 'ADV' && ['ADJ', 'NUM'].includes(this.peek(k + 1).pos) && !['not', 'never'].includes(t.lower)) return true;
    if (t.pos === 'VERB' && t.form === 'ing') return true;
    if (t.pos === 'WH' && ['what', 'which', 'whose'].includes(t.lower)) return true;
    return false;
  }
  // does an NP starting at k end right before a finite verb?  (then it is a subject, not an object)
  npThenFinite(k = 0) {
    const save = this.i;
    this.i += k;
    let r = false;
    try {
      const np = this.parseNP('probe');
      if (np) {
        // the subject may carry a phrase or two before its verb: "a man in possession of a fortune must..."
        let guard = 0;
        while (guard++ < 4 && this.peek().pos === 'PREP') {
          this.i++;
          if (!this.parseNP('probe')) break;
        }
        if (this.isComma() && this.verbStart(1)) this.i++;
        if (this.verbStart()) r = true;
      }
    } catch (e) { r = false; }
    this.i = save;
    return r;
  }
  laterFinite(k = 0) {
    for (let j = this.i + k; j < this.t.length; j++) {
      const t = this.t[j];
      if (t.pos === 'PUNCT' && t.text !== ',') return false;
      if (t.pos === 'CCONJ' || t.pos === 'SCONJ') return false;
      if (this.isFiniteTok(t) && !(t.pos === 'VERB' && t.form === 'pastpp' && this.t[j + 1] && this.t[j + 1].lower === 'by')) return true;
    }
    return false;
  }

  // --- sentence -----------------------------------------------------------
  parseSentence(end) {
    const s = { kind: 'sentence', id: nid(), clauses: [], conjs: [], interjections: [], vocatives: [], loose: [], tag: null };
    s.type = end && end.includes('?') ? 'interrogative' : end && end.includes('!') ? 'exclamatory' : 'declarative';

    // trailing tag question: ", isn't it?"
    const n = this.t.length;
    if (n > 3) {
      let j = n - 1;
      if (this.t[j].pos === 'PRON') {
        let k = j - 1;
        if (this.t[k] && this.t[k].pos === 'NEG') k--;
        if (this.t[k] && ['AUX', 'MODAL'].includes(this.t[k].pos) && this.t[k - 1] && this.t[k - 1].text === ',') {
          s.tag = this.t.slice(k, n).map(t => t.text).join(' ');
          this.t = this.t.slice(0, k - 1);
        }
      }
    }
    // trailing vocative: ", John."
    {
      const m = this.t.length;
      let j = m - 1;
      while (j > 0 && (this.t[j].pos === 'PROPN' || (VOC_NOUNS.has(this.t[j].lower) && this.t[j].pos === 'NOUN'))) j--;
      if (j < m - 1 && j > 0 && this.t[j].text === ',' && m - 1 - j <= 3) {
        const words = this.t.slice(j + 1, m);
        let k = j - 1;
        while (k >= 0 && (this.t[k].pos === 'POSS' || this.t[k].pos === 'ADJ')) k--;
        s.vocatives.push(W(words.map(t => t.text).join(' '), 'vocative'));
        this.t = this.t.slice(0, j);
      }
    }

    // leading interjections
    while (this.peek().pos === 'INTJ') {
      const parts = [this.next().text];
      while (this.peek().pos === 'INTJ' && !this.isComma()) parts.push(this.next().text);
      s.interjections.push(W(parts.join(' '), 'interjection'));
      while (this.isPunct() && this.peek().text !== '(') this.i++;
    }
    // leading vocative: "Mary, close the door."
    this.tryLeadingVocative(s);

    if (this.done) {
      if (!s.interjections.length && !s.vocatives.length) return null;
      return s;
    }

    const first = this.parseClause({ top: true, type: s.type });
    if (!first) {
      // a fragment: a noun phrase, a phrase, or loose words
      s.fragment = this.parseFragment();
      while (!this.done) {
        if (this.isPunct()) { this.i++; continue; }
        const extra = this.parseFragment();
        if (extra) s.loose.push(extra); else s.loose.push(W(this.next(), 'word'));
      }
      return s;
    }
    s.clauses.push(first);

    // compound sentence
    let guard = 0;
    while (!this.done && guard++ < 12) {
      const save = this.i;
      let punct = null;
      while (this.isPunct()) { punct = this.next().text; }
      if (this.done) break;
      if (this.peek().pos === 'CCONJ' || (this.peek().lower === 'for' && punct === ',') || ((this.peek().lower === 'so' || this.peek().lower === 'yet') && punct)) {
        const c = this.next();
        const cl = this.parseClause({ top: true, type: s.type });
        if (cl && cl.preds.length) { s.clauses.push(cl); s.conjs.push(c.text); continue; }
        this.i = save;
        break;
      }
      if (punct === ';' || punct === ':' || punct === '—' || punct === ',') {
        const cl = this.parseClause({ top: true, type: s.type });
        if (cl && cl.preds.length && (punct !== ',' || !cl.subject.understood)) { s.clauses.push(cl); s.conjs.push(''); continue; }
        this.i = save;
      }
      // leftovers: try to tack them onto the last predicate
      this.i = save;
      while (this.isPunct()) this.i++;
      const last = s.clauses[s.clauses.length - 1];
      const pred = last.preds[last.preds.length - 1];
      const before = this.i;
      if (pred) this.parseVPTail(pred, true);
      if (this.i === before) {
        const frag = this.parseFragment();
        if (frag) s.loose.push(frag);
        else if (!this.done) s.loose.push(W(this.next(), 'word'));
      }
    }
    return s;
  }

  tryLeadingVocative(s) {
    const save = this.i;
    const t0 = this.peek();
    let j = 0;
    if (t0.pos === 'PROPN') { while (this.peek(j).pos === 'PROPN') j++; }
    else if ((t0.pos === 'POSS' || t0.pos === 'ADJ') && ['NOUN', 'PROPN'].includes(this.peek(1).pos)) {
      j = 1; while (['NOUN', 'PROPN', 'ADJ'].includes(this.peek(j).pos)) j++;
    } else if (t0.pos === 'NOUN' && VOC_NOUNS.has(t0.lower)) j = 1;
    else return;
    if (!this.isComma(j)) return;
    const after = this.peek(j + 1);
    const imper = (after.pos === 'VERB' && after.form === 'base') || after.lower === 'please' || after.lower === 'let' ||
      (after.pos === 'AUX' && (after.lower === 'do' || after.lower === 'be') && true) || ['MODAL', 'AUX'].includes(after.pos) ||
      (after.pos === 'PRON' && (SUBJ_PRON.has(after.lower) || after.lower === 'you')) || after.pos === 'WH' || after.pos === 'INTJ';
    if (!imper) return;
    const words = [];
    for (let k = 0; k < j; k++) words.push(this.next());
    this.i++; // comma
    const head = W(words[words.length - 1].text, 'vocative');
    if (words.length > 1 && words[0].pos !== 'PROPN') {
      head.mods = words.slice(0, -1).map(w => W(w, w.pos === 'POSS' ? 'possessive' : 'adjective'));
    } else if (words.length > 1) head.text = words.map(w => w.text).join(' ');
    s.vocatives.unshift(head);
    if (this.done) { this.i = save; s.vocatives.shift(); }
  }

  parseFragment() {
    const save = this.i;
    const t = this.peek();
    if (t.pos === 'PREP') {
      const pp = this.parsePP();
      if (pp && pp.kind === 'pp' && pp.obj) return pp;
      this.i = save;
    }
    const np = this.parseNPList('subj');
    if (np) {
      this.parsePostMods(np, 'subj');
      return np;
    }
    if (t.pos === 'ADJ' || t.pos === 'ADV' || t.pos === 'VERB' || t.pos === 'NUM') {
      this.i++;
      const w = W(t, t.pos === 'ADJ' ? 'adjective' : t.pos === 'ADV' ? 'adverb' : t.pos === 'VERB' ? 'verb' : 'numeral');
      while (this.peek().pos === 'PREP') {
        const pp = this.parsePP();
        if (pp && pp.kind === 'pp') w.mods.push(pp); else break;
      }
      return w;
    }
    this.i = save;
    return null;
  }

  // --- clause -------------------------------------------------------------
  // opts: { sub, noQuestion, type, top }
  parseClause(opts = {}) {
    const start = this.i;
    const pre = [];
    const preSubj = [];
    let guard = 0;
    while (guard++ < 12 && !this.done) {
      const t = this.peek();
      if (t.pos === 'PUNCT' && (t.text === ',' || t.text === '—') && pre.length + preSubj.length > 0) { this.i++; continue; }
      if ((t.pos === 'ADV' || t.pos === 'NEG') && !INTERJ_ADV_WH.has(t.lower)) {
        // sentence adverb before the subject ("Suddenly the door opened.")
        const nx = this.peek(1);
        if (t.lower === 'please' && (nx.pos === 'VERB' || nx.pos === 'AUX')) { pre.push(W(this.next(), 'adverb')); continue; }
        if (nx.pos === 'ADJ' && !this.isComma(1)) break;
        if (this.isComma(1) || this.npStart(1) || nx.pos === 'EX' || nx.pos === 'VERB' || (nx.pos === 'AUX' && t.lower !== 'not')) {
          if (nx.pos === 'VERB' || nx.pos === 'AUX' || nx.pos === 'MODAL') break;
          pre.push(this.parseAdverb());
          continue;
        }
        break;
      }
      if (t.pos === 'PREP' && !opts.inverted) {
        const save = this.i;
        const pp = this.parsePP();
        if (pp && pp.kind === 'pp' && pp.obj) { pre.push(pp); continue; }
        this.i = save;
        break;
      }
      const whSub = ['when', 'where', 'whenever', 'wherever'].includes(t.lower) && (opts.type !== 'interrogative' || opts.sub) && this.clauseAhead(1);
      if (whSub || t.pos === 'SCONJ' || (SCONJ_WORDS.has(t.lower) && t.pos !== 'WH' && t.lower !== 'that' && t.pos !== 'REL') || this.matchSeq(MULTI_SCONJ)) {
        if (t.lower === 'whether' || (t.lower === 'that' && t.pos !== 'SCONJ')) break;
        const ac = this.parseAdvClause();
        if (ac) { pre.push(ac); continue; }
        break;
      }
      if (((t.pos === 'VERB' && (t.form === 'ing' || t.form === 'pp' || t.form === 'pastpp')) || (/^(having|being)$/.test(t.lower) && this.peek(1).pos === 'VERB')) && start === this.i - 0 && !opts.sub) {
        // participial phrase before the subject: "Walking home, I saw a fox."
        const save = this.i;
        const part = this.parseParticiple();
        if (part && this.isComma()) { this.i++; preSubj.push(part); continue; }
        this.i = save;
        break;
      }
      if ((t.pos === 'TO' || (t.lower === 'in' && this.peek(1).lower === 'order' && this.peek(2).lower === 'to')) && !opts.sub) {
        const save = this.i;
        const inf = this.parseInfinitive();
        if (inf && this.isComma()) { this.i++; pre.push(inf); continue; }
        this.i = save;
        break;
      }
      // adverbial noun: "Last night we...", "Four score and seven years ago our fathers..."
      if (['DET', 'NUM', 'ADJ', 'NOUN'].includes(t.pos) || (t.pos === 'PRON' && t.lower === 'one')) {
        const adv = this.tryAdverbialNP(true);
        if (adv) { pre.push(adv); continue; }
      }
      break;
    }

    const clause = { kind: 'clause', id: nid(), subject: null, preds: [], predConj: null, expletive: null };
    const t = this.peek();
    const interrogative = opts.type === 'interrogative' && !opts.sub && !opts.noQuestion;

    let res = null;
    // noun clause as subject: "What he said was true."  "That he lied is obvious."
    if (!interrogative && (t.pos === 'WH' || ['whoever', 'whatever', 'whichever'].includes(t.lower) || (t.lower === 'that' && t.pos === 'SCONJ') || t.lower === 'whether')) {
      const save = this.i;
      const nc = this.parseNounClause();
      if (nc && this.verbStart()) {
        clause.subject = nc;
        res = this.finishClause(clause, pre, preSubj);
        if (res) return res;
      }
      this.i = save;
    }
    if (t.pos === 'WH' && !opts.sub && !opts.noQuestion) {
      res = this.parseWhQuestion(clause, pre);
      if (res) return res;
      this.i = start;
      return null;
    }
    if ((t.pos === 'AUX' || t.pos === 'MODAL') && !opts.sub && !this.isImperativeStart() && (interrogative || opts.type === 'interrogative')) {
      let k = 1;
      if (this.peek(1).pos === 'NEG') k = 2;
      if (this.npStart(k) || this.peek(k).pos === 'EX') {
        res = this.parseInverted(clause, pre, preSubj);
        if (res) return res;
        this.i = start;
      }
    }
    if (t.pos === 'EX') {
      res = this.parseExpletive(clause, pre);
      if (res) return res;
    }
    if (!opts.sub && this.isImperativeStart()) {
      clause.subject = W('you', 'pronoun', { understood: true });
      return this.finishClause(clause, pre, preSubj);
    }
    clause.subject = this.parseNPList('subj');
    if (!clause.subject) {
      if (!opts.sub && this.verbStart() && pre.length) {
        clause.subject = W('you', 'pronoun', { understood: true });
      } else { this.i = start; return null; }
    }
    // "To be or not to be, that is the question": the pronoun is the subject, the phrase in apposition
    if (this.isComma() && this.peek(1).pos === 'PRON' && /^(that|this|it|these|those|they|he|she)$/.test(this.peek(1).lower) && this.verbStart(2) && clause.subject.kind !== 'word') {
      this.i++;
      const pr = W(this.next(), 'pronoun');
      pr.appos = clause.subject;
      clause.subject = pr;
    }
    // an old-fashioned comma between subject and verb
    if (this.isComma() && this.verbStart(1) && !this.isComma(2) && this.peek(1).pos !== 'VERB' || this.isComma() && this.peek(1).pos === 'MODAL') {
      this.i++;
    }
    // subject followed by a parenthetical comma'd phrase "John, however, left."
    if (this.isComma() && this.peek(1).pos === 'ADV' && this.isComma(2)) {
      this.i++; pre.push(this.parseAdverb()); this.i++;
    } else if (this.isComma() && (['PREP', 'TO', 'SCONJ'].includes(this.peek(1).pos) || this.peek(1).lower === 'in')) {
      const save = this.i;
      this.i++;
      let m = null;
      if (this.peek().pos === 'TO' || (this.peek().lower === 'in' && this.peek(1).lower === 'order')) m = this.parseInfinitive();
      else if (this.peek().pos === 'PREP') { const pp = this.parsePP(); if (pp && pp.kind === 'pp' && pp.obj) m = pp; }
      else m = this.parseAdvClause();
      if (m && this.isComma() && this.verbStart(1)) { this.i++; pre.push(m); }
      else this.i = save;
    }
    res = this.finishClause(clause, pre, preSubj);
    if (!res) this.i = start;
    return res;
  }

  finishClause(clause, pre, preSubj) {
    const vp = this.parseVPList();
    if (!vp) return null;
    clause.preds = vp.items;
    clause.predConj = vp.conj;
    // "It is a truth universally acknowledged, that ...": the clause is in apposition with "it"
    const subj = clause.subject;
    if (subj && subj.kind === 'word' && /^it$/i.test(subj.text) && !subj.appos) {
      const save = this.i;
      if (this.isComma()) this.i++;
      const t = this.peek();
      let ap = null;
      if (t.lower === 'that' && this.clauseAhead(1)) ap = this.parseNounClause();
      else if (t.pos === 'TO' && this.peek(1).pos === 'VERB' && this.peek(-1).text !== ',') ap = this.parseInfinitive();
      if (ap) subj.appos = ap; else this.i = save;
    }
    const vw = verbWord(clause.preds[0]);
    const target = clause.preds[0].verb.kind === 'compound' ? clause.preds[0].verb.items[0] : clause.preds[0].verb;
    if (pre.length) target.mods.unshift(...pre);
    if (preSubj.length && clause.subject) {
      if (clause.subject.kind === 'word') clause.subject.mods.push(...preSubj);
      else target.mods.unshift(...preSubj);
    }
    void vw;
    return clause;
  }

  isImperativeStart() {
    const t = this.peek();
    if (t.pos === 'VERB' && t.form === 'base' && !(this.peek(1).pos === 'VERB' && this.peek(1).form !== 'ing')) {
      if (t.lower === 'let' || this.i === 0 || this.peek(-1).pos === 'PUNCT' || this.peek(-1).pos === 'CCONJ' || this.peek(-1).pos === 'INTJ' || this.peek(-1).lower === 'please') return true;
      return true;
    }
    if (t.pos === 'AUX' && t.lower === 'do' && this.peek(1).pos === 'NEG') return true;
    if (t.pos === 'AUX' && t.lower === 'be' && !this.npStart(1)) return true;
    if (t.pos === 'AUX' && t.lower === 'be' && ['ADJ', 'DET', 'ADV'].includes(this.peek(1).pos)) return true;
    if (t.lower === 'please') return true;
    if (t.pos === 'AUX' && t.lower === 'have' && this.npStart(1) && ['DET', 'POSS', 'ADJ'].includes(this.peek(1).pos) && this.i === 0 && false) return true;
    return false;
  }

  parseExpletive(clause, pre) {
    const save = this.i;
    const ex = this.next();
    const vg = this.parseVerbGroup();
    if (!vg) { this.i = save; return null; }
    const subj = this.parseNPList('subj');
    if (!subj) { this.i = save; return null; }
    clause.expletive = W(ex, 'expletive');
    clause.subject = subj;
    const verb = W(vg.text, 'verb', { mods: vg.mods });
    const pred = this.newPred(verb, vg);
    pred.linking = false;
    this.parseVPTail(pred);
    clause.preds = [pred];
    if (pre.length) verb.mods.unshift(...pre);
    return clause;
  }

  parseInverted(clause, pre, preSubj) {
    const save = this.i;
    const aux = this.next();
    const negs = [];
    while (this.peek().pos === 'NEG') negs.push(W(this.next(), 'adverb'));
    if (this.peek().pos === 'EX') {
      // "Is there a doctor in the house?"
      const ex = this.next();
      clause.expletive = W(ex, 'expletive');
    }
    const subj = this.parseNPList('subj');
    if (!subj) { this.i = save; return null; }
    clause.subject = subj;
    const vg = this.parseVerbGroup([aux]);
    const verb = W(vg.text, 'verb', { mods: [...negs, ...vg.mods] });
    const pred = this.newPred(verb, vg);
    this.parseVPTail(pred);
    clause.preds = [pred];
    // compound predicate in a question: "Did you sing and dance?"
    while (this.peek().pos === 'CCONJ' && this.peek(1).pos === 'VERB') {
      const c = this.next();
      const p2 = this.parseVP();
      if (!p2) break;
      clause.preds.push(p2);
      clause.predConj = c.text;
    }
    if (pre.length) verb.mods.unshift(...pre);
    if (preSubj.length && subj.kind === 'word') subj.mods.push(...preSubj);
    return clause;
  }

  // Build the node for a wh-word (with any noun or adjective it governs)
  buildWh() {
    const whTok = this.next();
    const lw = whTok.lower;
    if (['what', 'which', 'whose', 'whatever', 'whichever'].includes(lw) && (['NOUN', 'PROPN', 'ADJ', 'DET'].includes(this.peek().pos))) {
      const np = this.parseNP('wh');
      if (np && np.kind === 'word') {
        np.mods.unshift(W(whTok, lw === 'whose' ? 'possessive' : 'adjective', { wh: true }));
        return { node: np, role: 'nominal' };
      }
    }
    if (lw === 'how' && ['ADJ', 'ADV'].includes(this.peek().pos) || (lw === 'how' && ['many', 'much', 'few', 'little'].includes(this.peek().lower))) {
      const adjTok = this.next();
      const howW = W(whTok, 'adverb', { wh: true });
      if (['many', 'much', 'few', 'little'].includes(adjTok.lower) && ['NOUN', 'ADJ'].includes(this.peek().pos)) {
        const np = this.parseNP('wh');
        if (np && np.kind === 'word') {
          np.mods.unshift(W(adjTok, 'adjective', { mods: [howW] }));
          return { node: np, role: 'nominal' };
        }
      }
      if (adjTok.pos === 'ADJ' || ['many', 'much', 'few', 'little'].includes(adjTok.lower)) return { node: W(adjTok, 'adjective', { mods: [howW] }), role: 'adj' };
      return { node: W(adjTok, 'adverb', { mods: [howW] }), role: 'adv' };
    }
    if (lw === 'what' && ['a', 'an'].includes(this.peek().lower)) {
      const np = this.parseNP('wh');
      if (np && np.kind === 'word') { np.mods.unshift(W(whTok, 'adjective', { wh: true })); return { node: np, role: 'nominal' }; }
    }
    const adv = INTERJ_ADV_WH.has(lw) || lw === 'wherever' || lw === 'whenever';
    return { node: W(whTok, adv ? 'adverb' : 'pronoun', { wh: true }), role: adv ? 'adv' : 'nominal' };
  }

  parseWhQuestion(clause, pre) {
    const save = this.i;
    const { node, role } = this.buildWh();
    const t = this.peek();
    // subject question: "Who called?"  "Which team won?"  "Who is coming?"
    if (role === 'nominal' && this.isFiniteTok(t) && !((t.pos === 'AUX' || t.pos === 'MODAL') && (this.npStart(1) || (this.peek(1).pos === 'NEG' && this.npStart(2))) && !(this.peek(1).pos === 'VERB'))) {
      clause.subject = node;
      const r = this.finishClause(clause, pre, []);
      if (r) return r;
      this.i = save;
      this.buildWh();
    }
    if (t.pos === 'AUX' || t.pos === 'MODAL') {
      this.gap++;
      const r = this.parseInverted(clause, pre, []);
      this.gap--;
      if (r) { this.fillGap(r, node, role); return r; }
    }
    // "What a day it is!"  "How happy they are!"
    this.gap++;
    const sub = this.parseClause({ sub: true, noQuestion: true });
    this.gap--;
    if (sub) {
      this.fillGap(sub, node, role);
      if (pre.length) verbWord(sub.preds[0]).mods.unshift(...pre);
      return sub;
    }
    this.i = save;
    return null;
  }

  fillGap(clause, node, role) {
    const pred = clause.preds[0];
    if (!pred) { clause.floating = node; return; }
    const vw = pred.verb.kind === 'compound' ? pred.verb.items[0] : pred.verb;
    if (role === 'adv') { vw.mods.unshift(node); return; }
    if (role === 'adj') {
      if (!pred.comp) { pred.comp = node; pred.compType = 'pa'; } else vw.mods.unshift(node);
      return;
    }
    const stranded = this.findStranded(pred);
    if (stranded) { stranded.obj = node; delete stranded.stranded; return; }
    if (!pred.comp) { pred.comp = node; pred.compType = pred.linking ? 'pn' : 'do'; return; }
    if (pred.comp.kind === 'infinitive' && !pred.comp.pred.comp) {
      const st = this.findStranded(pred.comp.pred);
      if (st) { st.obj = node; delete st.stranded; return; }
      pred.comp.pred.comp = node; pred.comp.pred.compType = 'do'; return;
    }
    if (pred.compType === 'do' && !pred.io && pred.comp.kind === 'word') { pred.io = pred.comp; pred.comp = node; return; }
    if (pred.compType === 'pa' || pred.compType === 'pn') {
      // "Who is he?" parsed as subject "who"? keep node as predicate nominative
      clause.floating = node; return;
    }
    clause.floating = node;
  }

  findStranded(pred) {
    const scan = mods => {
      for (const m of mods || []) {
        if (m.kind === 'pp' && m.stranded) return m;
      }
      return null;
    };
    const vw = verbWord(pred);
    return scan(vw && vw.mods) || (pred.comp && pred.comp.kind === 'word' && scan(pred.comp.mods)) || null;
  }

  tryAdverbialNP(atStart) {
    const save = this.i;
    const np = this.parseNPList('adv');
    if (!np) { this.i = save; return null; }
    if (this.peek().lower === 'ago') {
      const ago = W(this.next(), 'adverb');
      ago.mods.push({ kind: 'pp', id: nid(), prep: null, obj: np, adverbial: true });
      return ago;
    }
    const head = np.kind === 'word' ? np : null;
    if (head && TIME_NOUNS.has(head.text.toLowerCase()) && head.mods.length && head.mods[0].kind === 'word' && TIME_DETS.has(head.mods[0].text.toLowerCase()) && head.mods[0].text.toLowerCase() !== 'the') {
      if (!atStart || this.isComma() || ['PRON', 'DET', 'PROPN', 'EX', 'POSS'].includes(this.peek().pos) || (this.peek().pos === 'NOUN')) {
        return { kind: 'pp', id: nid(), prep: null, obj: np, adverbial: true };
      }
    }
    this.i = save;
    return null;
  }

  // --- verb phrases -------------------------------------------------------
  parseVPList() {
    const first = this.parseVP();
    if (!first) return null;
    const items = [first];
    let conj = null;
    let guard = 0;
    while (guard++ < 8) {
      const save = this.i;
      let comma = false;
      if (this.isComma()) { this.i++; comma = true; }
      const t = this.peek();
      if (t.pos === 'CCONJ' && ['and', 'or', 'but', 'nor', 'yet'].includes(t.lower)) {
        const nx = this.peek(1);
        let j = 1;
        while (['ADV', 'NEG'].includes(this.peek(j).pos)) j++;
        const v = this.peek(j);
        if ((v.pos === 'VERB' && v.form !== 'ing') || ((v.pos === 'AUX' || v.pos === 'MODAL') && !this.npStart(j + 1))) {
          this.i++;
          const vp = this.parseVP();
          if (vp) { items.push(vp); conj = t.text; continue; }
        }
        void nx;
      } else if (comma && this.peek().pos === 'VERB' && this.peek().form !== 'ing' && this.peek().form !== 'pp') {
        // "He came, saw, and conquered"
        const vp = this.parseVP();
        if (vp) { items.push(vp); continue; }
      }
      this.i = save;
      break;
    }
    // shared object: "washed and dried the dishes"
    if (items.length > 1) {
      const last = items[items.length - 1];
      const bare = items.slice(0, -1).every(p => !p.comp && !p.io && p.verb.kind === 'word' && !p.verb.mods.length);
      if (bare && last.comp && last.verb.kind === 'word') {
        const verbs = items.map(p => p.verb);
        const pred = { ...last, verb: { kind: 'compound', id: nid(), items: verbs, conj: conj || 'and' } };
        return { items: [pred], conj: null };
      }
    }
    return { items, conj };
  }

  parseVP() {
    const save = this.i;
    const mods = [];
    while ((this.peek().pos === 'ADV' || this.peek().pos === 'NEG') && this.verbStart(1)) mods.push(this.parseAdverb());
    if ((this.peek().pos === 'ADV' || this.peek().pos === 'NEG')) {
      let j = 0;
      while (['ADV', 'NEG'].includes(this.peek(j).pos)) j++;
      if (this.isFiniteTok(this.peek(j))) while (j-- > 0) mods.push(W(this.next(), 'adverb'));
    }
    const vg = this.parseVerbGroup();
    if (!vg) { this.i = save; return null; }
    const verb = W(vg.text, 'verb', { mods: [...mods, ...vg.mods] });
    const pred = this.newPred(verb, vg);
    this.parseVPTail(pred);
    return pred;
  }

  newPred(verb, vg) {
    return { verb, compType: null, comp: null, io: null, oc: null, lemma: vg.lemma, linking: vg.linking, linkAdj: vg.linkAdj, passive: vg.passive, nested: !!vg.nested };
  }

  // Auxiliaries + main verb + particles.  preAux: tokens already consumed (inverted questions)
  parseVerbGroup(preAux = []) {
    const words = [...preAux];
    const mods = [];
    const isAuxLike = t => t.pos === 'AUX' || t.pos === 'MODAL';
    const followsAux = (aux, nx) => {
      if (!nx) return false;
      if (nx.pos === 'AUX' || nx.pos === 'MODAL') return aux.pos === 'MODAL' || aux.lemma === 'do' || aux.lemma === 'have' && (nx.lower === 'been') || aux.lemma === 'be' && nx.lower === 'being' || aux.pos === 'MODAL';
      if (nx.pos !== 'VERB') return false;
      if (aux.pos === 'MODAL' || aux.lemma === 'do') return true;
      if (aux.lemma === 'have') return /pp|pastpp|past/.test(nx.form || '');
      if (aux.lemma === 'be') return /ing|pp|pastpp|past/.test(nx.form || '');
      return false;
    };
    // after pre-consumed aux (questions) just continue
    let guard = 0;
    while (guard++ < 8) {
      const t = this.peek();
      if (isAuxLike(t) && (words.length === 0 || followsAux(words[words.length - 1], t) || preAux.length && words.length === preAux.length)) {
        if (words.length && !followsAux(words[words.length - 1], t) && !(preAux.length && words.length === preAux.length && (t.pos === 'AUX' || t.pos === 'MODAL'))) break;
        words.push(this.next());
        let k = 0;
        while (['NEG', 'ADV'].includes(this.peek(k).pos)) k++;
        const nx = this.peek(k);
        if (followsAux(t, nx)) {
          for (let q = 0; q < k; q++) mods.push(W(this.next(), 'adverb'));
          continue;
        }
        break;
      }
      if (t.pos === 'VERB' && (words.length === 0 || followsAux(words[words.length - 1], t) || (preAux.length && words.length === preAux.length))) {
        words.push(this.next());
        while (this.peek().pos === 'PART') words.push(this.next());
        break;
      }
      break;
    }
    if (!words.length) return null;
    const nonPart = words.filter(w => w.pos !== 'PART');
    const main = nonPart[nonPart.length - 1] || words[words.length - 1];
    const lemma = (main.lemma || main.root || main.lower).toLowerCase();
    const beforeMain = nonPart.slice(0, -1);
    const passive = main.pos === 'VERB' && /pp|pastpp|past/.test(main.form || '') && beforeMain.some(w => w.lemma === 'be') && beforeMain[beforeMain.length - 1].lemma === 'be' || (beforeMain.length && beforeMain[beforeMain.length - 1].lower === 'being' && /pp|past/.test(main.form || ''));
    const mainIsBe = main.pos === 'AUX' && main.lemma === 'be';
    return {
      text: words.map(w => w.text).join(' '),
      lemma: mainIsBe ? 'be' : lemma,
      form: main.form,
      mainTok: main,
      mods,
      passive: !!passive,
      linking: mainIsBe || LINK_FULL.has(lemma) && !passive,
      linkAdj: LINK_ADJ.has(lemma) && !passive,
      words,
    };
  }

  // Everything after the verb.  resume=true continues an existing predicate.
  parseVPTail(pred, resume = false) {
    const verb = pred.verb.kind === 'compound' ? pred.verb.items[pred.verb.items.length - 1] : pred.verb;
    const lemma = pred.lemma || '';
    let guard = 0;
    while (guard++ < 40 && !this.done) {
      const t = this.peek();
      const linkingOK = !pred.comp && (pred.linking || pred.linkAdj);

      // adverbs
      if (t.pos === 'NEG' || (t.pos === 'ADV' && /^(not|never)$/i.test(t.lower))) {
        verb.mods.push(W(this.next(), 'adverb'));
        continue;
      }
      if (t.pos === 'ADV' || t.pos === 'NEG') {
        if (linkingOK || (pred.compType === 'do' && OC_ADJ.has(lemma) && !pred.oc)) {
          let j = 0;
          while (['ADV', 'NEG'].includes(this.peek(j).pos)) j++;
          if (this.peek(j).pos === 'ADJ') {
            const adj = this.parseAdjPhrase();
            if (adj) {
              if (!pred.comp) { pred.comp = adj; pred.compType = 'pa'; } else { pred.oc = adj; }
              continue;
            }
          }
        }
        if (t.lower === 'as' && this.peek(1).pos === 'ADJ' || t.lower === 'as' && this.peek(1).pos === 'ADV') {
          verb.mods.push(this.parseAdverb());
          continue;
        }
        const adv = this.parseAdverb();
        verb.mods.push(adv);
        continue;
      }
      if (t.pos === 'PART') { verb.text += ' ' + this.next().text; continue; }

      // predicate adjective
      if (linkingOK && (t.pos === 'ADJ' || (t.pos === 'VERB' && (t.form === 'pp' || t.form === 'pastpp' || t.form === 'past') && pred.linking && !t.tags.has('Verb')))) {
        if (!(t.pos === 'ADJ' && ['NOUN', 'PROPN'].includes(this.peek(1).pos) && pred.linking)) {
          const adj = this.parseAdjPhrase();
          if (adj) { pred.comp = adj; pred.compType = 'pa'; continue; }
        }
      }
      // predicate nominative (be / become / remain / seem)
      if (!pred.comp && pred.linking && (this.npStart() || t.pos === 'TO' || (t.lower === 'that' && t.pos === 'SCONJ') || t.pos === 'WH' || t.lower === 'whether')) {
        const save = this.i;
        let np = null;
        if (t.pos === 'TO') np = this.parseInfinitive();
        else if (t.pos === 'WH' || (t.lower === 'that' && t.pos === 'SCONJ') || t.lower === 'whether') np = this.parseNounClause();
        else np = this.parseNPList('pn');
        if (np) { pred.comp = np; pred.compType = 'pn'; continue; }
        this.i = save;
      }
      // a linking-adj verb followed by an adjective-noun ("feel the cloth") falls through to objects
      const transitiveOK = !pred.comp && !pred.passive && !pred.linking;

      // to-infinitive
      if (t.pos === 'TO') {
        if (transitiveOK && (INF_OBJ.has(lemma) || pred.linkAdj && ['seem', 'appear'].includes(lemma))) {
          const inf = this.parseInfinitive();
          if (inf) { pred.comp = inf; pred.compType = pred.linkAdj && ['seem', 'appear'].includes(lemma) ? 'pn' : 'do'; continue; }
        }
        if (pred.compType === 'do' && !pred.oc && OBJ_INF.has(lemma) && pred.comp && pred.comp.kind === 'word') {
          const inf = this.parseInfinitive();
          if (inf) { pred.oc = inf; continue; }
        }
        const inf = this.parseInfinitive();
        if (inf) { verb.mods.push(inf); continue; }
        break;
      }

      // noun clause object: "I know (that) he is right", "She asked whether it was late"
      if (transitiveOK || (pred.compType === 'do' && pred.comp && pred.comp.kind === 'word' && pred.comp.role === 'pronoun' && !pred.io && IO_VERBS.has(lemma) && CLAUSE_VERBS.has(lemma))) {
        const clauseConn = (t.lower === 'that' && (t.pos === 'SCONJ' || this.clauseAhead(1))) || t.lower === 'whether' || (t.lower === 'if' && CLAUSE_VERBS.has(lemma)) ||
          (t.pos === 'WH' && CLAUSE_VERBS.has(lemma));
        if (clauseConn && (CLAUSE_VERBS.has(lemma) || t.lower === 'that')) {
          const save = this.i;
          const nc = this.parseNounClause();
          if (nc) {
            if (pred.comp) { pred.io = pred.comp; }
            pred.comp = nc; pred.compType = 'do';
            continue;
          }
          this.i = save;
        }
        // "that" omitted
        if (!pred.comp && !pred.nested && CLAUSE_VERBS.has(lemma) && ((t.pos === 'PRON' && (SUBJ_PRON.has(t.lower) || t.lower === 'you' || t.lower === 'it')) || this.npStart()) && this.npThenFinite(0) && !(t.pos === 'PRON' && !SUBJ_PRON.has(t.lower) && t.lower !== 'you' && t.lower !== 'it')) {
          const save = this.i;
          const cl = this.parseClause({ sub: true, noQuestion: true });
          if (cl) { pred.comp = { kind: 'nounclause', id: nid(), connector: null, clause: cl }; pred.compType = 'do'; continue; }
          this.i = save;
        }
      }

      // gerund object: "I enjoy swimming"
      if (transitiveOK && t.pos === 'VERB' && t.form === 'ing') {
        const g = this.parseGerund();
        if (g) { pred.comp = g; pred.compType = 'do'; continue; }
      }
      // participle after an object: "I saw a man running" is handled in the NP; "He came running"
      if (t.pos === 'VERB' && t.form === 'ing') {
        const part = this.parseParticiple();
        if (part) { verb.mods.push(part); continue; }
      }

      // adverbial noun: "every day", "last night"
      if (['DET', 'ADJ'].includes(t.pos) && TIME_DETS.has(t.lower) && t.lower !== 'the') {
        const save = this.i;
        const adv = this.tryAdverbialNP(false);
        if (adv && (pred.comp || !this.npStart())) { verb.mods.push(adv); continue; }
        this.i = save;
      }

      // objects
      if (transitiveOK && this.npStart() && !(t.pos === 'PRON' && SUBJ_PRON.has(t.lower) && t.lower !== 'it')) {
        const save = this.i;
        const np1 = this.parseNPList('obj');
        if (np1) {
          this.objectTail(pred, np1, lemma);
          continue;
        }
        this.i = save;
      }

      if (!pred.comp && !pred.passive && t.pos === 'ADJ' && !['NOUN', 'PROPN', 'ADJ'].includes(this.peek(1).pos) && !pred.nested) {
        const adj = this.parseAdjPhrase();
        if (adj) { pred.comp = adj; pred.compType = 'pa'; continue; }
      }
      // object complement adjective after the object
      if (pred.compType === 'do' && !pred.oc && OC_ADJ.has(lemma) && t.pos === 'ADJ') {
        pred.oc = this.parseAdjPhrase();
        continue;
      }

      // prepositional phrases
      if (t.pos === 'PREP' || (t.pos === 'THAN')) {
        const save = this.i;
        const pp = this.parsePP();
        if (pp && pp.kind === 'pp') {
          if (!pp.obj && !pp.stranded) { verb.mods.push(W(pp.prep.text, 'adverb')); continue; }
          verb.mods.push(pp);
          continue;
        }
        if (pp && pp.kind === 'word') { verb.mods.push(pp); continue; }
        this.i = save;
        break;
      }

      // subordinate (adverb) clauses — these belong to the main verb, not to a verbal
      if (pred.nested && (t.pos === 'SCONJ' || this.isComma())) break;
      if (t.pos === 'SCONJ' || this.matchSeq(MULTI_SCONJ) || (SCONJ_WORDS.has(t.lower) && !['that', 'whether'].includes(t.lower) && t.pos !== 'REL')) {
        if (t.lower === 'whether' || t.lower === 'that' && !this.matchSeq(MULTI_SCONJ)) {
          // "so happy that ..." handled in adj phrase
          break;
        }
        const ac = this.parseAdvClause();
        if (ac) { verb.mods.push(ac); continue; }
        break;
      }
      // comma followed by an adverb clause or participle
      if (this.isComma()) {
        const nx = this.peek(1);
        if ((nx.pos === 'SCONJ' || (SCONJ_WORDS.has(nx.lower) && nx.pos !== 'REL' && nx.lower !== 'that' && nx.pos !== 'WH')) && nx.lower !== 'whether') {
          this.i++;
          const ac = this.parseAdvClause();
          if (ac) { verb.mods.push(ac); continue; }
          this.i--;
          break;
        }
        if (nx.pos === 'VERB' && nx.form === 'ing') {
          this.i++;
          const part = this.parseParticiple();
          if (part) { verb.mods.push(part); continue; }
          this.i--;
        }
        if (nx.pos === 'ADV' && (this.isComma(2) || this.isEnd(2))) {
          this.i++;
          verb.mods.push(this.parseAdverb());
          if (this.isComma() && !(this.peek(1).pos === 'CCONJ')) { /* keep comma for compound check */ }
          continue;
        }
        if (nx.pos === 'PREP' && !this.isEnd(2)) {
          const save = this.i;
          this.i++;
          const pp = this.parsePP();
          if (pp && pp.kind === 'pp' && pp.obj && (this.isEnd() || this.isComma())) { verb.mods.push(pp); continue; }
          this.i = save;
        }
        break;
      }
      // "home" etc. tagged NOUN after motion verbs is handled by the tagger; anything else ends the predicate
      break;
    }
    void resume;
    return pred;
  }

  clauseAhead(k) {
    const t = this.peek(k);
    if (t.pos === 'PRON' && (SUBJ_PRON.has(t.lower) || ['you', 'it'].includes(t.lower))) return true;
    if (t.pos === 'EX') return true;
    return this.npThenFinite(k);
  }

  objectTail(pred, np1, lemma) {
    const t = this.peek();
    // second noun phrase: indirect object, or object complement
    if (this.npStart() && t.pos !== 'ADJ' && !this.npThenFinite(0) && !(t.pos === 'VERB' && t.form === 'ing') && !(t.pos === 'PRON' && SUBJ_PRON.has(t.lower))) {
      const save = this.i;
      const tAdvNP = this.tryAdverbialNP(false);
      if (tAdvNP) { this.i = save; }
      else {
        const np2 = this.parseNPList('obj');
        if (np2) {
          const ocNoun = OC_ALWAYS.has(lemma) || (OC_IF_BARE.has(lemma) && !hasDeterminer(np2) && !(np1.kind === 'word' && np1.role === 'pronoun' && IO_VERBS.has(lemma) && hasDeterminer(np2)));
          if (ocNoun && !IO_VERBS.has(lemma) || ocNoun && !hasDeterminer(np2)) {
            pred.comp = np1; pred.compType = 'do'; pred.oc = np2;
          } else {
            pred.io = np1; pred.comp = np2; pred.compType = 'do';
          }
          return;
        }
        this.i = save;
      }
    }
    if (t.pos === 'ADJ' && OC_ADJ.has(lemma)) {
      pred.comp = np1; pred.compType = 'do';
      pred.oc = this.parseAdjPhrase();
      return;
    }
    if (t.pos === 'TO' && OBJ_INF.has(lemma)) {
      pred.comp = np1; pred.compType = 'do';
      const inf = this.parseInfinitive();
      if (inf) pred.oc = inf;
      return;
    }
    if (t.pos === 'VERB' && t.form === 'base' && BARE_INF.has(lemma)) {
      pred.comp = np1; pred.compType = 'do';
      const vtok = this.next();
      const v = W(vtok, 'verb');
      const ip = this.newPred(v, { lemma: vtok.lemma || vtok.root, linking: false, linkAdj: LINK_ADJ.has(vtok.lemma || vtok.root), passive: false });
      this.parseVPTail(ip);
      pred.oc = { kind: 'infinitive', id: nid(), to: null, pred: ip };
      return;
    }
    // "told him that ..."
    if (((t.lower === 'that' && this.clauseAhead(1)) || (t.pos === 'WH' && CLAUSE_VERBS.has(lemma)) || (t.lower === 'whether' || t.lower === 'if')) && IO_VERBS.has(lemma) && np1.kind === 'word') {
      const save = this.i;
      const nc = this.parseNounClause();
      if (nc) { pred.io = np1; pred.comp = nc; pred.compType = 'do'; return; }
      this.i = save;
    }
    pred.comp = np1; pred.compType = 'do';
  }

  parseAdverb() {
    const t = this.next();
    const w = W(t, 'adverb');
    // adverb modifying adverb: "very quickly"
    if (['very', 'too', 'so', 'quite', 'rather', 'most', 'more', 'less', 'least', 'extremely', 'really', 'almost', 'nearly', 'how', 'as', 'just', 'right', 'far', 'much', 'pretty'].includes(t.lower) && this.peek().pos === 'ADV' && !['not', 'never'].includes(this.peek().lower)) {
      const head = this.parseAdverb();
      head.mods.unshift(w);
      return head;
    }
    // "as quickly as possible"
    if (t.lower !== 'as' && this.peek().pos === 'THAN') {
      const th = this.next();
      const obj = this.parseNPList('pobj');
      if (obj) w.mods.push({ kind: 'pp', id: nid(), prep: W(th, 'preposition'), obj });
    }
    return w;
  }

  parseAdjPhrase() {
    const first = this.parseAdj();
    if (!first) return null;
    const items = [first];
    let conj = null;
    let guard = 0;
    while (guard++ < 6) {
      const save = this.i;
      if (this.isComma()) this.i++;
      if (this.peek().pos === 'CCONJ' && ['and', 'or', 'but', 'yet'].includes(this.peek().lower) && (this.peek(1).pos === 'ADJ' || (this.peek(1).pos === 'ADV' && this.peek(2).pos === 'ADJ'))) {
        conj = this.next().text;
        const a = this.parseAdj();
        if (a) { items.push(a); continue; }
      } else if (this.peek(-1).text === ',' && this.peek().pos === 'ADJ') {
        const a = this.parseAdj();
        if (a) { items.push(a); continue; }
      }
      this.i = save;
      break;
    }
    if (items.length === 1) return first;
    return { kind: 'compound', id: nid(), items, conj: conj || 'and' };
  }

  parseAdj() {
    const advs = [];
    while ((this.peek().pos === 'ADV' || this.peek().pos === 'NEG') && ['ADJ', 'ADV', 'NEG'].includes(this.peek(1).pos)) advs.push(W(this.next(), 'adverb'));
    const t = this.peek();
    if (!(t.pos === 'ADJ' || (t.pos === 'VERB' && /pp|pastpp|past/.test(t.form || '')))) {
      this.i -= advs.length;
      return null;
    }
    this.i++;
    const adj = W(t, 'adjective', { mods: [] });
    // nested adverbs: "very" modifies the next adverb or the adjective
    if (advs.length) {
      let head = advs[advs.length - 1];
      for (let k = advs.length - 2; k >= 0; k--) { head.mods.unshift(advs[k]); }
      adj.mods.push(head);
    }
    // adjective complements: "afraid of the dark", "happy to help", "taller than John", "so tired that ..."
    let guard = 0;
    while (guard++ < 4) {
      const n = this.peek();
      if ((n.pos === 'PREP' && ADJ_PREPS.has(n.lower)) || n.pos === 'THAN') {
        const save = this.i;
        const pp = this.parsePP();
        if (pp && pp.kind === 'pp' && pp.obj) { adj.mods.push(pp); continue; }
        this.i = save;
        break;
      }
      if (n.pos === 'TO' && this.peek(1).pos === 'VERB') {
        const inf = this.parseInfinitive();
        if (inf) { adj.mods.push(inf); continue; }
      }
      if ((n.lower === 'that' && this.clauseAhead(1)) || (n.pos === 'SCONJ' && ['because', 'if', 'when', 'since', 'although', 'though', 'whether', 'that'].includes(n.lower) && false)) {
        const save = this.i;
        const conj = this.next();
        const cl = this.parseClause({ sub: true, noQuestion: true });
        if (cl) { adj.mods.push({ kind: 'advclause', id: nid(), conj: W(conj, 'conjunction'), clause: cl }); continue; }
        this.i = save;
      }
      break;
    }
    return adj;
  }

  // --- noun phrases ---------------------------------------------------------
  parseNPList(ctx) {
    const save = this.i;
    let corr = null;
    const t0 = this.peek();
    if (['both', 'either', 'neither'].includes(t0.lower)) {
      const want = { both: 'and', either: 'or', neither: 'nor' }[t0.lower];
      if (this.t.slice(this.i + 1, this.i + 12).some(x => x.lower === want)) { corr = this.next().text; }
    }
    const first = this.parseNP(ctx);
    if (!first) { this.i = save; return null; }
    const items = [first];
    let conj = null;
    let guard = 0;
    while (guard++ < 12) {
      const s2 = this.i;
      let comma = false;
      if (this.isComma()) { this.i++; comma = true; }
      const t = this.peek();
      if (t.pos === 'CCONJ' && ['and', 'or', 'nor', 'but'].includes(t.lower) && (t.lower !== 'but' || corr === null && false)) {
        this.i++;
        let negInf = null;
        if (this.peek().pos === 'NEG' && this.peek(1).pos === 'TO' && first.kind === 'infinitive') negInf = W(this.next(), 'adverb');
        if (this.npStart() || this.peek().pos === 'TO') {
          const np = this.peek().pos === 'TO' && first.kind === 'infinitive' ? this.parseInfinitive() : this.parseNP(ctx);
          if (np && negInf && np.kind === 'infinitive') np.pred.verb.mods.unshift(negInf);
          const okCoord = np && !(ctx !== 'subj' && ctx !== 'probe' && this.verbStart() && !this.isEnd()) && !(ctx === 'subj' && false);
          if (np && okCoord) { items.push(np); conj = t.text; if (!this.isComma() && this.peek().pos !== 'CCONJ') break; continue; }
        }
        this.i = s2;
        break;
      }
      if (comma && this.npStart() && this.listAhead()) {
        const np = this.parseNP(ctx);
        if (np) { items.push(np); continue; }
      }
      this.i = s2;
      break;
    }
    if (items.length === 1) return first;
    return { kind: 'compound', id: nid(), items, conj: corr ? `${corr}…${conj || 'and'}` : (conj || 'and') };
  }

  // after a comma: does a coordinating conjunction follow before the list ends?
  listAhead() {
    for (let j = this.i; j < Math.min(this.t.length, this.i + 14); j++) {
      const t = this.t[j];
      if (t.pos === 'CCONJ') return true;
      if (t.pos === 'PUNCT' && t.text !== ',') return false;
      if (this.isFiniteTok(t)) return false;
      if (t.pos === 'PREP' && false) return false;
    }
    return false;
  }

  parseNP(ctx) {
    const start = this.i;
    const t = this.peek();
    if (t.pos === 'EOF' || t.pos === 'PUNCT') return null;
    const nounSlot = ['subj', 'obj', 'pobj', 'pn', 'probe'].includes(ctx);

    // verbals and clauses that fill noun slots
    if (t.pos === 'VERB' && t.form === 'ing' && nounSlot) {
      if (ctx === 'probe') { this.i++; while (!this.isEnd() && !this.verbStart() && this.peek().pos !== 'CCONJ') this.i++; return { kind: 'gerund' }; }
      return this.parseGerund();
    }
    if (t.pos === 'TO' && nounSlot && this.peek(1).pos === 'VERB' || t.pos === 'TO' && nounSlot && this.peek(1).pos === 'AUX') return this.parseInfinitive();
    if (nounSlot && ctx !== 'probe' && ((t.lower === 'that' && t.pos === 'SCONJ') || t.lower === 'whether' || ((t.pos === 'WH' || ['whoever', 'whatever', 'whichever', 'whomever'].includes(t.lower)) && ctx !== 'subj'))) {
      const nc = this.parseNounClause();
      if (nc) return nc;
      this.i = start;
    }
    if (t.pos === 'PRON' || t.pos === 'REL' && t.lower === 'that' && ctx !== 'probe') {
      if (t.pos === 'REL') return null;
      this.i++;
      const role = t.pos === 'PRON' ? 'pronoun' : 'pronoun';
      const node = W(t, role);
      // "all of us", "something special", "everyone else"
      if (this.peek().pos === 'ADJ' && /^(some|any|no|every)(thing|one|body)$/.test(t.lower)) node.mods.push(W(this.next(), 'adjective'));
      if (this.peek().lower === 'else') node.mods.push(W(this.next(), 'adjective'));
      if (['we', 'us', 'you'].includes(t.lower) && this.peek().lower === 'the' && ['NOUN', 'ADJ'].includes(this.peek(1).pos) && ctx !== 'probe') {
        const ap = this.parseNP(ctx);
        if (ap && ap.kind === 'word') node.appos = ap;
      }
      if (ctx !== 'probe') this.parsePostMods(node, ctx);
      return node;
    }
    const pre = [];
    let guard = 0;
    while (guard++ < 12) {
      const k = this.peek();
      if (k.pos === 'DET') { pre.push(W(this.next(), /^(a|an|the)$/i.test(k.text) ? 'article' : 'adjective')); continue; }
      if (k.pos === 'POSS') {
        const p = W(this.next(), 'possessive');
        // "the old man's hat": earlier modifiers belong to the possessor
        if (pre.length && /'s?$|s'$/.test(k.text)) { p.mods = pre.splice(0); }
        pre.push(p);
        continue;
      }
      if (k.pos === 'NUM') { pre.push(W(this.next(), 'numeral')); continue; }
      if (k.pos === 'WH' && ['what', 'which', 'whose'].includes(k.lower) && ctx === 'wh') { pre.push(W(this.next(), 'adjective')); continue; }
      if ((k.pos === 'ADV' && !['not', 'never'].includes(k.lower) || k.pos === 'NEG' && false) && ['ADJ', 'NUM', 'ADV'].includes(this.peek(1).pos) && this.peek(1).pos !== 'ADV' || (k.pos === 'ADV' && this.peek(1).pos === 'ADV' && this.peek(2).pos === 'ADJ')) {
        const advs = [];
        while (this.peek().pos === 'ADV') advs.push(W(this.next(), 'adverb'));
        const a = this.peek();
        if (a.pos !== 'ADJ' && a.pos !== 'NUM') { this.i -= advs.length; break; }
        this.i++;
        const adj = W(a, a.pos === 'NUM' ? 'numeral' : 'adjective');
        let head = advs[advs.length - 1];
        for (let q = advs.length - 2; q >= 0; q--) head.mods.unshift(advs[q]);
        adj.mods.push(head);
        pre.push(adj);
        this.coordAdj(pre);
        continue;
      }
      if (k.pos === 'ADJ') {
        // stop if this adjective is actually a predicate adjective ("the man happy"?) — rare; accept
        if (!['NOUN', 'PROPN', 'ADJ', 'NUM', 'CCONJ', 'VERB', 'PUNCT'].includes(this.peek(1).pos) && !(this.peek(1).pos === 'CCONJ')) {
          // bare adjective as head: "the rich", "the poor"
          if (pre.length && pre[pre.length - 1].role === 'article' && ctx !== 'probe') {
            this.i++;
            const node = W(k, 'noun');
            node.mods = pre;
            this.parsePostMods(node, ctx);
            return node;
          }
          if (!pre.length) break;
        }
        if (this.peek(1).pos === 'VERB' && this.peek(1).form !== 'ing' && !pre.length) break;
        pre.push(W(this.next(), 'adjective'));
        this.coordAdj(pre);
        continue;
      }
      break;
    }
    // gerund after a possessive: "his singing"
    if (this.peek().pos === 'VERB' && this.peek().form === 'ing' && pre.length && nounSlot && ctx !== 'probe') {
      const g = this.parseGerund();
      if (g) { g.mods = pre; return g; }
    }
    // noun run
    const nouns = [];
    while (['NOUN', 'PROPN'].includes(this.peek().pos) || (this.peek().pos === 'NUM' && nouns.length && nouns[nouns.length - 1].pos === 'PROPN')) {
      if (nouns.length && nouns[nouns.length - 1].pos === 'NOUN' && this.peek().pos === 'PROPN') {
        let j = 0;
        while (this.peek(j).pos === 'PROPN') j++;
        if (this.verbStart(j)) break;
      }
      nouns.push(this.next());
      if (/'s?$/.test(nouns[nouns.length - 1].text) && false) break;
    }
    if (!nouns.length) {
      if (pre.length) {
        const last = pre[pre.length - 1];
        if (last.role === 'adjective' || last.role === 'numeral' || last.role === 'possessive' || last.role === 'article' && false) {
          pre.pop();
          const node = W(last.text, last.role === 'possessive' ? 'pronoun' : last.role === 'numeral' ? 'pronoun' : 'pronoun', { mods: [...last.mods] });
          node.mods.unshift(...pre);
          if (ctx !== 'probe') this.parsePostMods(node, ctx);
          return node;
        }
      }
      this.i = start;
      return null;
    }
    let headText;
    const mods = pre;
    const allProper = nouns.every(n => n.pos === 'PROPN');
    if (allProper) headText = nouns.map(n => n.text).join(' ');
    else {
      // trailing run of proper nouns stays together; earlier common nouns are adjuncts
      let k = nouns.length - 1;
      if (nouns[k].pos === 'PROPN') { while (k > 0 && nouns[k - 1].pos === 'PROPN') k--; }
      headText = nouns.slice(k).map(n => n.text).join(' ');
      for (let q = 0; q < k; q++) mods.push(W(nouns[q], 'adjunct'));
    }
    const node = W(headText, allProper ? 'proper' : 'noun', { mods });
    node.head = nouns[nouns.length - 1];
    if (ctx !== 'probe') this.parsePostMods(node, ctx);
    return node;
  }

  coordAdj(pre) {
    // "old and tired", "red, white, and blue" before a noun
    const save = this.i;
    let comma = false;
    if (this.isComma()) { this.i++; comma = true; }
    const t = this.peek();
    if (t.pos === 'CCONJ' && ['and', 'or', 'but', 'yet'].includes(t.lower) && this.peek(1).pos === 'ADJ') {
      this.i++;
      const a = W(this.next(), 'adjective');
      const prev = pre.pop();
      if (prev.kind === 'compound') { prev.items.push(a); prev.conj = t.text; pre.push(prev); }
      else pre.push({ kind: 'compound', id: nid(), items: [prev, a], conj: t.text });
      return;
    }
    if (comma && t.pos === 'ADJ') {
      // list continues; leave for the main loop but remember grouping
      const a = W(this.next(), 'adjective');
      const prev = pre.pop();
      if (prev.kind === 'compound') { prev.items.push(a); pre.push(prev); }
      else pre.push({ kind: 'compound', id: nid(), items: [prev, a], conj: ',' });
      this.coordAdj(pre);
      return;
    }
    this.i = save;
  }

  parsePostMods(node, ctx) {
    let guard = 0;
    while (guard++ < 12 && !this.done) {
      const t = this.peek();
      const isNoun = node.kind === 'word' && node.role !== 'pronoun';
      // prepositional phrase
      if (t.pos === 'PREP' && this.attachToNoun(t, ctx, node)) {
        const save = this.i;
        const pp = this.parsePP();
        if (pp && pp.kind === 'pp' && pp.obj) { node.mods.push(pp); continue; }
        this.i = save;
        break;
      }
      // relative clause
      const relWord = ['who', 'whom', 'whose', 'which'].includes(t.lower) || (t.lower === 'that' && (t.pos === 'REL' || isNoun && (this.verbStart(1) || this.npThenFinite(1)))) ||
        (t.lower === 'where' && isNoun && this.clauseAhead(1)) || (t.lower === 'when' && isNoun && TIME_NOUNS.has(node.text.toLowerCase()) && this.clauseAhead(1)) ||
        (t.lower === 'why' && node.text.toLowerCase() === 'reason');
      if (relWord && t.pos !== 'WH' || relWord && ['who', 'whom', 'whose', 'which', 'where', 'when', 'why'].includes(t.lower) && (this.peek(-1).pos === 'NOUN' || this.peek(-1).pos === 'PROPN' || this.peek(-1).pos === 'PRON' || this.peek(-1).text === ',')) {
        const rc = this.parseRelClause(node);
        if (rc) { node.mods.push(rc); continue; }
      }
      if (t.pos === 'PREP' && ['which', 'whom', 'whose'].includes(this.peek(1).lower)) {
        const rc = this.parseRelClause(node);
        if (rc) { node.mods.push(rc); continue; }
      }
      // non-restrictive: ", who ..." / ", which ..."
      if (this.isComma() && ['who', 'whom', 'whose', 'which', 'where'].includes(this.peek(1).lower)) {
        const save = this.i;
        this.i++;
        const rc = this.parseRelClause(node);
        if (rc) { node.mods.push(rc); if (this.isComma() && ctx === 'subj') this.i++; continue; }
        this.i = save;
      }
      // contact clause: "the book I read"
      if (isNoun && t.pos === 'PRON' && (SUBJ_PRON.has(t.lower) || t.lower === 'you') && this.isFiniteTok(this.peek(1)) && ctx !== 'probe' && ctx !== 'pn') {
        const save = this.i;
        const rel = W('that', 'pronoun', { understood: true, relative: true });
        this.gap++;
        const cl = this.parseClause({ sub: true, noQuestion: true });
        this.gap--;
        if (cl && (ctx === 'subj' ? this.verbStart() || this.isEnd() : true)) {
          this.fillGap(cl, rel, 'nominal');
          node.mods.push({ kind: 'relclause', id: nid(), clause: cl, link: rel.id });
          continue;
        }
        this.i = save;
      }
      // participial phrase
      const pastPart = t.form === 'pastpp' && (this.peek(1).lower === 'by' || (isNoun && ctx === 'subj' && this.peek(1).pos === 'PREP' && !CLAUSE_VERBS.has(t.lemma || t.root) && this.laterFinite(2)));
      if (t.pos === 'VERB' && ((t.form === 'ing' && (isNoun || ctx !== 'subj')) || (t.form === 'pp' && isNoun) || pastPart)) {
        if (!(ctx === 'subj' && t.form === 'ing' && false)) {
          const save = this.i;
          const part = this.parseParticiple();
          if (part) { node.mods.push(part); continue; }
          this.i = save;
        }
      }
      if (t.pos === 'ADV' && /ly$/.test(t.lower) && this.peek(1).pos === 'VERB' && /pp|pastpp/.test(this.peek(1).form || '') && isNoun && ctx !== 'probe') {
        const save = this.i;
        const adv = W(this.next(), 'adverb');
        const part = this.parseParticiple();
        if (part) { verbWord(part.pred).mods.unshift(adv); node.mods.push(part); continue; }
        this.i = save;
      }
      // adjectival infinitive: "time to go", "nothing to fear"
      if (t.pos === 'TO' && (INF_NOUNS.has(node.text.toLowerCase()) || ctx === 'subj' || ctx === 'pn') && this.peek(1).pos === 'VERB') {
        const inf = this.parseInfinitive();
        if (inf) { node.mods.push(inf); continue; }
      }
      // appositive: "my brother, a doctor, ..."
      if (this.isComma() && ['DET', 'POSS', 'PROPN', 'NUM', 'ADJ', 'NOUN'].includes(this.peek(1).pos) && node.kind === 'word' && !node.appos) {
        const save = this.i;
        this.i++;
        const ap = this.parseNP(ctx === 'subj' ? 'subj' : 'obj');
        const closes = this.isComma() && !(this.peek(1).pos === 'CCONJ') && (ctx === 'subj' ? this.verbStart(1) : true) && !this.npStart(1);
        const ends = this.isEnd() && !this.isComma() && ctx !== 'subj';
        if (ap && ap.kind === 'word' && (closes || ends)) {
          node.appos = ap;
          if (closes && ctx === 'subj') this.i++;
          continue;
        }
        this.i = save;
      }
      // "someone special" handled; "the man himself"
      if (t.pos === 'PRON' && /self$|selves$/.test(t.lower) && ctx !== 'probe') {
        node.appos = W(this.next(), 'pronoun');
        continue;
      }
      break;
    }
  }

  attachToNoun(prepTok, ctx, node) {
    const p = prepTok.lower;
    if (p === 'of') return true;
    if (ctx === 'probe') return false;
    if (node.kind === 'word' && node.role === 'pronoun') return ['of'].includes(p) || (/^(some|any|no|every)(one|body|thing)$/.test(node.text.toLowerCase()) && ['in', 'from', 'with', 'about'].includes(p));
    if (ctx === 'subj' || ctx === 'pn' || ctx === 'wh') return !['than'].includes(p);
    if (ctx === 'obj') return ['about', 'from', 'with', 'like', 'without', 'in', 'on', 'for'].includes(p) && this.ppNounBias(node, p);
    if (ctx === 'pobj') return ['with', 'without', 'like'].includes(p) && false;
    return false;
  }

  ppNounBias(node, p) {
    // "a book about birds", "a house with a garden", "a letter from home", "the man in the moon"
    const head = (node.text || '').toLowerCase();
    if (p === 'about') return true;
    if (['book', 'story', 'letter', 'news', 'report', 'question', 'film', 'movie', 'song', 'poem', 'article', 'note', 'message', 'word', 'information', 'lesson', 'lecture', 'talk', 'tale', 'essay', 'map', 'picture', 'photo', 'painting', 'house', 'room', 'girl', 'boy', 'man', 'woman', 'people', 'person', 'one', 'cup', 'glass', 'bowl', 'box', 'bag', 'key', 'door', 'window', 'road', 'way', 'end', 'top', 'bottom', 'side'].includes(head)) return ['from', 'with', 'in', 'on', 'for', 'without', 'like'].includes(p);
    return false;
  }

  parsePP() {
    const start = this.i;
    const seq = this.matchSeq(MULTI_PREP);
    let prepText;
    if (seq) { prepText = this.t.slice(this.i, this.i + seq.length).map(t => t.text).join(' '); this.i += seq.length; }
    else prepText = this.next().text;
    const prep = W(prepText, 'preposition');
    let obj = null;
    const t = this.peek();
    if (t.pos === 'WH' || ['whoever', 'whatever', 'whomever'].includes(t.lower)) {
      obj = this.parseNounClause();
    }
    if (!obj && t.pos === 'REL' && t.lower === 'which') return null;
    if (!obj && this.npStart()) obj = this.parseNPList('pobj');
    if (!obj && t.pos === 'ADV' && ['now', 'then', 'here', 'there', 'home', 'today', 'tomorrow', 'yesterday', 'tonight', 'long', 'afar', 'above', 'below', 'ever'].includes(t.lower)) obj = W(this.next(), 'noun');
    if (!obj) {
      if (this.gap > 0 && (this.isEnd() || this.peek().pos === 'CCONJ' || this.isComma())) return { kind: 'pp', id: nid(), prep, obj: null, stranded: true };
      if (this.isEnd() || ['ADV', 'CCONJ', 'SCONJ', 'PREP', 'TO'].includes(this.peek().pos) || this.isComma()) return W(prepText, 'adverb');
      this.i = start;
      return null;
    }
    return { kind: 'pp', id: nid(), prep, obj };
  }

  // --- verbals ------------------------------------------------------------
  parseGerund() {
    const t = this.next();
    const verb = W(t, 'gerund');
    const pred = this.newPred(verb, { lemma: t.lemma || t.root, linking: (t.lemma || t.root) === 'be' || LINK_FULL.has(t.lemma || t.root), linkAdj: LINK_ADJ.has(t.lemma || t.root), passive: false, nested: true });
    while (this.peek().pos === 'PART') verb.text += ' ' + this.next().text;
    this.parseVPTail(pred);
    return { kind: 'gerund', id: nid(), pred, mods: [] };
  }

  parseInfinitive() {
    const start = this.i;
    let toText = null;
    if (this.peek().lower === 'in' && this.peek(1).lower === 'order' && this.peek(2).lower === 'to') { this.i += 2; toText = 'in order to'; }
    const to = this.next();
    if (toText) to.text = toText;
    const mods = [];
    while (this.peek().pos === 'ADV' || this.peek().pos === 'NEG') mods.push(W(this.next(), 'adverb'));
    const words = [];
    while (this.peek().pos === 'AUX' && ['be', 'have', 'been', 'being'].includes(this.peek().lower) && (this.peek(1).pos === 'VERB' || this.peek(1).pos === 'AUX')) words.push(this.next());
    const v = this.peek();
    if (v.pos !== 'VERB' && !(v.pos === 'AUX' && ['be', 'have', 'do'].includes(v.lower))) { this.i = start; return null; }
    words.push(this.next());
    while (this.peek().pos === 'PART') words.push(this.next());
    const main = words.filter(w => w.pos !== 'PART').pop();
    const lemma = (main.pos === 'AUX' ? main.lemma : (main.lemma || main.root || main.lower));
    const passive = words.length > 1 && words.some(w => w.lower === 'be' || w.lower === 'been') && /pp|past/.test(main.form || '');
    const verb = W(words.map(w => w.text).join(' '), 'verb', { mods });
    const pred = this.newPred(verb, { lemma, linking: lemma === 'be' && main.pos === 'AUX' || LINK_FULL.has(lemma) && !passive, linkAdj: LINK_ADJ.has(lemma) && !passive, passive, nested: true });
    this.parseVPTail(pred);
    return { kind: 'infinitive', id: nid(), to: W(to, 'preposition'), pred };
  }

  parseParticiple() {
    let pre = '';
    if (/^(having|being)$/.test(this.peek().lower) && this.peek(1).pos === 'VERB') pre = this.next().text + ' ';
    const t = this.next();
    const verb = W(pre + t.text, 'participle');
    while (this.peek().pos === 'PART') verb.text += ' ' + this.next().text;
    const lemma = t.lemma || t.root;
    const passive = t.form !== 'ing' && !/^having/i.test(pre);
    const pred = this.newPred(verb, { lemma, linking: lemma === 'be' || (LINK_FULL.has(lemma) && !passive), linkAdj: LINK_ADJ.has(lemma) && !passive, passive, nested: true });
    this.parseVPTail(pred);
    return { kind: 'participle', id: nid(), pred };
  }

  // --- clauses inside clauses ---------------------------------------------
  parseNounClause() {
    const save = this.i;
    const t = this.peek();
    if ((t.lower === 'that' && (t.pos === 'SCONJ' || this.clauseAhead(1))) || t.lower === 'whether' || t.lower === 'if') {
      this.i++;
      const conn = W(t, 'conjunction');
      let orNot = null;
      if (t.lower === 'whether' && this.peek().lower === 'or' && this.peek(1).lower === 'not') { this.i += 2; orNot = true; }
      const clause = this.parseClause({ sub: true, noQuestion: true });
      if (!clause) { this.i = save; return null; }
      if (orNot) conn.text = 'whether or not';
      else if (t.lower === 'whether' && this.peek().lower === 'or' && this.peek(1).lower === 'not') { this.i += 2; conn.text = 'whether…or not'; }
      return { kind: 'nounclause', id: nid(), connector: conn, clause };
    }
    if (t.pos === 'WH' || ['whoever', 'whatever', 'whichever', 'whomever', 'wherever', 'whenever'].includes(t.lower)) {
      // "how to swim", "what to do"
      if (this.peek(1).pos === 'TO') {
        const wh = this.next();
        const inf = this.parseInfinitive();
        if (inf) {
          const lw = wh.lower;
          const whn = W(wh, INTERJ_ADV_WH.has(lw) ? 'adverb' : 'pronoun', { wh: true });
          if (INTERJ_ADV_WH.has(lw)) inf.pred.verb.mods.unshift(whn);
          else if (!inf.pred.comp) { inf.pred.comp = whn; inf.pred.compType = 'do'; }
          else inf.pred.verb.mods.unshift(whn);
          return inf;
        }
        this.i = save;
        return null;
      }
      const { node, role } = this.buildWh();
      let clause;
      if (role === 'nominal' && this.verbStart() && !this.npStart()) {
        const vp = this.parseVPList();
        if (!vp) { this.i = save; return null; }
        clause = { kind: 'clause', id: nid(), subject: node, preds: vp.items, predConj: vp.conj, expletive: null };
      } else {
        this.gap++;
        clause = this.parseClause({ sub: true, noQuestion: true });
        this.gap--;
        if (!clause) { this.i = save; return null; }
        this.fillGap(clause, node, role);
      }
      return { kind: 'nounclause', id: nid(), connector: null, clause };
    }
    return null;
  }

  parseRelClause(antecedent) {
    const save = this.i;
    let t = this.peek();
    if (t.pos === 'PREP' && ['which', 'whom', 'whose'].includes(this.peek(1).lower)) {
      const prepTok = this.next();
      t = this.next();
      let rel = W(t, 'pronoun', { relative: true });
      let obj = rel;
      if (t.lower === 'whose') {
        const np = this.parseNP('obj');
        if (!np) { this.i = save; return null; }
        np.mods.unshift(W(t, 'possessive', { relative: true }));
        rel = np.mods[0];
        obj = np;
      }
      const pp = { kind: 'pp', id: nid(), prep: W(prepTok, 'preposition'), obj };
      const clause = this.parseClause({ sub: true, noQuestion: true });
      if (!clause) { this.i = save; return null; }
      const vw = clause.preds[0].verb.kind === 'compound' ? clause.preds[0].verb.items[0] : clause.preds[0].verb;
      vw.mods.unshift(pp);
      return { kind: 'relclause', id: nid(), clause, link: rel.id };
    }
    this.i++;
    const lw = t.lower;
    if (lw === 'whose') {
      const rel = W(t, 'possessive', { relative: true });
      const np = this.parseNP('obj');
      if (!np || np.kind !== 'word') { this.i = save; return null; }
      np.mods.unshift(rel);
      let clause;
      if (this.verbStart() && !this.npStart()) {
        const vp = this.parseVPList();
        if (!vp) { this.i = save; return null; }
        clause = { kind: 'clause', id: nid(), subject: np, preds: vp.items, predConj: vp.conj, expletive: null };
      } else {
        this.gap++;
        clause = this.parseClause({ sub: true, noQuestion: true });
        this.gap--;
        if (!clause) { this.i = save; return null; }
        this.fillGap(clause, np, 'nominal');
      }
      return { kind: 'relclause', id: nid(), clause, link: rel.id };
    }
    if (['where', 'when', 'why'].includes(lw)) {
      const rel = W(t, 'adverb', { relative: true });
      const clause = this.parseClause({ sub: true, noQuestion: true });
      if (!clause) { this.i = save; return null; }
      const vw = clause.preds[0].verb.kind === 'compound' ? clause.preds[0].verb.items[0] : clause.preds[0].verb;
      vw.mods.unshift(rel);
      return { kind: 'relclause', id: nid(), clause, link: rel.id };
    }
    const rel = W(t, 'pronoun', { relative: true });
    let clause;
    if (this.verbStart() && !this.npStart() || (this.peek().pos === 'VERB' && this.peek().form !== 'ing')) {
      const vp = this.parseVPList();
      if (!vp) { this.i = save; return null; }
      clause = { kind: 'clause', id: nid(), subject: rel, preds: vp.items, predConj: vp.conj, expletive: null };
    } else {
      this.gap++;
      clause = this.parseClause({ sub: true, noQuestion: true });
      this.gap--;
      if (!clause) { this.i = save; return null; }
      this.fillGap(clause, rel, 'nominal');
    }
    void antecedent;
    return { kind: 'relclause', id: nid(), clause, link: rel.id };
  }

  parseAdvClause() {
    const save = this.i;
    const seq = this.matchSeq(MULTI_SCONJ);
    let conjText;
    if (seq) { conjText = this.t.slice(this.i, this.i + seq.length).map(t => t.text).join(' '); this.i += seq.length; }
    else conjText = this.next().text;
    const conj = W(conjText, 'conjunction');
    const afterConj = this.i;
    const clause = this.parseClause({ sub: true, noQuestion: true });
    if (clause && clause.preds.length && !clause.subject.understood) return { kind: 'advclause', id: nid(), conj, clause };
    // elliptical: "while walking home", "when finished", "if possible", "as a child"
    this.i = afterConj;
    const t = this.peek();
    if (t.pos === 'VERB' && (t.form === 'ing' || /pp|past/.test(t.form))) {
      const part = this.parseParticiple();
      if (part) return { kind: 'pp', id: nid(), prep: conj, obj: { kind: 'gerund', id: nid(), pred: part.pred, mods: [] }, elliptical: true };
    }
    if (t.pos === 'ADJ') {
      const adj = this.parseAdjPhrase();
      if (adj) return { kind: 'pp', id: nid(), prep: conj, obj: adj, elliptical: true };
    }
    if (this.npStart()) {
      const np = this.parseNPList('pobj');
      if (np) return { kind: 'pp', id: nid(), prep: conj, obj: np, elliptical: true };
    }
    this.i = save;
    return null;
  }
}

function parseOnce(tokens, end) {
  // a parenthesis is set apart and diagrammed on its own
  const main = [], paren = [];
  let depth = 0, cur = null;
  for (const t of tokens) {
    if (t.pos === 'PUNCT' && t.text === '(') { depth++; if (depth === 1) { cur = []; paren.push(cur); } continue; }
    if (t.pos === 'PUNCT' && t.text === ')') { depth = Math.max(0, depth - 1); continue; }
    (depth > 0 ? cur : main).push(t);
  }
  const p = new Parser(main);
  const s = p.parseSentence(end);
  if (s && paren.length) {
    s.parens = [];
    for (const toks of paren) {
      const q = new Parser(toks);
      const f = q.parseFragment();
      if (f) s.parens.push(f);
      while (!q.done) { if (q.isPunct()) { q.i++; continue; } const g = q.parseFragment(); if (g) s.parens.push(g); else s.parens.push(W(q.next(), 'word')); }
    }
  }
  return s;
}

function badness(s, flips) {
  if (!s) return 1000;
  let b = flips * 2;
  const looseWords = (s.loose || []).reduce((n, x) => n + countWords(x), 0);
  b += looseWords * 6;
  if (s.fragment) b += 14;
  for (const c of s.clauses || []) {
    if (c.floating) b += 4;
    if (c.subject && c.subject.understood && s.clauses.indexOf(c) === 0 && s.type !== 'exclamatory') b += 3;
  }
  return b;
}
function countWords(n) {
  let k = 0;
  const seen = new Set();
  (function go(x) {
    if (!x || typeof x !== 'object' || seen.has(x)) return;
    seen.add(x);
    if (x.kind === 'word' && x.text) k += x.text.split(' ').length;
    for (const v of Object.values(x)) if (v && typeof v === 'object') go(v);
  })(n);
  return k;
}

// Re-read words whose part of speech is genuinely doubtful, and keep the cleanest parse.
function alternatives(t) {
  const alts = [];
  if (t.pos === 'PUNCT' || t.userPos) return alts;
  if (t.pos === 'NOUN' && canBeVerb(t)) alts.push('VERB');
  if (t.pos === 'VERB' && (t.tags.has('Noun') || /Noun|Plural|Singular/.test(t.sw)) && t.form !== 'ing') alts.push('NOUN');
  if (t.pos === 'ADJ' && canBeVerb(t)) alts.push('VERB');
  if (t.pos === 'VERB' && /pastpp|past/.test(t.form || '') && (t.tags.has('Adjective') || /Adj/.test(t.sw))) alts.push('ADJ');
  if (t.pos === 'PREP' && t.lower === 'like') alts.push('VERB');
  if (t.pos === 'VERB' && t.lower === 'like') alts.push('PREP');
  if (t.pos === 'NOUN' && /Adj/.test(t.sw)) alts.push('ADJ');
  if (t.pos === 'ADJ' && /Noun/.test(t.sw)) alts.push('NOUN');
  return alts;
}

function variants(tokens) {
  const singles = [];
  tokens.forEach((t, i) => { for (const a of alternatives(t)) singles.push([i, a]); });
  const out = [];
  for (const [i, a] of singles.slice(0, 14)) out.push({ forced: { [i]: a }, cost: tokens[i].lower === 'like' ? 2 : 1 });
  const few = singles.slice(0, 8);
  for (let x = 0; x < few.length; x++) for (let y = x + 1; y < few.length; y++) {
    if (few[x][0] === few[y][0]) continue;
    out.push({ forced: { [few[x][0]]: few[x][1], [few[y][0]]: few[y][1] }, cost: 2.5 });
  }
  return out.slice(0, 48);
}

export function parseSentence(tokens, end) {
  try {
    let best = parseOnce(tokens, end);
    let bestScore = badness(best, 0);
    if (bestScore > 0) {
      for (const v of variants(tokens)) {
        let s;
        try { s = parseOnce(retag(tokens, v.forced), end); } catch (e) { continue; }
        const sc = badness(s, v.cost);
        if (sc < bestScore) { best = s; bestScore = sc; }
      }
    }
    return best;
  } catch (e) {
    console.error(e);
    return { kind: 'sentence', id: nid(), clauses: [], conjs: [], interjections: [], vocatives: [], loose: tokens.filter(t => t.pos !== 'PUNCT').map(t => W(t, 'word')), type: 'declarative', error: String(e) };
  }
}

// A compact bracketed rendering, used by the tests.
export function show(n) {
  if (!n) return '∅';
  const ms = mods => (mods && mods.length ? '{' + mods.map(show).join(', ') + '}' : '');
  switch (n.kind) {
    case 'sentence': {
      let s = n.clauses.map(show).join(n.conjs.length ? ` ‖${n.conjs.join('|')}‖ ` : '');
      if (n.fragment) s = 'FRAG(' + show(n.fragment) + ')';
      const extras = [];
      if (n.interjections.length) extras.push('INTJ:' + n.interjections.map(show).join(','));
      if (n.vocatives.length) extras.push('VOC:' + n.vocatives.map(show).join(','));
      if (n.loose.length) extras.push('LOOSE:' + n.loose.map(show).join(','));
      if (n.tag) extras.push('TAG:' + n.tag);
      return (extras.length ? '[' + extras.join(' ') + '] ' : '') + s;
    }
    case 'clause': {
      const preds = n.preds.map(show).join(n.predConj ? ` &${n.predConj}& ` : ' && ');
      return `⟨${n.expletive ? 'EX:' + n.expletive.text + ' ' : ''}${show(n.subject)} ‖ ${preds}${n.floating ? ' ~' + show(n.floating) : ''}⟩`;
    }
    case 'word': return (n.understood ? '(' + n.text + ')' : n.text) + (n.appos ? `(=${show(n.appos)})` : '') + ms(n.mods);
    case 'compound': return '[' + n.items.map(show).join(` ${n.conj} `) + ']';
    case 'gerund': return 'GER(' + showPred(n.pred) + ')' + ms(n.mods);
    case 'infinitive': return 'INF(' + (n.to ? 'to ' : '') + showPred(n.pred) + ')';
    case 'nounclause': return 'NC(' + (n.connector ? n.connector.text + ': ' : '') + show(n.clause) + ')';
    case 'pp': return 'PP(' + (n.prep ? n.prep.text : '·') + ' ' + show(n.obj) + ')';
    case 'participle': return 'PART(' + showPred(n.pred) + ')';
    case 'relclause': return 'REL(' + show(n.clause) + ')';
    case 'advclause': return 'ADV(' + n.conj.text + ': ' + show(n.clause) + ')';
    default: if (n.verb) return showPred(n); return '?' + JSON.stringify(n).slice(0, 40);
  }
}
function showPred(p) {
  let s = show(p.verb);
  if (p.io) s += ' IO:' + show(p.io);
  if (p.comp) s += ` ${p.compType === 'do' ? '|' : '\\'} ` + show(p.comp);
  if (p.oc) s += ' \\OC ' + show(p.oc);
  return s;
}
