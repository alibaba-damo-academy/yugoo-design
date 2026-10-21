/** Install an already-built package through Codex, never through project-local skills. */
import { cp, lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { randomUUID } from 'node:crypto'

const exec = promisify(execFile)
const json = async path => JSON.parse(await readFile(path, 'utf8'))
async function exists(path) {
  try { await lstat(path); return true } catch (e) { if (e.code === 'ENOENT') return false; throw e }
}
async function requireFile(path) {
  if (!(await lstat(path)).isFile()) throw new Error(`Expected a regular file: ${path}`)
}
async function copyPackage(source, target) {
  await cp(source, target, { recursive: true, errorOnExist: true, force: false,
    filter: async path => {
      if ((await lstat(path)).isSymbolicLink()) throw new Error(`Plugin package must not contain symlinks: ${path}`)
      return true
    },
  })
}

export async function installCodex({ packageRoot, userHome = homedir(), run = exec }) {
  const source = resolve(packageRoot)
  const manifest = await json(join(source, '.codex-plugin/plugin.json'))
  if (manifest.name !== 'yugoo-design' || typeof manifest.version !== 'string') throw new Error('Expected a versioned yugoo-design package.')
  for (const file of ['scripts/design.mjs', 'web/index.html', 'web/client.js', '.mcp.json', 'skills/yugoo/SKILL.md', 'skills/design-panel/SKILL.md', 'skills/design-panel/native-execution.md', 'kits/web_app/mindset.md', 'kits/web_app/kit.yaml']) await requireFile(join(source, file))
  const mcp = (await json(join(source, '.mcp.json'))).mcpServers?.['design-system']
  if (mcp?.command !== 'node' || JSON.stringify(mcp.args) !== JSON.stringify(['scripts/design.mjs', 'mcp']) || mcp.cwd !== '.') throw new Error('Invalid design-system MCP entry; no changes made.')
  if (manifest.skills !== './skills/' || manifest.mcpServers !== './.mcp.json') throw new Error('Invalid yugoo-design manifest entries; no changes made.')
  const index = await readFile(join(source, 'web/index.html'), 'utf8')
  for (const match of index.matchAll(/(?:src|href)=["']([^"']+)["']/g)) {
    const path = match[1].replace(/^\//, '')
    if (!path || path.includes('..') || path.includes(':')) throw new Error('Unexpected external or unsafe web entry resource.')
    await requireFile(join(source, 'web', path))
  }
  // Check the native installer before changing anything. No shell interpolation.
  await run('codex', ['plugin', 'add', '--help'])
  const root = join(userHome, '.agents/plugins')
  const marketplacePath = join(root, 'marketplace.json')
  // Codex resolves the implicit personal marketplace's ./plugins paths from home.
  const target = join(userHome, 'plugins/yugoo-design')
  if (source === target || source.startsWith(`${target}/`)) throw new Error('Build outside the installed plugin directory before updating.')
  const original = await exists(marketplacePath) ? await readFile(marketplacePath, 'utf8') : null
  const marketplace = original === null ? { name: 'personal', interface: { displayName: 'Personal' }, plugins: [] } : JSON.parse(original)
  if (!/^[A-Za-z0-9_-]+$/.test(marketplace.name ?? '') || !Array.isArray(marketplace.plugins)) throw new Error('Invalid personal marketplace; no changes made.')
  if (marketplace.plugins.some(entry => entry.name === 'design-system') || await exists(join(userHome, 'plugins/design-system'))) throw new Error('Legacy design-system registration found. Uninstall the exact old selector in Codex, then explicitly archive its retained ~/plugins/design-system package and remove only its personal marketplace entry before installing yugoo-design; retain all projects. No changes made.')
  const native = JSON.parse((await run('codex', ['plugin', 'list', '--json'])).stdout)
  if (!Array.isArray(native.installed)) throw new Error('Unexpected Codex plugin list; no changes made.')
  if (native.installed.some(entry => entry.pluginId?.startsWith('design-system@'))) throw new Error('Legacy design-system plugin is still installed in Codex. Uninstall the exact old selector before installing yugoo-design; no changes made.')
  const matches = marketplace.plugins.filter(entry => entry.name === 'yugoo-design')
  if (matches.length > 1) throw new Error('Duplicate yugoo-design marketplace entries; resolve them before installing.')
  const entry = matches[0]
  if (entry && (entry.source?.source !== 'local' || entry.source?.path !== './plugins/yugoo-design')) throw new Error('Existing yugoo-design uses a different source; no changes made.')
  const hadTarget = await exists(target)
  if (hadTarget && (!entry || (await json(join(target, '.codex-plugin/plugin.json'))).name !== 'yugoo-design')) throw new Error('Unmanaged installation target; no changes made.')
  if (hadTarget && (await lstat(target)).isSymbolicLink()) throw new Error('Installation target must not be a symlink.')
  await mkdir(dirname(target), { recursive: true })
  const id = randomUUID()
  const staged = join(dirname(target), `.design-system-stage-${id}`)
  const backup = hadTarget ? join(dirname(target), `.design-system-backup-${id}`) : null
  await mkdir(root, { recursive: true })
  await copyPackage(source, staged)
  if (backup) await rename(target, backup)
  await rename(staged, target)
  if (!entry) {
    marketplace.plugins.push({ name: 'yugoo-design', source: { source: 'local', path: './plugins/yugoo-design' },
      policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' })
    // Existing registrations are never rewritten during upgrades.
    if ((await exists(marketplacePath) ? await readFile(marketplacePath, 'utf8') : null) !== original) throw new Error('Marketplace changed during installation. Plugin files retained; retry after checking the marketplace.')
    const temporary = `${marketplacePath}.${id}.tmp`
    await writeFile(temporary, `${JSON.stringify(marketplace, null, 2)}\n`, { flag: 'wx' })
    await rename(temporary, marketplacePath)
  }
  const selector = `yugoo-design@${marketplace.name}`
  try {
    const result = await run('codex', ['plugin', 'add', selector, '--json'])
    return { selector, version: manifest.version, target, marketplacePath, backup, result: result.stdout,
      next: 'Start a new Codex thread outside the old test workspace, then use $yugoo new <name>. Existing projects are unchanged.' }
  } catch (error) {
    throw new Error(`Codex installation failed. Package retained at ${target}; previous package: ${backup ?? 'none'}. Retry: codex plugin add ${selector}. ${error.message}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3 || process.argv[2] === '--help') {
    console.log('Usage: node install-codex.mjs /absolute/built/yugoo-design\nInstalls or updates the personal Codex plugin; does not modify projects or project-local test configuration.')
    if (process.argv[2] !== '--help') process.exitCode = 1
  } else installCodex({ packageRoot: process.argv[2] }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1 })
}
