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
