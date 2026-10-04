// Diagrammatic — the tagger.
// compromise supplies a first guess at each word's part of speech; a closed-class
// lexicon and a pass of contextual rules then correct it into the coarse tags the
// parser works with:
//   DET POSS PRON WH AUX MODAL NEG PREP TO CCONJ SCONJ INTJ ADV ADJ NOUN PROPN NUM
//   VERB PART EX THAN PUNCT

import nlp from '../vendor/compromise.mjs';

const MODEL = nlp.model();
const SWITCHES = (MODEL.two && MODEL.two.switches) || {};
const LEXICON = (MODEL.one && MODEL.one.lexicon) || {};

const CLOSED = {};
const L = (pos, words) => words.split(/\s+/).forEach(w => { if (w) CLOSED[w] = pos; });
L('DET', 'the a an every each another no');
L('DETPRON', 'this that these those all some any both either neither many much few several enough such half');
L('WHDET', 'what which whose whatever whichever');
L('POSS', 'my your our their its');
L('POSSPRON', 'his her');
L('PRON', `i me you he him she it we us they them myself yourself himself herself itself ourselves
  yourselves themselves oneself mine yours hers ours theirs someone somebody something anyone anybody
  anything everyone everybody everything nobody nothing none whoever whomever thee thou ye`);
L('WH', 'who whom how why where when');
L('BE', 'be am is are was were been being art');
L('HAVE', 'have has had having hath');
L('DO', 'do does did doth');
L('MODAL', 'will would shall should can could may might must ought wilt shalt');
L('NEG', 'not never');
L('PREP', `about above across against along amid amidst among amongst around at behind below beneath beside
  besides between beyond by concerning despite during except from inside into of onto outside per regarding
  through throughout toward towards under underneath unto upon via with within without amongst atop`);
L('PREPX', 'after before since until till as');
L('PREPADV', 'in on off out up down over past near');
L('CCONJ', 'and or nor but');
L('CCX', 'for so yet');
L('SCONJ', 'because although though if unless while whilst whereas whether lest whenever wherever');
L('INTJ', `oh o ah alas hurrah hurray hooray wow ouch oops hey hello hi bravo ha aha hush lo eh phew ugh yay
  goodbye farewell amen huzzah pshaw fie egad ahoy hark`);
L('ADV', `very too quite rather always often sometimes seldom rarely soon now then here already still just only
  even also almost nearly perhaps maybe ago away again ever twice everywhere somewhere anywhere nowhere forth
  hence thus therefore however indeed else together alone abroad ahead apart aside later yesterday today
  tomorrow tonight please hither thither thence whence afterward afterwards meanwhile instead quickly slowly
  barely hardly scarcely merely nevertheless nonetheless otherwise somewhat sometime anyway anyhow downstairs
  upstairs overseas backward backwards forward forwards homeward onward outdoors indoors herein hereby hereof hereto
  hereafter heretofore therein thereby thereof thereto thereafter thereupon whereof whereby wherein hitherto`);

// Verbs whose base form follows "to" or a modal in ways compromise often misreads.
const MOTION = new Set('go goes went gone going come comes came coming return returns returned walk walked ran run runs drove drive driven rode ride flew fly sent send take took taken bring brought get got head headed hurried hurry rushed rush moved move'.split(' '));

const BE_FORMS = new Set('be am is are was were been being art'.split(' '));
const SUBJ_PRON = new Set('i you he she it we they thou ye'.split(' '));
const MONTHS = new Set('january february march april may june july august september october november december monday tuesday wednesday thursday friday saturday sunday'.split(' '));

const IRREG_PAST = new Set(`went saw ate took gave wrote ran came began drank sang swam rang drove rode spoke broke chose
  froze stole wore tore threw grew knew flew drew blew did was were fell forgot hid rose shook woke beat bit bore showed
  swore forgave forbade arose awoke sank shrank sprang stank strove strode`.split(/\s+/));
const IRREG_PP = new Set(`gone seen eaten taken given written begun drunk sung swum rung driven ridden spoken broken chosen
  frozen stolen worn torn thrown grown known flown drawn blown done been fallen forgotten gotten hidden risen shaken woken
  beaten bitten born borne shown sworn mistaken forgiven forbidden arisen awoken sunk shrunk sprung stunk striven
  stridden proven laden molten sewn sown swollen hewn mown`.split(/\s+/));

const NOT_ING = new Set('bring sing ring sting string spring swing wring cling fling sling king thing wing ping ding during nothing something anything everything morning evening ceiling'.split(' '));
const BARE_PP_NOUNS = new Set('school bed church work town market dinner lunch breakfast supper sea heaven hell college class court prison jail hospital war sleep home camp mass office chapel shore land port bed university parliament congress table'.split(' '));
const OBJ_PRON = new Set('me him her us them'.split(' '));
const isUnknown = w => !LEXICON[w] && !SWITCHES[w];

function ingStems(w) {
  const st = w.replace(/ing$/, '');
  const out = [st, st + 'e'];
  if (/(.)\1$/.test(st)) out.push(st.slice(0, -1));
  if (/y$/.test(st)) out.push(st.slice(0, -1) + 'ie');
  return out;
}

