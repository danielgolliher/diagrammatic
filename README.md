# Diagrammatic

*or, the Analysis of Sentences made Visible to the Eye.*

Type any sentence and Diagrammatic draws it as a Reed–Kellogg diagram, the way a nineteenth-century grammar book would. The page is set in the Fell Types and comes in two finishes, Paper and Slate.

**Live:** https://danielgolliher.github.io/diagrammatic/

## What it draws

- The subject and verb on a base line, split by a vertical line that crosses it.
- The direct object, set off by a short vertical line. Predicate nominatives and adjectives get a line slanting back toward the subject.
- Objective complements (*They elected him president*) and indirect objects, which hang from the verb on an empty slant.
- Adjectives, articles, possessives and adverbs on slants. An adverb that modifies a modifier hangs from an elbow (*very old*).
- Prepositional phrases: the preposition sits on a slant and its object on a line of its own.
- Compound subjects, verbs, objects and modifiers. They split into forks, and the conjunction sits on a dotted line. A shared object makes a diamond.
- Gerunds (on a stepped line), infinitives and noun clauses on pedestals. Participles bend from a slant onto a flat line.
- Adjective clauses and adverb clauses. Each gets its own base line, joined by a dotted line to the word it modifies.
- Compound sentences, joined verb to verb by a dotted step with the conjunction on the tread.
- Understood subjects shown in parentheses, *(you)* and *(that)*. Interjections, nouns of address and parentheticals float above the diagram, attached to nothing.

Each figure comes with a written **Analysis** in the style of the old grammars. It also has a **Parsing** table, where you can correct any word's part of speech and see the figure redrawn. Figures can be saved as SVG or PNG, and the sentence is kept in the page's URL so you can share a link to it.

## How it works

Everything runs in the browser. There is no server and no build step.

| File | Role |
| --- | --- |
| `js/tagger.js` | [compromise](https://github.com/spencermountain/compromise) makes a first guess at each word's part of speech. A closed-class lexicon and a set of context rules then correct it. |
| `js/parser.js` | A forgiving recursive-descent parser that turns tagged words into subjects, predicates, complements, modifiers, phrases and clauses. When the parse leaves words over, it re-reads doubtful words (for example, a word that could be a noun or a verb) and keeps the cleanest result. |
| `js/layout.js` | Draws the parse tree as an SVG. Every piece carries collision boxes, and pieces are packed against each other so modifiers and clauses sit close without touching. |
| `js/analysis.js` | Writes the prose analysis. |
| `js/main.js` | The page: plates, exports, exercises and the Key to the Lines. |

English grammar is large and this parser works by rule, not by understanding. It will sometimes get a sentence wrong. The Parsing table is there so a reader can correct it.

## Developing

```bash
python3 -m http.server 8000      # then open http://localhost:8000
node tests/run.mjs               # check parses against tests/golden.json
node tests/run.mjs "Any sentence you like."
node tests/stress.mjs            # parse, lay out and analyse every test sentence
```

`tests/gallery.html` draws every test sentence at a large size, for checking the drawings by eye.

## Credits

- The diagramming method comes from Alonzo Reed and Brainerd Kellogg, *Higher Lessons in English* (1877).
- The IM Fell types were digitized by Igino Marini and are used under the SIL Open Font License (`fonts/OFL.txt`).
- Part-of-speech tagging uses compromise (MIT, `vendor/compromise-LICENSE.txt`).
