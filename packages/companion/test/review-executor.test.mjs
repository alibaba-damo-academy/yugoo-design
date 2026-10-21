import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { spawn } from 'node:child_process'
import { access, readFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createReviewExecutor } from '../src/review-executor.mjs'

const id = '01234567-89ab-cdef-0123-456789abcdef'
const input = { prompt: 'Review saved evidence.', outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false }, cwd: '/tmp/evidence' }
const success = [
  { type: 'thread.started', thread_id: id }, { type: 'turn.started' },
  { type: 'item.completed', item: { type: 'agent_message', text: '{"ok":true}' } }, { type: 'turn.completed' },
]
function fixture({ config = { model: 'fixture-model', model_provider: 'openai', mcp_servers: { dangerous: { command: 'write-data' } } }, events = success, exitCode = 0, tail = '', hang = false, ignoreTerm = false, configError = false, configHang = false, stderr = '', configStderr = '', configExitCode = 0, configLinger = false, configReadHang = false } = {}) {
  const calls = [], kills = []
  function spawnImpl(executable, args, options) {
    const child = new EventEmitter()
    Object.assign(child, { stdin: new PassThrough(), stdout: new PassThrough(), stderr: new PassThrough() })
    const call = { executable, args, options, child, input: '' }; calls.push(call)
    let closed = false
    const close = (code = 0, signal = null) => {
      if (closed) return
      closed = true
      child.stdout.end(); child.stderr.end()
      queueMicrotask(() => child.emit('close', code, signal))
    }
    child.kill = signal => { kills.push(signal); if (!ignoreTerm || signal === 'SIGKILL') close(null, signal); return true }
    const emit = event => child.stdout.write(`${JSON.stringify(event)}\n`)
    child.stdin.on('data', chunk => {
      call.input += chunk.toString()
      if (args[0] !== 'app-server' || configHang) return
      for (const line of chunk.toString().trim().split('\n')) {
        const request = JSON.parse(line)
        if (request.method === 'initialize') queueMicrotask(() => emit({ id: 1, result: {} }))
        if (request.method === 'config/read' && !configReadHang) queueMicrotask(() => emit(configError ? { id: 2, error: { message: 'SECRET provider detail' } } : { id: 2, result: { config } }))
      }
    })
    child.stdin.on('finish', () => {
      if (args[0] === 'app-server') { if (configStderr) child.stderr.write(configStderr); if (!configLinger) close(configExitCode); return }
      if (hang) return
      queueMicrotask(() => {
        for (const event of events) emit(event)
        if (tail) child.stdout.write(tail)
        if (stderr) child.stderr.write(stderr)
        close(exitCode)
      })
    })
    queueMicrotask(() => child.emit('spawn'))
    return child
  }
  return { calls, kills, spawnImpl, run: overrides => createReviewExecutor({ spawnImpl, killGraceMs: 5, timeoutMs: 1000, configTimeoutMs: 1000, ...overrides })(input) }
}

test('isolated exec preserves model and auth location, returns actual native ID, cleans temporary files', async () => {
  const f = fixture()
  assert.deepEqual(await f.run(), { result: { ok: true }, nativeRunId: id })
  assert.equal(f.calls.length, 2)
  const [probe, run] = f.calls
  assert.match(probe.input, /config\/read/)
  assert.doesNotMatch(probe.input, /thread\/start|turn\/start/)
  assert.equal(run.options.shell, false)
  assert.equal(run.options.env, undefined, 'reuse native auth environment; no auth copying')
  assert.notEqual(run.options.cwd, input.cwd, 'evidence directory cannot load project config')
  for (const flag of ['--ignore-user-config', '--ignore-rules', '--ephemeral', '--output-schema']) assert.ok(run.args.includes(flag))
  assert.ok(run.args.includes('approval_policy="never"'))
  assert.ok(run.args.includes('shell_environment_policy.inherit="none"'))
  assert.ok(run.args.includes('web_search="disabled"'))
  assert.equal(run.args[run.args.indexOf('--sandbox') + 1], 'read-only')
  assert.equal(run.args[run.args.indexOf('--model') + 1], 'fixture-model')
  assert.ok(run.args.includes('mcp_servers={}'))
  for (const feature of ['hooks', 'plugins', 'apps', 'multi_agent', 'skill_mcp_dependency_install', 'computer_use', 'browser_use', 'image_generation', 'request_permissions_tool']) assert.ok(run.args.some((arg, i) => arg === '--disable' && run.args[i + 1] === feature))
  assert.ok(run.args.some(arg => arg.startsWith('mcp_servers={"dangerous"=') && arg.includes('disabled-mcp-do-not-launch') && arg.includes('"enabled"=false')))
  assert.doesNotMatch(run.args.join(' '), /write-data/)
  assert.match(run.input, /Evidence working directory: \/tmp\/evidence/)
  assert.match(run.input, /across all required facets/)
  assert.match(run.input, /Read authoritative source files.*verify findings or resolve missing facts/)
  assert.match(run.input, /Directory exploration and repeated reads.*are not prerequisites/)
  assert.match(run.input, /Do not narrow the review scope, substitute graph projections for source verification/)
  assert.doesNotMatch(run.input, /Inspect that directory read-only;/)
  assert.equal(run.args.at(-1), '-')
  await assert.rejects(access(run.options.cwd), { code: 'ENOENT' })
})

