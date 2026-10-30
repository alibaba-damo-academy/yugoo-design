import { validateQwenWorkRuntime, configureQwenWorkPackage, qwenWorkNativeExecutionReference } from './qwenwork-package.mjs'
/** Package already-built assets, without touching a personal plugin installation. */
import { cp, mkdir, mkdtemp, lstat, readdir, readFile, writeFile, appendFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { build } from 'tsdown'
import { packageKnowledge } from './package-knowledge.mjs'
import { prepareBundledLicenseMaterials, copyBundledLicenseMaterials, prepareBrowserLicenseMaterials, copyBrowserLicenseMaterials, BROWSER_LICENSE_NOTICE, prepareBundledJsLicenseMaterials, copyBundledJsLicenseMaterials, BUNDLED_JS_LICENSE_NOTICE } from '../../scripts/companion-bundled-license.mjs'
import { copyOwnLicenseMaterials, OWN_LICENSE_FILES } from '../../scripts/release-own-license.mjs'
import { readOfficialDshJsonInput } from '../../scripts/official-dsh-json-input.mjs'
import { preparePanelAuthoringMaterial, writePanelAuthoringMaterial } from '../../scripts/companion-authoring-material.mjs'
import { prepareStudioAuthoringMaterial, writeStudioAuthoringMaterial } from '../../scripts/studio-authoring-material.mjs'
import { copyComponentSkill } from './component-skill-package.mjs'
import { configureCodexDesktopPackage } from './codex-desktop-package.mjs'
import { prepareCompanionNativeGit, stageCompanionNativeGit, verifyCompanionNativeGit } from '../../scripts/companion-native-git.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const run = promisify(execFile)

async function copyTree(source, target) {
  const info = await lstat(source)
  if (info.isSymbolicLink()) throw new Error(`Plugin source must not include symlinks: ${source}`)
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true })
    for (const name of await readdir(source)) await copyTree(join(source, name), join(target, name))
  } else if (info.isFile()) await cp(source, target, { errorOnExist: true, force: false })
  else throw new Error(`Unsupported plugin source: ${source}`)
}

async function copyOptionalTree(source, target) {
  try { await copyTree(source, target) }
  catch (error) { if (error?.code !== 'ENOENT') throw error }
}

/** The normal package builder's native modules, also used by candidate staging. */
export async function copyNativeHookModules(target, { host, sourceDirectory = join(here, 'src') }) {
  if (!['qoder', 'claude-code', 'qwenwork'].includes(host)) throw new Error('Native Hook package host required.')
  const prefix = host === 'qwenwork' ? 'qwenwork' : host === 'qoder' ? 'qoder' : 'claude'
  await mkdir(join(target, 'scripts'), { recursive: true })
  for (const name of ['native-hook-transport.mjs', 'windows-private-storage.mjs', 'windows-native-platform.mjs', `${prefix}-hook-transport.mjs`, `${prefix}-connection.mjs`]) {
    // Repository compatibility entries cannot be relocated into a plugin.
    const owner = name.startsWith('windows-') ? join(sourceDirectory, '../../studio/src/node') : sourceDirectory
    await copyTree(join(owner, name), join(target, 'scripts', name))
  }
}

/** Preserve the normal builder's host-specific method in every package route. */
export async function copyNativeExecutionReference(target, { host, companionRoot = here }) {
  if (!['qoder', 'claude-code', 'qwenwork'].includes(host)) throw new Error('Native execution reference host required.')
  const shared = await readFile(join(companionRoot, 'plugin/design-system/skills/design-panel/native-execution.md'), 'utf8')
  const text = host === 'qoder'
    ? '# Qoder identity supplement\n\nRead SKILL.md native execution specifics for Qoder taskPath and agent IDs. The operations below are shared; Qoder does not use Codex transcript metadata.\n\n' + shared.replaceAll('Codex', 'Qoder CLI').replace('`codex exec`', '`qodercli -p`')
    : host === 'qwenwork' ? qwenWorkNativeExecutionReference(shared) : shared
  const path = join(target, 'skills/yugoo/native-execution.md')
  try {
    const info = await lstat(path)
    if (!info.isFile() || info.isSymbolicLink() || await readFile(path, 'utf8') !== text) throw new Error('Native execution reference conflicts with the owning method.')
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, text, { flag: 'wx' })
  }
  return path
}

