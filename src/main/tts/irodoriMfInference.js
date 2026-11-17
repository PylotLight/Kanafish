import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { Tokenizer } from '@huggingface/tokenizers'

const SAMPLE_RATE = 48_000
const HOP = 1920
const LATENT_DIM = 32
const KEEP_TOKENS = new Set(`心筋梗塞 日常茶飯事 瀬戸内海 老若男女 興味津々 高田馬場 アクリル板 年モデル オフショア モスクワ テラス席 缶バッジ ジュリー ッチャー ティーン トゥルー マリッジ リフィル リベット デパート カリウム タピオカ ボーイズ フレックス フリース ファブリック ユナイテッド ブルース ミスター タイムズ ソケット コスチューム プレビュー リーズナブル プロダクション ファイト アバター 産婦人科 行方不明 直射日光`.split(' '))
const FORCE_SPLITS = {
  セブンイレブン:['セブン','イレブン'],楽天市場:['楽天','市場'],外壁塗装:['外壁','塗装'],イベルメクチン:['イベルメ','クチン'],ミノキシジル:['ミノ','キシ','ジル'],送料無料:['送料','無料'],ヴィンテージ:['ヴィン','テージ'],点セット:['点','セット'],フォルダ:['フォル','ダ'],消費者金融:['消費者','金融'],代表取締役:['代表','取締役'],本セット:['本','セット'],厚生労働省:['厚生','労働','省'],オンラインカジノ:['オンライン','カジノ'],当サイト:['当','サイト'],プロペシア:['プロ','ペ','シア'],リノベーション:['リノベ','ー','ション'],メール便:['メール','便'],不動産投資:['不動産','投資'],ティック:['ティ','ック'],フジテレビ:['フジ','テレビ'],東日本大震災:['東日本','大震災'],新品未使用:['新品','未使用'],ネクスガード:['ネ','クス','ガード'],全身脱毛:['全身','脱毛'],債務整理:['債務','整理'],ス感染症:['ス','感染症'],代表取締役社長:['代表','取締役','社長'],枚セット:['枚','セット'],フィナステリド:['フィ','ナス','テリ','ド'],クチコミ:['クチ','コミ'],ブロガー:['ブロ','ガー'],ルイヴィトン:['ルイ','ヴィ','トン'],転職エージェント:['転職','エージェント'],数量限定:['数量','限定'],ホワイトニング:['ホワイト','ニング'],無料ダウンロード:['無料','ダウンロード'],スーパーコピー:['スーパー','コピー'],一般社団法人:['一般','社','団','法人'],日本語版:['日本語','版'],ペット用品:['ペット','用品'],投資信託:['投資','信託'],脱毛サロン:['脱毛','サロン'],東京都港区:['東京都','港区'],注文住宅:['注文','住宅'],マイナビ:['マイ','ナビ'],行政書士:['行政','書','士'],無料相談:['無料','相談'],市区町村:['市','区','町','村'],ザガーロ:['ザ','ガー','ロ'],リハビリテーショ:['リハビリ','テーショ'],株主優待:['株主','優待'],オンラインストア:['オンライン','ストア'],個人事業主:['個人','事業主'],社会福祉法人:['社会','福祉','法人'],カルティエ:['カル','ティエ'],イオンモール:['イオン','モール'],ピーター:['ピー','ター'],銀行振込:['銀行','振込'],スタッフ一同:['スタッフ','一同'],即日融資:['即日','融資'],プラセンタ:['プラ','センタ'],大学大学院:['大学','大学院'],モンクレール:['モン','ク','レール'],賃貸物件:['賃貸','物件'],協同組合:['協同','組合'],年以上前:['年','以上','前'],土日祝日:['土日','祝日'],ウェイト:['ウェ','イト']
}
const HIRAGANA_ONLY = /^[ぁ-ゖゝゞー]+$/u

export function stripOuterBrackets(text) {
  const pairs = new Map([['「','」'],['『','』'],['（','）'],['【','】'],['(',')']])
  while (text.length >= 2 && pairs.get(text[0]) === text.at(-1)) {
    const opening = text[0], closing = text.at(-1)
    let depth = 0, enclosing = true
    for (let i = 0; i < text.length; i++) {
      if (text[i] === opening) depth++
      else if (text[i] === closing) depth--
      if (depth === 0 && i < text.length - 1) { enclosing = false; break }
    }
    if (!enclosing || depth !== 0) break
    text = text.slice(1, -1)
  }
  return text
}

export function normalizeIrodoriText(text) {
  text = String(text)
  for (const [from, to] of [['\t',''],['[n]',''],['\\[n\\]',''],['　',''],['？','?'],['！','!'],['♥','♡'],['●','○'],['◯','○'],['〇','○']]) text = text.split(from).join(to)
  text = text.replace(/[;▼♀♂《》≪≫①②③④⑤⑥]/gu, '')
    .replace(/[\u02d7\u2010-\u2015\u2043\u2212\u23af\u23e4\u2500\u2501\u2e3a\u2e3b]/gu, '')
    .replace(/[\uff5e\u301c]/gu, 'ー').replace(/…{3,}/gu, '……')
  text = stripOuterBrackets(text).normalize('NFKC')
  return text.replace(/\.\.\./gu, '…').replace(/\.\./gu, '…')
}

