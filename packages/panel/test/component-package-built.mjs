/** Isolated built-artifact probe; never installs a package or starts a Host. */
import assert from 'node:assert/strict'
import { copyFile, mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { isAbsolute, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'tsdown'
import { NativePanelRegistry } from '../lib/host.js'
import { DesignBundleContributionRegistry, DesignDriverId, deriveDesignBundleAuthorityId, validateComponentPackageClosure, registerComponentPackageContributions } from '../../core/lib/index.js'
import { fixtureRoot, fixture, sourcePin, sha256 } from '../../core/test/fixtures/component-package/fixture.mjs'

const output = process.env.COMPONENT_PACKAGE_TEST_OUT
if (!output || !isAbsolute(output)) throw new Error('Set COMPONENT_PACKAGE_TEST_OUT to an owned absolute evidence directory.')
await mkdir(output, { recursive: true })
const directory = await mkdtemp(join(output, 'candidate-'))
await build({ config: false, tsconfig: false, entry: { client: fileURLToPath(new URL('client.mjs', fixtureRoot)), server: fileURLToPath(new URL('server.mjs', fixtureRoot)) },
  outDir: directory, format: 'esm', platform: 'neutral', dts: false, clean: false, sourcemap: false, outputOptions: { entryFileNames: '[name].mjs' } })
for (const path of ['LICENSE', 'package.json']) await copyFile(new URL(path, fixtureRoot), join(directory, path))
const files = new Map(await Promise.all((await readdir(directory)).map(async path => [path, await readFile(join(directory, path))])))
const { source: original } = await fixture(), manifest = JSON.parse(original.manifest)
manifest.files = [...files].map(([path, bytes]) => ({ path, sha256: sha256(bytes) })).sort((a, b) => a.path < b.path ? -1 : 1)
const source = { manifest: Buffer.from(JSON.stringify(manifest, null, 2) + '\n'), files }
await writeFile(join(directory, 'component-package.json'), source.manifest)
const pin = sourcePin(source)
const requirePanel = createRequire(new URL('../package.json', import.meta.url))
const React = requirePanel('react'), ReactDOM = requirePanel('react-dom'), { Context } = requirePanel('@deepseek-ai/cordis')
const { renderToStaticMarkup } = requirePanel('react-dom/server')
const host = { nativePanelApi: 1, reactVersion: React.version, reactDOMVersion: ReactDOM.version }
const [checked] = await validateComponentPackageClosure([source], pin, host)
const server = await import(pathToFileURL(join(directory, 'server.mjs'))), client = await import(pathToFileURL(join(directory, 'client.mjs')))
const serverRegistry = new DesignBundleContributionRegistry(), authority = deriveDesignBundleAuthorityId('package:component-built-fixture', 'notice')
const stopServer = server.install(serverRegistry, checked, authority, registerComponentPackageContributions)
const ctx = new Context(), panelRegistry = new NativePanelRegistry(ctx)
try {
  serverRegistry.requirePresentation(authority, DesignDriverId(manifest.components[0].id))
  const stopClient = await client.install(panelRegistry, [source], pin, { React, ReactDOM })
  const [definition] = panelRegistry.installedDefinitions()
  assert.equal(definition.metadata.componentPackage.integrity, pin.integrity)
  const html = renderToStaticMarkup(definition.render({}))
  assert.match(html, /Trusted notice component/)
  stopClient(); assert.deepEqual(panelRegistry.ids(), [])
  const result = { status: 'passed', scope: 'built Core + built Panel registry + built minimal package entries; Node SSR, not browser or installed Host', pin, directory, host, html }
  await writeFile(join(output, 'built-result.json'), JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result))
} finally { stopServer(); await ctx.fiber.dispose() }
