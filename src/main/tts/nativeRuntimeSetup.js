import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, mkdir, rename, rm, stat, statfs } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawn } from 'node:child_process'

export const NATIVE_RUNTIME_BUILD_RESERVE_BYTES = 8 * 1024 ** 3
export const NATIVE_RUNTIME_PLANS = Object.freeze({
  codecCpp: Object.freeze({
    key: 'codecCpp',
    runtimeId: 'codec.cpp',
    label: 'codec.cpp for Qwen3-TTS',
    repository: 'https://github.com/mybigday/codec.cpp.git',
    revision: 'd5e385229ea5a0f48fff696fed4699a852aa43b7',
    directory: 'codec.cpp',
    executable: process.platform === 'win32' ? 'tts-server.exe' : 'tts-server'
  }),
  nemoSpeech: Object.freeze({
    key: 'nemoSpeech',
    runtimeId: 'nemo-speech',
    label: 'NeMo-Speech.cpp for Magpie',
    repository: 'https://github.com/NVIDIA/NeMo-Speech.cpp.git',
    revision: '20999cc921d2b14aa58708f61756a8b2e787ba20',
    directory: 'nemo-speech',
    executable: process.platform === 'win32' ? 'nemo-speech.exe' : 'nemo-speech'
  })
})

const MIN_CMAKE_VERSION = [3, 26, 0]
const MAX_COMMAND_OUTPUT = 18_000
const COMMAND_TIMEOUT_MS = 2 * 60 * 60 * 1000
const SECRET_ENV_KEY = /(TOKEN|SECRET|PASSWORD|CREDENTIAL|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|AUTH)/i

function parseVersion(value) {
  const match = String(value).match(/(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : null
}

function isVersionAtLeast(value, minimum) {
  if (!value) return false
  for (let index = 0; index < minimum.length; index += 1) {
    const difference = (value[index] || 0) - minimum[index]
    if (difference !== 0) return difference > 0
  }
  return true
}

function scrubBuildEnvironment(env) {
  const safe = {}
  for (const [key, value] of Object.entries(env || {})) {
    if (!SECRET_ENV_KEY.test(key) && value != null) safe[key] = String(value)
  }
  safe.GIT_TERMINAL_PROMPT = '0'
  safe.GIT_LFS_SKIP_SMUDGE = '1'
  safe.GIT_CONFIG_NOSYSTEM = '1'
  safe.GIT_CONFIG_GLOBAL = '/dev/null'
  safe.GIT_CONFIG_COUNT = '1'
  safe.GIT_CONFIG_KEY_0 = 'credential.helper'
  safe.GIT_CONFIG_VALUE_0 = ''
  return safe
}

async function findExecutable(name, { env, platform }) {
  const executable = platform === 'win32' && !name.toLowerCase().endsWith('.exe') ? `${name}.exe` : name
  for (const directory of String(env.PATH || '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, executable)
    try {
      const info = await stat(candidate)
      if (!info.isFile()) continue
      await access(candidate, platform === 'win32' ? constants.F_OK : constants.X_OK)
      return candidate
    } catch {}
  }
  return ''
}

function appendBounded(current, chunk) {
  return `${current}${chunk.toString('utf8')}`.slice(-MAX_COMMAND_OUTPUT)
}

function cleanOutputLine(value) {
  return String(value).replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\r\n]+/g, ' ').trim().slice(-240)
}

function runProcess(executable, args, {
  spawnImpl,
  env,
  cwd,
  platform,
  timeoutMs = COMMAND_TIMEOUT_MS,
  onChild = () => {},
  onOutput = () => {},
  taskName = 'native setup'
} = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let child
    try {
      child = spawnImpl(executable, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: platform !== 'win32'
      })
    } catch (error) {
      rejectPromise(error)
      return
    }
    onChild(child)
    let stdout = ''
    let stderr = ''
    let settled = false
    let lastOutputAt = 0
    const finish = (error, result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      onChild(null)
      if (error) rejectPromise(error)
      else resolvePromise(result)
    }
    const receive = (stream, chunk) => {
      if (stream === 'stdout') stdout = appendBounded(stdout, chunk)
      else stderr = appendBounded(stderr, chunk)
      const now = Date.now()
      if (now - lastOutputAt >= 500) {
        const line = cleanOutputLine(chunk.toString('utf8').split(/\r?\n/).filter(Boolean).at(-1) || '')
        if (line) onOutput(line)
        lastOutputAt = now
      }
    }
    child.stdout?.on('data', (chunk) => receive('stdout', chunk))
    child.stderr?.on('data', (chunk) => receive('stderr', chunk))
    child.on('error', (error) => finish(error))
    child.on('close', (code, signal) => {
      if (code === 0) finish(null, { stdout, stderr })
      else {
        const tail = cleanOutputLine(stderr || stdout)
        finish(new Error(`${taskName} failed with ${signal || `exit code ${code}`}${tail ? `: ${tail}` : ''}`))
      }
    })
    const timer = setTimeout(() => {
      try {
        if (platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch { try { child.kill('SIGTERM') } catch {} }
      finish(new Error(`${taskName} timed out after ${Math.round(timeoutMs / 60_000)} minutes.`))
    }, timeoutMs)
  })
}

