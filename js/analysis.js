// Diagrammatic — the analysis.
// Writes out, in the manner of a nineteenth-century grammar's "Model for
// Analysis", what the diagram shows.

const i = s => `<i>${esc(s)}</i>`;
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
// capitalise the first letter of a sentence, even when it sits inside <i>…</i>
const cap = s => s.replace(/^((?:<[^>]+>)*)(\w)/, (m, tags, ch) => tags + ch.toUpperCase());

function list(arr, conj = 'and') {
  if (arr.length <= 1) return arr.join('');
  if (arr.length === 2) return `${arr[0]} ${conj} ${arr[1]}`;
  return arr.slice(0, -1).join(', ') + `, ${conj} ` + arr[arr.length - 1];
}

const PRE_ROLES = new Set(['article', 'adjective', 'possessive', 'numeral', 'adjunct']);

// --- reconstructing the words of a phrase ---------------------------------
export function phraseText(n, skip = null) {
  if (!n) return '';
  if (skip && n.id === skip) return '';
  switch (n.kind) {
    case 'word': {
      const pre = [], post = [];
      for (const m of n.mods || []) {
        const isPre = (m.kind === 'word' && (PRE_ROLES.has(m.role) || (m.role === 'adverb' && n.role === 'adjective') || (m.role === 'adverb' && n.role === 'adverb'))) || (m.kind === 'compound' && m.items.every(x => x.kind === 'word'));
        (isPre ? pre : post).push(phraseText(m, skip));
      }
      const head = n.understood ? '' : n.text;
      const ap = n.appos ? ', ' + phraseText(n.appos, skip) + ',' : '';
      return [...pre, head + ap, ...post].filter(Boolean).join(' ').replace(/,$/, '');
    }
    case 'compound': {
      const parts = n.items.map(x => phraseText(x, skip));
      const c = n.conj && n.conj !== ',' ? n.conj.replace('…', ' … ') : 'and';
      if (c.includes('…')) { const [a, b] = c.split(' … '); return `${a} ${parts[0]} ${b} ${parts.slice(1).join(', ')}`; }
      return list(parts, c);
    }
    case 'pp': return [n.prep ? n.prep.text : '', phraseText(n.obj, skip)].filter(Boolean).join(' ');
    case 'gerund': return [...(n.mods || []).map(m => phraseText(m, skip)), predText(n.pred, skip)].join(' ');
    case 'participle': return predText(n.pred, skip);
    case 'infinitive': return [(n.to ? n.to.text : ''), predText(n.pred, skip)].filter(Boolean).join(' ');
    case 'relclause': return clauseText(n.clause, n.link);
    case 'advclause': return n.conj.text + ' ' + clauseText(n.clause);
    case 'nounclause': {
      const front = findWh(n.clause);
      return [(n.connector ? n.connector.text : ''), clauseText(n.clause, front)].filter(Boolean).join(' ');
    }
    default: return '';
  }
}

function findWh(clause) {
  let found = null;
  walk(clause, x => { if (!found && x.kind === 'word' && x.wh) found = x.id; });
  if (!found) return null;
  // only front it if it is not already the first thing (the subject)
  if (clause.subject && (clause.subject.id === found || (clause.subject.mods || []).some(m => m.id === found))) return null;
  return found;
}

function findNode(root, id) {
  let hit = null;
  walk(root, x => { if (!hit && x.id === id) hit = x; });
  return hit;
}

export function walk(n, fn, seen = new Set()) {
  if (!n || typeof n !== 'object' || seen.has(n)) return;
  seen.add(n);
  if (n.kind) fn(n);
  for (const k of ['subject', 'verb', 'comp', 'io', 'oc', 'obj', 'clause', 'pred', 'appos', 'prep', 'connector', 'expletive', 'fragment']) if (n[k]) walk(n[k], fn, seen);
  for (const k of ['mods', 'items', 'preds', 'clauses', 'interjections', 'vocatives', 'loose']) if (Array.isArray(n[k])) n[k].forEach(x => walk(x, fn, seen));
}

function predText(p, skip) {
  if (!p) return '';
  const v = p.verb;
  const vw = v.kind === 'compound' ? v : v;
  const verbMods = v.kind === 'word' ? v.mods || [] : [];
  const pre = verbMods.filter(m => m.kind === 'word' && /^(not|never|always|often|also|just|still|really|already|seldom|rarely|never)$/i.test(m.text));
  const post = verbMods.filter(m => !pre.includes(m) && !(m.kind === 'word' && m.wh));
  let vt = v.kind === 'compound' ? phraseText({ ...v, items: v.items.map(x => ({ ...x, mods: [] })) }) : v.text;
  if (pre.length && v.kind === 'word') {
    const parts = v.text.split(' ');
    if (parts.length > 1) vt = [parts[0], ...pre.map(m => m.text), ...parts.slice(1)].join(' ');
    else vt = [...pre.map(m => m.text), v.text].join(' ');
  }
  void vw;
  return [vt, phraseText(p.io, skip), phraseText(p.comp, skip), phraseText(p.oc, skip), ...post.map(m => phraseText(m, skip))].filter(Boolean).join(' ');
}

