/** Optional private observation of a normal tsdown build; no release acceptance. */
import assert from 'node:assert/strict'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { captureOutputModuleMap, verifyOutputModuleFiles } from './companion-output-module-map.mjs'

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Observe the existing normal configs without changing their entries or bundling. */
export function withNormalBuildEvidence(label, configs) {
  if (process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR === undefined) return configs
  const observe = (config, index) => {
    const evidence = normalBuildModuleEvidence(`${label}-${index}`, { hashModuleInputs: true })
    const previous = config.hooks?.['build:done']
    assert.ok(previous === undefined || typeof previous === 'function', 'Function build:done hook required')
    return { ...config, hooks: { ...config.hooks, 'build:done': async (...args) => {
      if (previous) await previous(...args)
      await evidence['build:done'](...args)
    } } }
  }
  return Array.isArray(configs) ? configs.map(observe) : observe(configs, 0)
}

export function normalBuildModuleEvidence(label, {
  evidenceDirectory = process.env.YUGOO_BUILD_MODULE_EVIDENCE_DIR,
  workspaceRoot = workspace,
  hashModuleInputs = false,
} = {}) {
  if (evidenceDirectory === undefined) return {}
  assert.match(label, /^[a-z][a-z0-9-]*$/u, 'Safe build label required')
  assert.ok(isAbsolute(workspaceRoot) && isAbsolute(evidenceDirectory), 'Absolute evidence roots required')
  const target = resolve(evidenceDirectory), root = resolve(workspaceRoot)
  const delta = relative(root, target)
  assert.ok(target !== dirname(target) && delta && (delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta)), 'Evidence must be outside workspace')
  return {
    'build:done': async ({ chunks, options }) => {
      // Consume lazy bundler fields synchronously, before the first await.
      const snapshot = captureOutputModuleMap(label, chunks, { workspaceRoot: root, outputRoot: resolve(options.outDir) })
      const verified = await verifyOutputModuleFiles(snapshot)
      if (hashModuleInputs) {
        const ids = new Set(snapshot.outputs.flatMap(output => (output.modules ?? [])
          .filter(module => module.renderedLength > 0).map(module => module.rawId))
          .filter(id => isAbsolute(id) && !id.includes('\0') && !id.includes('?')))
        verified.inputFileSha256 = {}
        for (const id of [...ids].sort()) {
          verified.inputFileSha256[id] = createHash('sha256').update(await readFile(id)).digest('hex')
        }
      }
      await mkdir(target, { recursive: true })
      assert.equal(await realpath(target), target, 'Evidence directory must not traverse symlinks')
      await writeFile(resolve(target, `${label}-output-modules.json`), JSON.stringify({
        ...verified,
        observation: 'normal-tsdown-build-done-hook',
        coverage: 'reported top-level outputs only; nested/prebundled code and copied dependencies are not fully inventoried',
      }, null, 2) + '\n', { flag: 'wx', mode: 0o600 })
    },
  }
}
