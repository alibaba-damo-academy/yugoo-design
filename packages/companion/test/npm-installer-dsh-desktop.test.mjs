import assert from 'node:assert/strict'
import {test} from 'node:test'
import {createHash} from 'node:crypto'
import {readFile,writeFile,mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {runDesktopDshInstaller} from '../src/npm-installer-dsh-desktop.mjs'

test('Desktop bridge rejects changed executable, malformed argv and relative product roots before execution', async () => {
  const node = {path:process.execPath,sha256:createHash('sha256').update(await readFile(process.execPath)).digest('hex')}
  await assert.rejects(runDesktopDshInstaller({node:{...node,sha256:'0'.repeat(64)},args:['--help'],npmRoot:process.cwd()}),/pin changed/)
  for (const args of [['--help',null],['--help\0other'],undefined])
    await assert.rejects(runDesktopDshInstaller({node,args,npmRoot:process.cwd()}),/argv required/)
  await assert.rejects(runDesktopDshInstaller({node,args:['--help'],npmRoot:'.'}),/must be absolute/)
})

test('owned synthetic Desktop bridge forwards pipe cancellation and deadline to the installer', async t => {
  const root=await mkdtemp(join(tmpdir(),'dsh-bridge-cancel-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const bridge=join(root,'npm-installer-dsh-desktop.mjs'),preload=join(root,'synthetic-electron.mjs')
  await writeFile(bridge,await readFile(new URL('../src/npm-installer-dsh-desktop.mjs',import.meta.url)))
  await writeFile(join(root, 'npm-installer-dsh.mjs'), `export {spawnDshProcess} from ${JSON.stringify(new URL('../src/npm-installer-dsh.mjs', import.meta.url).href)}`)
  // This exercises the exact bridge control path, not an actual Electron host.
  await writeFile(preload,'Object.defineProperty(process.versions,"electron",{value:"synthetic-test"})')
  await writeFile(join(root,'npm-installer.mjs'),`export async function installerMain(args,context) {
    await new Promise(resolve=>{
      if(context.signal.aborted) resolve(); else context.signal.addEventListener('abort',resolve,{once:true});
      process.stderr.write('ready');
    });
    return {status:'failed-partial-state-retained',cancelled:context.signal.aborted,timeoutMs:context.dshInstallTimeoutMs};
  }`)
  const request=Buffer.from(JSON.stringify({args:['install'],npmRoot:root,timeoutMs:37})).toString('base64url')
  const pending=promisify(execFile)(process.execPath,['--import',preload,'--expose-internals',bridge,request],{timeout:3000})
  pending.child.stdin.end('cancel\n')
  assert.deepEqual(JSON.parse((await pending).stdout),{status:'failed-partial-state-retained',cancelled:true,timeoutMs:37})
  if(process.platform!=='win32') {
    const interrupted=promisify(execFile)(process.execPath,['--import',preload,'--expose-internals',bridge,request],{timeout:3000})
    interrupted.child.stderr.once('data',()=>interrupted.child.kill('SIGINT'))
    assert.equal(JSON.parse((await interrupted).stdout).cancelled,true)
  }
})

test('a pinned but non-executable Desktop file retains the launch error without a pipe TypeError', async t => {
  const root=await mkdtemp(join(tmpdir(),'dsh-bridge-spawn-error-'))
  t.after(()=>rm(root,{recursive:true,force:true}))
  const path=join(root,'not-an-executable'),bytes=Buffer.from('not an executable')
  await writeFile(path,bytes)
  await assert.rejects(runDesktopDshInstaller({node:{path,sha256:createHash('sha256').update(bytes).digest('hex')},args:['--help'],npmRoot:root}),error=>{
    assert.notEqual(error.name,'TypeError')
    assert.ok(error.code)
    return true
  })
})

for (const outcome of ['success', 'cancel', 'failure']) test(`Desktop bridge streams verbose progress and preserves ${outcome}`, async t => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-bridge-progress-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const bridge = join(root, 'npm-installer-dsh-desktop.mjs')
  const preload = join(root, 'synthetic-electron.mjs')
  await writeFile(bridge, await readFile(new URL('../src/npm-installer-dsh-desktop.mjs', import.meta.url)))
  // Reuse the production streaming helper; only the host and native installer are synthetic.
  await writeFile(join(root, 'npm-installer-dsh.mjs'), `export {spawnDshProcess} from ${JSON.stringify(new URL('../src/npm-installer-dsh.mjs', import.meta.url).href)}`)
  await writeFile(preload, 'Object.defineProperty(process.versions,"electron",{value:"synthetic-test"})')
  await writeFile(join(root, 'npm-installer.mjs'), `export async function installerMain(args, context) {
    context.onDshOutput(Buffer.alloc(6 * 1024 * 1024, 112));
    if (args[0] === 'failure') throw Error('native failure');
    if (args[0] === 'cancel') await new Promise(resolve => context.signal.aborted ? resolve() : context.signal.addEventListener("abort", resolve, {once:true}));
    return {status:context.signal.aborted ? "failed-partial-state-retained" : "installed", cancelled:context.signal.aborted};
  }`)
  const runner = join(root, 'runner.mjs')
  const node = { path: process.execPath, sha256: createHash('sha256').update(await readFile(process.execPath)).digest('hex') }
  await writeFile(runner, `import {runDesktopDshInstaller} from "./npm-installer-dsh-desktop.mjs";
    const controller = new AbortController();
    let progressBytes = 0;
    try {
      const result = await runDesktopDshInstaller({
        node:${JSON.stringify(node)}, npmRoot:${JSON.stringify(root)}, args:[${JSON.stringify(outcome)}], signal:controller.signal,
        onOutput: chunk => {
          progressBytes += chunk.length;
          if (${JSON.stringify(outcome)} === 'cancel' && progressBytes > 3 * 1024 * 1024) controller.abort();
        }
      });
      console.log(JSON.stringify({result, progressBytes}));
    } catch (error) {
      console.log(JSON.stringify({code:error.code, diagnosticBytes:Buffer.byteLength(error.stderr), tail:error.stderr.slice(-15), progressBytes}));
    }
  `)
  const output = await promisify(execFile)(process.execPath, [runner], {
    env: { ...process.env, NODE_OPTIONS: '--import=' + preload }, timeout: 5000,
  })
  assert.deepEqual(JSON.parse(output.stdout), outcome === 'failure' ? {
    code:1, diagnosticBytes:65536, tail:'native failure\n', progressBytes:6 * 1024 * 1024 + 15,
  } : {
    result: {status:outcome === 'cancel' ? 'failed-partial-state-retained' : 'installed', cancelled:outcome === 'cancel'}, progressBytes:6 * 1024 * 1024,
  })
})
