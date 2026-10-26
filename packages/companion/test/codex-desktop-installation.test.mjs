import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, readFile, writeFile, realpath, rm, symlink, lstat, cp, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, dirname, relative } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { configureCodexDesktopPackage } from '../codex-desktop-package.mjs'
import { planCodexDesktopMarketplace, applyCodexDesktopMarketplace } from '../src/npm-installer-codex.mjs'

async function fixture(t) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'codex-desktop-install-')))
  t.after(() => rm(root, { recursive: true, force: true }))
  const home = join(root, 'home'), source = join(home, 'fixed/yugoo-design')
  const put = async (path, bytes) => { await mkdir(dirname(path), { recursive: true }); await writeFile(path, bytes) }
  await put(join(source, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'yugoo-design', version: '0.1.0+desktop.fixture', skills: './skills/', mcpServers: './.mcp.json' }))
  await put(join(source, '.mcp.json'), JSON.stringify({ mcpServers: { 'design-system': { command: 'node', args: ['scripts/design.mjs', 'mcp'], cwd: '.' } } }))
  for (const path of ['scripts/design.mjs', 'scripts/codex-desktop-bridge.mjs', 'scripts/codex-desktop-marketplace.mjs', 'skills/design-panel/codex-desktop.md', 'skills/yugoo/SKILL.md', 'web/index.html']) await put(join(source, path), 'inventory fixture only')
  const market = join(home, '.agents/plugins/marketplace.json')
  const foreign = { name: 'foreign', source: { source: 'local', path: './keep' }, extra: { preserve: true } }
  await put(market, JSON.stringify({ name: 'personal', keep: 'catalog metadata', plugins: [foreign] }))
  const config = join(home, '.codex/config.toml')
  await put(config, '# foreign native config must stay byte-identical\n')
  return { root, home, source, market, foreign, config, put, receipts: join(root, 'receipts') }
}

async function ownedUpdateFixture(t) {
  const f = await fixture(t)
  await configureCodexDesktopPackage(f.source, { nodeExecutable: process.execPath })
  const oldPlan = await planCodexDesktopMarketplace({ pluginRoot: f.source, userRoot: f.home })
  const previous = await applyCodexDesktopMarketplace(oldPlan, { receiptDirectory: f.receipts })
  const nextSource = join(f.home, 'fixed-next/yugoo-design')
  await mkdir(dirname(nextSource), { recursive: true })
  await cp(f.source, nextSource, { recursive: true, force: false, errorOnExist: true })
  const manifestPath = join(nextSource, '.codex-plugin/plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.version = '0.1.0+desktop.next'
  await writeFile(manifestPath, JSON.stringify(manifest))
  return { ...f, previous, nextSource, options: { pluginRoot: nextSource, userRoot: f.home, previousReceipt: previous.receiptPath } }
}

test('desktop package uses pinned public Node and loaded-root mapping; catalog preparation preserves unrelated native state', async t => {
  const f = await fixture(t)
  const mapping = await configureCodexDesktopPackage(f.source, { nodeExecutable: process.execPath })
  const mcp = JSON.parse(await readFile(join(f.source, '.mcp.json'), 'utf8')).mcpServers['design-system']
  assert.equal(mcp.command, mapping.nodeRuntime.executable)
  assert.deepEqual(mcp.args, ['scripts/design.mjs', 'mcp'])
  assert.equal(mcp.cwd, '.')
  const plan = await planCodexDesktopMarketplace({ pluginRoot: f.source, userRoot: f.home })
  const config = await readFile(f.config, 'utf8'), before = await readFile(f.market, 'utf8')
  const receipt = await applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts })
  const catalog = JSON.parse(await readFile(f.market, 'utf8'))
  assert.equal(catalog.keep, 'catalog metadata')
  assert.deepEqual(catalog.plugins[0], f.foreign)
  assert.equal(catalog.plugins[1].name, 'yugoo-design')
  assert.equal(await readFile(receipt.backupPath, 'utf8'), before)
  assert.equal(await readFile(f.config, 'utf8'), config)
  await assert.rejects(lstat(join(f.home, '.codex/plugins/cache')), { code: 'ENOENT' })
  assert.equal(receipt.marketplacePrepared, true)
  for (const key of ['hostRegistered', 'installed', 'loaded']) assert.equal(receipt[key], false)
})

