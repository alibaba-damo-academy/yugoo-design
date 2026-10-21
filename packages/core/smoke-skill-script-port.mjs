import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSkillScriptPort } from './lib/dsh-design-execution-plugin.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-skill-script-'))
try {
  const scripts = join(root, 'skills', 'fixture', 'scripts')
  const outside = join(root, 'outside.mjs')
  await mkdir(scripts, { recursive: true })
  await writeFile(join(scripts, 'ok.mjs'), 'process.stdout.write("ok")\n')
  await writeFile(outside, 'process.stdout.write("outside")\n')
  await symlink(outside, join(scripts, 'escape.mjs'))

  let invocation
  const subprocess = {
    spawn(request) {
      invocation = request
      return {
        done: Promise.resolve({ exitCode: 0 }),
        collected: {
          stdout: { readFrom: () => ({ text: 'ok', lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
      }
    },
  }
  const port = createSkillScriptPort(
    { sourceRoot: root },
    { name: 'fixture' },
    subprocess,
  )
  assert.ok(port)
  assert.deepEqual(await port.run('ok.mjs', ['literal'], 'stdin', new AbortController().signal), {
    stdout: 'ok', stderr: '', exitCode: 0,
  })
  assert.deepEqual(invocation.argv, [process.execPath, join(scripts, 'ok.mjs'), 'literal'])
  assert.equal(invocation.cwd, scripts)
  assert.deepEqual(invocation.stdio.stdin, { data: 'stdin' })

  await assert.rejects(
    port.run('../outside.mjs', [], '', new AbortController().signal),
    /escapes the active Skill scripts directory|ENOENT/,
  )
  await assert.rejects(
    port.run('escape.mjs', [], '', new AbortController().signal),
    /escapes the active Skill scripts directory/,
  )
  await assert.rejects(
    port.run('ok.txt', [], '', new AbortController().signal),
    /ENOENT|regular \.mjs/,
  )
  console.log('SKILL SCRIPT PORT CONFINEMENT OK')
} finally {
  await rm(root, { recursive: true, force: true })
}
