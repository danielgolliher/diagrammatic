// Usage:
//   node tests/run.mjs                 compare every specimen against tests/golden.json
//   node tests/run.mjs --update        rewrite the golden file from current output
//   node tests/run.mjs "Any sentence." show tags and parse for ad-hoc sentences
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { tagText } from '../js/tagger.js'
import { parseSentence, show, resetIds } from '../js/parser.js'
import { SPECIMENS } from './sentences.mjs'
import { HARD } from './hard.mjs'

const args = process.argv.slice(2)
const update = args.includes('--update')
const adhoc = args.filter(a => !a.startsWith('--'))
const goldenPath = new URL('./golden.json', import.meta.url)

function parseAll(s) {
  return tagText(s).map(sen => { resetIds(); return { raw: sen.raw, sen, tree: show(parseSentence(sen.tokens, sen.end)) } })
}

if (adhoc.length) {
  for (const s of adhoc) for (const r of parseAll(s)) {
    console.log('• ' + r.raw)
    console.log('   ' + r.sen.tokens.map(t => `${t.text}/${t.pos}${t.form ? '.' + t.form : ''}`).join(' '))
    console.log('   ' + r.tree)
  }
} else {
  const out = {}
  for (const s of [...SPECIMENS, ...HARD]) out[s] = parseAll(s).map(r => r.tree)
  if (update || !existsSync(goldenPath)) {
    writeFileSync(goldenPath, JSON.stringify(out, null, 1) + '\n')
    console.log(`wrote ${Object.keys(out).length} golden parses`)
  } else {
    const gold = JSON.parse(readFileSync(goldenPath, 'utf8'))
    let bad = 0
    for (const [s, trees] of Object.entries(out)) {
      if (JSON.stringify(gold[s]) !== JSON.stringify(trees)) {
        bad++
        console.log(`✗ ${s}\n   was: ${(gold[s] || []).join(' / ')}\n   now: ${trees.join(' / ')}`)
      }
    }
    console.log(bad ? `\n${bad} parse(s) changed` : `all ${Object.keys(out).length} parses match`)
    process.exit(bad ? 1 : 0)
  }
}