function clauseText(c, front = null) {
  if (!c) return '';
  const frontNode = front ? findNode(c, front) : null;
  let frontText = '';
  if (frontNode) {
    // a fronted relative: if it sits inside a phrase ("in which", "whose dog"), bring the phrase
    const holder = findHolder(c, front);
    frontText = holder ? phraseText(holder) : frontNode.text;
    front = holder ? holder.id : front;
  }
  const subj = c.subject && !(c.subject.understood) ? phraseText(c.subject, front) : '';
  const preds = c.preds.map(p => predText(p, front)).join(` ${c.predConj || 'and'} `);
  return [frontText, c.expletive ? c.expletive.text : '', subj, preds].filter(Boolean).join(' ').replace(/\s+/g, ' ');
}

function findHolder(c, id) {
  let holder = null;
  walk(c, x => {
    if (holder) return;
    if (x.kind === 'pp' && x.obj && (x.obj.id === id || (x.obj.mods || []).some(m => m.id === id))) holder = x;
    else if (x.kind === 'word' && (x.mods || []).some(m => m.id === id && m.role === 'possessive')) holder = x;
  });
  return holder;
}

// --- describing ------------------------------------------------------------
const ROLE_NAME = {
  article: 'the article', adjective: 'the adjective', possessive: 'the possessive', numeral: 'the numeral adjective',
  adjunct: 'the noun', adverb: 'the adverb', noun: 'the noun', proper: 'the proper noun', pronoun: 'the pronoun',
};

function wordKind(w) {
  if (w.relative) return w.role === 'adverb' ? 'the relative adverb' : w.role === 'possessive' ? 'the relative pronoun' : 'the relative pronoun';
  if (w.wh) return w.role === 'adverb' ? 'the interrogative adverb' : w.role === 'pronoun' ? 'the interrogative pronoun' : 'the interrogative adjective';
  if (w.role === 'adjunct') return 'the noun';
  return ROLE_NAME[w.role] || 'the word';
}

function describeMod(m) {
  switch (m.kind) {
    case 'word': {
      let s = `${wordKind(m)} ${i(m.text)}`;
      if (m.role === 'adjunct') s += ', used as an adjective';
      const subs = (m.mods || []);
      if (subs.length) s += ` (itself modified by ${list(subs.map(describeMod))})`;
      return s;
    }
    case 'compound': {
      const kinds = new Set(m.items.map(x => x.kind === 'word' ? x.role : x.kind));
      const plural = kinds.size === 1 && m.items[0].kind === 'word' ? `the ${m.items[0].role === 'adverb' ? 'adverbs' : 'adjectives'}` : 'the words';
      return `${plural} ${list(m.items.map(x => i(phraseText(x))), m.conj && m.conj !== ',' ? m.conj : 'and')}`;
    }
    case 'pp':
      if (!m.prep) return m.io ? `the indirect object ${i(phraseText(m.obj))}` : `the adverbial noun ${i(phraseText(m.obj))}`;
      if (m.elliptical) return `the elliptical clause ${i(phraseText(m))}`;
      return `the prepositional phrase ${i(phraseText(m))}`;
    case 'infinitive': return `the infinitive phrase ${i(phraseText(m))}`;
    case 'participle': return `the participial phrase ${i(phraseText(m))}`;
    case 'relclause': return `the adjective clause ${i(phraseText(m))}`;
    case 'advclause': return `the adverb clause ${i(phraseText(m))}, introduced by ${i(m.conj.text)}`;
    case 'gerund': return `the gerund phrase ${i(phraseText(m))}`;
    case 'nounclause': return `the noun clause ${i(phraseText(m))}`;
    default: return '';
  }
}

function headName(n) {
  if (!n) return '';
  if (n.kind === 'word') return n.understood ? `${i(n.text)}, understood` : i(n.text);
  if (n.kind === 'compound') return list(n.items.map(headName), n.conj && n.conj !== ',' ? n.conj.replace('…', '…') : 'and');
  if (n.kind === 'gerund') return `the gerund phrase ${i(phraseText(n))}`;
  if (n.kind === 'infinitive') return `the infinitive phrase ${i(phraseText(n))}`;
  if (n.kind === 'nounclause') return `the noun clause ${i(phraseText(n))}`;
  return i(phraseText(n));
}

function modsSentence(n, name) {
  if (!n) return '';
  const mods = n.kind === 'word' ? (n.mods || []) : n.kind === 'compound' ? [] : [];
  const out = [];
  if (n.kind === 'word' && mods.length) out.push(`${cap(name || i(n.text))} is modified by ${list(mods.map(describeMod))}.`);
  if (n.kind === 'word' && n.appos) out.push(`${cap(n.appos.kind === 'word' ? i(n.appos.text) : headName(n.appos))} is in apposition with ${i(n.text)}.`);
  if (n.kind === 'compound') for (const it of n.items) { const s = modsSentence(it); if (s) out.push(s); }
  return out.join(' ');
}

