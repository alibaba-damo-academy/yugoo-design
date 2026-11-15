import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnDshProcess } from './npm-installer-dsh.mjs'

// Electron owns ASAR resolution. Keep the existing installer and official
// Loader together in its Node runtime instead of extracting the desktop tree.
export async function runDesktopDshInstaller({ node, args, npmRoot, signal, timeoutMs = 0, onOutput }) {
  assert.ok(node && isAbsolute(node.path), 'Explicit Desktop executable required')
  assert.match(node.sha256 ?? '', /^[a-f0-9]{64}$/u)
  assert.ok((await lstat(await realpath(node.path))).isFile(), 'Desktop executable must be a regular file')
  const hash = createHash('sha256').update(await readFile(node.path)).digest('hex')
  assert.equal(hash, node.sha256, 'Desktop executable pin changed')
  assert.ok(Array.isArray(args) && args.every(arg => typeof arg === 'string' && !arg.includes('\0')), 'Installer argv required')
  assert.ok(typeof npmRoot === 'string' && isAbsolute(npmRoot), 'Retained npm installation must be absolute')
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 0 && timeoutMs <= 2147483647, 'Invalid install deadline')
  signal?.throwIfAborted()
  const request = Buffer.from(JSON.stringify({ args, npmRoot, timeoutMs })).toString('base64url')
  const pending = spawnDshProcess(node.path,
    ['--expose-internals', fileURLToPath(import.meta.url), request], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      windowsHide: true, shell: false,
    })
  // Use the pipe on Windows as well: killing the bridge would lose its partial
  // state receipt and says nothing about the official pnpm descendants.
  const resultChunks = []
  let resultBytes = 0, diagnostic = Buffer.alloc(0)
  const resultOutput = chunk => {
    const remaining = Math.max(0, 1024 * 1024 - resultBytes)
    if (remaining) resultChunks.push(Buffer.from(chunk.subarray(0, remaining)))
    resultBytes += chunk.length
  }
  const progress = chunk => {
    diagnostic = Buffer.concat([diagnostic, chunk]).subarray(-65536)
    try { onOutput?.(chunk, 'stderr') } catch {}
  }
  pending.child?.stdout?.on('data', resultOutput)
  pending.child?.stderr?.on('data', progress)
  const cancel = () => { if (pending.child?.stdin?.writable) pending.child.stdin.write('cancel\n') }
  pending.child?.stdin?.on('error', () => {}) // A closed bridge cannot accept a late cancellation.
  signal?.addEventListener('abort', cancel, { once: true })
  if (signal?.aborted) cancel()
  try {
    await pending
    assert.ok(resultBytes <= 1024 * 1024, 'Desktop installer result exceeds the bounded JSON result size; inspect retained receipts')
    return JSON.parse(Buffer.concat(resultChunks).toString('utf8'))
  } catch (error) {
    error.stderr = diagnostic.toString('utf8')
    if (error.stderr.trim()) error.message += ': ' + error.stderr.trim().split('\n').at(-1)
    throw error
  }
  finally {
    signal?.removeEventListener('abort', cancel)
    pending.child?.stdout?.off('data', resultOutput)
    pending.child?.stderr?.off('data', progress)
    pending.child?.stdin?.destroy()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Finish this module before loading the installer, which imports this bridge.
  void (async () => {
    try {
      assert.ok(process.versions.electron, 'Desktop bridge requires Electron Node mode')
      assert.equal(process.argv.length, 3, 'One installer request required')
      const request = JSON.parse(Buffer.from(process.argv[2], 'base64url').toString('utf8'))
      assert.deepEqual(Object.keys(request).sort(), ['args', 'npmRoot', 'timeoutMs'])
      assert.ok(Array.isArray(request.args) && request.args.every(arg => typeof arg === 'string' && !arg.includes('\0')), 'Installer argv required')
      assert.ok(typeof request.npmRoot === 'string' && isAbsolute(request.npmRoot), 'Retained npm installation must be absolute')
      assert.ok(Number.isSafeInteger(request.timeoutMs) && request.timeoutMs >= 0 && request.timeoutMs <= 2147483647, 'Invalid install deadline')
      const cancellation = new AbortController()
      const cancel = () => cancellation.abort()
      // Terminal Ctrl-C can reach the bridge as well as the outer entry.
      process.on('SIGINT', cancel)
      process.on('SIGTERM', cancel)
      // A partial or malformed control frame cannot authorize any installation.
      let control = ''
      process.stdin.setEncoding('utf8')
      process.stdin.on('data', chunk => {
        control = (control + chunk).slice(-64)
        if (control.includes('cancel\n')) cancellation.abort()
      })
      try {
        const { installerMain } = await import('./npm-installer.mjs').catch(error => {
          if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.url?.endsWith('/npm-installer.mjs')) throw error
          // The published bin directory names the same module installer.mjs.
          return import('./installer.mjs')
        })
        process.stdout.write(JSON.stringify(await installerMain(request.args, {
          npmRoot: request.npmRoot, signal: cancellation.signal, dshInstallTimeoutMs: request.timeoutMs,
          onDshOutput: chunk => process.stderr.write(chunk),
        })) + '\n')
      } finally {
        process.off('SIGINT', cancel)
        process.off('SIGTERM', cancel)
        process.stdin.destroy()
      }
    } catch (error) {
      process.stderr.write(String(error.message) + '\n')
      process.exitCode = 1
    }
  })()
}
