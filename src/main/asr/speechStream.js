import { StringDecoder } from 'node:string_decoder'
import { EventEmitter } from 'node:events'

const MAX_JSON_LINE_BYTES = 1024 * 1024
const MAX_STDERR_BYTES = 16_000
const MAX_PCM_FRAME_BYTES = 256 * 1024

export function buildStreamingAsrArgs(modelPath, vadPath, sampleRate, { device = '', threads = 0 } = {}) {
  if (typeof modelPath !== 'string' || !modelPath.endsWith('.gguf')) throw new Error('Streaming ASR needs the verified local Haas GGUF path.')
  if (typeof vadPath !== 'string' || !vadPath.endsWith('.gguf')) throw new Error('Streaming ASR needs the verified local VAD GGUF path.')
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) throw new Error('The live audio sample rate must be 8–48 kHz.')
  const args = ['asr', modelPath, '--format', 'json', '--vad', vadPath, '--rate', String(sampleRate), '--min-silence-duration-ms', '500', '--speech-pad-ms', '300']
  if (device) args.push('--device', String(device))
  if (Number.isInteger(threads) && threads > 0) args.push('--threads', String(threads))
  args.push('-')
  return args
}

export function parseSpeechJsonEvent(line) {
  let event
  try {
    event = JSON.parse(line)
  } catch {
    throw new Error('speech.cpp wrote a line that is not JSON.')
  }
  if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') {
    throw new Error('speech.cpp wrote an invalid live-ASR event.')
  }
  return event
}

export function createSpeechJsonLineSplitter(onEvent, { maxLineBytes = MAX_JSON_LINE_BYTES } = {}) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  return (chunk) => {
    pending += typeof chunk === 'string' ? chunk : decoder.write(chunk)
    if (Buffer.byteLength(pending, 'utf8') > maxLineBytes) throw new Error('speech.cpp wrote an oversized live-ASR line.')
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, '')
      pending = pending.slice(newline + 1)
      if (line.trim()) onEvent(parseSpeechJsonEvent(line))
      newline = pending.indexOf('\n')
    }
    if (Buffer.byteLength(pending, 'utf8') > maxLineBytes) throw new Error('speech.cpp wrote an oversized live-ASR line.')
  }
}

function toPcmBuffer(input) {
  const bytes = Buffer.isBuffer(input)
    ? input
    : input instanceof Uint8Array
      ? Buffer.from(input.buffer, input.byteOffset, input.byteLength)
      : null
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength % 2 || bytes.byteLength > MAX_PCM_FRAME_BYTES) {
    throw new Error('Live audio frames must be non-empty, even-length PCM16LE and no larger than 256 KB.')
  }
  return bytes
}

export function createSpeechStreamClient({ spawnImpl, executable, args, env, cwd, startupTimeoutMs = 180_000, writeTimeoutMs = 10_000, onEvent = () => {}, onError = () => {}, onStderr = () => {} }) {
  let child = null
  let stderrTail = ''
  let running = false
  let stopping = false
  let startPromise = null
  let stopPromise = null
  const lifecycle = new EventEmitter()

  const reportError = (error) => {
    if (!running && !startPromise) return
    running = false
    lifecycle.emit('closed', error)
    try { onError(error) } catch {}
  }

  function start() {
    if (running) return Promise.resolve()
    if (startPromise) return startPromise
    stopping = false
    startPromise = new Promise((resolvePromise, rejectPromise) => {
      let settled = false
      const settle = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectPromise(error)
        else { running = true; resolvePromise() }
      }
      try {
        child = spawnImpl(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (error) {
        settle(error)
        return
      }
      const timer = setTimeout(() => {
        const error = new Error(`speech.cpp live ASR did not start within ${Math.round(startupTimeoutMs / 1000)} s.`)
        settle(error)
        try { child?.kill?.('SIGTERM') } catch {}
      }, startupTimeoutMs)
      const splitter = createSpeechJsonLineSplitter((event) => {
        try { onEvent(event) } catch (error) { reportError(error); try { child?.kill?.('SIGTERM') } catch {} }
      })
      child.stdout?.on('data', (chunk) => {
        try { splitter(chunk) } catch (error) { reportError(error); try { child?.kill?.('SIGTERM') } catch {} }
      })
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString('utf8')
        stderrTail = `${stderrTail}${text}`.slice(-MAX_STDERR_BYTES)
        try { onStderr(text) } catch {}
      })
      child.stdin?.on('error', (error) => { if (!stopping) reportError(error) })
      child.once?.('spawn', () => settle(null))
      // Test doubles and some compatible spawn adapters may expose a pid but not emit `spawn`.
      if (child.pid && !child.once) settle(null)
      child.on('error', (error) => { settle(error); reportError(error) })
      child.on('close', (code, signal) => {
        const tail = stderrTail.trim().split(/\r?\n/).slice(-5).join(' ').slice(-900)
        const error = new Error(`speech.cpp live ASR stopped${signal ? ` (${signal})` : ` (exit ${code})`}${tail ? `: ${tail}` : ''}`)
        if (!stopping) { settle(error); reportError(error) }
        else lifecycle.emit('closed')
        running = false
        child = null
      })
    }).finally(() => { startPromise = null })
    startPromise.catch(() => {})
    return startPromise
  }

  async function write(input) {
    const bytes = toPcmBuffer(input)
    if (!running || !child || !child.stdin?.writable) throw new Error('The local live-ASR process is not accepting audio.')
    let writable
    try { writable = child.stdin.write(bytes) } catch (error) { reportError(error); throw error }
    if (writable) return
    await new Promise((resolvePromise, rejectPromise) => {
      let settled = false
      const finish = (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        child?.stdin?.removeListener('drain', onDrain)
        child?.stdin?.removeListener('error', onError)
        lifecycle.removeListener('closed', onClosed)
        if (error) rejectPromise(error)
        else resolvePromise()
      }
      const onDrain = () => finish()
      const onError = (error) => finish(error)
      const onClosed = (error) => finish(error || new Error('The local live-ASR process exited while audio was queued.'))
      const timer = setTimeout(() => finish(new Error('Timed out waiting for the local ASR audio pipe.')), writeTimeoutMs)
      child.stdin.once('drain', onDrain)
      child.stdin.once('error', onError)
      lifecycle.once('closed', onClosed)
    })
  }

  function stop({ graceMs = 2_000 } = {}) {
    if (stopPromise) return stopPromise
    const current = child
    if (!current) return Promise.resolve()
    stopping = true
    running = false
    stopPromise = new Promise((resolvePromise) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(termTimer)
        clearTimeout(killTimer)
        lifecycle.removeListener('closed', finish)
        resolvePromise()
      }
      lifecycle.once('closed', finish)
      try { current.stdin?.end() } catch {}
      const termTimer = setTimeout(() => { try { current.kill?.('SIGTERM') } catch {} }, graceMs)
      const killTimer = setTimeout(() => { try { current.kill?.('SIGKILL') } catch {}; finish() }, graceMs * 2)
      termTimer.unref?.()
      killTimer.unref?.()
    }).finally(() => { stopPromise = null })
    return stopPromise
  }

  return Object.freeze({ start, write, stop, get running() { return running }, get stderrTail() { return stderrTail } })
}
