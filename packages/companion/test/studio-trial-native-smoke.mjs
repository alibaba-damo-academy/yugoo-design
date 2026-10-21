/** Opt-in real model check; dispatch is captured and delivered to a native CLI.
 * This is NOT a proof of automatic hook wakeup in an already-running session. */
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { DesignProjectManager } from '../../core/lib/index.js'
import { startCompanion } from '../src/server.mjs'
import { callCompanion } from '../src/connection-file.mjs'

const root = await mkdtemp(join(tmpdir(), 'studio-trial-native-'))
let server
try {
  const projectRoot = join(root, 'source-project'), stateRoot = join(root, 'state'), config = join(root, 'claude')
  await mkdir(stateRoot); await mkdir(config)
  const threadId = randomUUID(), messages = []
  await new DesignProjectManager().create({ root: projectRoot, name: 'Isolated Studio native check', kit: { name: 'web_app', version: '1.0' }, knowledge: { provider: 'ladybug-wasm' } })
  const transcriptPath = join(config, 'projects', projectRoot.replace(/[^a-zA-Z0-9]/g, '-'), `${threadId}.jsonl`)
  server = await startCompanion({ projectRoot, stateRoot, kitRoot: resolve('packages/skills-web-app'),
    staticRoot: resolve('packages/companion/dist'), host: 'claude-code', nativeCwd: projectRoot, transcriptPath,
    knowledgeAutoRefresh: false, embedding: { provider: 'disabled' },
    knowledgeRuntime: async () => { throw new Error('Knowledge disabled in this non-KAG check') },
    connection: { host: 'claude-code', threadId, send: async text => { messages.push(text); return { accepted: true } } },
  })
  const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params })
  const trial = await call('studioTrialStart', { source: { kind: 'installed', kit: { name: 'web_app', version: '1.0' }, bundle: { name: 'smart_questions', version: '1.0' } } })
  assert.equal(trial.status, 'preparing', JSON.stringify(trial))
  const trialRoot = join(stateRoot, 'studio-trials', trial.id, 'project')
  const mcp = JSON.stringify({ mcpServers: { design: { command: process.execPath, args: [resolve('packages/companion/dist-server/design.mjs'), 'mcp'] } } })
  const allowed = ['design_status', 'design_prepare_bundle', 'design_submit_trial_input', 'design_begin_main_bundle', 'design_finish_main_bundle'].map(name => `mcp__design__${name}`)
  allowed.push(`Read(/${root}/**)`, `Edit(/${trialRoot}/design_files/smart_questions/**)`)
  const prompt = `You are running one isolated Studio test. Session identity: ${threadId}. Use the exact Companion connection specified below, never inspect its token file. Use design_prepare_bundle, read the method/schema/resources it provides, generate a concrete synthetic test input naming smart_questions and submit it through design_submit_trial_input before beginning execution. Then begin main execution and Write one valid canonical Smart Questions state. Finish with scope=state,outcome=pause. Do not run design_command, modify installed content, ask a shell to do the work, or use another connection. Stop after successful finish; no user answer is available.\n${messages[0]}`
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn('claude-qwen', ['--print', '--thinking', 'disabled', '--session-id', threadId,
      '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--strict-mcp-config', '--mcp-config', mcp,
      '--tools', 'Read,Write', '--allowedTools', ...allowed, '--permission-mode', 'dontAsk', '--disable-slash-commands',
      '--output-format', 'stream-json', '--verbose', prompt], { cwd: projectRoot, env: { ...process.env, CLAUDE_CONFIG_DIR: config }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    let bytes = 0, buffer = '', last, killTimer
    const stop = () => { try { process.kill(-child.pid, 'SIGTERM') } catch {} }
    const timer = setTimeout(() => { stop(); killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL') } catch {} }, 5000) }, 240000)
    child.stdout.on('data', data => {
      bytes += data.length; if (bytes > 1000000) { stop(); return }
      buffer += data.toString(); let i
      while ((i = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1)
        try { const event = JSON.parse(line); if (event.type === 'result') last = event
          if (event.type === 'assistant') for (const block of event.message?.content ?? []) if (block.type === 'tool_use') console.log(`native tool: ${block.name}`)
        } catch {}
      }
    })
    child.stderr.on('data', () => {}) // Never print credential-bearing diagnostics.
    child.on('error', reject)
    child.on('close', code => { clearTimeout(timer); clearTimeout(killTimer); resolveResult({ code, last }) })
  })
  assert.equal(result.code, 0, 'Native CLI did not finish successfully')
  assert.equal(result.last?.is_error, false, 'Native model returned an error')
  const state = JSON.parse(await readFile(join(trialRoot, 'design_files/smart_questions/smart_questions.json'), 'utf8'))
  assert.ok(Object.entries(state.questions).some(([key, value]) => !key.startsWith('const_') && value.kind === 'text' && !value.answer))
  const observed = await call('studioTrialRead', { id: trial.id })
  assert.equal(observed.status, 'waiting', JSON.stringify(observed))
  assert.equal(observed.inputMode, 'generated')
  assert.match(observed.task, /smart_questions/)
  console.log('PASS real claude-qwen -> generated concrete input receipt -> compiled MCP -> isolated Bundle generation/settlement -> waiting. Captured dispatch, not live hook wakeup.')
} finally { await server?.close(); await rm(root, { recursive: true, force: true }) }
