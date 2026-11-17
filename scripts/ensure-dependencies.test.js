import { expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ensureDependencies } from './ensure-dependencies.js'

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), 'kanafish-dependency-check-'))
  writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^19.0.0' } }))
  writeFileSync(join(root, 'bun.lock'), 'initial lockfile\n')
  return root
}

test('installs only when dependency inputs change', () => {
  const root = makeProject()
  try {
    let installs = 0
    const install = () => {
      installs += 1
      return true
    }
    const quiet = () => {}

    expect(ensureDependencies(root, install, quiet)).toBe(true)
    expect(installs).toBe(1)
    expect(ensureDependencies(root, install, quiet)).toBe(true)
    expect(installs).toBe(1)

    writeFileSync(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '^19.1.0' } }))
    expect(ensureDependencies(root, install, quiet)).toBe(true)
    expect(installs).toBe(2)
    writeFileSync(join(root, 'bun.lock'), 'updated lockfile\n')
    expect(ensureDependencies(root, install, quiet)).toBe(true)
    expect(installs).toBe(3)
    expect(readFileSync(join(root, 'node_modules', '.kanafish-dependency-state'), 'utf8')).toMatch(/^[a-f0-9]{64}\n$/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('does not cache a failed install, so the next dev run retries', () => {
  const root = makeProject()
  try {
    expect(ensureDependencies(root, () => false, () => {})).toBe(false)
    expect(ensureDependencies(root, () => true, () => {})).toBe(true)
    expect(ensureDependencies(root, () => { throw new Error('unexpected reinstall') }, () => {})).toBe(true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
