import { describe, expect, test } from 'bun:test'
import { encodeIrodoriText, normalizeIrodoriText, stripOuterBrackets } from '../src/main/tts/irodoriMfInference.js'

describe('Irodori v4.1-Small-MF JavaScript preprocessing', () => {
  test('strips only a single outer matching bracket pair and handles nested pairs', () => {
    expect(stripOuterBrackets('「『こんにちは』」')).toBe('こんにちは')
    expect(stripOuterBrackets('「こんにちは」「こんばんは」')).toBe('「こんにちは」「こんばんは」')
  })

  test('applies the upstream replacements and Japanese NFKC normalization', () => {
    expect(normalizeIrodoriText('（ＡＢＣ）　？…')).toBe('(ABC)?…')
    expect(normalizeIrodoriText('テスト...[n]')).toBe('テスト…')
  })

  test('applies forced rare-token pieces to text only, with one manual BOS', () => {
    const wrapped = {
      tokenizer: { encode: () => ({ ids: [11, 22] }) },
      forced: new Map([[22, [33, 44]]])
    }
    expect(encodeIrodoriText(wrapped, 'こんにちは', { bosId: 9 })).toEqual([9, 11, 33, 44])
    expect(encodeIrodoriText(wrapped, 'こんにちは', { bosId: 9, splitRare: false })).toEqual([9, 11, 22])
  })
})
