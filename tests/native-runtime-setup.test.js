import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { access, chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  createNativeRuntimeSetup,
  getNativeRuntimeInstallPaths,
  NATIVE_RUNTIME_BUILD_RESERVE_BYTES,
  NATIVE_RUNTIME_PLANS
} from '../src/main/tts/nativeRuntimeSetup.js'
import { createQwenRuntime, supportsCodecCppTtsServer } from '../src/main/tts/qwenRuntime.js'

const HELP_OUTPUT = `Usage: tts-server [options]\n  --model MODEL\n  --backbone BACKBONE\n  --host HOST\n  --port PORT\n  --api-key KEY\n  --n-threads N\nResponse formats: wav, pcm`

async function makeFixture({ availableBytes = NATIVE_RUNTIME_BUILD_RESERVE_BYTES * 2, platform = 'linux', arch = 'x64', wrongRevision = false, onProgress = () => {}, helpOutput = HELP_OUTPUT, extraEnv = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'kanafish-native-runtime-'))
  const toolDirectory = join(root, 'tools')
  const userDataDir = join(root, 'user-data')
  await mkdir(toolDirectory, { recursive: true })
  await mkdir(userDataDir, { recursive: true })
  const toolNames = platform === 'win32' ? ['git.exe', 'cmake.exe', 'ninja.exe', 'bash.exe', 'cc.exe', 'c++.exe'] : ['git', 'cmake', 'ninja', 'bash', 'cc', 'c++']
  for (const name of toolNames) {
    const path = join(toolDirectory, name)
    await writeFile(path, '#!/bin/sh\nexit 0\n')
    await chmod(path, 0o755)
  }

  const calls = []
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter()
    child.stdout = new PassThrough()
    child.stderr = new PassThrough()
    child.kill = (signal) => {
      child.stdout.end()
      child.stderr.end()
      setTimeout(() => child.emit('close', null, signal), 0)
      return true
    }
    calls.push({ command, args: [...args], env: options.env, cwd: options.cwd })
    setTimeout(async () => {
      try {
        const executable = basename(command).replace(/\.exe$/i, '')
        let stdout = ''
        let stderr = ''
        let code = 0
        if (executable === 'cmake' && args[0] === '--version') stdout = 'cmake version 3.30.0\n'
        if (executable === 'git' && args[0] === 'clone') await mkdir(args.at(-1), { recursive: true })
        if (executable === 'git' && args[0] === '-C' && args[2] === 'rev-parse') stdout = `${wrongRevision ? '0'.repeat(40) : NATIVE_RUNTIME_PLANS.codecCpp.revision}\n`
        if (executable === 'cmake' && args[0] === '--install') {
          const prefix = args[args.indexOf('--prefix') + 1]
          const bin = join(prefix, 'bin')
          await mkdir(bin, { recursive: true })
          const binary = join(bin, 'tts-server')
          await writeFile(binary, '#!/bin/sh\nexit 0\n')
          await chmod(binary, 0o755)
        }
        if (executable === 'tts-server' && args[0] === '--help') stdout = helpOutput
        setTimeout(() => {
          child.stdout.end(stdout)
          child.stderr.end(stderr)
          setTimeout(() => child.emit('close', code, null), 0)
        }, 0)
      } catch (error) {
        child.stderr.end(error?.message || String(error))
        setTimeout(() => child.emit('close', 1, null), 0)
      }
    }, 0)
    return child
  }
  const manager = createNativeRuntimeSetup({
    userDataDir,
    env: { PATH: toolDirectory, TEST_TOKEN: 'not-for-child', AWS_ACCESS_KEY_ID: 'not-for-child', ...extraEnv },
    platform,
    arch,
    spawnImpl,
    getFilesystemStats: async () => ({ bavail: Math.floor(availableBytes / 4096), bsize: 4096 }),
    onProgress
  })
  return { root, userDataDir, manager, calls, spawnImpl }
}

async function clean(fixture) {
  await rm(fixture.root, { recursive: true, force: true })
}

test('native setup status blocks unsupported platforms and missing build prerequisites', async () => {
  const unsupported = await makeFixture({ platform: 'win32' })
  try {
    const status = await unsupported.manager.getStatus('codecCpp')
    expect(status.supportedPlatform).toBe(false)
    expect(status.canBuild).toBe(false)
    expect(status.blockers.join(' ')).toContain('Windows')
  } finally {
    await clean(unsupported)
  }

  const missing = await makeFixture()
  try {
    await rm(join(missing.root, 'tools'), { recursive: true, force: true })
    await mkdir(join(missing.root, 'empty-tools'))
    const manager = createNativeRuntimeSetup({
      userDataDir: missing.userDataDir,
      env: { PATH: join(missing.root, 'empty-tools') },
      getFilesystemStats: async () => ({ bavail: 10_000_000, bsize: 4096 })
    })
    const status = await manager.getStatus('nemoSpeech')
    expect(status.canBuild).toBe(false)
    expect(status.blockers.join(' ')).toContain('Install git')
    expect(status.blockers.join(' ')).toContain('CMake 3.26')
  } finally {
    await clean(missing)
  }
})

test('native setup status blocks an insufficient free-space budget before any build starts', async () => {
  const fixture = await makeFixture({ availableBytes: NATIVE_RUNTIME_BUILD_RESERVE_BYTES - 1 })
  try {
    const status = await fixture.manager.getStatus('codecCpp')
    expect(status.canBuild).toBe(false)
    expect(status.blockers.join(' ')).toContain('At least 8 GiB free')
  } finally {
    await clean(fixture)
  }
})

