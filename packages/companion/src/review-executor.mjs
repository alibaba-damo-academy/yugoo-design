/** Finite, service-owned Codex execution. No main-thread identity or model SDK. */
import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { strictReviewOutput } from './review-output-schema.mjs'

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const failure = code => Object.assign(new Error(`Review executor: ${code}`), { code })
// Classify, never echo, native diagnostics: stderr may contain URLs, credentials,
// prompts or file bytes. Only closed-vocabulary labels cross this boundary.
function classify(text, code) {
  if (/invalid transport|missing field.*mcp_servers/is.test(text)) return 'mcp-config'
  if (/unknown feature|unexpected argument|unrecognized (?:argument|option)/i.test(text)) return 'cli-compatibility'
  if (/invalid[_ ](?:json[_ ])?schema|response_format.*schema/is.test(text)) return 'output-schema'
  if (/error (?:loading|parsing).*config|toml parse error/is.test(text)) return 'configuration'
  if (/permission denied|operation not permitted|landlock|bwrap|sandbox.*(?:failed|not supported)/is.test(text)) return 'sandbox-or-permission'
  if (/\b(?:401|403)\b|unauthorized|authentication|not logged in|(?:missing|invalid).*api.?key/is.test(text)) return 'authentication'
  if (/\b429\b|rate.limit|quota/i.test(text)) return 'rate-limit'
  if (/ECONNREFUSED|connection refused|dns error|certificate|connection.*(?:failed|timed out)/is.test(text)) return 'transport'
  return ({ TIMEOUT: 'timeout', CONFIG_CLEANUP_TIMEOUT: 'timeout', ABORTED: 'cancelled', OUTPUT_LIMIT: 'output-limit', SPAWN_FAILED: 'process-start',
    TRUNCATED_OUTPUT: 'output-incomplete', INVALID_OUTPUT: 'output-format', NATIVE_FAILURE: 'native-error' })[code] ?? 'unclassified'
}
function diagnosticError(error, stage, exitCode = null, signal = null, classification = 'unclassified', timing) {
  const diagnostic = { stage, exitCode: Number.isInteger(exitCode) ? exitCode : null,
    signal: ['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGABRT', 'SIGSEGV', 'SIGPIPE', 'SIGHUP'].includes(signal) ? signal : null, classification,
    ...(timing ?? {}) }
  error.diagnostic = diagnostic
  error.message = `Review executor: ${error.code} [stage=${stage}; exit=${diagnostic.exitCode ?? 'unknown'}; signal=${diagnostic.signal ?? 'none'}; category=${classification}${timing ? `; phase=${timing.phase}; timingsMs=${JSON.stringify(timing.timingsMs)}` : ''}]`
  return error
}
const disabled = ['hooks', 'plugins', 'apps', 'multi_agent', 'multi_agent_v2', 'skill_mcp_dependency_install', 'workspace_dependencies',
  'computer_use', 'browser_use', 'browser_use_external', 'image_generation', 'request_permissions_tool']
const isolation = () => disabled.flatMap(name => ['--disable', name])
const toml = value => {
  if (typeof value === 'string' || typeof value === 'boolean' || Number.isFinite(value) && typeof value === 'number') return JSON.stringify(value)
  if (record(value)) return `{${Object.entries(value).map(([key, item]) => `${JSON.stringify(key)}=${toml(item)}`).join(',')}}`
  throw failure('UNSUPPORTED_PROVIDER_CONFIG')
}

