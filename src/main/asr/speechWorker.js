// A client for `speech worker MODEL` (speech.cpp docs/worker.md): JSON Lines over stdin/stdout, one model per process.
// stdout carries only protocol lines; logs go to stderr, of which a bounded tail is kept for error messages.

const MAX_STDERR = 16_000
const MAX_LINE_BYTES = 8 * 1024 * 1024

export class SpeechWorkerError extends Error {
  constructor(message, { code = '', option = null } = {}) {
    super(message)
    this.name = 'SpeechWorkerError'
    this.code = code
    this.option = option
  }
}

export function createJsonLineSplitter(onLine) {
  let pending = ''
  return (chunk) => {
    pending += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
    if (pending.length > MAX_LINE_BYTES) throw new SpeechWorkerError('speech worker wrote an oversized line.', { code: 'protocol' })
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, '')
      pending = pending.slice(newline + 1)
      if (line.trim()) onLine(line)
      newline = pending.indexOf('\n')
    }
  }
}

export function parseWorkerLine(line) {
  let message
  try {
    message = JSON.parse(line)
  } catch {
    throw new SpeechWorkerError('speech worker wrote a line that is not JSON.', { code: 'protocol' })
  }
  if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') {
    throw new SpeechWorkerError('speech worker wrote a line that is not a protocol message.', { code: 'protocol' })
  }
  return message
}

