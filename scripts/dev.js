import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDependencies } from './ensure-dependencies.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
if (!ensureDependencies(root)) process.exit(1)

const executable = process.platform === 'win32'
  ? join(root, 'node_modules', '.bin', 'electron-vite.cmd')
  : join(root, 'node_modules', '.bin', 'electron-vite')
const child = spawn(executable, ['dev', ...process.argv.slice(2)], {
  cwd: root,
  env: process.env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

child.on('error', (error) => {
  console.error(`[dev] failed to start electron-vite: ${error.message}`)
  process.exit(1)
})

let shuttingDown = false
function forward(signal) {
  if (shuttingDown) return
  shuttingDown = true
  try {
    child.kill(signal)
  } catch {
    // The child may already have exited.
  }
}
process.on('SIGINT', () => forward('SIGINT'))
process.on('SIGTERM', () => forward('SIGTERM'))

/** Drain terminal capability replies emitted by Chromium before returning to the shell. */
function drainStdin() {
  const { stdin } = process
  if (!stdin.isTTY) return Promise.resolve()

  return new Promise((resolve) => {
    let done = false
    let timer
    const finish = () => {
      if (done) return
      done = true
      clearTimeout(timer)
      stdin.removeListener('data', swallow)
      stdin.pause()
      try {
        stdin.setRawMode(false)
      } catch {
        // Ignore terminals that have already restored their mode.
      }
      resolve()
    }
    const swallow = () => {
      clearTimeout(timer)
      timer = setTimeout(finish, 80)
    }

    timer = setTimeout(finish, 250)
    try {
      stdin.setRawMode(true)
    } catch {
      // Drain in cooked mode when raw mode is unavailable.
    }
    stdin.resume()
    stdin.on('data', swallow)
  })
}

child.on('exit', (code) => {
  void drainStdin().then(() => {
    process.stdout.write('\x1b[?25h\x1b[0m')
    process.exit(code ?? 0)
  })
})