function isVerbRoot(r) {
  const lx = LEXICON[r];
  const lxs = Array.isArray(lx) ? lx.join(',') : (lx || '');
  return /Infinitive|PresentTense|PastTense/.test(lxs) || /Verb/.test(SWITCHES[r] || '');
}

const IRREG_LEMMA = Object.fromEntries(`seen:see saw:see known:know knew:know said:say told:tell found:find given:give gave:give taken:take
  took:take made:make thought:think felt:feel heard:hear held:hold kept:keep left:leave written:write wrote:write gone:go went:go done:do
  did:do brought:bring bought:buy taught:teach caught:catch meant:mean met:meet sent:send spent:spend stood:stand understood:understand
  begun:begin began:begin born:bear borne:bear chosen:choose chose:choose spoken:speak spoke:speak broken:break broke:break
  forgotten:forget forgot:forget drawn:draw drew:draw shown:show grown:grow grew:grow thrown:throw threw:throw laid:lay paid:pay
  sold:sell sat:sit led:lead fed:feed fell:fall fallen:fall became:become came:come ran:run`.split(/\s+/).map(p => p.split(':')));

function capFirst(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Split raw text into sentences of tokens.
export function tagText(text, overrides = {}) {
  const clean = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const doc = nlp(clean);
  doc.compute('root');
  const json = doc.json({ terms: { text: true, normal: true, implicit: true, tags: true, root: true, pre: true, post: true } });
  const sentences = [];
  json.forEach((sen, si) => {
    const toks = [];
    let raw = '';
    const terms = sen.terms;
    for (let ti = 0; ti < terms.length; ti++) {
      let t = terms[ti];
      // compromise splits "self-evident" in two; join hyphenated words back into one
      while (t.post === '-' && terms[ti + 1] && !terms[ti + 1].pre && terms[ti + 1].text) {
        const nx = terms[ti + 1];
        t = { ...nx, text: `${t.text}-${nx.text}`, normal: `${t.normal || t.text}-${nx.normal || nx.text}`.toLowerCase(), implicit: undefined, pre: t.pre, root: undefined };
        ti++;
      }
      const nx = terms[ti + 1], nx2 = terms[ti + 2];
      if (t.implicit && /^[A-Za-z]+['’]s$/.test(t.text || '') && nx && !nx.text && /^(is|has)$/.test(nx.implicit || '') && nx2 &&
        !/^(it|that|what|there|here|he|she|who|let|where|how|when|why|this|everyone|everybody|someone|somebody|nobody|one)$/i.test(t.implicit) &&
        (nx2.tags || []).some(g => ['Noun', 'Adjective', 'Value', 'Possessive'].includes(g)) && !(nx2.tags || []).some(g => ['Verb', 'Determiner', 'Adverb', 'Pronoun', 'Preposition', 'Comparable'].includes(g) && g !== 'Noun') ) {
        raw += (t.pre || '') + t.text + (nx.post || t.post || '');
        toks.push({ text: t.text.replace('’', "'"), orig: t.text, lower: t.text.toLowerCase().replace('’', "'"), tags: new Set(['Noun', 'Possessive']), root: t.implicit.toLowerCase(), sw: '', pos: null });
        const post = (nx.post || '').replace(/\s/g, '');
        for (const ch of post) if (',;:—)'.includes(ch)) toks.push(punct(ch));
        ti++;
        continue;
      }
      raw += (t.pre || '') + (t.text || '') + (t.post || '');
      const pre = (t.pre || '').replace(/\s/g, '');
      for (const ch of pre) if ('(—'.includes(ch)) toks.push(punct(ch));
      let word = t.implicit || t.text;
      if (!word) continue;
      if (t.implicit && t.text && /^[A-Z]/.test(t.text) && !/^[A-Z]/.test(word)) word = capFirst(word);
      if (t.implicit === 'us' && /^let'?s$/i.test(t.text || '')) word = 'us';
      word = word.replace(/^["'(]+|["')]+$/g, '');
      if (!word) continue;
      toks.push({
        text: word,
        orig: t.text || '',
        lower: word.toLowerCase(),
        tags: new Set(t.tags || []),
        root: (t.root || t.normal || word).toLowerCase(),
        sw: SWITCHES[(t.normal || word).toLowerCase()] || '',
        pos: null,
      });
      const post = (t.post || '').replace(/\s/g, '');
      for (let k = 0; k < post.length; k++) {
        const ch = post[k];
        if (ch === '-' && post[k + 1] === '-') { toks.push(punct('—')); k++; continue; }
        if (',;:—–)'.includes(ch)) toks.push(punct(ch === '–' ? '—' : ch));
      }
    }
    const end = (raw.trim().match(/([.?!]+)["')\]]*$/) || [, '.'])[1];
    mergeIdioms(toks);
    toks.forEach((t, i) => { t.i = i; });
    // user corrections, keyed "<sentence>:<word index>", are fixed before context is read
    let wi = 0;
    for (const t of toks) {
      if (t.pos === 'PUNCT') continue;
      t.wi = wi;
      const o = overrides[`${si}:${wi}`];
      if (o) t.userPos = o;
      wi++;
    }
    assignPOS(toks);
    sentences.push({ tokens: toks, end, raw: raw.trim() });
  });
  return sentences;
}

// fixed phrases that act as a single word
const IDIOMS = [['as well as', 'CCONJ'], ['as many as', 'ADV'], ['as much as', 'ADV'], ['from time to time', 'ADV'], ['each other', 'PRON'], ['one another', 'PRON'], ['at last', 'ADV'], ['of course', 'ADV'],
  ['at least', 'ADV'], ['in fact', 'ADV'], ['by and by', 'ADV'], ['now and then', 'ADV'], ['once upon a time', 'ADV'], ['for ever', 'ADV']];
function mergeIdioms(toks) {
  for (let i = 0; i < toks.length; i++) {
    // "a far, far better thing": a word doubled for emphasis is one adverb
    const a = toks[i], c = toks[i + 1], b = toks[i + 2];
    if (a && b && c && c.text === ',' && a.lower === b.lower && /^(far|very|long|so|much)$/.test(a.lower)) {
      toks.splice(i, 3, { text: `${a.text}, ${b.text}`, orig: `${a.orig}, ${b.orig}`, lower: `${a.lower}, ${b.lower}`, tags: new Set(['Adverb']), root: a.lower, sw: '', pos: null, fixed: 'ADV' });
      continue;
    }
    for (const [phrase, pos] of IDIOMS) {
      const ws = phrase.split(' ');
      if (ws.every((w, k) => toks[i + k] && toks[i + k].pos !== 'PUNCT' && toks[i + k].lower === w)) {
        const parts = toks.splice(i, ws.length);
        toks.splice(i, 0, { text: parts.map(p => p.text).join(' '), orig: parts.map(p => p.orig).join(' '), lower: phrase, tags: new Set([pos === 'PRON' ? 'Pronoun' : 'Adverb']), root: phrase, sw: '', pos: null, fixed: pos });
        break;
      }
    }
  }
}

function punct(ch) { return { text: ch, lower: ch, pos: 'PUNCT', tags: new Set(), root: ch, sw: '' }; }

// --- user overrides --------------------------------------------------------
export const OVERRIDE_CHOICES = [
  ['NOUN', 'Noun'], ['PRON', 'Pronoun'], ['VERB', 'Verb'], ['AUX', 'Auxiliary verb'], ['ADJ', 'Adjective'],
  ['DET', 'Article'], ['ADV', 'Adverb'], ['PREP', 'Preposition'], ['CCONJ', 'Conjunction (co-ord.)'],
  ['SCONJ', 'Conjunction (subord.)'], ['INTJ', 'Interjection'],
];

function applyOverride(t, pos) {
  t.userPos = pos;
  t.pos = pos;
  if (pos === 'VERB') t.form = t.forceForm || guessForm(t);
  if (pos === 'AUX') t.lemma = auxLemma(t.lower) || t.root;
}

// Re-read a sentence with some words' parts of speech held fixed, letting the
// context rules settle the rest around them.  forced: { tokenIndex: pos }
export function retag(tokens, forced) {
  const toks = tokens.map(t => {
    const c = { ...t };
    if (c.pos !== 'PUNCT') { c.pos = null; delete c.form; delete c.lemma; delete c.participle; delete c.gerundNoun; }
    return c;
  });
  for (const [k, pos] of Object.entries(forced)) toks[k].userPos = pos;
  assignPOS(toks);
  return toks;
}

function auxLemma(w) {
  if (BE_FORMS.has(w)) return 'be';
  if (CLOSED[w] === 'HAVE') return 'have';
  if (CLOSED[w] === 'DO') return 'do';
  return null;
}

function guessForm(t) {
  const w = t.lower;
  if (t.tags.has('Gerund') || (/ing$/.test(w) && w.length >= 5 && !NOT_ING.has(w))) return 'ing';
  if (IRREG_PP.has(w)) return 'pp';
  if (IRREG_PAST.has(w)) return 'past';
  if (t.tags.has('Participle') && /(en|wn|ne|rn)$/.test(w)) return 'pp';
  if (t.tags.has('PastTense') || /ed$/.test(w)) return 'pastpp';
  if (t.tags.has('PresentTense') && /[^s]s$/.test(w) && !t.tags.has('Infinitive')) return 'pres3';
  return 'base';
}

export function canBeVerb(t) {
  if (!t || !t.tags) return false;
  if (t.pos === 'VERB') return true;
  if (['DET', 'POSS', 'PRON', 'PUNCT', 'CCONJ', 'MODAL', 'WH', 'NUM', 'TO', 'INTJ', 'EX'].includes(t.pos)) return false;
  if (t.tags.has('Verb')) return true;
  if (/Verb|Past|Present/.test(t.sw)) return true;
  const lx = LEXICON[t.lower];
  const lxs = Array.isArray(lx) ? lx.join(',') : (lx || '');
  if (/Infinitive|PastTense|PresentTense|Gerund|Participle/.test(lxs)) return true;
  if (t.pos === 'PREP' && t.lower === 'like') return true;
  if (IRREG_PAST.has(t.lower) || IRREG_PP.has(t.lower)) return true;
  return false;
}

function canBeNoun(t) {
  if (!t || !t.tags) return false;
  if (t.pos === 'NOUN' || t.pos === 'PROPN') return true;
  if (t.tags.has('Noun') && !t.tags.has('Pronoun')) return true;
  return /Noun/.test(t.sw);
}

// --- POS assignment --------------------------------------------------------
function basePOS(t) {
  if (t.fixed) return t.fixed;
  const w = t.lower;
  const c = CLOSED[w];
  const tg = t.tags;
  if (w === 'to') return 'TO';
  if (w === 'than') return 'THAN';
  if (w === 'there') return 'EX';
  if (w === 'like') return tg.has('Verb') ? 'VERB' : 'PREP';
  if (c === 'BE' || c === 'HAVE' || c === 'DO') { t.lemma = auxLemma(w); return 'AUX'; }
  if (c) return c;
  if (tg.has('Expression')) return 'INTJ';
  if (tg.has('QuestionWord')) return 'WH';
  if (tg.has('Pronoun')) return tg.has('Possessive') ? 'POSS' : 'PRON';
  if (tg.has('Possessive')) return 'POSS';
  if (tg.has('Determiner')) return 'DET';
  if (tg.has('Modal')) return 'MODAL';
  if (tg.has('Copula')) { t.lemma = 'be'; return 'AUX'; }
  if (tg.has('Negative')) return 'NEG';
  if (tg.has('Particle')) return 'PART';
  if (tg.has('Preposition')) return 'PREP';
  if (tg.has('Conjunction')) return 'CCONJ';
  if (tg.has('Verb')) return 'VERB';
  if (tg.has('Adverb')) return 'ADV';
  if (tg.has('Ordinal')) return 'ADJ';
  if (tg.has('Value') || tg.has('Cardinal') || tg.has('NumericValue') || /^\d[\d,.]*$/.test(w)) return 'NUM';
  if (tg.has('Adjective') || tg.has('Comparable')) return 'ADJ';
  if (tg.has('ProperNoun')) return 'PROPN';
  if (MONTHS.has(w) && /^[A-Z]/.test(t.text)) return 'PROPN';
  if (tg.has('Noun')) return /^[A-Z]/.test(t.text) && t.i > 0 ? 'PROPN' : 'NOUN';
  if (/ly$/.test(w) && w.length > 4) return 'ADV';
  if (/^[A-Z]/.test(t.text) && t.i > 0) return 'PROPN';
  return 'NOUN';
}

const isWord = t => t && t.pos !== 'PUNCT';

function assignPOS(toks) {
  for (const t of toks) {
    if (t.pos === 'PUNCT') continue;
    if (t.userPos) { applyOverride(t, t.userPos); continue; }
    t.pos = basePOS(t);
    if (t.pos === 'VERB') t.form = guessForm(t);
  }
  const P = i => toks[i] || { pos: 'EOF', lower: '', tags: new Set(), sw: '' };

  // Looks like a clause (subject + finite verb) begins at j?
  const clauseAt = j => {
    const a = P(j);
    if (a.pos === 'PRON' && SUBJ_PRON.has(a.lower)) return true;
    if (a.pos === 'EX') return true;
    for (let k = j; k < j + 6 && k < toks.length; k++) {
      const x = P(k);
      if (x.pos === 'PUNCT' || x.pos === 'PREP' || x.pos === 'CCONJ' || x.pos === 'TO') return false;
      if (k > j && x.pos === 'PRON' && SUBJ_PRON.has(x.lower)) return false;
      if (k > j && (x.pos === 'AUX' || x.pos === 'MODAL' || (x.pos === 'VERB' && x.form !== 'ing'))) return true;
      if (!['DET', 'POSS', 'ADJ', 'NOUN', 'PROPN', 'NUM', 'DETPRON', 'POSSPRON', 'PRON', 'ADV', 'WHDET'].includes(x.pos)) return false;
    }
    return false;
  };
  const nounish = x => ['NOUN', 'PROPN', 'ADJ', 'NUM'].includes(x.pos) || (x.pos === 'VERB' && x.form === 'ing' && canBeNoun(x));

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.pos === 'PUNCT' || t.userPos) continue;
      const prev = P(i - 1), next = P(i + 1), next2 = P(i + 2);
      const w = t.lower;
      const sentenceStart = i === 0 || ['CCONJ', 'SCONJ'].includes(prev.pos) || (prev.pos === 'PUNCT' && prev.text !== ')');

      switch (t.pos) {
        case 'DETPRON':
          if (w === 'that' && (/^(all|everything|something|anything|nothing|those|someone|anyone|everyone)$/.test(prev.lower)) && i > 0) { t.pos = 'REL'; break; }
          if (w === 'that' && ['NOUN', 'PROPN'].includes(prev.pos) && ['PROPN', 'PRON', 'DET', 'POSS', 'VERB', 'AUX', 'MODAL', 'ADV', 'NEG'].includes(next.pos) && !(next.pos === 'PRON' && OBJ_PRON.has(next.lower) && next.lower !== 'her')) { t.pos = 'REL'; break; }
          t.pos = (nounish(next) || (next.pos === 'ADV' && nounish(next2)) || next.pos === 'POSS' || (next.pos === 'DET' && ['all', 'both', 'half'].includes(w))) ? 'DET' : 'PRON';
          if (w === 'such') t.pos = 'ADJ';
          break;
        case 'WHDET':
          t.pos = 'WH';
          break;
        case 'POSSPRON': {
          // her/his: possessive before a noun phrase, otherwise a pronoun
          const np = nounish(next) || (next.pos === 'ADV' && nounish(next2)) || next.pos === 'DETPRON';
          const verbNext = next.pos === 'VERB' && next.form !== 'ing';
          t.pos = np && !verbNext && next.pos !== 'DET' ? 'POSS' : 'PRON';
          break;
        }
        case 'PREPX': {
          if (w === 'as' && next.pos === 'ADJ' || w === 'as' && next.pos === 'ADV') { t.pos = 'ADV'; break; }
          t.pos = clauseAt(i + 1) ? 'SCONJ' : 'PREP';
          break;
        }
        case 'PREPADV': {
          const npNext = nounish(next) || ['DET', 'POSS', 'PRON', 'NUM', 'DETPRON', 'POSSPRON'].includes(next.pos);
          if (t.tags.has('Particle') && (prev.pos === 'VERB' || prev.pos === 'AUX')) {
            t.pos = !npNext || (/^(up|down|out|off|away|back|on|over)$/.test(w) && next.pos !== 'PROPN') ? 'PART' : 'PREP';
          } else if (prev.pos === 'VERB' && !nounish(next) && !['DET', 'POSS', 'PRON', 'NUM'].includes(next.pos) && next.pos !== 'DETPRON') t.pos = 'PART';
          else t.pos = 'PREP';
          break;
        }
        case 'CCX':
          if (w === 'so' && next.lower === 'that') { t.pos = 'SCONJ'; break; }
          if (w === 'so' && (next.pos === 'ADJ' || next.pos === 'ADV' || next.lower === 'many' || next.lower === 'much')) { t.pos = 'ADV'; break; }
          if ((prev.pos === 'PUNCT' || i === 0 || w === 'yet' || w === 'so') && clauseAt(i + 1)) { t.pos = 'CCONJ'; break; }
          t.pos = w === 'for' ? 'PREP' : 'ADV';
          break;
        case 'EX': {
          const nb = next.pos === 'AUX' && next.lemma === 'be' || next.pos === 'MODAL' ||
            (next.pos === 'VERB' && /^(seem|seems|seemed|appear|appears|appeared|exist|exists|existed|remain|remains|remained|lived|live|lives|came|come|stood|stands|stand|arose|was|were|goes|went)$/.test(next.lower));
          t.pos = (sentenceStart || prev.pos === 'AUX' || prev.pos === 'MODAL') && nb ? 'EX' : 'ADV';
          if (t.pos === 'ADV' && prev.pos === 'AUX' && prev.lemma === 'be' && i > 0 && (P(i - 2).pos === 'PUNCT' || i === 1)) t.pos = 'EX'; // "Is there ...?"
          break;
        }
        case 'TO': {
          let j = i + 1;
          while (P(j).pos === 'ADV' && !['very'].includes(P(j).lower)) j++;
          const v = P(j);
          const unknownVerb = v.pos === 'NOUN' && isUnknown(v.lower) && !/s$/.test(v.lower) && !BARE_PP_NOUNS.has(v.lower) && !['NOUN', 'PROPN'].includes(P(j + 1).pos);
          const verbish = unknownVerb || v.pos === 'VERB' && v.form !== 'pastpp' && v.form !== 'past' || v.pos === 'AUX' && (v.lower === 'be' || v.lower === 'have' || v.lower === 'do') ||
            (canBeVerb(v) && !['DET', 'POSS', 'PROPN'].includes(v.pos) && v.pos !== 'ADJ' && !(v.pos === 'NOUN' && /s$/.test(v.lower) && !v.tags.has('Verb')));
          const motionPrev = toks.slice(Math.max(0, i - 3), i).some(x => MOTION.has(x.lower));
          if (verbish && !(motionPrev && v.pos === 'NOUN' && !v.tags.has('Verb')) && !(BARE_PP_NOUNS.has(v.lower) && v.pos === 'NOUN')) {
            t.pos = 'TO';
            if (v.pos !== 'AUX') { v.pos = 'VERB'; v.form = 'base'; }
          } else t.pos = 'PREP';
          break;
        }
        case 'INTJ':
          break;
        case 'NOUN':
        case 'PROPN':
          // a gerund that compromise has filed as a noun: "Swimming is fun"
          if (t.pos === 'NOUN' && /ing$/.test(w) && !NOT_ING.has(w) && !['DET', 'POSS', 'ADJ', 'NUM'].includes(prev.pos) && ingStems(w).some(isVerbRoot)) { t.pos = 'VERB'; t.form = 'ing'; break; }
          if (i === 0 && canBeVerb(t) && !t.tags.has('Plural') && !(t.pos === 'PROPN' && t.tags.has('Person')) && ['DET', 'POSS', 'NEG', 'WH', 'DETPRON', 'POSSPRON'].includes(next.pos) || (i === 0 && canBeVerb(t) && next.pos === 'PRON' && OBJ_PRON.has(next.lower))) { t.pos = 'VERB'; t.form = 'base'; break; }
          // "four score", "the run" are nouns; "they book flights" is a verb
          if (t.pos === 'NOUN' && prev.pos === 'PRON' && SUBJ_PRON.has(prev.lower) && canBeVerb(t) && !t.tags.has('Plural')) { t.pos = 'VERB'; t.form = guessForm(t); }
          if (t.pos === 'NOUN' && (prev.pos === 'MODAL' || prev.pos === 'TO' || (prev.pos === 'NEG' && ['MODAL', 'AUX'].includes(P(i - 2).pos) && P(i - 2).lemma !== 'be')) && canBeVerb(t)) { t.pos = 'VERB'; t.form = 'base'; }
          break;
        case 'VERB':
          if (w === 'like' && prev.pos === 'VERB' && prev.lower !== 'would' && !['MODAL', 'TO'].includes(P(i - 2).pos)) { t.pos = 'PREP'; break; }
          if (prev.pos === 'AUX' && prev.lemma === 'be' && t.form === 'base' && canBeNoun(t) && !/^(be)$/.test(w)) { t.pos = 'NOUN'; break; }
          if (['DET', 'POSS', 'ADJ', 'NUM'].includes(prev.pos) && t.form !== 'ing' && !(t.form === 'pp' || t.form === 'pastpp') && canBeNoun(t)) { t.pos = 'NOUN'; break; }
          if (['DET', 'POSS'].includes(prev.pos) && t.form === 'base') { t.pos = 'NOUN'; break; }
          if (prev.pos === 'PRON' && OBJ_PRON.has(prev.lower) && t.form === 'base' && isUnknown(t.lower) && !/^(let|make|help|have|watch|see|hear|feel|bid)$/.test(P(i - 2).lower)) { t.pos = 'NOUN'; break; }
          if (prev.pos === 'NUM' && t.form === 'base') { t.pos = 'NOUN'; break; }
          // participle before a noun acts as an adjective: "the running water"
          if ((t.form === 'ing' || t.form === 'pp' || t.form === 'pastpp') && ['DET', 'POSS', 'ADJ'].includes(prev.pos) && (next.pos === 'NOUN' || next.pos === 'PROPN')) { t.pos = 'ADJ'; t.participle = true; break; }
          if (t.form === 'ing' && ['DET', 'POSS'].includes(prev.pos) && !nounish(next)) { t.pos = 'NOUN'; t.gerundNoun = true; }
          break;
        case 'PREP':
          if (w === 'like') {
            const linkPrev = /^(look|looks|looked|looking|sound|sounds|sounded|seem|seems|seemed|feel|feels|felt|taste|tastes|tasted|smell|smells|smelled|be|is|are|was|were|am)$/.test(prev.lower);
            if (!linkPrev && (prev.pos === 'PRON' || prev.pos === 'NOUN' || prev.pos === 'PROPN' || prev.pos === 'AUX' || prev.pos === 'MODAL' || prev.pos === 'NEG' || prev.pos === 'TO' || prev.pos === 'ADV')) { t.pos = 'VERB'; t.form = 'base'; }
          }
          break;
        case 'PART':
          if (prev.pos !== 'VERB' && prev.pos !== 'PART') t.pos = (nounish(next) || ['DET', 'POSS', 'PRON'].includes(next.pos)) ? 'PREP' : 'ADV';
          break;
        case 'ADV':
          if (['DET', 'POSS'].includes(prev.pos) && (next.pos === 'NOUN' || w === 'only') && !/ly$|^(very|too|so|quite|rather|most|more|less|least|really|extremely|almost|nearly|even)$/.test(w) || (w === 'only' && ['DET', 'POSS'].includes(prev.pos))) { t.pos = 'ADJ'; break; }
          if (/^(yesterday|today|tomorrow|tonight)$/.test(w) && (prev.pos === 'PREP' || prev.pos === 'POSS' || next.pos === 'POSS' && false)) t.pos = 'NOUN';
          if (w === 'home' && prev.pos === 'VERB') t.pos = 'ADV';
          break;
        case 'NUM':
          if (w === 'one' && !nounish(next)) t.pos = 'PRON';
          break;
      }

      // closed-class words with special readings
      if (w === 'well' && i === 0 && next.text === ',') t.pos = 'INTJ';
      if ((w === 'yes' || w === 'no') && (next.text === ',' || next.pos === 'EOF' || next.text === '!')) t.pos = 'INTJ';
      if (w === 'home' && i > 0 && MOTION.has(prev.lower)) t.pos = 'ADV';
      if (w === 'that' && t.pos === 'PRON' && i > 0) {
        if (['NOUN', 'PROPN', 'PRON'].includes(prev.pos) && prev.lower !== 'that') t.pos = 'REL';
        else if (prev.pos === 'DETPRON' || /^(all|everything|something|anything|nothing|those|one|someone|anyone|everyone)$/.test(prev.lower)) t.pos = 'REL';
        else if (prev.pos === 'VERB' || prev.pos === 'ADJ' || prev.pos === 'AUX' && prev.lemma !== 'be') t.pos = clauseAt(i + 1) ? 'SCONJ' : 'PRON';
      }
      if (['who', 'whom', 'which', 'whose'].includes(w) && i > 0 && ['NOUN', 'PROPN', 'PRON'].includes(prev.pos)) t.pos = 'REL';
      if (['who', 'whom', 'which', 'whose'].includes(w) && prev.text === ',' && i > 1) t.pos = 'REL';
      // after modal / do-support / to, the next word is a bare verb (adverbs may intervene: "may from time to time ordain")
      if (prev.pos === 'ADV' && i > 1) {
        let k = i - 1;
        while (k > 0 && ['ADV', 'NEG'].includes(toks[k].pos)) k--;
        if (toks[k].pos === 'MODAL' && (t.pos === 'NOUN' || t.pos === 'ADJ') && !/s$/.test(w)) { t.pos = 'VERB'; t.form = 'base'; }
      }
      const doAux = x => x.pos === 'AUX' && x.lemma === 'do' && !['MODAL', 'TO', 'AUX'].includes(P(toks.indexOf(x) - 1).pos);
      if ((prev.pos === 'MODAL' || doAux(prev) || (prev.pos === 'NEG' && (P(i - 2).pos === 'MODAL' || doAux(P(i - 2))))) &&
        !['PRON', 'DET', 'POSS', 'NEG', 'ADV', 'AUX', 'PROPN', 'NUM', 'EX', 'PUNCT', 'WH', 'TO'].includes(t.pos) && (canBeVerb(t) || t.pos === 'NOUN' || (t.pos === 'PREP' && w === 'like') || t.pos === 'ADJ' && !BE_FORMS.has(prev.lower))) {
        if (!(t.pos === 'ADJ' && P(i - 1).lemma === 'be')) { t.pos = 'VERB'; t.form = 'base'; }
      }
      // question: aux + subject pronoun + verb
      if (prev.pos === 'PRON' && SUBJ_PRON.has(prev.lower) && ['AUX', 'MODAL'].includes(P(i - 2).pos) && P(i - 2).lemma !== 'be' && (t.pos === 'NOUN' || t.pos === 'PREP') && canBeVerb(t)) { t.pos = 'VERB'; t.form = 'base'; }
    }
  }
  // straight after a relative pronoun, a noun that can be a verb usually is one ("all that glitters")
  for (let i = 1; i < toks.length; i++) {
    const t = toks[i], prev = toks[i - 1];
    if (t.userPos || prev.pos !== 'REL' || !/^(that|who|which)$/.test(prev.lower)) continue;
    if (t.pos === 'NOUN' && canBeVerb(t) && /s$/.test(t.lower) && !['VERB', 'AUX', 'MODAL'].includes((toks[i + 1] || {}).pos) || (t.pos === 'NOUN' && canBeVerb(t) && toks[i + 1] && ['AUX', 'VERB', 'MODAL'].includes(toks[i + 1].pos) && /s$/.test(t.lower))) {
      t.pos = 'VERB'; t.form = guessForm(t);
    }
  }
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i], prev = toks[i - 1] || {}, next = toks[i + 1] || {}, n2 = toks[i + 2] || {}, n3 = toks[i + 3] || {};
    if (t.userPos || t.pos === 'PUNCT') continue;
    // "a dark and stormy night": both words before the noun are adjectives
    if (['DET', 'POSS', 'ADJ', 'NUM'].includes(prev.pos) && t.pos === 'NOUN' && next.pos === 'CCONJ' && /^(and|or|but|yet)$/.test(next.lower) &&
      ['ADJ', 'NOUN'].includes(n2.pos) && n3.pos === 'NOUN' && !/s$/.test(t.lower)) {
      t.pos = 'ADJ';
      if (n2.pos === 'NOUN' && !n2.userPos) n2.pos = 'ADJ';
    }
    // compromise sometimes files a plain noun as an adjective ("justice") or a name ("harmony")
    if (t.pos === 'ADJ' && /(ice|tion|sion|ness|ment|ity|ism|ship|hood|ance|ence|ony|dom)$/.test(t.lower) && !t.tags.has('Comparable') && !/Adj/.test(t.sw) && !t.participle) t.pos = 'NOUN';
    if (t.pos === 'PROPN' && /^[a-z]/.test(t.text)) t.pos = 'NOUN';
    // "will little note", "can never forget": an adverb between a modal and its verb
    if ((t.pos === 'VERB' || t.pos === 'ADJ') && (prev.pos === 'MODAL' || (prev.pos === 'CCONJ' && next.pos === 'VERB')) && (next.pos === 'VERB' || (canBeVerb(next) && (next.pos !== 'NOUN' || !n2.pos || ['PUNCT', 'CCONJ', 'DET', 'PRON', 'PREP', 'ADV', 'POSS'].includes(n2.pos)))) && /^(little|long|well|ill|soon|still|hardly|scarcely|ever|truly|surely|rightly|justly|best|better|rather|only|just|also|even)$/.test(t.lower)) {
      t.pos = 'ADV';
      if (next.pos !== 'VERB') { next.pos = 'VERB'; next.form = 'base'; }
    }
    // "He kindly stopped": an -ly word right before a verb is an adverb
    if (t.pos === 'ADJ' && /ly$/.test(t.lower) && next.pos === 'VERB' && ['PRON', 'NOUN', 'PROPN', 'MODAL', 'AUX'].includes(prev.pos)) t.pos = 'ADV';
    // "of having nothing to do", "being kind": have and be as gerunds
    if (t.pos === 'AUX' && /^(having|being)$/.test(t.lower) && !(next.pos === 'VERB' && /pp|pastpp|past|ing/.test(next.form || '')) && ['NOUN', 'PRON', 'DET', 'POSS', 'ADJ', 'NUM', 'PROPN'].includes(next.pos)) { t.pos = 'VERB'; t.form = 'ing'; t.lemma = t.lower === 'having' ? 'have' : 'be'; }
    // "Why, sometimes…": an exclamation, not a question
    if (i === 0 && t.lower === 'why' && next.text === ',') t.pos = 'INTJ';
    // "government … is but a necessary evil": "but" meaning "only"
    if (t.lower === 'but' && prev.pos === 'AUX' && prev.lemma === 'be' && ['DET', 'ADJ', 'NUM'].includes(next.pos)) t.pos = 'ADV';
    // "less difficult", "more lovely": a comparative adverb before an adjective
    if (/^(less|more|most|least)$/.test(t.lower) && (next.pos === 'ADJ' || (next.pos === 'VERB' && /pp|pastpp/.test(next.form || '')))) t.pos = 'ADV';
    // "We are all in the gutter": a floating "all" after a form of be
    if (/^(all|both)$/.test(t.lower) && prev.pos === 'AUX' && prev.lemma === 'be' && ['PREP', 'ADJ'].includes(next.pos)) t.pos = 'ADV';
    // hyphenated present participles: "spring-cleaning his little home"
    if (/-[a-z]+ing$/.test(t.lower) && !['DET', 'POSS', 'ADJ'].includes(prev.pos) && ['DET', 'POSS', 'PRON', 'NOUN', 'PROPN', 'NUM'].includes(next.pos) && !NOT_ING.has(t.lower.split('-').pop())) { t.pos = 'VERB'; t.form = 'ing'; }
  }
  // a clause with a subject but no verb: the last noun after a noun is probably the verb ("the sun rose")
  {
    let seg = [];
    const flush = () => {
      if (seg.some(x => ['VERB', 'AUX', 'MODAL'].includes(x.pos))) { seg = []; return; }
      for (let k = seg.length - 1; k > 0; k--) {
        const x = seg[k], before = seg[k - 1];
        if (x.pos === 'NOUN' && ['NOUN', 'PROPN', 'PRON'].includes(before.pos) && canBeVerb(x) && !x.userPos && !(before.pos === 'PRON' && !SUBJ_PRON.has(before.lower))) {
          x.pos = 'VERB';
          x.form = IRREG_PAST.has(x.lower) ? 'past' : guessForm(x);
          break;
        }
      }
      seg = [];
    };
    for (const t of toks) {
      if (t.pos === 'PUNCT' || t.pos === 'SCONJ' || t.pos === 'REL' || t.pos === 'CCONJ' || t.pos === 'PREPX' && false) { flush(); continue; }
      seg.push(t);
    }
    flush();
  }
  // final normalisation
  for (const t of toks) {
    if (t.pos === 'DETPRON') t.pos = 'PRON';
    if (t.pos === 'POSSPRON') t.pos = 'PRON';
    if (t.pos === 'WHDET') t.pos = 'WH';
    if (t.pos === 'PREPX') t.pos = 'PREP';
    if (t.pos === 'PREPADV') t.pos = 'PREP';
    if (t.pos === 'CCX') t.pos = t.lower === 'for' ? 'PREP' : 'ADV';
    if (t.pos === 'VERB' && !t.form) t.form = guessForm(t);
    if (t.pos === 'VERB') {
      t.lemma = auxLemma(t.lower) || IRREG_LEMMA[t.lower] || t.root || t.lower;
      if (t.form === 'pastpp' && IRREG_PAST.has(t.lower)) t.form = 'past';
    }
    if (t.pos === 'AUX' && !t.lemma) t.lemma = auxLemma(t.lower) || 'be';
  }
}

// A human label for each coarse tag, for the parsing table.
export const POS_LABEL = {
  DET: 'article', POSS: 'possessive', PRON: 'pronoun', WH: 'interrogative', AUX: 'auxiliary verb', MODAL: 'auxiliary verb',
  NEG: 'adverb', PREP: 'preposition', TO: 'sign of the infinitive', CCONJ: 'conjunction', SCONJ: 'conjunction',
  INTJ: 'interjection', ADV: 'adverb', ADJ: 'adjective', NOUN: 'noun', PROPN: 'proper noun', NUM: 'adjective',
  VERB: 'verb', PART: 'adverb', EX: 'expletive', THAN: 'conjunction', REL: 'relative pronoun', PUNCT: '',
};