/** The normal standalone Flow script closure, exercised without a whole package copy. */
export async function packageFlowLayout(target) {
  return build({
    config: false,
    entry: { layout: join(here, '../skills-web-app/bundles/flow_design/scripts/layout.mjs') },
    outDir: join(target, 'bundles/flow_design/scripts'),
    format: 'esm', platform: 'node', target: 'node22',
    tsconfig: false, dts: false, clean: false,
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    plugins: [{
      name: 'portable-kit-script-imports',
      generateBundle(_options, bundle) {
        for (const output of Object.values(bundle)) {
          if (output.type !== 'chunk') continue
          for (const dependency of [...output.imports, ...output.dynamicImports]) {
            if (!dependency.startsWith('node:') && !bundle[dependency]) {
              throw new Error(`Unbundled Kit script dependency: ${dependency}`)
            }
          }
        }
      },
    }],
  })
}

export async function packagePlugin(destination, { host = 'codex', qwenworkRuntime, nativeGitArtifactRoot, nodeExecutable } = {}) {
  if (!['codex', 'codex-desktop', 'qoder', 'claude-code', 'qwenwork'].includes(host)) throw new Error('Unsupported package host.')
  const overlayHost = host === 'codex-desktop' ? 'codex' : host
  if (nodeExecutable && host !== 'codex-desktop') throw new Error('Explicit package Node mapping is only supported by --codex-desktop.')
  if (host === 'qwenwork') validateQwenWorkRuntime(qwenworkRuntime)
  const officialInputs = await readOfficialDshJsonInput()
  const authoring = await preparePanelAuthoringMaterial(join(here, '../..'))
  const creatorMethods = await prepareStudioAuthoringMaterial(join(here, '../..'))
  const bundledLicenseEntries = await prepareBundledLicenseMaterials(join(here, '../..'))
  const browserLicenseEntries = await prepareBrowserLicenseMaterials(join(here, '../..'))
  const bundledJsLicenseEntries = await prepareBundledJsLicenseMaterials(join(here, '../..'))
  const target = resolve(destination)
  const native = await prepareCompanionNativeGit(join(here, '../..'), { artifactRoot: nativeGitArtifactRoot })
  if (!['yugoo-design', 'design-system'].includes(basename(target))) throw new Error('Output folder must be named yugoo-design (legacy design-system is also accepted).')
  // Deliberately fail if it exists: never clean an arbitrary output or plugin install.
  await mkdir(target)
  const overlay = { codex: 'plugin', qoder: 'plugin-qoder', 'claude-code': 'plugin-claude', qwenwork: 'plugin-qwenwork' }[overlayHost]
  const manifestDirectory = { codex: '.codex-plugin', qoder: '.qoder-plugin', 'claude-code': '.claude-plugin', qwenwork: '.claude-plugin' }[overlayHost]
  await copyTree(join(here, overlay, 'design-system'), target)
  if (overlayHost !== 'codex') await copyComponentSkill(target)
  await writePanelAuthoringMaterial(target, authoring)
  await writeStudioAuthoringMaterial(target, creatorMethods)
  await copyOwnLicenseMaterials(join(here, '../..'), target)
  const manifestPath = join(target, manifestDirectory, 'plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = `${manifest.version.split('+')[0]}+${host}.${Date.now()}-${randomUUID().slice(0, 8)}`
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  if (host === 'codex') await cp(join(here, 'install-codex.mjs'), join(target, 'install-codex.mjs'))
  else if (overlayHost !== 'codex') {
    const prefix = host === 'qwenwork' ? 'qwenwork' : host === 'qoder' ? 'qoder' : 'claude'
    await copyNativeHookModules(target, { host })
    if (host === 'qwenwork') await configureQwenWorkPackage(target, qwenworkRuntime)
    await copyNativeExecutionReference(target, { host })
  }
  await mkdir(join(target, 'scripts'), { recursive: true })
  await cp(join(here, 'dist-server/design.mjs'), join(target, 'scripts/design.mjs'))
  // Include pure shared chunks and the read-only snapshot query helper.
  for (const name of await readdir(join(here,'dist-server'))) {
    if (name !== 'design.mjs' && /\.(?:mjs|js)$/.test(name)) await cp(join(here,'dist-server',name),join(target,'scripts',name))
  }
  await stageCompanionNativeGit(target, native)
  await verifyCompanionNativeGit(target)
  await copyTree(join(here, 'dist'), join(target, 'web'))
  await cp(join(here, 'index.html'), join(target, 'web/index.html'))
  await packageKnowledge(target)
  const kit = join(target, 'kits/web_app')
  await mkdir(kit, { recursive: true })
  await copyTree(join(here, '../skills-web-app/kits/web_app'), kit)
  await copyTree(join(here, '../skills-web-app/bundles'), join(target, 'bundles'))
  for (const name of OWN_LICENSE_FILES) await copyTree(join(here, '../skills-web-app', name), join(kit, name))
  // Agent-facing scripts run as separate Node processes, outside design.mjs.
  // Bundle their runtime imports at publication time, not in a user's session.
  // Keep the source Kit (and the native DSH execution path) unchanged.
  await packageFlowLayout(target)
  // Separate third-party notice: the bundled JSON utility comes from upstream DSH.
  await mkdir(join(target, 'licenses'))
  await writeFile(join(target, 'licenses/DSH-LICENSE'), officialInputs.licenseBytes, { flag: 'wx' })
  await copyBundledLicenseMaterials(bundledLicenseEntries, target)
  await copyBrowserLicenseMaterials(browserLicenseEntries, target)
  await copyBundledJsLicenseMaterials(bundledJsLicenseEntries, target)
  await appendFile(join(target, 'NOTICE'), BROWSER_LICENSE_NOTICE + BUNDLED_JS_LICENSE_NOTICE)
  if (host === 'codex-desktop') await configureCodexDesktopPackage(target, { nodeExecutable })
  return target
}

async function main() {
  const args = process.argv.slice(2)
  const hostFlag = { '--codex-desktop': 'codex-desktop', '--qoder': 'qoder', '--claude': 'claude-code', '--qwenwork': 'qwenwork' }[args[0]]
  const host = hostFlag ? (args.shift(), hostFlag) : 'codex'
  let qwenworkRuntime
  if (host === 'qwenwork') {
    if (args.shift() !== '--runtime-config' || !args[0]) throw Error('QwenWork requires --runtime-config /absolute/runtime.json')
    qwenworkRuntime = validateQwenWorkRuntime(JSON.parse(await readFile(resolve(args.shift()), 'utf8')))
  }
  let nativeGitArtifactRoot
  if (args[0] === '--native-git-artifacts') {
    args.shift()
    if (!args[0] || args[0].startsWith('--')) throw Error('--native-git-artifacts requires a pinned artifact directory')
    nativeGitArtifactRoot = resolve(args.shift())
  }
  let nodeExecutable
  if (args[0] === '--node-executable') {
    args.shift()
    if (!args[0] || args[0].startsWith('--')) throw Error('--node-executable requires an existing public Node executable')
    nodeExecutable = resolve(args.shift())
  }
  if (args.length > 1 || args.some(arg => arg.startsWith('--'))) throw new Error('Usage: node build-plugin.mjs [--codex-desktop|--qoder|--claude|--qwenwork --runtime-config PATH] [--native-git-artifacts PATH] [--node-executable PUBLIC_NODE] [new-output-directory/yugoo-design]')
  for (const config of ['tsdown.config.ts', 'tsdown.server.config.ts']) {
    const result = await run('pnpm', ['exec', 'tsdown', '--config', config], { cwd: here, maxBuffer: 1024 * 1024 })
    process.stderr.write(result.stdout)
  }
  let destination = args[0]
  if (!destination) {
    await mkdir(join(here, 'dist-plugin'), { recursive: true })
    // Do not put packaged output inside browser dist: it is copied wholesale.
    const parent = await mkdtemp(join(here, 'dist-plugin/build-'))
    destination = join(parent, 'yugoo-design')
  }
  console.log(await packagePlugin(destination, { host, qwenworkRuntime, nativeGitArtifactRoot, nodeExecutable }))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