function describeClause(c, out) {
  const subjN = c.subject;
  let s = '';
  if (subjN) {
    if (subjN.kind === 'compound') s += `The subject is compound: ${headName(subjN)}. `;
    else s += `The subject is ${headName(subjN)}. `;
  }
  if (c.expletive) s += `${cap(i(c.expletive.text))} is an expletive, used only to introduce the sentence. `;
  const verbs = c.preds.map(p => p.verb.kind === 'compound' ? list(p.verb.items.map(v => i(v.text)), p.verb.conj) : i(p.verb.text));
  s += c.preds.length > 1 ? `The predicate is compound: ${list(verbs, c.predConj || 'and')}. ` : `The verb is ${verbs[0]}. `;
  out.push(s.trim());
  const sm = modsSentence(subjN);
  if (sm) out.push(sm);
  for (const p of c.preds) describePred(p, out);
}

function describePred(p, out) {
  const v = p.verb;
  const vw = v.kind === 'compound' ? v.items : [v];
  for (const w of vw) {
    const mods = (w.mods || []);
    if (mods.length) out.push(`${cap(i(w.text))} is modified by ${list(mods.map(describeMod))}.`);
  }
  if (p.io) out.push(`${cap(headName(p.io))} is the indirect object.`);
  if (p.comp) {
    const what = p.compType === 'do' ? 'the direct object' : p.compType === 'pa' ? 'the predicate adjective' : 'the predicate nominative';
    out.push(`${cap(headName(p.comp))} ${p.comp.kind === 'compound' ? 'are' : 'is'} ${what}${p.compType !== 'do' ? `, completing the verb and describing the subject` : ''}.`);
    const cm = modsSentence(p.comp);
    if (cm) out.push(cm);
  }
  if (p.oc) out.push(`${cap(headName(p.oc))} is the objective complement.`);
}

function counts(s) {
  let dep = 0;
  walk(s, x => { if (x.kind === 'relclause' || x.kind === 'advclause' || x.kind === 'nounclause') dep++; });
  return { indep: s.clauses.length, dep };
}

export function analyse(s) {
  if (!s) return '';
  const out = [];
  if (s.fragment) {
    out.push(`This is not a sentence but a phrase, for it has no verb. It is diagrammed as it would stand within a sentence.`);
    const m = modsSentence(s.fragment);
    if (m) out.push(m);
    return out.join(' ');
  }
  if (!s.clauses.length) return 'Nothing here could be analysed.';
  const { indep, dep } = counts(s);
  const form = indep > 1 && dep ? 'compound-complex' : indep > 1 ? 'compound' : dep ? 'complex' : 'simple';
  let type = s.type;
  if (s.clauses[0].subject && s.clauses[0].subject.understood) type = s.type === 'exclamatory' ? 'imperative and exclamatory' : 'imperative';
  out.push(`This is a ${form} ${type} sentence.`);
  if (indep > 1) out.push(`It joins ${indep === 2 ? 'two' : indep} independent clauses${s.conjs.filter(Boolean).length ? ` by the conjunction${s.conjs.filter(Boolean).length > 1 ? 's' : ''} ${list([...new Set(s.conjs.filter(Boolean))].map(i))}` : ''}.`);
  if (s.interjections.length) out.push(`${cap(list(s.interjections.map(w => i(w.text))))} ${s.interjections.length > 1 ? 'are interjections' : 'is an interjection'}, independent of the rest.`);
  if (s.vocatives.length) out.push(`${cap(list(s.vocatives.map(w => i(phraseText(w)))))} ${s.vocatives.length > 1 ? 'are nouns' : 'is a noun'} of address, independent of the rest.`);
  s.clauses.forEach((c, k) => {
    const sub = [];
    describeClause(c, sub);
    if (indep > 1) out.push(`<span class="clause-no">${['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth'][k] || 'Next'} clause.</span> ${sub.join(' ')}`);
    else out.push(sub.join(' '));
  });
  // dependent clauses, each in its own words
  const deps = [];
  walk(s, x => { if (x.kind === 'relclause' || x.kind === 'advclause' || x.kind === 'nounclause') deps.push(x); });
  for (const d of deps) {
    const sub = [];
    describeClause(d.clause, sub);
    const kind = d.kind === 'relclause' ? 'adjective clause' : d.kind === 'advclause' ? 'adverb clause' : 'noun clause';
    out.push(`<span class="clause-no">In the ${kind} ${i(phraseText(d))}:</span> ${sub.join(' ')}`);
  }
  if (s.parens && s.parens.length) out.push(`The parenthetical ${list(s.parens.map(w => i(phraseText(w))))} stands apart from the construction of the sentence and is set above it.`);
  if (s.tag) out.push(`The question tag ${i(s.tag)} is set apart.`);
  if (s.loose && s.loose.length) out.push(`<span class="unplaced">The words ${list(s.loose.map(w => i(phraseText(w))))} could not be fitted to the diagram and are set below it.</span>`);
  return out.join(' ');
}
