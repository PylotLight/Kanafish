import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

const dependencyInputs = ['package.json', 'bun.lock']
const installStateFilename = '.kanafish-dependency-state'

function isMissingFile(error) {
  return error?.code === 'ENOENT'
}

export function dependencyFingerprint(projectRoot) {
  const hash = createHash('sha256')
  for (const input of dependencyInputs) {
    hash.update(input)
    hash.update('\0')
    try {
      hash.update(readFileSync(join(projectRoot, input)))
    } catch (error) {
      if (!isMissingFile(error)) throw error
      hash.update('<missing>')
    }
    hash.update('\0')
  }
  return hash.digest('hex')
}

function runBunInstall(projectRoot) {
  const result = spawnSync(process.execPath, ['install'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit'
  })
  if (result.error) {
    console.error(`[dev] failed to run bun install: ${result.error.message}`)
    return false
  }
  if (result.status !== 0) {
    console.error(`[dev] bun install exited with status ${result.status ?? 'unknown'}`)
    return false
  }
  return true
}

/** Install dependencies when the package manifest or Bun lockfile changes. */
export function ensureDependencies(projectRoot, install = runBunInstall, log = console.log) {
  const nodeModules = join(projectRoot, 'node_modules')
  const stateFile = join(nodeModules, installStateFilename)
  const fingerprint = dependencyFingerprint(projectRoot)

  try {
    if (readFileSync(stateFile, 'utf8').trim() === fingerprint) return true
  } catch (error) {
    if (!isMissingFile(error)) throw error
  }

  log('[dev] dependencies are missing or changed; running bun install')
  if (!install(projectRoot)) return false

  mkdirSync(nodeModules, { recursive: true })
  // bun install may update bun.lock, so fingerprint the inputs after installation.
  writeFileSync(stateFile, `${dependencyFingerprint(projectRoot)}\n`)
  return true
}
