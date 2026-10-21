import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DesignProjectManager } from '../../core/lib/index.js'
import { startCompanion } from '../src/server.mjs'
import { parse } from 'yaml'
import { staticFixture } from './static-fixture.mjs'
export const threadId = '00000000-0000-4000-8000-000000000001'
const sourceKitRoot = fileURLToPath(new URL('../../skills-web-app/', import.meta.url))

export async function fixture({ withTranscript = false, smartQuestionsMode = 'subagent', researchMode = 'subagent', serverOptions = {} } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'design-companion-test-'))
  // Producer tests choose their topology explicitly, independently of the
  // shipped Smart Questions default. Never rewrite the shared source Kit.
  const kitRoot = join(root, 'kit')
  await mkdir(kitRoot)
  // This fixture deliberately retains the supported embedded development layout.
  // Independent installed closures have separate lifecycle integration tests.
  await cp(join(sourceKitRoot, 'kits/web_app/mindset.md'), join(kitRoot, 'mindset.md'))
  await cp(join(sourceKitRoot, 'bundles'), join(kitRoot, 'skills'), { recursive: true })
  await writeFile(join(kitRoot, 'relations.yaml'), `schema_version: 1
relations:
  - type: web_app:corroborates
    meaning: supports
    direction: forward
    label: { zh: 佐证, en: Corroborates }
    description: { zh: A 的证据佐证 B, en: Evidence from A corroborates B }
`)
  const manifest = join(kitRoot, 'skills/smart_questions/skill.yaml')
  await writeFile(manifest, (await readFile(manifest, 'utf8')).replace('  mode: main\n', `  mode: ${smartQuestionsMode}\n`))
  const researchManifest = join(kitRoot, 'skills/research/skill.yaml')
  await writeFile(researchManifest, (await readFile(researchManifest, 'utf8')).replace('  mode: main\n', `  mode: ${researchMode}\n`))
  const projectRoot = join(root, 'project')
  const kitVersion = parse((await readFile(join(kitRoot, 'mindset.md'), 'utf8')).split('---')[1]).version
  await new DesignProjectManager().create({ root: projectRoot, name: 'Companion fixture', knowledge: { provider: 'ladybug-wasm' }, kit: { name: 'web_app', version: String(kitVersion) } })
  const messages = []
  let rejectMessage = false
  const transcriptPath = withTranscript ? join(root, serverOptions.host === 'qwenwork' ? `${threadId}.jsonl` : 'native.jsonl') : undefined
  if (transcriptPath) await writeFile(transcriptPath, JSON.stringify(serverOptions.host === 'workbuddy'
    ? { type: 'message', id: 'before-design', role: 'user', sessionId: threadId, cwd: projectRoot,
      content: [{ type: 'input_text', text: 'Earlier native WorkBuddy history' }], timestamp: Date.now() }
    : serverOptions.host === 'qwenwork'
    ? { type: 'user', uuid: 'before-design', parentUuid: null, sessionId: threadId, cwd: projectRoot,
      message: { content: 'Earlier native QwenWork history' }, timestamp: new Date().toISOString() }
    : { type: 'session_meta', payload: { id: threadId, cwd: projectRoot } }) + '\n')
  const options = { ...await staticFixture(root), threadId, projectRoot, nativeCwd: projectRoot, kitRoot, transcriptPath, stateRoot: join(root, 'journal'),
    knowledgeAutoRefresh: false,
    knowledgeRuntime: async () => { throw new Error('Knowledge runtime disabled in non-KAG fixture') },
    embedding: { provider: 'disabled' }, connection: { ...(serverOptions.host === 'workbuddy' ? { host: 'workbuddy' } : {}), threadId, async send(text) {
    // This fixture rejects before appending/sending anything; unlike a lost
    // native receipt it can prove that explicit recovery will not duplicate.
    if (rejectMessage) throw Object.assign(new Error(typeof rejectMessage === 'string' ? rejectMessage : 'test transport disconnected'), { notSubmitted: true })
    messages.push(text)
    return { accepted: true, threadId }
  } } }
  const server = await startCompanion({...options,...serverOptions})
  return { root, options, server, messages, failNotification: value => { rejectMessage = value }, async close() {
    await server.close()
    await rm(root, { recursive: true, force: true })
  } }
}