test('legacy desktop launch survives cache relocation without plugin-root interpolation', async t => {
  const f = await fixture(t)
  await f.put(join(f.source, 'scripts/design.mjs'), `import { fileURLToPath } from 'node:url'
console.log(JSON.stringify({ cwd: process.cwd(), script: fileURLToPath(import.meta.url), args: process.argv.slice(2) }))
`)
  await configureCodexDesktopPackage(f.source, { nodeExecutable: process.execPath })
  const installed = join(f.home, '.codex/plugins/cache/personal/yugoo-design/version with spaces')
  await cp(f.source, installed, { recursive: true })
  await rm(f.source, { recursive: true })
  const mcp = JSON.parse(await readFile(join(installed, '.mcp.json'), 'utf8')).mcpServers['design-system']
  const env = { ...process.env }
  delete env.PLUGIN_ROOT; delete env.CLAUDE_PLUGIN_ROOT
  const run = promisify(execFile)
  // The native legacy parser joins a relative cwd to the cache root and does not
  // expand args. Exercise that actual launch boundary with the source gone.
  const { stdout, stderr } = await run(mcp.command, mcp.args, { cwd: join(installed, mcp.cwd), env, timeout: 10_000 })
  assert.equal(stderr, '')
  assert.deepEqual(JSON.parse(stdout), { cwd: installed, script: join(installed, 'scripts/design.mjs'), args: ['mcp'] })
  assert.notEqual(installed, process.cwd())
  // This is the exact pre-fix cwd returned by the observed desktop loader.
  await assert.rejects(run(mcp.command, mcp.args, { cwd: join(installed, '${PLUGIN_ROOT}'), env, timeout: 10_000 }), { code: 'ENOENT' })
})

test('desktop preparation refuses changed package/catalog and another owned source', async t => {
  const f = await fixture(t)
  await configureCodexDesktopPackage(f.source, { nodeExecutable: process.execPath })
  const plan = await planCodexDesktopMarketplace({ pluginRoot: f.source, userRoot: f.home })
  await f.put(join(f.source, 'scripts/design.mjs'), 'changed after plan')
  await assert.rejects(applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts }), /package or marketplace changed/)
  const fresh = await planCodexDesktopMarketplace({ pluginRoot: f.source, userRoot: f.home })
  const foreignCatalog = JSON.stringify({ name: 'personal', plugins: [f.foreign], concurrent: true })
  await writeFile(f.market, foreignCatalog)
  await assert.rejects(applyCodexDesktopMarketplace(fresh, { receiptDirectory: f.receipts }), /package or marketplace changed/)
  assert.equal(await readFile(f.market, 'utf8'), foreignCatalog)
  await writeFile(f.market, JSON.stringify({ name: 'personal', plugins: [{ name: 'yugoo-design', source: { source: 'local', path: './another-source' } }] }))
  await assert.rejects(planCodexDesktopMarketplace({ pluginRoot: f.source, userRoot: f.home }), /another source/)
})

test('desktop preparation rejects symlinked sources and private host Node as a shared prerequisite', async t => {
  const f = await fixture(t)
  const original = await readFile(join(f.source, '.mcp.json'), 'utf8')
  await assert.rejects(configureCodexDesktopPackage(f.source, { nodeExecutable: '/Applications/Selected.app/Contents/Resources/node' }), /private Node runtime/)
  assert.equal(await readFile(join(f.source, '.mcp.json'), 'utf8'), original)
  const alias = join(f.home, 'alias')
  await symlink(f.source, alias)
  await assert.rejects(planCodexDesktopMarketplace({ pluginRoot: alias, userRoot: f.home }), /symlink rejected/)
})