// Only transport/model settings cross the config boundary. Never forward hooks,
// MCP, shell policies, instructions, plugins or inline credentials in argv.
function modelConfig(config, override) {
  if (!record(config)) throw failure('INVALID_CONFIG')
  const args = [], model = override ?? config.model
  if (model != null) {
    if (typeof model !== 'string' || !model.trim()) throw failure('INVALID_MODEL')
    args.push('--model', model)
  }
  const provider = config.model_provider ?? 'openai'
  if (typeof provider !== 'string' || !provider.trim()) throw failure('INVALID_PROVIDER')
  args.push('-c', `model_provider=${toml(provider)}`)
  const spec = config.model_providers?.[provider]
  if (spec != null) {
    if (!record(spec)) throw failure('UNSUPPORTED_PROVIDER_CONFIG')
    const allowed = new Set(['name', 'base_url', 'env_key', 'env_key_instructions', 'wire_api', 'requires_openai_auth', 'request_max_retries', 'stream_max_retries', 'stream_idle_timeout_ms', 'env_http_headers', 'query_params', 'supports_websockets', 'supports_standalone_web_search'])
    const safe = {}
    for (const [key, value] of Object.entries(spec)) {
      if (value == null || key === 'http_headers' && record(value) && !Object.keys(value).length) continue
      if (!allowed.has(key)) throw failure('UNSUPPORTED_PROVIDER_CONFIG')
      if (key === 'supports_standalone_web_search' && typeof value !== 'boolean') throw failure('UNSUPPORTED_PROVIDER_CONFIG')
      if (key === 'query_params' && record(value) && Object.keys(value).some(name => /key|token|secret|auth/i.test(name))) throw failure('INLINE_PROVIDER_CREDENTIAL')
      if (key === 'base_url') {
        let url
        try { url = new URL(value) } catch { throw failure('INVALID_PROVIDER_URL') }
        if (url.username || url.password || url.search || url.hash) throw failure('INLINE_PROVIDER_CREDENTIAL')
      }
      safe[key] = value
    }
    // CLI override paths are not TOML quoted-key paths: quotes there become
    // literal name bytes. Quote names inside a parsed TOML VALUE instead.
    args.push('-c', `model_providers=${toml({ [provider]: safe })}`)
  } else if (provider !== 'openai') throw failure('MISSING_PROVIDER_CONFIG')
  return args
}

/** Bounded JSONL process; raw output/errors are deliberately not surfaced. */
function jsonProcess({ executable, args, cwd, spawnImpl, signal, timeoutMs, maxOutputBytes, killGraceMs, stage, onStart, onEvent }) {
  return new Promise((accept, reject) => {
    if (signal?.aborted) { reject(failure('ABORTED')); return }
    let child, timer, killer, reaper, cleanupDeadline, fault, settled = false, bytes = 0, buffer = ''
    const startedAt = performance.now(), durations = {}
    let phase = 'spawn', phaseStarted = startedAt, failurePhase
    const markPhase = next => {
      if (settled || phase === next) return
      const now = performance.now()
      durations[phase] = (durations[phase] ?? 0) + now - phaseStarted
      phase = next; phaseStarted = now
    }
    const timing = () => {
      const now = performance.now()
      const timingsMs = Object.fromEntries(Object.entries({ ...durations, [phase]: (durations[phase] ?? 0) + now - phaseStarted })
        .map(([key, value]) => [key, Math.round(value)]))
      timingsMs.total = Math.round(now - startedAt)
      return { phase: failurePhase ?? phase, timingsMs }
    }
    let configComplete = false, completionKillSent = false
    let diagnosticText = ''
    const noteError = text => { if (typeof text === 'string') diagnosticText = (diagnosticText + text.slice(0, 16384)).slice(-16384) }
    const decoder = new StringDecoder('utf8')
    const finish = (error, exitCode, killed) => {
      if (settled) return
      settled = true
      clearTimeout(timer); clearTimeout(killer); clearTimeout(reaper); clearTimeout(cleanupDeadline)
      signal?.removeEventListener('abort', abort)
      error ? reject(diagnosticError(error, stage, exitCode, killed, classify(diagnosticText, error.code), timing())) : accept()
    }
    const kill = kind => {
      try {
        // Kill descendants too for real POSIX spawns; fake children own their kill.
        if (spawnImpl === spawn && process.platform !== 'win32' && child.pid) process.kill(-child.pid, kind)
        else child.kill(kind)
      } catch { /* close/error still settles; final reaper bounds broken children */ }
    }
    const stop = error => {
      if (fault || settled) return
      fault = error
      failurePhase = phase
      markPhase('cleanup')
      clearTimeout(timer); clearTimeout(killer); clearTimeout(reaper); clearTimeout(cleanupDeadline)
      child.stdin.destroy()
      kill('SIGTERM')
      killer = setTimeout(() => kill('SIGKILL'), killGraceMs)
      reaper = setTimeout(() => finish(fault), killGraceMs * 2)
    }
    const abort = () => stop(failure('ABORTED'))
    try {
      child = spawnImpl(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], shell: false, detached: process.platform !== 'win32' })
    } catch { finish(failure('SPAWN_FAILED')); return }
    const write = value => child.stdin.write(`${JSON.stringify(value)}\n`)
    const completeConfig = () => {
      if (stage !== 'config' || configComplete) throw failure('INVALID_CONFIG_COMPLETION')
      if (performance.now() - startedAt >= timeoutMs) throw failure('TIMEOUT')
      configComplete = true
      // The request budget ends at the validated response, not at process EOF.
      // Cleanup has its own finite grace budget; it cannot turn abort into success.
      clearTimeout(timer)
      markPhase('cleanup')
      child.stdin.end()
      // App-server can keep background services alive after stdin EOF. Once the
      // requested config response is validated, explicitly close this probe.
      // Never apply response-based completion to the model exec process.
      killer = setTimeout(() => {
        completionKillSent = true
        kill('SIGTERM')
        reaper = setTimeout(() => kill('SIGKILL'), killGraceMs)
      }, killGraceMs)
      cleanupDeadline = setTimeout(() => {
        kill('SIGKILL')
        finish(failure('CONFIG_CLEANUP_TIMEOUT'))
      }, killGraceMs * 3)
    }
    const consume = chunk => {
      bytes += chunk.length
      if (bytes > maxOutputBytes) { stop(failure('OUTPUT_LIMIT')); return false }
      return !fault && !settled
    }
    child.stdout.on('data', chunk => {
      if (!consume(chunk)) return
      buffer += decoder.write(chunk)
      let newline
      while (!fault && (newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        if (!line.trim()) continue
        try { onEvent(JSON.parse(line), { write, completeConfig, noteError, configReadStarted: () => markPhase('read') }) }
        catch (error) { stop(error?.code ? error : failure('INVALID_OUTPUT')) }
      }
    })
    child.stderr.on('data', chunk => { noteError(chunk.toString('utf8')); consume(chunk) })
    child.stdin.on('error', () => stop(failure('STDIN_FAILED')))
    child.stdout.on('error', () => stop(failure('STDOUT_FAILED')))
    child.stderr.on('error', () => stop(failure('STDERR_FAILED')))
    child.on('error', () => stop(failure('SPAWN_FAILED')))
    child.once('spawn', () => { if (phase === 'spawn' && !fault) markPhase(stage === 'config' ? 'initialize' : 'run') })
    child.on('close', (code, killed) => {
      // The CLI may close before a shell descendant does. Do not leave those
      // processes behind, including children that ignored the initial TERM.
      if (spawnImpl === spawn && process.platform !== 'win32') kill('SIGKILL')
      buffer += decoder.end()
      const expectedClose = configComplete && completionKillSent && ['SIGTERM', 'SIGKILL'].includes(killed)
      finish(fault ?? ((code !== 0 || killed) && !expectedClose ? failure('PROCESS_FAILED') : buffer.trim() ? failure('TRUNCATED_OUTPUT') : undefined), code, killed)
    })
    timer = setTimeout(() => stop(failure('TIMEOUT')), timeoutMs)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    else {
      try { onStart({ write, end: value => child.stdin.end(value) }) }
      catch { stop(failure('STDIN_FAILED')) }
    }
  })
}