function createNotReadyError(plan, blockers) {
  const details = blockers.length ? blockers.join(' ') : 'Check the build tools and available disk space, then retry.'
  return new Error(`Cannot build ${plan.label} automatically on this device. ${details}`)
}

export function getNativeRuntimeInstallPaths(userDataDir, key, revision = NATIVE_RUNTIME_PLANS[key]?.revision, platform = process.platform) {
  const plan = NATIVE_RUNTIME_PLANS[key]
  if (!plan || !userDataDir) throw new Error(`Unknown native runtime setup: ${key}`)
  const versionDirectory = join(resolve(userDataDir), 'native-runtimes', plan.directory, revision)
  const executableName = platform === 'win32' ? `${plan.executable.replace(/\.exe$/i, '')}.exe` : plan.executable.replace(/\.exe$/i, '')
  return {
    versionDirectory,
    installDirectory: join(versionDirectory, 'install'),
    executablePath: join(versionDirectory, 'install', 'bin', executableName)
  }
}

export function createNativeRuntimeSetup({
  userDataDir,
  home = homedir(),
  env = process.env,
  platform = process.platform,
  arch = process.arch,
  spawnImpl = spawn,
  getFilesystemStats = statfs,
  onProgress = () => {}
} = {}) {
  if (!userDataDir) throw new Error('A Kanafish user-data directory is required to install native runtimes.')
  const safeEnv = scrubBuildEnvironment(env)
  const runtimeRoot = join(resolve(userDataDir), 'native-runtimes')
  let active = null
  let setupPromise = null
  let setupStarting = false

  async function getStatus(key) {
    const plan = NATIVE_RUNTIME_PLANS[key]
    if (!plan) throw new Error(`Unknown native runtime setup: ${key}`)
    const supportedPlatform = (platform === 'linux' || platform === 'darwin') && (arch === 'x64' || arch === 'arm64')
    const backend = platform === 'darwin' && arch === 'arm64' ? 'Metal' : 'CPU'
    const blockers = []
    const toolNames = ['git', 'cmake', 'ninja', 'bash']
    const tools = Object.fromEntries(await Promise.all(toolNames.map(async (name) => [name, await findExecutable(name, { env: safeEnv, platform })])))
    const cCompilerNames = platform === 'darwin' ? ['clang'] : ['cc', 'gcc', 'clang']
    let cCompiler = ''
    for (const name of cCompilerNames) {
      cCompiler = await findExecutable(name, { env: safeEnv, platform })
      if (cCompiler) break
    }
    const compilerNames = platform === 'darwin' ? ['clang++'] : ['c++', 'g++', 'clang++']
    let compiler = ''
    for (const name of compilerNames) {
      compiler = await findExecutable(name, { env: safeEnv, platform })
      if (compiler) break
    }
    tools.cCompiler = cCompiler
    tools.compiler = compiler
    let cmakeVersion = null
    if (tools.cmake) {
      try {
        const result = await runProcess(tools.cmake, ['--version'], { spawnImpl, env: safeEnv, platform, timeoutMs: 10_000, taskName: 'CMake version check' })
        cmakeVersion = parseVersion(result.stdout || result.stderr)
      } catch {}
    }
    let availableFreeBytes = null
    try {
      const filesystem = await getFilesystemStats(userDataDir)
      availableFreeBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
      if (!Number.isFinite(availableFreeBytes)) availableFreeBytes = null
    } catch {}

    if (!supportedPlatform) blockers.push('Automatic source builds are supported here only on x64/arm64 Linux and macOS; use the manual Windows/build guide on this platform.')
    for (const name of toolNames) if (!tools[name]) blockers.push(`Install ${name} and restart Kanafish.`)
    if (!cCompiler) blockers.push(platform === 'darwin' ? 'Install Apple Xcode Command Line Tools (xcode-select --install) for the C compiler.' : 'Install a C compiler (cc, gcc, or clang).')
    if (!compiler) blockers.push(platform === 'darwin' ? 'Install Apple Xcode Command Line Tools (xcode-select --install).' : 'Install a C++17 compiler (g++ or clang++).')
    if (!cmakeVersion || !isVersionAtLeast(cmakeVersion, MIN_CMAKE_VERSION)) blockers.push('CMake 3.26 or newer is required.')
    if (availableFreeBytes == null) blockers.push('Could not read free space on the Kanafish app-data volume.')
    else if (availableFreeBytes < NATIVE_RUNTIME_BUILD_RESERVE_BYTES) blockers.push(`At least ${NATIVE_RUNTIME_BUILD_RESERVE_BYTES / 1024 ** 3} GiB free is required for a source build; ${Math.floor(availableFreeBytes / 1024 ** 3)} GiB is currently available.`)
    if (platform === 'darwin' && arch === 'arm64' && !await findExecutable('xcrun', { env: safeEnv, platform })) blockers.push('Apple Silicon Metal builds require Xcode Command Line Tools (xcode-select --install).')

    return {
      runtimeId: plan.runtimeId,
      supportedPlatform,
      platform,
      arch,
      backend,
      canBuild: blockers.length === 0,
      blockers,
      requiredFreeBytes: NATIVE_RUNTIME_BUILD_RESERVE_BYTES,
      availableFreeBytes,
      cmakeVersion: cmakeVersion?.join('.') || '',
      tools,
      installDirectory: getNativeRuntimeInstallPaths(userDataDir, key, plan.revision, platform).installDirectory,
      modelWeightsIncluded: false,
      changesSystemFiles: false
    }
  }

  async function executeCommand(executable, args, { cwd, tools, stage, message, timeoutMs = COMMAND_TIMEOUT_MS } = {}) {
    if (active?.cancelled) throw new Error('Setup cancelled.')
    onProgress({ runtimeId: active.key, state: 'setup', stage, message })
    if (active?.cancelled) throw new Error('Setup cancelled.')
    const { stdout, stderr } = await runProcess(executable, args, {
      spawnImpl,
      env: safeEnv,
      cwd,
      platform,
      timeoutMs,
      onChild: (child) => { active.child = child },
      onOutput: (line) => onProgress({ runtimeId: active.key, state: 'setup', stage, message: line }),
      taskName: message
    })
    active.child = null
    return { stdout, stderr }
  }

  async function cancel(key) {
    if (!active || (key && active.key !== key)) return { cancelled: false }
    active.cancelled = true
    const child = active.child
    if (child) {
      try {
        if (platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGTERM')
        else child.kill('SIGTERM')
      } catch {
        try { child.kill('SIGTERM') } catch {}
      }
    }
    return { cancelled: true }
  }

  async function setup(key, verifyBinary) {
    const plan = NATIVE_RUNTIME_PLANS[key]
    if (!plan) throw new Error(`Unknown native runtime setup: ${key}`)
    if (setupPromise || setupStarting) throw new Error('Another native runtime build is already running. Wait for it to finish or cancel it.')
    setupStarting = true
    let stageDirectory = ''
    active = { key, child: null, cancelled: false }
    try {
      const readiness = await getStatus(key)
      if (!readiness.canBuild) {
        active = null
        throw createNotReadyError(plan, readiness.blockers)
      }
      const stageId = randomUUID()
      const parentDirectory = join(runtimeRoot, plan.directory)
      stageDirectory = join(parentDirectory, `.staging-${stageId}`)
      const sourceDirectory = join(stageDirectory, 'source')
      const buildDirectory = plan.key === 'codecCpp' ? join(sourceDirectory, 'build') : join(sourceDirectory, 'build', platform === 'darwin' && arch === 'arm64' ? 'metal-tts' : 'cpu-tts')
      const task = (async () => {
      try {
        if (active.cancelled) throw new Error('Setup cancelled.')
        await mkdir(parentDirectory, { recursive: true })
        const filesystem = await getFilesystemStats(userDataDir)
        const availableBytes = Number(filesystem.bavail) * Number(filesystem.bsize)
        if (!Number.isFinite(availableBytes) || availableBytes < NATIVE_RUNTIME_BUILD_RESERVE_BYTES) {
          throw createNotReadyError(plan, [`At least ${NATIVE_RUNTIME_BUILD_RESERVE_BYTES / 1024 ** 3} GiB free is required; ${Number.isFinite(availableBytes) ? `${Math.floor(availableBytes / 1024 ** 3)} GiB is available` : 'free space could not be read'}.`])
        }
        if (active.cancelled) throw new Error('Setup cancelled.')
        const git = readiness.tools.git
        const cmake = readiness.tools.cmake
        const bash = readiness.tools.bash
        await mkdir(stageDirectory, { recursive: true })
        const commonCloneArgs = ['clone', '--filter=blob:none', '--no-checkout', plan.repository, sourceDirectory]
        await executeCommand(git, commonCloneArgs, { cwd: parentDirectory, tools: readiness.tools, stage: 'source', message: `Downloading pinned ${plan.runtimeId} source (${plan.revision.slice(0, 12)}…)…`, timeoutMs: 30 * 60 * 1000 })
        await executeCommand(git, ['-C', sourceDirectory, 'fetch', '--depth=1', 'origin', plan.revision], { cwd: parentDirectory, tools: readiness.tools, stage: 'source', message: 'Fetching the pinned source revision…', timeoutMs: 30 * 60 * 1000 })
        await executeCommand(git, ['-C', sourceDirectory, 'checkout', '--detach', plan.revision], { cwd: parentDirectory, tools: readiness.tools, stage: 'source', message: 'Checking out the pinned revision…' })
        const head = await executeCommand(git, ['-C', sourceDirectory, 'rev-parse', 'HEAD'], { cwd: parentDirectory, tools: readiness.tools, stage: 'verify', message: 'Verifying the source revision…', timeoutMs: 30_000 })
        if (head.stdout.trim() !== plan.revision) throw new Error(`Source pin mismatch: expected ${plan.revision}, got ${head.stdout.trim() || 'no commit id'}.`)
        const submoduleArgs = plan.key === 'codecCpp'
          ? ['-C', sourceDirectory, 'submodule', 'update', '--init', '--depth=1', '--recursive']
          : ['-C', sourceDirectory, 'submodule', 'update', '--init', '--depth=1', 'llama.cpp', 'third_party/cpp-httplib', 'third_party/open_jtalk']
        await executeCommand(git, submoduleArgs, { cwd: parentDirectory, tools: readiness.tools, stage: 'dependencies', message: 'Fetching the source-pinned C++ submodules…', timeoutMs: 45 * 60 * 1000 })

        if (plan.key === 'codecCpp') {
          const configureArgs = ['-S', sourceDirectory, '-B', buildDirectory, '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release']
          if (platform === 'darwin' && arch === 'arm64') configureArgs.push('-DGGML_METAL=ON')
          await executeCommand(cmake, configureArgs, { cwd: sourceDirectory, tools: readiness.tools, stage: 'configure', message: `Configuring codec.cpp for ${readiness.backend}…` })
          await executeCommand(cmake, ['--build', buildDirectory, '--target', 'tts-server', '--parallel', '4'], { cwd: sourceDirectory, tools: readiness.tools, stage: 'compile', message: 'Compiling the pinned codec.cpp tts-server (up to four jobs)…', timeoutMs: COMMAND_TIMEOUT_MS })
        } else {
          const preset = platform === 'darwin' && arch === 'arm64' ? 'metal-tts' : 'cpu-tts'
          await executeCommand(bash, ['scripts/configure.sh', preset, '-DNEMO_SPEECH_BUILD_HTTP=ON', '-DNEMO_SPEECH_TTS_WITH_JA=ON'], { cwd: sourceDirectory, tools: readiness.tools, stage: 'configure', message: `Configuring NeMo-Speech.cpp ${preset} with Japanese TTS and HTTP…` })
          await executeCommand(cmake, ['--build', '--preset', preset, '--parallel', '4'], { cwd: sourceDirectory, tools: readiness.tools, stage: 'compile', message: 'Compiling the pinned NeMo-Speech.cpp runtime (up to four jobs)…', timeoutMs: COMMAND_TIMEOUT_MS })
        }

        const installStage = join(stageDirectory, 'install')
        await mkdir(installStage, { recursive: true })
        await executeCommand(cmake, ['--install', buildDirectory, '--prefix', installStage], { cwd: sourceDirectory, tools: readiness.tools, stage: 'install', message: 'Installing the native runtime in Kanafish app data…' })
        const executableName = platform === 'win32' ? `${plan.executable.replace(/\.exe$/i, '')}.exe` : plan.executable.replace(/\.exe$/i, '')
        const stagedExecutable = join(installStage, 'bin', executableName)
        await access(stagedExecutable, platform === 'win32' ? constants.F_OK : constants.X_OK).catch(() => {
          throw new Error(`Build finished but the expected executable was not installed at ${stagedExecutable}.`)
        })
        onProgress({ runtimeId: key, state: 'setup', stage: 'health-check', message: 'Checking the built server features before installation…' })
        if (typeof verifyBinary !== 'function') throw new Error('No runtime health check was provided; refusing to mark this build ready.')
        await verifyBinary(stagedExecutable, async (executable, args) => executeCommand(executable, args, {
          cwd: installStage,
          tools: readiness.tools,
          stage: 'health-check',
          message: 'Running runtime feature check…',
          timeoutMs: 30_000
        }))
        if (active.cancelled) throw new Error('Setup cancelled.')
        await rm(buildDirectory, { recursive: true, force: true })
        const finalPaths = getNativeRuntimeInstallPaths(userDataDir, key, plan.revision, platform)
        await mkdir(join(runtimeRoot, plan.directory), { recursive: true })
        const backupDirectory = `${finalPaths.versionDirectory}.previous-${stageId}`
        let movedPrevious = false
        try {
          await rename(finalPaths.versionDirectory, backupDirectory)
          movedPrevious = true
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error
        }
        try {
        await rename(stageDirectory, finalPaths.versionDirectory)
        } catch (error) {
          if (movedPrevious) await rename(backupDirectory, finalPaths.versionDirectory).catch(() => {})
          throw error
        }
        if (movedPrevious) await rm(backupDirectory, { recursive: true, force: true }).catch(() => {})
        onProgress({ runtimeId: key, state: 'complete', stage: 'complete', message: `${plan.label} built and verified in Kanafish app data.` })
        return { installed: true, runtimeId: plan.runtimeId, executablePath: finalPaths.executablePath, installDirectory: finalPaths.versionDirectory }
      } catch (error) {
        if (active?.cancelled) {
          onProgress({ runtimeId: key, state: 'cancelled', message: `${plan.label} setup cancelled. Temporary build files were removed.` })
          throw new Error(`${plan.label} setup was cancelled.`)
        }
        onProgress({ runtimeId: key, state: 'error', message: error?.message || `Could not build ${plan.label}.` })
        throw error
      } finally {
        if (stageDirectory) await rm(stageDirectory, { recursive: true, force: true }).catch(() => {})
        active = null
      }
      })()
      setupPromise = task.finally(() => { setupPromise = null })
      return await setupPromise
    } catch (error) {
      if (active?.key === key && !setupPromise) active = null
      if (stageDirectory) await rm(stageDirectory, { recursive: true, force: true }).catch(() => {})
      throw error
    } finally {
      setupStarting = false
    }
  }

  return { getStatus, setup, cancel }
}