test('an external catalog edit during staging survives and leaves a recoverable uncommitted candidate', async t => {
  const f = await fixture(t)
  await configureCodexDesktopPackage(f.source, { nodeExecutable: process.execPath })
  const plan = await planCodexDesktopMarketplace({ pluginRoot: f.source, userRoot: f.home })
  const before = await readFile(f.market, 'utf8')
  const concurrent = JSON.stringify({ ...JSON.parse(before), plugins: [f.foreign, { name: 'arrived-during-staging' }] })
  let recoveryPath, stagedPath
  await assert.rejects(applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts,
    checkpoint: async phase => { assert.equal(phase, 'after-staging'); await writeFile(f.market, concurrent) },
  }), error => {
    assert.equal(error.code, 'CODEX_DESKTOP_MARKETPLACE_CONFLICT')
    recoveryPath = error.recoveryPath; stagedPath = error.stagedPath
    return true
  })
  assert.equal(await readFile(f.market, 'utf8'), concurrent, 'the other plugin entry is never overwritten')
  const recovery = JSON.parse(await readFile(recoveryPath, 'utf8'))
  assert.equal(recovery.phase, 'not-committed')
  assert.equal(recovery.marketplacePrepared, false)
  assert.equal(recovery.concurrency.atomicCompareAndSwap, false)
  assert.equal(await readFile(recovery.backupPath, 'utf8'), before)
  assert.equal(JSON.parse(await readFile(stagedPath, 'utf8')).plugins.at(-1).name, 'yugoo-design')
  await assert.rejects(lstat(recovery.lock), { code: 'ENOENT' })
})

test('same-tool preparations in different receipt directories cannot overlap on one profile', async t => {
  const f = await fixture(t)
  await configureCodexDesktopPackage(f.source, { nodeExecutable: process.execPath })
  const plan = await planCodexDesktopMarketplace({ pluginRoot: f.source, userRoot: f.home })
  let release, entered
  const staged = new Promise(resolve => { entered = resolve })
  const barrier = new Promise(resolve => { release = resolve })
  const first = applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts,
    checkpoint: async () => { entered(); await barrier },
  })
  await staged
  try {
    await assert.rejects(applyCodexDesktopMarketplace(plan, { receiptDirectory: join(f.root, 'another-receipt-dir') }),
      error => error.code === 'CODEX_DESKTOP_MARKETPLACE_BUSY')
  } finally { release() }
  const receipt = await first
  assert.equal(receipt.marketplacePrepared, true)
  const catalog = JSON.parse(await readFile(f.market, 'utf8'))
  assert.deepEqual(catalog.plugins, [f.foreign, plan.entry])
  await assert.rejects(lstat(receipt.lock), { code: 'ENOENT' })
})

test('explicit owned-source update preserves unrelated catalog data, old closure and native configuration', async t => {
  const f = await ownedUpdateFixture(t)
  await assert.rejects(planCodexDesktopMarketplace({ pluginRoot: f.nextSource, userRoot: f.home }), /another source/)
  const catalog = JSON.parse(await readFile(f.market, 'utf8'))
  catalog.extra = 'concurrent foreign metadata'
  catalog.plugins.push({ name: 'another-plugin', custom: 'retained' })
  await writeFile(f.market, JSON.stringify(catalog))
  const oldManifest = await readFile(join(f.source, '.codex-plugin/plugin.json'), 'utf8')
  const oldReceiptBytes = await readFile(f.previous.receiptPath)
  const plan = await planCodexDesktopMarketplace(f.options)
  assert.equal(plan.action, 'update')
  assert.equal(plan.changes.sourceBefore.path, f.source)
  assert.equal(plan.changes.sourceAfter.path, f.nextSource)
  assert.notEqual(plan.changes.sourceBefore.version, plan.changes.sourceAfter.version)
  const receipt = await applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts })
  const next = JSON.parse(await readFile(f.market, 'utf8'))
  assert.deepEqual(next, { ...catalog, plugins: catalog.plugins.map(entry => entry.name === 'yugoo-design' ? { ...entry, source: plan.entry.source } : entry) })
  assert.equal(await readFile(join(f.source, '.codex-plugin/plugin.json'), 'utf8'), oldManifest)
  assert.deepEqual(await readFile(f.previous.receiptPath), oldReceiptBytes)
  assert.equal(receipt.previousReceipt.sha256, createHash('sha256').update(oldReceiptBytes).digest('hex'))
  assert.deepEqual(receipt.planSnapshot, plan)
  assert.equal(await readFile(f.config, 'utf8'), '# foreign native config must stay byte-identical\n')
  await assert.rejects(lstat(join(f.home, '.codex/plugins/cache')), { code: 'ENOENT' })
  for (const field of ['hostRegistered', 'installed', 'loaded']) assert.equal(receipt[field], false)
})