function diagnosticBase(error) {
  const { phase, timingsMs, ...base } = error.diagnostic
  assert.ok(['spawn', 'initialize', 'read', 'cleanup', 'run'].includes(phase))
  assert.ok(Number.isInteger(timingsMs.total))
  for (const value of Object.values(timingsMs)) assert.ok(Number.isInteger(value) && value >= 0)
  return base
}

test('selected custom provider is whitelisted; unrelated credentials/config never forwarded', async () => {
  const f = fixture({ config: { model: 'saved', model_provider: 'gateway', model_providers: {
    gateway: { name: 'Gateway', base_url: 'https://example.invalid/v1', env_key: 'REVIEW_API_KEY', wire_api: 'responses', requires_openai_auth: false },
    unused: { http_headers: { Authorization: 'SECRET' } },
  }, instructions: 'spawn agents', hooks: { command: 'unsafe' } } })
  await f.run({ model: 'explicit' })
  const args = f.calls[1].args
  assert.equal(args[args.indexOf('--model') + 1], 'explicit')
  assert.match(args.join(' '), /REVIEW_API_KEY/)
  assert.doesNotMatch(args.join(' '), /SECRET|unsafe|spawn agents/)
})

for (const capability of [false, true]) test(`provider standalone web search capability accepts boolean ${capability}`, async () => {
  const f = fixture({ config: { model_provider: 'gateway', model_providers: {
    gateway: { name: 'Gateway', wire_api: 'responses', supports_standalone_web_search: capability },
  } } })
  await f.run()
  assert.equal(f.calls.length, 2)
  const args = f.calls[1].args
  assert.ok(args.some(arg => arg.startsWith('model_providers=') && arg.includes(`"supports_standalone_web_search"=${capability}`)))
  assert.ok(args.includes('web_search="disabled"'))
})

for (const [name, spec] of [
  ['inline headers', { http_headers: { Authorization: 'SECRET' } }],
  ['inline bearer', { experimental_bearer_token: 'SECRET' }],
  ['URL credentials', { base_url: 'https://user:SECRET@example.invalid' }],
  ['URL query', { base_url: 'https://example.invalid/?key=SECRET' }],
  ['query credentials', { query_params: { api_key: 'SECRET' } }],
  ['unknown provider field', { future_tool: 'SECRET' }],
  ['nonboolean standalone web search capability', { supports_standalone_web_search: 'SECRET' }],
]) test(`fail closed on ${name}`, async () => {
  const f = fixture({ config: { model_provider: 'custom', model_providers: { custom: spec } } })
  await assert.rejects(f.run(), error => /PROVIDER/.test(error.code) && !error.message.includes('SECRET'))
  assert.equal(f.calls.length, 1)
  await assert.rejects(access(f.calls[0].options.cwd), { code: 'ENOENT' })
})

