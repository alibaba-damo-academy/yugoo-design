import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createDesignSkillScriptTool } from '../src/dsh-producer-design-tools.ts'

function fixture(run = async () => ({ exitCode: 0, stdout: '<html>ok</html>', stderr: '' })) {
  const writes = []
  let active = true
  let calls = 0
  const tool = createDesignSkillScriptTool({
    read: async () => ({ encoding: 'utf8', content: '{}' }),
    write: async (path, file) => { writes.push({ path, file }) },
  }, { run: async (...args) => { calls++; return run(...args) } }, output => {
    if (!active) throw new Error('assignment inactive')
    if (output !== undefined && output !== 'page_design/a.html') throw new Error('outside assignment')
  })
  return { tool, writes, revoke: () => { active = false }, calls: () => calls }
}

const args = { path: 'render.mjs', input_json: {}, output_file: 'page_design/a.html' }
const exec = () => ({ signal: new AbortController().signal })

test('shared script tool writes the assigned artifact without echoing bytes', async () => {
  const f = fixture()
  const result = await f.tool.execute(args, exec())
  assert.equal(result.written_path, args.output_file)
  assert.equal(result.stdout, '')
  assert.equal(f.writes.length, 1)
})

test('wrong artifact and canonical output fail before script execution', async () => {
  const f = fixture()
  for (const output_file of ['page_design/b.html', 'page_design/page_design.json']) {
    await assert.rejects(f.tool.execute({ ...args, output_file }, exec()), /outside assignment/)
  }
  assert.equal(f.calls(), 0)
  assert.equal(f.writes.length, 0)
})

test('assignment revoked during a script cannot publish its late output', async () => {
  const f = fixture(async () => {
    f.revoke()
    return { exitCode: 0, stdout: 'late', stderr: '' }
  })
  await assert.rejects(f.tool.execute(args, exec()), /assignment inactive/)
  assert.equal(f.writes.length, 0)
})

test('aborted execution cannot run a script', async () => {
  const f = fixture()
  await assert.rejects(f.tool.execute(args, { signal: AbortSignal.abort() }))
  assert.equal(f.calls(), 0)
})

test('validation-only scripts remain usable without output_file', async () => {
  const f = fixture(async () => ({ exitCode: 0, stdout: 'valid', stderr: '' }))
  const result = await f.tool.execute({ path: 'validate.mjs', input_file: 'page_design/a.html' }, exec())
  assert.equal(result.stdout, 'valid')
  assert.equal(f.writes.length, 0)
})

test('canonical guard rejects output even when the supplied policy permits it', async () => {
  let writes = 0
  const tool = createDesignSkillScriptTool({ read: async () => undefined, write: async () => { writes++ } },
    { run: async () => ({ exitCode: 0, stdout: '{}', stderr: '' }) }, () => {})
  await assert.rejects(tool.execute({ ...args, output_file: 'page_design/page_design.json' }, exec()), /canonical JSON/)
  assert.equal(writes, 0)
})

test('invalid output paths are rejected before policy invocation or execution', async () => {
  let checks = 0
  let runs = 0
  const tool = createDesignSkillScriptTool({ read: async () => undefined, write: async () => {} },
    { run: async () => { runs++; return { exitCode: 0, stdout: 'unused', stderr: '' } } }, () => { checks++ })
  await assert.rejects(tool.execute({ ...args, output_file: '../outside.html' }, exec()), /resource paths/)
  assert.equal(checks, 0)
  assert.equal(runs, 0)
})