test('owned update rejects old-source drift and does not repair it', async t => {
  const f = await ownedUpdateFixture(t)
  const plan = await planCodexDesktopMarketplace(f.options)
  const before = await readFile(f.market, 'utf8')
  await writeFile(join(f.source, 'scripts/design.mjs'), 'unexpected old closure edit')
  await assert.rejects(planCodexDesktopMarketplace(f.options), /Previous immutable desktop source changed/)
  await assert.rejects(applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts }), /Previous immutable desktop source changed/)
  assert.equal(await readFile(f.market, 'utf8'), before)
  assert.equal(await readFile(join(f.source, 'scripts/design.mjs'), 'utf8'), 'unexpected old closure edit')
})

test('owned update rejects a foreign entry and tampered receipt identities', async t => {
  const f = await ownedUpdateFixture(t)
  const before = await readFile(f.market, 'utf8'), catalog = JSON.parse(before)
  catalog.plugins.find(entry => entry.name === 'yugoo-design').source.path = './another-owner'
  const changed = JSON.stringify(catalog)
  await writeFile(f.market, changed)
  await assert.rejects(planCodexDesktopMarketplace(f.options), /Current Yugoo entry differs/)
  assert.equal(await readFile(f.market, 'utf8'), changed)
  await writeFile(f.market, before)
  const receipt = JSON.parse(await readFile(f.previous.receiptPath, 'utf8'))
  receipt.selector = 'yugoo-design@someone-else'
  await writeFile(f.previous.receiptPath, JSON.stringify(receipt))
  await assert.rejects(planCodexDesktopMarketplace(f.options), /Previous desktop receipt identity changed/)
})

test('owned update revalidates receipt bytes under the lease and refuses writes inside the old closure', async t => {
  const f = await ownedUpdateFixture(t), plan = await planCodexDesktopMarketplace(f.options)
  const before = await readFile(f.market, 'utf8')
  const forbidden = join(f.source, 'new-receipts')
  await assert.rejects(applyCodexDesktopMarketplace(plan, { receiptDirectory: forbidden }), /previous immutable closure/)
  await assert.rejects(lstat(forbidden), { code: 'ENOENT' })
  const bytes = await readFile(f.previous.receiptPath, 'utf8')
  await writeFile(f.previous.receiptPath, bytes + '\n')
  await assert.rejects(applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts }), /package or marketplace changed/)
  assert.equal(await readFile(f.market, 'utf8'), before)
})

test('original schema-1 preparation receipts can authorize a separately pinned update', async t => {
  const f = await ownedUpdateFixture(t)
  const fields = ['schemaVersion', 'scope', 'source', 'userRoot', 'version', 'selector', 'marketplacePath', 'entry',
    'sourceSha256', 'beforeSha256', 'alreadyPresent', 'hostRegistered', 'installed', 'loaded', 'nodeRuntime']
  const legacyPlan = Object.fromEntries(fields.map(key => [key, f.previous[key]]))
  legacyPlan.schemaVersion = 1
  const legacy = { ...legacyPlan, planSha256: createHash('sha256').update(JSON.stringify(legacyPlan)).digest('hex'),
    id: f.previous.id, backupPath: f.previous.backupPath, marketplacePrepared: true, afterSha256: f.previous.afterSha256 }
  await writeFile(f.previous.receiptPath, JSON.stringify(legacy))
  const plan = await planCodexDesktopMarketplace(f.options)
  assert.equal(plan.action, 'update')
  const receipt = await applyCodexDesktopMarketplace(plan, { receiptDirectory: f.receipts })
  assert.equal(receipt.marketplacePrepared, true)
  assert.equal(receipt.previousReceipt.id, legacy.id)
})

