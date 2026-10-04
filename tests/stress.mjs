import { tagText } from '../js/tagger.js'
import { parseSentence, show, resetIds } from '../js/parser.js'
import { Draughtsman, toSVG } from '../js/layout.js'
import { analyse } from '../js/analysis.js'
import { HARD } from './hard.mjs'
import { SPECIMENS } from './sentences.mjs'
const pen = new Draughtsman((s, size) => s.length * size * 0.45)
let fails = 0, loose = 0, n = 0
const t0 = Date.now()
const verbose = process.argv.includes('-v')
for (const s of [...HARD, ...SPECIMENS]) {
  let sens
  try { sens = tagText(s) } catch (e) { console.log('TAG FAIL', JSON.stringify(s), e.message); fails++; continue }
  for (const sen of sens) {
    n++
    try {
      resetIds()
      const tree = parseSentence(sen.tokens, sen.end)
      if (!tree) { if (verbose) console.log('• (null)', sen.raw); continue }
      const t1 = Date.now()
      const fig = pen.sentence(tree)
      const svg = toSVG(fig)
      const ms = Date.now() - t1
      const a = analyse(tree)
      if (tree.loose && tree.loose.length) loose++
      if (verbose || (tree.loose && tree.loose.length) || ms > 200) console.log(`• ${sen.raw}  [${ms}ms ${svg.width}x${svg.height}]\n   ${show(tree)}`)
      if (/undefined|NaN/.test(svg.svg) || /undefined|NaN/.test(a)) { console.log('  !! undefined/NaN in output', sen.raw); fails++ }
    } catch (e) { console.log('FAIL', JSON.stringify(sen.raw), e.stack.split('\n').slice(0,3).join(' | ')); fails++ }
  }
}
console.log(`\n${n} sentences, ${fails} failures, ${loose} with loose words, ${Date.now()-t0}ms`)
