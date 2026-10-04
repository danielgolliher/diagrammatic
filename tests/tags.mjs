import { tagText } from '../js/tagger.js'
const sents = process.argv.slice(2).length ? process.argv.slice(2) : [
 "The old man walked slowly to the village.",
 "John and Mary don't like the very large dog that barked at them.",
 "She gave him a book about birds yesterday.",
 "I want to go home because I am tired.",
 "There are three apples on the table.",
 "Where did you put my keys?",
 "Oh, Mary, close the door!",
 "The letter written by her was lost.",
 "He picked up the phone and called his mother.",
 "I know that he is right.",
 "It's a beautiful day, isn't it?",
 "Four score and seven years ago our fathers brought forth on this continent a new nation.",
 "I saw her dog.", "I gave her the book.", "Do you like cats?", "That book is mine.", "The book that I read was long.",
 "After the rain stopped, we went outside.", "After dinner we walked.", "He left so that she could sleep.",
]
for (const s of sents) for (const sen of tagText(s)) console.log(sen.tokens.map(t => `${t.text}/${t.pos}${t.form?'.'+t.form:''}${t.lemma&&t.lemma!==t.lower?'('+t.lemma+')':''}`).join(' '), sen.end)
