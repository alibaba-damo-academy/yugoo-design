import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fixture } from './fixture.mjs'

const run = promisify(execFile), session = `workspace-poll-${process.pid}`
const browser = async (...args) => (await run('agent-browser', ['--session', session, ...args], { timeout: 45000, maxBuffer: 1024 * 1024 })).stdout
const f = await fixture()
const state = prompt => JSON.stringify({ questions: { goal: { prompt, kind: 'text', answer: 'saved answer', detail: '' } } })
const write = content => f.server.project.store.writeWorktreeText('smart_questions/smart_questions.json', content)
try {
  await write(state('Workspace polling fixture'))
  await browser('open', f.server.url)
  await browser('wait', '--fn', 'document.body.innerText.includes("Workspace polling fixture")')
  await browser('snapshot', '-i')
  await browser('eval', `(() => {
    window.__workspacePollSamples = [];
    const original = window.fetch;
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (args[1]?.body && JSON.parse(args[1].body).method === 'readWorkspace') {
        const text = await response.clone().text(), value = JSON.parse(text);
        window.__workspacePollSamples.push({ bytes: new TextEncoder().encode(text).length, unchanged: value.unchanged === true, ok: response.ok });
      }
      return response;
    };
    return true;
  })()`)
  await browser('wait', '--fn', 'window.__workspacePollSamples.filter(x=>x.unchanged && x.bytes<120).length>=2')
  await write(state('Changed workspace polling fixture'))
  await browser('wait', '--fn', 'document.body.innerText.includes("Changed workspace polling fixture")')
  await write('{')
  await browser('wait', '--fn', 'document.body.innerText.includes("incomplete or invalid")')
  await write(state('Changed workspace polling fixture'))
  await browser('wait', '--fn', '!document.body.innerText.includes("incomplete or invalid") && document.body.innerText.includes("Changed workspace polling fixture")')
  const measurement = await browser('eval', 'JSON.stringify(window.__workspacePollSamples)')
  assert.match(measurement, /"?bytes/)
  console.log('WORKSPACE CONDITIONAL BROWSER OK', measurement)
} finally {
  await browser('close').catch(() => {})
  await f.close()
}
