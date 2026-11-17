import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))

function copyPythonFiles(source, destination) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name.endsWith('.pyc')) continue
    const sourcePath = join(source, entry.name)
    const destinationPath = join(destination, entry.name)
    if (entry.isDirectory()) copyPythonFiles(sourcePath, destinationPath)
    else if (entry.isFile() && (entry.name.endsWith('.py') || entry.name.endsWith('.txt'))) copyFileSync(sourcePath, destinationPath)
  }
}

const copyIrodoriResources = {
  name: 'copy-irodori-sidecar-resources',
  writeBundle(options) {
    const outputDirectory = resolve(options.dir || 'out/main')
    const destination = join(outputDirectory, 'tts')
    const source = join(root, 'src', 'main', 'tts')
    mkdirSync(destination, { recursive: true })
    for (const file of ['irodori_sidecar.py', 'irodori-requirements.txt']) {
      copyFileSync(join(source, file), join(destination, file))
    }
    copyPythonFiles(join(source, 'vendor'), join(destination, 'vendor'))
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyIrodoriResources]
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs'
        }
      }
    }
  },
  renderer: {
    root: 'src/renderer',
    plugins: [react()]
  }
})