for (const [name, options, code] of [
  ['nonzero exit', { exitCode: 1 }, 'PROCESS_FAILED'],
  ['truncated JSONL', { tail: '{"type":' }, 'TRUNCATED_OUTPUT'],
  ['invalid JSONL', { tail: 'oops\n' }, 'INVALID_OUTPUT'],
  ['missing completion', { events: success.slice(0, -1) }, 'INCOMPLETE_TURN'],
  ['missing result', { events: [success[0], success[1], success[3]] }, 'MISSING_RESULT'],
  ['refusal', { events: [success[0], success[1], { type: 'item.completed', item: { type: 'refusal' } }] }, 'NATIVE_FAILURE'],
  ['native turn failed', { events: [success[0], { type: 'turn.failed', error: { message: 'SECRET' } }] }, 'NATIVE_FAILURE'],
  ['duplicate native ID', { events: [success[0], success[0]] }, 'INVALID_NATIVE_ID'],
  ['duplicate turn', { events: [success[0], success[1], success[1]] }, 'INVALID_TURN'],
  ['invalid native ID', { events: [{ type: 'thread.started', thread_id: 'made-up' }] }, 'INVALID_NATIVE_ID'],
  ['post-terminal output', { events: [...success, success[2]] }, 'OUTPUT_AFTER_COMPLETION'],
  ['non-JSON final result', { events: [success[0], success[1], { type: 'item.completed', item: { type: 'agent_message', text: 'Cannot comply' } }, success[3]] }, 'INVALID_RESULT_JSON'],
  ['array final result', { events: [success[0], success[1], { type: 'item.completed', item: { type: 'agent_message', text: '[]' } }, success[3]] }, 'INVALID_RESULT'],
  ['config failure', { configError: true }, 'CONFIG_FAILED'],
]) test(`rejects ${name}`, async () => {
  const f = fixture(options)
  await assert.rejects(f.run(), { code })
  await assert.rejects(access(f.calls[0].options.cwd), { code: 'ENOENT' })
})

test('config preflight is time bounded without model execution', async () => {
  const f = fixture({ configHang: true })
  await assert.rejects(f.run({ configTimeoutMs: 15 }), { code: 'TIMEOUT' })
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.kills, ['SIGTERM'])
})

test('hung exec escalates TERM to KILL; output limit includes stderr', async () => {
  const f = fixture({ hang: true, ignoreTerm: true })
  await assert.rejects(f.run({ timeoutMs: 15 }), { code: 'TIMEOUT' })
  assert.deepEqual(f.kills, ['SIGTERM', 'SIGKILL'])
  const large = fixture({ stderr: 'x'.repeat(3000) })
  await assert.rejects(large.run({ maxOutputBytes: 2000 }), { code: 'OUTPUT_LIMIT' })
})

test('abort before launch and while executing never returns success', async () => {
  const controller = new AbortController(); controller.abort()
  const f = fixture()
  await assert.rejects(createReviewExecutor({ spawnImpl: f.spawnImpl })({ ...input, signal: controller.signal }), { code: 'ABORTED' })
  assert.equal(f.calls.length, 0)
  const later = new AbortController(), hanging = fixture({ hang: true })
  const promise = createReviewExecutor({ spawnImpl: hanging.spawnImpl, killGraceMs: 5 })({ ...input, signal: later.signal })
  const timer = setInterval(() => { if (hanging.calls.length === 2) later.abort() }, 2)
  try { await assert.rejects(promise, { code: 'ABORTED' }) } finally { clearInterval(timer) }
  assert.deepEqual(hanging.kills, ['SIGTERM'])
})

test('unsupported hosts and invalid input do not spawn; schema is passed verbatim to native CLI', async () => {
  const f = fixture()
  for (const host of ['cc', 'qoder', 'qodercli']) await assert.rejects(f.run({ host }), { code: 'UNSUPPORTED_HOST' })
  assert.equal(f.calls.length, 0)
  await assert.rejects(createReviewExecutor({ spawnImpl: f.spawnImpl })({ ...input, prompt: '' }), { code: 'INVALID_INPUT' })
  let schema
  const wrapped = (exe, args, opts) => {
    if (args[0] === 'exec') schema = readFile(args[args.indexOf('--output-schema') + 1], 'utf8')
    return f.spawnImpl(exe, args, opts)
  }
  await createReviewExecutor({ spawnImpl: wrapped })(input)
  assert.deepEqual(JSON.parse(await schema), input.outputSchema)
})

test('spawn failure is sanitized and cleaned', async () => {
  let root
  const run = createReviewExecutor({ spawnImpl: (_exe, _args, options) => { root = options.cwd; throw new Error('SECRET') } })
  await assert.rejects(run(input), error => {
    assert.deepEqual(diagnosticBase(error), { stage: 'config', exitCode: null, signal: null, classification: 'process-start' })
    assert.equal(error.diagnostic.phase, 'spawn')
    return error.code === 'SPAWN_FAILED'
  })
  await assert.rejects(access(root), { code: 'ENOENT' })
})

