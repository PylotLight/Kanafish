// A simple, kana-agnostic character similarity for "say this line" practice. It does not judge pronunciation:
// it compares what the recognizer wrote with the target line after folding katakana to hiragana, normalizing
// width (NFKC) and dropping punctuation and whitespace. Kanji vs kana spellings of the same word still differ.

const PUNCTUATION_AND_SPACE = /[\s\p{P}\p{S}\u3000]/gu

export function katakanaToHiragana(text) {
  return String(text).replace(/[\u30a1-\u30f6]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60))
}

export function normalizeForComparison(text) {
  if (typeof text !== 'string') return ''
  return katakanaToHiragana(text.normalize('NFKC')).toLowerCase().replace(PUNCTUATION_AND_SPACE, '')
}

export function levenshtein(a, b) {
  const left = Array.from(a)
  const right = Array.from(b)
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let i = 1; i <= left.length; i += 1) {
    const current = [i]
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
    }
    previous = current
  }
  return previous[right.length]
}

export function scoreSpokenLine(expected, recognized) {
  const target = normalizeForComparison(expected)
  const heard = normalizeForComparison(recognized)
  const length = Math.max(Array.from(target).length, Array.from(heard).length)
  const distance = levenshtein(target, heard)
  const score = length ? Math.max(0, Math.round((1 - distance / length) * 100)) : 0
  const verdict = !heard ? 'nothing' : score >= 90 ? 'match' : score >= 70 ? 'close' : 'retry'
  return { score, distance, target, heard, verdict }
}