// The chunk lines and the closing `transcribe` line of one recognition request, PCM as 16-bit LE mono.
export function buildTranscribeLines(id, pcm16, sampleRate, { chunkBytes = 64_000, timestamps = false } = {}) {
  if (typeof id !== 'string' || !id) throw new Error('A request id is required.')
  if (!Number.isInteger(sampleRate) || sampleRate < 8_000 || sampleRate > 48_000) throw new Error('The audio sample rate must be 8–48 kHz.')
  const bytes = Buffer.isBuffer(pcm16) ? pcm16 : Buffer.from(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
  if (bytes.length < 2 || bytes.length % 2) throw new Error('The audio must be whole 16-bit samples.')
  const size = Math.max(2, chunkBytes - (chunkBytes % 2))
  const lines = []
  for (let offset = 0, seq = 0; offset < bytes.length; offset += size, seq += 1) {
    lines.push(JSON.stringify({ type: 'chunk', id, seq, pcm: bytes.subarray(offset, offset + size).toString('base64') }))
  }
  const request = { type: 'transcribe', id, sample_rate: sampleRate }
  if (timestamps) request.timestamps = true
  lines.push(JSON.stringify(request))
  return lines
}

export function createSpeechWorkerClient({
  spawnImpl,
  executable,
  args,
  env,
  cwd,
  startTimeoutMs = 180_000,
  expectedVersion = '',
  expectedProtocol = 0,
  onExit = () => {},
  onStderr = () => {}
}) {
  let child = null
  let ready = null
  let readyInfo = null
  let stderrTail = ''
  let exited = false
  const pending = new Map()

  function failAll(error) {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer)
      entry.reject(error)
    }
    pending.clear()
  }

  function describeExit(code, signal) {
    const tail = stderrTail.trim().split(/\r?\n/).slice(-6).join(' ').slice(-1200)
    return `speech worker stopped${signal ? ` (${signal})` : ` (exit ${code})`}${tail ? `: ${tail}` : ''}`
  }

  function start() {
    if (ready) return ready
    exited = false
    ready = new Promise((resolvePromise, rejectPromise) => {
      let settled = false
      const settle = (error, value) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) rejectPromise(error)
        else resolvePromise(value)
      }
      try {
        child = spawnImpl(executable, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
      } catch (error) {
        settle(error)
        return
      }
      const timer = setTimeout(() => {
        settle(new SpeechWorkerError(`speech worker did not load the model within ${Math.round(startTimeoutMs / 1000)} s.`, { code: 'timeout' }))
        kill()
      }, startTimeoutMs)
      const handleMessage = (message) => {
        if (message.type === 'ready') {
          if (expectedProtocol && message.protocol !== expectedProtocol) {
            settle(new SpeechWorkerError(`speech worker speaks protocol ${message.protocol}; Kanafish expects ${expectedProtocol}.`, { code: 'protocol' }))
            kill()
            return
          }
          if (expectedVersion && message.version !== expectedVersion) {
            settle(new SpeechWorkerError(`speech worker is ${message.version || 'an unknown version'}; Kanafish pins ${expectedVersion}.`, { code: 'version' }))
            kill()
            return
          }
          readyInfo = message
          settle(null, message)
          return
        }
        if (message.type === 'fatal') {
          const detail = message.error || {}
          settle(new SpeechWorkerError(`speech worker could not start: ${detail.message || detail.code || 'unknown error'}`, { code: detail.code || 'fatal', option: detail.option ?? null }))
          return
        }
        if (typeof message.id !== 'string') {
          // An error without an id answers a line the worker could not attribute; fail every request in flight.
          if (message.type === 'error') failAll(new SpeechWorkerError(message.error?.message || 'speech worker refused a line.', { code: message.error?.code || 'error', option: message.error?.option ?? null }))
          return
        }
        const entry = pending.get(message.id)
        if (!entry) return
        if (message.type === 'progress') {
          entry.onProgress?.(Number(message.done) || 0)
          return
        }
        if (message.type === 'end' || message.type === 'error' || message.type === 'cancelled') {
          pending.delete(message.id)
          clearTimeout(entry.timer)
          if (message.type === 'end') entry.resolve(message)
          else if (message.type === 'cancelled') entry.reject(new SpeechWorkerError('Recognition was cancelled.', { code: 'cancelled' }))
          else entry.reject(new SpeechWorkerError(message.error?.message || 'speech worker failed the request.', { code: message.error?.code || 'error', option: message.error?.option ?? null }))
        }
      }
      const splitter = createJsonLineSplitter((line) => {
        let message
        try {
          message = parseWorkerLine(line)
        } catch (error) {
          settle(error)
          failAll(error)
          kill()
          return
        }
        handleMessage(message)
      })
      child.stdout.on('data', (chunk) => {
        try {
          splitter(chunk)
        } catch (error) {
          settle(error)
          failAll(error)
          kill()
        }
      })
      child.stderr?.on('data', (chunk) => {
        const text = chunk.toString('utf8')
        stderrTail = `${stderrTail}${text}`.slice(-MAX_STDERR)
        onStderr(text)
      })
      child.stdin?.on('error', () => {})
      child.on('error', (error) => {
        settle(error)
        failAll(error)
      })
      child.on('close', (code, signal) => {
        exited = true
        const error = new SpeechWorkerError(describeExit(code, signal), { code: 'exited' })
        settle(error)
        failAll(error)
        child = null
        ready = null
        readyInfo = null
        onExit({ code, signal })
      })
    })
    ready.catch(() => {})
    return ready
  }

  function write(line) {
    if (!child || exited || !child.stdin?.writable) throw new SpeechWorkerError('speech worker is not running.', { code: 'exited' })
    child.stdin.write(`${line}\n`)
  }

  async function request(id, lines, { timeoutMs = 120_000, onProgress } = {}) {
    await start()
    if (pending.has(id)) throw new Error(`Request ${id} is already in flight.`)
    return new Promise((resolvePromise, rejectPromise) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        try { write(JSON.stringify({ type: 'cancel', id })) } catch {}
        rejectPromise(new SpeechWorkerError(`speech worker did not answer within ${Math.round(timeoutMs / 1000)} s.`, { code: 'timeout' }))
      }, timeoutMs)
      pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer, onProgress })
      try {
        for (const line of lines) write(line)
      } catch (error) {
        pending.delete(id)
        clearTimeout(timer)
        rejectPromise(error)
      }
    })
  }

  function cancel(id) {
    try { write(JSON.stringify({ type: 'cancel', id })) } catch {}
  }

  function kill(signal = 'SIGTERM') {
    try { child?.kill?.(signal) } catch {}
  }

  async function stop({ graceMs = 3000 } = {}) {
    const current = child
    if (!current) return
    await new Promise((resolvePromise) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(termTimer)
        clearTimeout(killTimer)
        resolvePromise()
      }
      current.once('close', finish)
      // Closing stdin asks the worker to answer what it has and exit 0 (docs/worker.md).
      try { current.stdin?.end() } catch {}
      const termTimer = setTimeout(() => { try { current.kill?.('SIGTERM') } catch {} }, graceMs)
      const killTimer = setTimeout(() => { try { current.kill?.('SIGKILL') } catch {}; finish() }, graceMs * 2)
      termTimer.unref?.()
      killTimer.unref?.()
      if (exited) finish()
    })
  }

  return Object.freeze({
    start,
    request,
    cancel,
    stop,
    get running() { return Boolean(child) && !exited },
    get readyInfo() { return readyInfo },
    get busy() { return pending.size > 0 }
  })
}