function makeRareTokenizer(source, config) {
  const data = JSON.parse(source)
  if (data.model?.type !== 'Unigram' || !Array.isArray(data.model.vocab)) throw new Error('Rare-token splitting requires a Unigram tokenizer.')
  for (const item of data.model.vocab) {
    const piece = item[0].replaceAll('▁', '')
    if (Number(item[1]) <= -13 && [...piece].length >= 4 && !KEEP_TOKENS.has(piece) && !FORCE_SPLITS[piece] && !HIRAGANA_ONLY.test(piece)) item[1] = -1e9
  }
  const tokenizer = new Tokenizer(data, config)
  const forced = new Map()
  for (const [word, pieces] of Object.entries(FORCE_SPLITS)) {
    const wordId = tokenizer.token_to_id(word)
    if (wordId == null) continue
    const ids = []
    for (const piece of pieces) {
      const id = tokenizer.token_to_id(piece)
      if (id != null) ids.push(id)
      else ids.push(...tokenizer.encode(piece, { add_special_tokens: false }).ids)
    }
    forced.set(wordId, ids)
  }
  return { tokenizer, forced }
}

export function encodeIrodoriText(tokenizer, text, { splitRare = true, bosId } = {}) {
  const ids = tokenizer.tokenizer.encode(normalizeIrodoriText(text), { add_special_tokens: false }).ids.flatMap(id => splitRare ? (tokenizer.forced.get(id) || [id]) : [id])
  return bosId == null ? ids : [bosId, ...ids]
}

function tensor(ort, data, dims, type = 'float32') { return new ort.Tensor(type, data, dims) }
function ones(length) { return new Float32Array(length).fill(1) }
function zeros(length) { return new Float32Array(length) }
function f32(value) { return new Float32Array([value]) }
function int64(values) { return BigInt64Array.from(values, BigInt) }

function standardNormalNoise(length, seed) {
  const output = new Float32Array(length)
  let index = 0
  while (index < length) {
    seed = (1664525 * seed + 1013904223) >>> 0
    const u1 = Math.max(seed / 0x100000000, Number.EPSILON)
    seed = (1664525 * seed + 1013904223) >>> 0
    const u2 = seed / 0x100000000
    const radius = Math.sqrt(-2 * Math.log(u1))
    output[index++] = radius * Math.cos(2 * Math.PI * u2)
    if (index < length) output[index++] = radius * Math.sin(2 * Math.PI * u2)
  }
  return output
}

function findFlatteningPoint(latent, frameCount) {
  const windowFrames = 20
  for (let start = 0; start < frameCount; start++) {
    const count = windowFrames * LATENT_DIM
    let sum = 0, sumSquares = 0
    for (let offset = 0; offset < count; offset++) {
      const frame = start + Math.floor(offset / LATENT_DIM)
      const value = frame < frameCount ? latent[frame * LATENT_DIM + (offset % LATENT_DIM)] : 0
      sum += value
      sumSquares += value * value
    }
    const mean = sum / count
    const std = Math.sqrt(Math.max(0, sumSquares / count - mean * mean))
    if (std < 0.05 && Math.abs(mean) < 0.1) return start
  }
  return frameCount
}

function wavFromFloat(samples) {
  const pcm = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const value = Math.max(-1, Math.min(1, Number.isFinite(samples[i]) ? samples[i] : 0))
    pcm.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8)
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22)
  header.writeUInt32LE(SAMPLE_RATE, 24); header.writeUInt32LE(SAMPLE_RATE * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34)
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([header, pcm])
}

