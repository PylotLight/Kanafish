const BASE = Object.freeze({
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o',
  か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko',
  さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to',
  な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no',
  は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo',
  や: 'ya', ゆ: 'yu', よ: 'yo',
  ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro',
  わ: 'wa', ゐ: 'wi', ゑ: 'we', を: 'o', ん: 'n',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go',
  ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo',
  だ: 'da', ぢ: 'ji', づ: 'zu', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo',
  ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ゔ: 'vu', ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o',
  ゃ: 'ya', ゅ: 'yu', ょ: 'yo', ゎ: 'wa',
})

const DIGRAPHS = Object.freeze({
  きゃ: 'kya', きゅ: 'kyu', きょ: 'kyo',
  ぎゃ: 'gya', ぎゅ: 'gyu', ぎょ: 'gyo',
  しゃ: 'sha', しゅ: 'shu', しょ: 'sho',
  じゃ: 'ja', じゅ: 'ju', じょ: 'jo',
  ちゃ: 'cha', ちゅ: 'chu', ちょ: 'cho',
  にゃ: 'nya', にゅ: 'nyu', にょ: 'nyo',
  ひゃ: 'hya', ひゅ: 'hyu', ひょ: 'hyo',
  びゃ: 'bya', びゅ: 'byu', びょ: 'byo',
  ぴゃ: 'pya', ぴゅ: 'pyu', ぴょ: 'pyo',
  みゃ: 'mya', みゅ: 'myu', みょ: 'myo',
  りゃ: 'rya', りゅ: 'ryu', りょ: 'ryo',
  てぃ: 'ti', でぃ: 'di', とぅ: 'tu', どぅ: 'du',
  ふぁ: 'fa', ふぃ: 'fi', ふぇ: 'fe', ふぉ: 'fo',
  うぃ: 'wi', うぇ: 'we', うぉ: 'wo',
  しぇ: 'she', じぇ: 'je', ちぇ: 'che',
  つぁ: 'tsa', つぃ: 'tsi', つぇ: 'tse', つぉ: 'tso',
  ゔぁ: 'va', ゔぃ: 'vi', ゔぇ: 've', ゔぉ: 'vo',
})

function toHiragana(character) {
  if (typeof character !== 'string' || !character) return ''
  const code = character.codePointAt(0)
  return code >= 0x30a1 && code <= 0x30f6 ? String.fromCodePoint(code - 0x60) : character
}

function unitAt(characters, index) {
  const first = toHiragana(characters[index])
  if (!first) return { text: '', length: 1 }
  const second = characters[index + 1] ? toHiragana(characters[index + 1]) : ''
  const pair = `${first}${second}`
  return DIGRAPHS[pair] ? { text: DIGRAPHS[pair], length: 2 } : { text: BASE[first] ?? first, length: 1 }
}

export function kanaToRomaji(value) {
  if (typeof value !== 'string' || !value.trim() || /\p{Script=Han}/u.test(value)) return ''
  const characters = Array.from(value.normalize('NFKC'))
  let result = ''
  for (let index = 0; index < characters.length; index += 1) {
    const character = toHiragana(characters[index])
    if (character === 'っ') {
      const next = unitAt(characters, index + 1).text
      const consonant = next.match(/^[bcdfghjklmpqrstvwxyz]/i)?.[0]
      result += consonant || 'っ'
      continue
    }
    if (character === 'ん') {
      const next = unitAt(characters, index + 1).text
      result += /^[aeiouy]/i.test(next) ? "n'" : 'n'
      continue
    }
    if (character === 'ー') {
      const vowel = result.match(/[aeiou](?!.*[aeiou])/i)?.[0]
      result += vowel || 'ー'
      continue
    }
    const unit = unitAt(characters, index)
    result += unit.text
    index += unit.length - 1
  }
  return result
}
