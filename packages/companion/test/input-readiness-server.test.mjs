import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const execute = promisify(execFile)
const fixtureUrl = new URL('./fixture.mjs', import.meta.url).href
const serverUrl = new URL('../src/server.mjs', import.meta.url).href
const callerUrl = new URL('../src/connection-file.mjs', import.meta.url).href

for (const host of ['qoder', 'claude-code', ...(process.platform === 'linux' ? ['qwenwork'] : [])]) {
  test(`${host}: unavailable input does not block HTTP, durable save or notification recovery`, { timeout: 60000 }, async t => {
    // The normal factories resolve HOME themselves. Confine that lookup to this
    // child instead of reading or modifying the native user's real Hook files.
    const home = await mkdtemp(join(tmpdir(), 'input-readiness-home-'))
    t.after(() => rm(home, { recursive: true, force: true }))
    const script = `
      import assert from 'node:assert/strict';
      import { readFile } from 'node:fs/promises';
      import { join } from 'node:path';
      const { fixture, threadId } = await import(${JSON.stringify(fixtureUrl)});
      const { startCompanion } = await import(${JSON.stringify(serverUrl)});
      const { callCompanion } = await import(${JSON.stringify(callerUrl)});
      const host = ${JSON.stringify(host)}, f = await fixture();
      let server;
      try {
        const options = { ...f.options, host, connection: undefined };
        server = await startCompanion(options);
        const call = (method, params = {}) => callCompanion(server.connectionPath, { method, params });
        assert.equal((await call('info')).host, host);
        await call('readWorkspace');
        const state = { questions: { 'Q-001': { prompt: 'Who confirms the scope?', kind: 'text', answer: 'Project lead', detail: '' } } };
        const saved = await call('savePanel', { skill: 'smart_questions', state, eventId: 'input-unavailable-save', includeDerivedStatus: false });
        const file = join(f.options.projectRoot, 'design_files/smart_questions/smart_questions.json');
        const bytes = await readFile(file, 'utf8');
        assert.match(bytes, /Project lead/);
        const request = { text: 'Continue from the saved answer', requestId: 'input-unavailable-notice', saved: [{ eventId: 'input-unavailable-save', commit: saved.commit }] };
        assert.deepEqual(await call('sendPrompt', request), { accepted: false, status: 'unavailable', notSubmitted: true });
        const entry = (await call('readWorkspace')).savedContinuations.find(x => x.eventId === 'input-unavailable-save');
        assert.equal(entry.status, 'not_submitted');
        assert.equal(entry.retryable, true);
        await server.close(); server = undefined;
        const sent = [];
        server = await startCompanion({ ...options, connection: { host, threadId, send: async text => { sent.push(text); return { accepted: true, status: 'hook_received' }; } } });
        const reopened = await call('readWorkspace');
        assert.equal(reopened.savedContinuations.find(x => x.eventId === 'input-unavailable-save').status, 'not_submitted');
        const { saved: _saved, ...ordinaryMessage } = request;
        assert.equal((await call('sendPrompt', ordinaryMessage)).accepted, true, 'an ordinary user message carries known unsent saved changes');
        assert.equal((await call('sendPrompt', request)).accepted, true);
        assert.equal(sent.length, 1, 'explicit notification recovery does not repeat an accepted send');
        assert.equal(await readFile(file, 'utf8'), bytes, 'notification recovery never repeats or rewrites the save');
      } finally { await server?.close(); await f.close(); }
    `
    const result = await execute(process.execPath, ['--input-type=module', '-e', script], {
      env: { ...process.env, HOME: home }, maxBuffer: 2 * 1024 * 1024,
    })
    assert.equal(result.stdout, '')
  })
}