export function createIrodoriMfInference({ ort, modelsDir }) {
  if (!ort?.InferenceSession || !ort?.Tensor) throw new Error('An ONNX Runtime Web module is required.')
  if (!modelsDir) throw new Error('modelsDir is required.')
  let loadPromise
  async function load() {
    if (loadPromise) return loadPromise
    loadPromise = (async () => {
      const tokenizerDir = join(modelsDir, 'tokenizer')
      const [tokenizerJSON, tokenizerConfigText] = await Promise.all([
        readFile(join(tokenizerDir, 'tokenizer.json'), 'utf8'), readFile(join(tokenizerDir, 'tokenizer_config.json'), 'utf8')
      ])
      const config = JSON.parse(tokenizerConfigText)
      const rare = makeRareTokenizer(tokenizerJSON, config)
      const originalTokenizer = new Tokenizer(JSON.parse(tokenizerJSON), config)
      const bosId = originalTokenizer.token_to_id(config.bos_token)
      const padId = originalTokenizer.token_to_id(config.pad_token)
      if (bosId == null || padId == null) throw new Error('Tokenizer BOS/PAD token is missing from vocabulary.')
      const names = ['text_encoder_int8.onnx','speaker_encoder.onnx','duration.onnx','context_kv.onnx','dit_step_int8.onnx','dacvae_decode.onnx']
      const sessions = await Promise.all(names.map(name => ort.InferenceSession.create(join(modelsDir, name), { executionProviders: ['wasm'] })))
      return { rare, bosId, padId, captionTokenizer: originalTokenizer, sessions: Object.fromEntries(names.map((n, i) => [n.replace('.onnx',''), sessions[i]])) }
    })()
    try { return await loadPromise } catch (error) { loadPromise = null; throw error }
  }
  return {
    async synthesize(text, { caption = '落ち着いた声で自然に話す。', onProgress = () => {} } = {}) {
      const started = performance.now()
      const state = await load()
      const { sessions } = state
      const textIds = encodeIrodoriText(state.rare, text, { bosId: state.bosId })
      const captionIds = [state.bosId, ...state.captionTokenizer.encode(caption, { add_special_tokens: false }).ids]
      const textMask = ones(textIds.length), captionMask = ones(captionIds.length)
      const runText = await sessions.text_encoder_int8.run({ input_ids: tensor(ort, int64(textIds), [1, textIds.length], 'int64'), mask: tensor(ort, textMask, [1, textMask.length]) })
      const textState = runText.text_state
      const speaker = await sessions.speaker_encoder.run({ ref_latent: tensor(ort, zeros(4 * LATENT_DIM), [1,4,LATENT_DIM]), mask: tensor(ort, zeros(4), [1,4]) })
      const captionResult = await sessions.text_encoder_int8.run({ input_ids: tensor(ort, int64(captionIds), [1, captionIds.length], 'int64'), mask: tensor(ort, captionMask, [1, captionMask.length]) })
      const duration = await sessions.duration.run({ text_state: textState, text_mask: tensor(ort, textMask, [1,textMask.length]), speaker_state: speaker.speaker_state, has_speaker: tensor(ort, zeros(1), [1]), caption_state: captionResult.text_state, caption_mask: tensor(ort, captionMask, [1,captionMask.length]), has_caption: tensor(ort, ones(1), [1]) })
      const logFrames = Number(duration.log_frames.data[0])
      const frames = Math.max(13, Math.min(750, Math.round(Math.expm1(logFrames))))
      const kv = await sessions.context_kv.run({ text_state: textState, speaker_state: speaker.speaker_state, caption_state: captionResult.text_state })
      let seed = (Date.now() ^ (textIds.length * 0x9e3779b9)) >>> 0
      const x = standardNormalNoise(frames * LATENT_DIM, seed)
      const ditInputs = new Set(sessions.dit_step_int8.inputNames)
      const kvInputs = Object.fromEntries(Object.entries(kv).filter(([name]) => ditInputs.has(name)))
      for (let step=0; step<4; step++) {
        const current = 1 - step * 0.25, next = current - 0.25
        const feed = {
          text_mask: tensor(ort,textMask,[1,textMask.length]), speaker_mask: speaker.speaker_mask,
          caption_mask: tensor(ort,captionMask,[1,captionMask.length]), speaker_kv_scales: tensor(ort,ones(12),[12]),
          x_t: tensor(ort,x,[1,frames,LATENT_DIM]), t: tensor(ort,f32(current),[1]), delta_t: tensor(ort,f32(0.25),[1]), ...kvInputs
        }
        const out = await sessions.dit_step_int8.run(feed)
        const velocity = out[sessions.dit_step_int8.outputNames[0]].data
        for (let i=0;i<x.length;i++) x[i] += Number(velocity[i]) * (next-current)
        onProgress({ stage:'inference', step:step+1, totalSteps:4, frames })
      }
      const flatteningPoint = findFlatteningPoint(x, frames)
      const decoded = await sessions.dacvae_decode.run({ latent: tensor(ort,x,[1,frames,LATENT_DIM]) })
      const waveTensor = decoded[sessions.dacvae_decode.outputNames[0]]
      let wave = Float32Array.from(waveTensor.data, Number)
      const rawWaveLength = wave.length
      let rawPeak = 0
      for (const value of wave) rawPeak = Math.max(rawPeak, Math.abs(value))
      const targetSamples = flatteningPoint * HOP > 0 ? Math.min(frames * HOP, flatteningPoint * HOP) : frames * HOP
      wave = wave.slice(0, Math.min(wave.length, targetSamples))
      const audio = wavFromFloat(wave)
      let peak=0, sumSq=0
      for (const v of wave) { peak=Math.max(peak,Math.abs(v)); sumSq += v*v }
      const seconds=wave.length/SAMPLE_RATE, elapsedSeconds=(performance.now()-started)/1000
      return { audio, sampleRate:SAMPLE_RATE, channels:1, frames, durationSeconds:seconds, metrics:{ peak, rms:Math.sqrt(sumSq/Math.max(1,wave.length)), rawWaveLength, rawPeak, elapsedSeconds, rtf:elapsedSeconds/Math.max(seconds,Number.EPSILON), backend:'onnxruntime-web-wasm-cpu' } }
    }
  }
}