test('a broken child that never closes cannot hang cancellation cleanup', async () => {
  const f = fixture({ configHang: true })
  const kills = []
  const spawnImpl = (...args) => {
    const child = f.spawnImpl(...args)
    child.kill = signal => { kills.push(signal); return false }
    return child
  }
  await assert.rejects(createReviewExecutor({ spawnImpl, configTimeoutMs: 10, killGraceMs: 5 })(input), { code: 'TIMEOUT' })
  assert.deepEqual(kills, ['SIGTERM', 'SIGKILL'])
  await assert.rejects(access(f.calls[0].options.cwd), { code: 'ENOENT' })
})

test('asynchronous process errors fail without leaking diagnostics', async () => {
  const f = fixture({ configHang: true })
  const spawnImpl = (...args) => {
    const child = f.spawnImpl(...args)
    queueMicrotask(() => child.emit('error', new Error('SECRET executable details')))
    return child
  }
  await assert.rejects(createReviewExecutor({ spawnImpl, killGraceMs: 5 })(input), error => error.code === 'SPAWN_FAILED' && error.diagnostic.stage === 'config' && !error.message.includes('SECRET'))
})

test('disabled MCP entries retain valid inert transport, never actual commands or credentials', async () => {
  const f = fixture({ config: { model_provider: 'openai', mcp_servers: {
    stdio: { command: 'SECRET_COMMAND', args: ['SECRET_ARG'], env: { TOKEN: 'SECRET_ENV' } },
    http: { url: 'https://SECRET_SERVER.invalid', http_headers: { Authorization: 'SECRET_HEADER' } },
  } } })
  await f.run()
  const args = f.calls[1].args.join(' ')
  assert.match(args, /mcp_servers=\{"stdio"=\{"command"="[^"]+disabled-mcp-do-not-launch","enabled"=false\}/)
  assert.match(args, /"http"=\{"url"="http:\/\/127\.0\.0\.1:0\/disabled-mcp","enabled"=false\}/)
  assert.doesNotMatch(args, /SECRET/)
  const invalid = fixture({ config: { mcp_servers: { malformed: { enabled: false } } } })
  await assert.rejects(invalid.run(), { code: 'INVALID_MCP_CONFIG' })
  assert.equal(invalid.calls.length, 1)
})

for (const stage of ['config', 'exec']) test(`nonzero ${stage} exit exposes only safe stage/exit/category, never stderr`, async () => {
  const raw = 'Error: error loading config: invalid transport in mcp_servers.SECRET_NAME https://secret.invalid/?token=SECRET_TOKEN Authorization: Bearer SECRET_TOKEN'
  const f = fixture(stage === 'config' ? { configStderr: raw, configExitCode: 1 } : { stderr: raw, exitCode: 1, events: [] })
  await assert.rejects(f.run(), error => {
    assert.deepEqual(diagnosticBase(error), { stage, exitCode: 1, signal: null, classification: 'mcp-config' })
    assert.match(error.message, /exit=1/)
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /SECRET|secret\.invalid|Authorization/)
    return error.code === 'PROCESS_FAILED'
  })
})

test('native error classification is finite and redacted, and cancellation retains observed signal', async () => {
  const f = fixture({ events: [success[0], { type: 'turn.failed', error: { message: 'HTTP 401 invalid API key SECRET_TOKEN' } }] })
  await assert.rejects(f.run(), error => {
    assert.equal(error.diagnostic.classification, 'authentication')
    assert.equal(error.diagnostic.stage, 'exec')
    assert.doesNotMatch(JSON.stringify(error) + error.stack, /SECRET_TOKEN/)
    return error.code === 'NATIVE_FAILURE'
  })
  await assert.rejects(fixture({ hang: true, ignoreTerm: true }).run({ timeoutMs: 10 }), error => {
    assert.deepEqual(diagnosticBase(error), { stage: 'exec', exitCode: null, signal: 'SIGKILL', classification: 'timeout' })
    assert.equal(error.diagnostic.phase, 'run')
    return error.code === 'TIMEOUT'
  })
})

test('successful config probes close boundedly even when app-server ignores stdin EOF', async () => {
  const f = fixture({ configLinger: true, ignoreTerm: true })
  assert.deepEqual(await f.run(), { result: { ok: true }, nativeRunId: id })
  assert.deepEqual(f.kills, ['SIGTERM', 'SIGKILL'])
  assert.equal(f.calls.length, 2)
  // A genuine nonzero config exit, even after a response, is still a failure.
  await assert.rejects(fixture({ configExitCode: 1 }).run(), { code: 'PROCESS_FAILED' })
})

test('a completed config response does not turn user cancellation into success', async () => {
  const f = fixture({ configLinger: true }), controller = new AbortController()
  const running = createReviewExecutor({ spawnImpl: f.spawnImpl, killGraceMs: 100 })({ ...input, signal: controller.signal })
  const timer = setInterval(() => { if (f.calls[0]?.child.stdin.writableFinished) controller.abort() }, 1)
  try { await assert.rejects(running, error => {
    assert.deepEqual(diagnosticBase(error), { stage: 'config', exitCode: null, signal: 'SIGTERM', classification: 'cancelled' })
    assert.equal(error.diagnostic.phase, 'cleanup')
    return error.code === 'ABORTED'
  }) }
  finally { clearInterval(timer) }
  assert.equal(f.calls.length, 1)
})

test('validated config response ends request deadline; cleanup remains separately bounded', async () => {
  const f = fixture({ configLinger: true })
  assert.deepEqual(await f.run({ configTimeoutMs: 30, killGraceMs: 60 }), { result: { ok: true }, nativeRunId: id })
  assert.deepEqual(f.kills, ['SIGTERM'])
  const broken = fixture({ configLinger: true }), kills = []
  const spawnImpl = (...args) => {
    const child = broken.spawnImpl(...args)
    child.kill = signal => { kills.push(signal); return false }
    return child
  }
  await assert.rejects(createReviewExecutor({ spawnImpl, configTimeoutMs: 30, killGraceMs: 10 })(input), error => {
    assert.equal(error.diagnostic.phase, 'cleanup')
    assert.ok(error.diagnostic.timingsMs.cleanup >= 20)
    return error.code === 'CONFIG_CLEANUP_TIMEOUT'
  })
  assert.ok(kills.includes('SIGKILL'))
  assert.equal(broken.calls.length, 1)
})

for (const [phase, options] of [['initialize', { configHang: true }], ['read', { configReadHang: true }]]) {
  test(`config timeout identifies ${phase} separately from bounded cleanup`, async () => {
    const f = fixture(options)
    await assert.rejects(f.run({ configTimeoutMs: 20 }), error => {
      diagnosticBase(error)
      assert.equal(error.diagnostic.phase, phase)
      assert.ok(error.diagnostic.timingsMs[phase] >= 10)
      assert.ok(Object.hasOwn(error.diagnostic.timingsMs, 'cleanup'))
      return error.code === 'TIMEOUT'
    })
    assert.equal(f.calls.length, 1)
  })
}

test('executor supplies strict schema and restores optional fields before shared validation', async () => {
  const f = fixture({ events: [success[0], success[1], { type: 'item.completed', item: {
    type: 'agent_message', text: '{"ok":true,"optional":null,"nullable":{"value":null}}',
  } }, success[3]] })
  let schema
  const spawnImpl = (...args) => {
    if (args[1][0] === 'exec') schema = readFile(args[1][args[1].indexOf('--output-schema') + 1], 'utf8')
    return f.spawnImpl(...args)
  }
  const result = await createReviewExecutor({ spawnImpl })({ ...input, outputSchema: {
    ...input.outputSchema, properties: { ...input.outputSchema.properties, optional: { type: 'string' }, nullable: { type: ['string', 'null'] } },
  } })
  assert.deepEqual(result.result, { ok: true, nullable: null })
  assert.deepEqual(JSON.parse(await schema).required, ['ok', 'optional', 'nullable'])
  assert.match(f.calls[1].input, /Do not invent a value/)
})

// Explicit opt-in: real CLI CONFIG parsing only. No thread/start, turn/start,
// exec, credentials copied, or model request. Covers the bug fake processes hid.
test('native config-only regression: incomplete disabled MCP fails, emitted inert transports parse', {
  skip: process.env.DESIGN_REVIEW_CODEX_CONFIG_TEST !== '1', timeout: 30000,
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'review-native-config-test-'))
  async function probe(args) {
    const child = spawn('codex', ['app-server', '--stdio', ...args], {
      cwd: root, env: { ...process.env, CODEX_HOME: root }, stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = '', buffer = '', config, bytes = 0, shutdown, expectedShutdown = false
    const timer = setTimeout(() => child.kill('SIGKILL'), 10000)
    child.stdin.on('error', () => {})
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-16384) })
    child.stdout.on('data', chunk => {
      bytes += chunk.length
      if (bytes > 1024 * 1024) { child.kill('SIGKILL'); return }
      buffer += chunk.toString()
      let newline
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        let event
        try { event = JSON.parse(line) } catch { child.kill('SIGKILL'); return }
        if (event.id === 1) {
          child.stdin.write(JSON.stringify({ method: 'initialized' }) + '\n')
          child.stdin.write(JSON.stringify({ id: 2, method: 'config/read', params: { includeLayers: false, cwd: root } }) + '\n')
        } else if (event.id === 2) {
          config = event.result?.config; child.stdin.end()
          shutdown = setTimeout(() => { expectedShutdown = true; child.kill('SIGTERM') }, 100)
        }
      }
    })
    child.stdin.write(JSON.stringify({ id: 1, method: 'initialize', params: { clientInfo: { name: 'review_config_test', version: '1.0.0' } } }) + '\n')
    try {
      const exit = await new Promise((resolve, reject) => { child.once('close', (code, signal) => resolve({ code, signal })); child.once('error', reject) })
      return { ...exit, config, expectedShutdown, invalidTransport: /invalid transport/.test(stderr) }
    } finally { clearTimeout(timer); clearTimeout(shutdown); child.kill('SIGKILL') }
  }
  try {
    const broken = await probe(['--disable', 'hooks', '--disable', 'plugins', '-c', 'mcp_servers.fixture.enabled=false'])
    assert.equal(broken.code, 1)
    assert.equal(broken.invalidTransport, true)
    const f = fixture({ config: { model_provider: 'gateway', model_providers: { gateway: { name: 'Fixture gateway', base_url: 'http://127.0.0.1:0/v1', env_key: 'CONFIG_TEST_UNUSED_KEY', wire_api: 'responses' } },
      mcp_servers: { stdio: { command: 'NEVER_RUN' }, http: { url: 'https://never-contact.invalid' }, 'name.with.dots': { command: 'NEVER_RUN' } } } })
    await f.run()
    // Simulate a lower-priority file layer, without touching real system/user
    // config. Overrides must disable existing names, not add quoted-name clones.
    await writeFile(join(root, 'config.toml'), [
      '[mcp_servers.stdio]', 'command = "NEVER_RUN_ORIGINAL"', 'enabled = true',
      '[mcp_servers.http]', 'url = "http://127.0.0.1:0/original"', 'enabled = true',
      '[mcp_servers."name.with.dots"]', 'command = "NEVER_RUN_ORIGINAL"', 'enabled = true',
    ].join('\n'))
    const configArgs = []
    const args = f.calls[1].args
    for (let i = 0; i < args.length; i++) if (args[i] === '-c' || args[i] === '--disable') configArgs.push(args[i], args[++i])
    const fixed = await probe(configArgs)
    assert.ok(fixed.code === 0 || fixed.expectedShutdown && fixed.signal === 'SIGTERM', `emitted overrides must parse without a model; configRead=${!!fixed.config}; invalidTransport=${fixed.invalidTransport}`)
    assert.deepEqual(Object.keys(fixed.config.mcp_servers).sort(), ['http', 'name.with.dots', 'stdio'])
    assert.equal(fixed.config.mcp_servers.stdio.enabled, false)
    assert.equal(fixed.config.mcp_servers.http.enabled, false)
    assert.equal(fixed.config.mcp_servers['name.with.dots'].enabled, false)
    assert.match(fixed.config.mcp_servers.stdio.command, /disabled-mcp-do-not-launch$/)
    assert.equal(fixed.config.mcp_servers.http.url, 'http://127.0.0.1:0/disabled-mcp')
    assert.equal(fixed.config.model_provider, 'gateway')
    assert.equal(fixed.config.model_providers.gateway.base_url, 'http://127.0.0.1:0/v1')
    assert.equal(fixed.config.features.hooks, false)
    assert.equal(fixed.config.features.plugins, false)
  } finally { await rm(root, { recursive: true, force: true }) }
})
