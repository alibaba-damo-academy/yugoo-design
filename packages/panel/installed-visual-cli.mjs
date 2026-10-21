import { createRequire } from 'node:module'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

function assertContained(root, path, description) {
  const delta = relative(root, path)
  if (delta === '..' || delta.startsWith('..' + sep) || isAbsolute(delta)) {
    throw new Error(`${description} must belong to the candidate installation`)
  }
}

// Resolve only. Never installs dependencies or starts a process.
export function installedVisualCli(panelDirectory) {
  const panel = realpathSync(panelDirectory)
  const repository = realpathSync(resolve(panel, '../..'))
  const installation = realpathSync(resolve(repository, 'node_modules'))
  assertContained(repository, installation, 'node_modules root')
  const require = createRequire(resolve(panel, 'package.json'))
  const packageFile = realpathSync(require.resolve('tsdown/package.json'))
  assertContained(installation, packageFile, 'tsdown package')
  const metadata = JSON.parse(readFileSync(packageFile, 'utf8'))
  const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin?.tsdown
  if (typeof bin !== 'string' || !bin || isAbsolute(bin)) throw new Error('tsdown must declare a relative CLI binary')
  const packageDirectory = dirname(packageFile)
  const executable = realpathSync(resolve(packageDirectory, bin))
  assertContained(packageDirectory, executable, 'tsdown binary')
  if (!statSync(executable).isFile()) throw new Error('tsdown CLI must be a file')
  return { command: process.execPath, args: [executable, '--config', 'test/visual-browser.config.ts'], version: metadata.version }
}
