/** Build-time only: publish the existing inspector's data, never a runtime TS reader. */
import assert from 'node:assert/strict'
import { mkdir, lstat, readFile, readdir, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { createRequire } from 'node:module'
import { execFile } from 'node:child_process'

export const PANEL_AUTHORING_RESOURCE = 'authoring/panel-components.json'
const inspector = '.agents/skills/design-bundle-creator/scripts/inspect-panel-component.mjs'
const generator = 'scripts/generate-panel-authoring-material.mjs'
const maxBytes = 4_000_000

/** Include every example the inspector actually scans, also across non-Web Kits. */
export async function panelAuthoringInputPaths(workspace) {
  const paths = [inspector, generator, 'docs/dsl-spec.md', 'docs/panel-uiux-standard.md', 'scripts/companion-authoring-material.mjs']
  for (const entry of await readdir(join(workspace, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('skills-')) continue
    const packageRoot = join(workspace, 'packages', entry.name)
    const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
    paths.push(`packages/${entry.name}/package.json`)
    const contentPath = manifest.designSystem?.kit?.bundles ?? manifest.designSystem?.kit?.skills ?? './skills'
    const root = join(packageRoot, contentPath)
    let bundles
    try { bundles = await readdir(root, { withFileTypes: true }) }
    catch (error) { if (error.code === 'ENOENT') continue; throw error }
    for (const bundle of bundles) if (bundle.isDirectory()) {
      const path = `packages/${entry.name}/${contentPath.replace(/^\.\//, '')}/${bundle.name}/panel.yaml`
      try { await lstat(join(workspace, path)); paths.push(path) }
      catch (error) { if (error.code !== 'ENOENT') throw error }
    }
  }
  return paths.sort()
}

export async function preparePanelAuthoringMaterial(workspace) {
  workspace = resolve(workspace)
  const require = createRequire(join(workspace, 'package.json'))
  const loader = pathToFileURL(require.resolve('tsx/esm')).href
  // A new process owns each module graph, so source edits remain visible without
  // accumulating deactivated loaders or namespace caches in the build process.
  const bytes = await new Promise((resolveBytes, reject) => {
    execFile(process.execPath, ['--import', loader, join(workspace, generator), workspace], {
      cwd: workspace, encoding: 'buffer', maxBuffer: maxBytes,
      timeout: 120_000, killSignal: 'SIGKILL',
      env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '' },
    }, (error, stdout, stderr) => {
      if (error) {
        const detail = stderr.toString('utf8').slice(0, 8192).trim()
        reject(new Error(`Authoring reference generation failed: ${error.message}${detail ? `\n${detail}` : ''}`, { cause: error }))
      } else resolveBytes(stdout)
    })
  })
  assert.ok(bytes.length <= maxBytes, 'Packaged authoring reference exceeds its bounded size')
  return { material: JSON.parse(bytes.toString('utf8')), bytes }
}

export async function writePanelAuthoringMaterial(root, prepared) {
  const path = join(root, PANEL_AUTHORING_RESOURCE)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, prepared.bytes, { flag: 'wx' })
  return path
}

/** Compare with this build's actual source-derived material, including docs/types/examples. */
export async function verifyPanelAuthoringMaterial(root, prepared) {
  const path = join(root, PANEL_AUTHORING_RESOURCE)
  const info = await lstat(path)
  assert.ok(info.isFile() && !info.isSymbolicLink(), 'Authoring reference must be a regular file')
  assert.ok(info.size <= maxBytes, 'Packaged authoring reference exceeds its bounded size')
  const material = JSON.parse(await readFile(path, 'utf8'))
  assert.ok(isDeepStrictEqual(material, prepared.material), 'Authoring reference is stale or incomplete for the current source')
  return path
}
