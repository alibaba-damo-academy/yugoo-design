/** Small package-owned desktop templates/helpers; never includes a runtime or profile. */
import assert from 'node:assert/strict'
import { cp, lstat, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { qwenWorkNativeExecutionReference } from './qwenwork-package.mjs'
import { copyComponentSkill } from './component-skill-package.mjs'
import { prepareStudioAuthoringMaterial, writeStudioAuthoringMaterial } from '../../scripts/studio-authoring-material.mjs'

const here = dirname(fileURLToPath(import.meta.url))
export const DESKTOP_MATERIAL_PATH = 'payload/desktop-preparation'
const modules = ['browser-access.mjs', 'native-hook-transport.mjs', 'windows-private-storage.mjs', 'windows-native-platform.mjs',
  'qwenwork-hook-transport.mjs', 'qwenwork-connection.mjs', 'workbuddy-context-probe.mjs', 'workbuddy-message-probe.mjs',
  'workbuddy-mcp-relay.mjs', 'workbuddy-relay-probe.mjs', 'workbuddy-relay-service.mjs', 'workbuddy-ui-probes.mjs', 'workbuddy-panel-mcp.mjs']

export async function stageDesktopPreparationMaterials(destination, { companionRoot = here, licenseRoot = join(here, '../..') } = {}) {
  await mkdir(destination)
  async function copy(source, target) {
    const info = await lstat(source)
    assert.ok(!info.isSymbolicLink(), 'Desktop source symlink rejected')
    if (info.isDirectory()) {
      await mkdir(target, { recursive: true })
      for (const name of (await readdir(source)).sort()) { assert.notEqual(name, 'node_modules'); await copy(join(source, name), join(target, name)) }
    } else { assert.ok(info.isFile()); await mkdir(dirname(target), { recursive: true }); await cp(source, target, { errorOnExist: true, force: false }) }
  }
  // Keep the shared Windows helpers together; the Companion entries only forward in-repo.
  const moduleSource = name => join(companionRoot, name.startsWith('windows-') ? '../studio/src/node' : 'src', name)
  for (const name of ['qwenwork-package.mjs', 'workbuddy-package.mjs']) await copy(join(companionRoot, name), join(destination, name))
  for (const name of modules) await copy(moduleSource(name), join(destination, 'src', name))
  await copy(join(companionRoot, 'hosts/workbuddy/design-SKILL.md'), join(destination, 'hosts/workbuddy/design-SKILL.md'))
  const qwen = join(destination, 'qwenwork-template')
  await copy(join(companionRoot, 'plugin-qwenwork/design-system'), qwen)
  await copyComponentSkill(qwen, join(companionRoot, 'plugin/design-system/skills/design-component/SKILL.md'))
  const creatorMethods = await prepareStudioAuthoringMaterial(join(companionRoot, '../..'))
  await writeStudioAuthoringMaterial(qwen, creatorMethods)
  await writeStudioAuthoringMaterial(join(destination, 'studio-authoring-template'), creatorMethods)
  for (const name of ['native-hook-transport.mjs', 'windows-private-storage.mjs', 'windows-native-platform.mjs', 'qwenwork-hook-transport.mjs', 'qwenwork-connection.mjs']) await copy(moduleSource(name), join(qwen, 'scripts', name))
  const sharedPath = 'plugin/design-system/skills/design-panel/native-execution.md'
  await copy(join(companionRoot, sharedPath), join(destination, sharedPath))
  const shared = await readFile(join(destination, sharedPath), 'utf8')
  await writeFile(join(qwen, 'skills/yugoo/native-execution.md'), qwenWorkNativeExecutionReference(shared), { flag: 'wx' })
  for (const name of ['LICENSE', 'NOTICE', 'THIRD_PARTY_NOTICES.md']) {
    await copy(join(licenseRoot, name), join(destination, name))
    await copy(join(licenseRoot, name), join(qwen, name))
  }
  const files = {}
  async function inventory(dir) {
    for (const name of (await readdir(dir)).sort()) {
      const path = join(dir, name), info = await lstat(path)
      if (info.isDirectory()) await inventory(path)
      else files[relative(destination, path).split('\\').join('/')] = createHash('sha256').update(await readFile(path)).digest('hex')
    }
  }
  await inventory(destination)
  await writeFile(join(destination, 'materials.json'), JSON.stringify({ schemaVersion: 1, scope: 'desktop-preparation-only', files }, null, 2) + '\n', { flag: 'wx' })
  return { destination, fileCount: Object.keys(files).length, registered: false }
}
