// Pure audio helpers for speech recognition: the renderer records the microphone, turns it into 16 kHz mono
// 16-bit PCM WAV, and sends those bytes to the main process. Kept free of DOM APIs so they run under bun test.

export const ASR_SAMPLE_RATE = 16_000
export const ASR_MAX_RECORD_SECONDS = 60

export function downmixToMono(channels) {
  const list = Array.isArray(channels) ? channels.filter(Boolean) : []
  if (!list.length) return new Float32Array(0)
  if (list.length === 1) return Float32Array.from(list[0])
  const length = Math.min(...list.map((channel) => channel.length))
  const mono = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    let sum = 0
    for (const channel of list) sum += channel[index]
    mono[index] = sum / list.length
  }
  return mono
}

// Linear-interpolation resampler, used only when OfflineAudioContext is unavailable. Downsampling averages the
// source window first so speech-band content does not alias badly.
export function resampleLinear(samples, fromRate, toRate) {
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate) || fromRate <= 0 || toRate <= 0) throw new Error('Sample rates must be positive.')
  if (fromRate === toRate) return Float32Array.from(samples)
  const ratio = fromRate / toRate
  const length = Math.max(0, Math.floor(samples.length / ratio))
  const output = new Float32Array(length)
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio
    if (ratio > 1) {
      const start = Math.floor(position)
      const end = Math.min(samples.length, Math.max(start + 1, Math.floor(position + ratio)))
      let sum = 0
      for (let source = start; source < end; source += 1) sum += samples[source]
      output[index] = sum / (end - start)
    } else {
      const left = Math.floor(position)
      const right = Math.min(samples.length - 1, left + 1)
      const fraction = position - left
      output[index] = samples[left] * (1 - fraction) + samples[right] * fraction
    }
  }
  return output
}

export function floatToPcm16(samples) {
  const pcm = new Int16Array(samples.length)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, Number.isFinite(samples[index]) ? samples[index] : 0))
    pcm[index] = Math.round(value * 32767)
  }
  return pcm
}

export function encodeWav16(samples, sampleRate = ASR_SAMPLE_RATE) {
  if (!Number.isInteger(sampleRate) || sampleRate <= 0) throw new Error('A whole positive sample rate is required.')
  const pcm = samples instanceof Int16Array ? samples : floatToPcm16(samples)
  const dataBytes = pcm.length * 2
  const bytes = new Uint8Array(44 + dataBytes)
  const view = new DataView(bytes.buffer)
  const ascii = (offset, text) => { for (let index = 0; index < text.length; index += 1) bytes[offset + index] = text.charCodeAt(index) }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, dataBytes, true)
  for (let index = 0; index < pcm.length; index += 1) view.setInt16(44 + index * 2, pcm[index], true)
  return bytes
}

export function trimToSeconds(samples, sampleRate, maxSeconds = ASR_MAX_RECORD_SECONDS) {
  const limit = Math.floor(sampleRate * maxSeconds)
  return samples.length > limit ? samples.subarray(0, limit) : samples
}

export function peakLevel(samples) {
  let peak = 0
  for (let index = 0; index < samples.length; index += 1) peak = Math.max(peak, Math.abs(samples[index]))
  return peak
}