/** Result shape/schema semantics are validated by finishManagedReview, not duplicated here. */
export function createReviewExecutor({ host = 'codex', model, executable = 'codex', spawnImpl = spawn,
  timeoutMs = 600000, configTimeoutMs = 10000, maxOutputBytes = 4 * 1024 * 1024, killGraceMs = 1000 } = {}) {
  return async ({ prompt, outputSchema, cwd, signal }) => {
    if (host !== 'codex') throw failure('UNSUPPORTED_HOST')
    if (typeof prompt !== 'string' || !prompt.trim() || !record(outputSchema) || typeof cwd !== 'string' || !cwd) throw failure('INVALID_INPUT')
    if ([timeoutMs, configTimeoutMs, maxOutputBytes, killGraceMs].some(value => !Number.isSafeInteger(value) || value <= 0)) throw failure('INVALID_LIMIT')
    if (signal?.aborted) throw failure('ABORTED')
    const transport = strictReviewOutput(outputSchema)
    const schema = JSON.stringify(transport.schema)
    if (Buffer.byteLength(prompt) + Buffer.byteLength(schema) > maxOutputBytes) throw failure('INPUT_LIMIT')
    const root = await mkdtemp(join(tmpdir(), 'design-review-executor-'))
    // Run outside the evidence repository so project config/instructions cannot
    // restore tools after --ignore-user-config. Evidence paths stay explicit.
    const common = { executable, cwd: root, spawnImpl, signal, maxOutputBytes, killGraceMs }
    let stage = 'config'
    try {
      let config, initialized = false
      await jsonProcess({ ...common, stage: 'config', timeoutMs: configTimeoutMs,
        args: ['app-server', '--stdio', ...isolation()],
        onStart: ({ write }) => write({ id: 1, method: 'initialize', params: { clientInfo: { name: 'design_review_executor', version: '1.0.0' } } }),
        onEvent(event, { write, completeConfig, noteError, configReadStarted }) {
          if (event.error) { noteError(event.error.message); throw failure('CONFIG_FAILED') }
          if (event.id === 1 && !initialized) {
            initialized = true
            configReadStarted()
            write({ method: 'initialized' })
            write({ id: 2, method: 'config/read', params: { includeLayers: false, cwd: root } })
          } else if (event.id === 2 && initialized && !config) {
            config = event.result?.config
            if (!record(config)) throw failure('INVALID_CONFIG')
            completeConfig()
          }
        },
      })
      stage = 'setup'
      const modelArgs = modelConfig(config, model)
      // --ignore-user-config does not mean ignore administrator/system layers.
      // Explicitly disable every effective server observed in the native probe;
      // an administrator policy forbidding this must make native startup fail.
      if (config.mcp_servers != null && !record(config.mcp_servers)) throw failure('INVALID_MCP_CONFIG')
      const disabledServers = Object.fromEntries(Object.entries(config.mcp_servers ?? {}).map(([name, server]) => {
        if (!record(server)) throw failure('INVALID_MCP_CONFIG')
        // Ignoring user config removes its transport too. An enabled=false-only
        // table is INVALID even when disabled. Supply a valid inert transport of
        // the same kind, without copying commands, URLs, args or credentials.
        const transport = typeof server.command === 'string' && typeof server.url !== 'string'
          ? { command: join(root, 'disabled-mcp-do-not-launch'), enabled: false }
          : typeof server.url === 'string' && typeof server.command !== 'string'
            ? { url: 'http://127.0.0.1:0/disabled-mcp', enabled: false } : null
        if (!transport) throw failure('INVALID_MCP_CONFIG')
        return [name, transport]
      }))
      const mcpArgs = ['-c', `mcp_servers=${toml(disabledServers)}`]
      const schemaPath = join(root, 'output-schema.json')
      await writeFile(schemaPath, schema, { mode: 0o600 })
      let nativeRunId, resultText, started = false, completed = false
      stage = 'exec'
      await jsonProcess({ ...common, stage: 'exec', timeoutMs,
        args: ['exec', '--ignore-user-config', '--ignore-rules', ...isolation(), '-c', 'approval_policy="never"',
          '-c', 'mcp_servers={}', '-c', 'shell_environment_policy.inherit="none"', '-c', 'web_search="disabled"',
          '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '--color', 'never', '--json',
          '--output-schema', schemaPath, ...modelArgs, ...mcpArgs, '-C', root, '-'],
        onStart: ({ end }) => end(`${prompt}\n\n${transport.instruction}\nEvidence working directory: ${resolve(cwd)}\nUse the supplied evidence to plan the checks across all required facets. Read authoritative source files in that directory read-only as needed to verify findings or resolve missing facts; batch related file reads and reuse evidence already verified at this immutable snapshot. Directory exploration and repeated reads of unchanged evidence are not prerequisites for completing the review. Do not narrow the review scope, substitute graph projections for source verification, modify files, launch agents, or contact the foreground conversation. Return only the requested JSON.\n`),
        onEvent(event, { noteError }) {
          if (!record(event) || typeof event.type !== 'string') throw failure('INVALID_EVENT')
          if (event.type === 'error' || event.type === 'turn.failed' || event.type.includes('refusal') || event.item?.type === 'refusal') {
            noteError(event.error?.message ?? event.message)
            throw failure('NATIVE_FAILURE')
          }
          if (completed) throw failure('OUTPUT_AFTER_COMPLETION')
          if (event.type === 'thread.started') {
            if (nativeRunId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(event.thread_id)) throw failure('INVALID_NATIVE_ID')
            nativeRunId = event.thread_id
          } else if (event.type === 'turn.started') {
            if (!nativeRunId || started) throw failure('INVALID_TURN')
            started = true
          } else if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
            if (!started || typeof event.item.text !== 'string') throw failure('INVALID_RESULT')
            resultText = event.item.text
          } else if (event.type === 'turn.completed') {
            if (!started || !resultText) throw failure('MISSING_RESULT')
            completed = true
          }
        },
      })
      stage = 'result'
      if (!completed) throw failure('INCOMPLETE_TURN')
      let result
      try { result = JSON.parse(resultText) } catch { throw failure('INVALID_RESULT_JSON') }
      if (!record(result)) throw failure('INVALID_RESULT')
      return { result: transport.decode(result), nativeRunId }
    } catch (error) {
      if (error.diagnostic) throw error
      const safe = error.message === `Review executor: ${error.code}` ? error : failure('SETUP_FAILED')
      throw diagnosticError(safe, stage, null, null, classify('', safe.code))
    } finally { await rm(root, { recursive: true, force: true }) }
  }
}