test('actual packaged planning CLI keeps old and new closures unchanged across receipt-directory aliases', { timeout: 60000 }, async t => {
  const built = await realpath(await mkdtemp(join(tmpdir(), 'desktop-plan-cli-build-')))
  t.after(() => rm(built, { recursive: true, force: true }))
  const { build } = await import('tsdown')
  const config = (await import('../tsdown.server.config.ts')).default
  await build({ ...config, config: false, clean: false, outDir: built,
    entry: { 'codex-desktop-marketplace': fileURLToPath(new URL('../src/codex-desktop-marketplace.mjs', import.meta.url)) } })
  const exec = promisify(execFile)
  const fingerprint = async root => {
    const items = []
    const walk = async path => {
      for (const name of (await readdir(path)).sort()) {
        const child = join(path, name), info = await lstat(child)
        assert.ok(!info.isSymbolicLink())
        items.push([relative(root, child), info.isDirectory() ? 'directory' : createHash('sha256').update(await readFile(child)).digest('hex')])
        if (info.isDirectory()) await walk(child)
      }
    }
    await walk(root)
    return createHash('sha256').update(JSON.stringify(items)).digest('hex')
  }
  for (const scenario of ['old-leaf', 'old-ancestor', 'new-leaf', 'new-ancestor', 'old-case-ancestor', 'new-case-ancestor', 'valid-external']) {
    await t.test(scenario, async st => {
      const f = await ownedUpdateFixture(st)
      await cp(built, join(f.nextSource, 'scripts'), { recursive: true })
      // Test-only homedir binding for the real CLI subprocess. No real HOME,
      // CODEX_HOME, profile or installed desktop is changed by this harness.
      const preload = join(f.root, 'isolated-homedir.mjs')
      await writeFile(preload, `import os from 'node:os'; import {syncBuiltinESMExports} from 'node:module'; os.homedir=()=>${JSON.stringify(f.home)}; syncBuiltinESMExports();\n`)
      const oldBefore = await fingerprint(f.source), nextBefore = await fingerprint(f.nextSource)
      const catalogBefore = await readFile(f.market, 'utf8')
      let receiptDirectory = join(f.root, 'external-plans')
      if (scenario.includes('-case-')) {
        const target = scenario.startsWith('old') ? f.source : f.nextSource
        const alias = join(dirname(target), 'YUGOO-DESIGN')
        let physical
        try { physical = await realpath(alias) } catch (error) { if (error.code !== 'ENOENT') throw error }
        if (physical !== target) { st.skip('Case-sensitive volume; no case alias exists'); return }
        receiptDirectory = join(alias, 'nested-plans')
      } else if (scenario !== 'valid-external') {
        const alias = join(f.root, 'receipt-alias')
        await symlink(scenario.startsWith('old') ? f.source : f.nextSource, alias, process.platform === 'win32' ? 'junction' : 'dir')
        receiptDirectory = scenario.endsWith('ancestor') ? join(alias, 'nested-plans') : alias
      }
      const args = ['--import', preload, join(f.nextSource, 'scripts/codex-desktop-marketplace.mjs'),
        '--receipt-dir', receiptDirectory, '--previous-receipt', f.previous.receiptPath]
      if (scenario === 'valid-external') {
        const result = await exec(process.execPath, args)
        const output = JSON.parse(result.stdout)
        assert.equal(output.action, 'update')
        const saved = JSON.parse(await readFile(output.planPath, 'utf8'))
        assert.equal(saved.source, f.nextSource)
        assert.equal(saved.previousReceipt.source, f.source)
        assert.equal((await lstat(output.planPath)).mode & 0o077, 0)
      } else {
        await assert.rejects(exec(process.execPath, args), error => {
          assert.equal(error.code, 1)
          assert.equal(error.stdout, '')
          assert.match(error.stderr, scenario.includes('-case-') ? /canonical before creation/ : /symlink rejected/)
          return true
        })
      }
      assert.equal(await fingerprint(f.source), oldBefore, 'old files and directories remain byte-identical')
      assert.equal(await fingerprint(f.nextSource), nextBefore, 'new files and directories remain byte-identical')
      assert.equal(await readFile(f.market, 'utf8'), catalogBefore, 'planning never writes the profile catalog')
    })
  }
})