test('install paths are revision-pinned and app-private', async () => {
  const userDataDir = '/tmp/kanafish-app-data'
  const paths = getNativeRuntimeInstallPaths(userDataDir, 'codecCpp')
  expect(paths.versionDirectory).toBe(join(userDataDir, 'native-runtimes', 'codec.cpp', NATIVE_RUNTIME_PLANS.codecCpp.revision))
  expect(paths.executablePath).toBe(join(paths.versionDirectory, 'install', 'bin', 'tts-server'))
})

test('native setup locks concurrent builds and cancellation is honored before the next child process', async () => {
  let manager
  let cancelOnProgress = false
  const fixture = await makeFixture({
    onProgress: (progress) => {
      if (cancelOnProgress && progress.stage === 'source') void manager.cancel('codecCpp')
    }
  })
  manager = fixture.manager
  try {
    const first = manager.setup('codecCpp', async () => {})
    await expect(manager.setup('nemoSpeech', async () => {})).rejects.toThrow('already running')
    await manager.cancel('codecCpp')
    await expect(first).rejects.toThrow('cancelled')

    cancelOnProgress = true
    await expect(manager.setup('codecCpp', async () => {})).rejects.toThrow('cancelled')
    expect(fixture.calls.filter((call) => basename(call.command).startsWith('git'))).toHaveLength(0)
  } finally {
    await clean(fixture)
  }
})

test('native setup checks out the exact pin, verifies required CLI capabilities, and installs only under app data', async () => {
  const childEnvironments = []
  const fixture = await makeFixture({
    extraEnv: { GITHUB_TOKEN: 'not-for-child' },
    onProgress: () => {}
  })
  try {
    const originalSetup = fixture.manager.setup
    const result = await originalSetup('codecCpp', async (binary, runCheck) => {
      const check = await runCheck(binary, ['--help'])
      expect(supportsCodecCppTtsServer(check.stdout)).toBe(true)
    })
    expect(result.installed).toBe(true)
    expect(result.executablePath).toBe(getNativeRuntimeInstallPaths(fixture.userDataDir, 'codecCpp').executablePath)
    await access(result.executablePath)
    const restartedRuntime = createQwenRuntime({
      userDataDir: fixture.userDataDir,
      env: { PATH: join(fixture.root, 'empty-path') },
      home: fixture.root,
      fetchImpl: async () => new Response('unused'),
      spawnImpl: fixture.spawnImpl
    })
    const restartedStatus = await restartedRuntime.getStatus()
    expect(restartedStatus.runtimePath).toBe(result.executablePath)
    expect(restartedStatus.runtimeReady).toBe(true)
    expect(fixture.calls.some((call) => call.args.includes(NATIVE_RUNTIME_PLANS.codecCpp.revision))).toBe(true)
    for (const call of fixture.calls) if (call.env?.GIT_TERMINAL_PROMPT === '0') childEnvironments.push(call.env)
    expect(childEnvironments.length).toBeGreaterThan(0)
    expect(childEnvironments.every((env) => !env.TEST_TOKEN && !env.AWS_ACCESS_KEY_ID && !env.GITHUB_TOKEN)).toBe(true)
    expect(childEnvironments.every((env) => env.GIT_TERMINAL_PROMPT === '0' && env.GIT_CONFIG_NOSYSTEM === '1')).toBe(true)
  } finally {
    await clean(fixture)
  }
})

test('native setup refuses a source pin mismatch and cleans staged files', async () => {
  const fixture = await makeFixture({ wrongRevision: true })
  try {
    await expect(fixture.manager.setup('codecCpp', async () => {})).rejects.toThrow('Source pin mismatch')
    const paths = getNativeRuntimeInstallPaths(fixture.userDataDir, 'codecCpp')
    await expect(access(paths.versionDirectory)).rejects.toThrow()
  } finally {
    await clean(fixture)
  }
})

test('native setup refuses to install a binary missing required CLI capabilities', async () => {
  const fixture = await makeFixture({ helpOutput: 'Usage: tts-server --unsupported' })
  try {
    await expect(fixture.manager.setup('codecCpp', async (binary, runCheck) => {
      const check = await runCheck(binary, ['--help'])
      if (!supportsCodecCppTtsServer(check.stdout)) throw new Error('Required WAV server features are missing.')
    })).rejects.toThrow('Required WAV server features are missing')
    const paths = getNativeRuntimeInstallPaths(fixture.userDataDir, 'codecCpp')
    await expect(access(paths.executablePath)).rejects.toThrow()
  } finally {
    await clean(fixture)
  }
})

test('native setup status exposes no model weights and accurately reports available build capacity', async () => {
  const fixture = await makeFixture()
  try {
    const status = await fixture.manager.getStatus('nemoSpeech')
    expect(status.modelWeightsIncluded).toBe(false)
    expect(status.changesSystemFiles).toBe(false)
    expect(status.canBuild).toBe(true)
    expect(status.requiredFreeBytes).toBe(NATIVE_RUNTIME_BUILD_RESERVE_BYTES)
    expect(status.installDirectory).toBe(getNativeRuntimeInstallPaths(fixture.userDataDir, 'nemoSpeech').installDirectory)
  } finally {
    await clean(fixture)
  }
})
