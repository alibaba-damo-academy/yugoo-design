import test from 'node:test'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

test('Companion build-time Core selection retains canonical Kit resource projection', () => {
  const script = `
    import assert from 'node:assert/strict';
    const selected = await import(process.argv[1]);
    const canonical = await import(process.argv[2]);
    assert.equal(typeof selected.projectKitResource, 'function');
    assert.equal(selected.projectKitResource, canonical.projectKitResource);
    assert.deepEqual(selected.projectKitResource('notes.md', Buffer.from('Saved context')), {
      kind: 'text', content: 'Saved context'
    });
    const opaque = selected.projectKitResource('image.png', Buffer.from([255, 0, 128]));
    assert.equal(opaque.kind, 'opaque');
    assert.equal(opaque.byteLength, 3);
    assert.match(opaque.sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => selected.projectKitResource('notes.md', Buffer.from([255])));
  `
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script,
    new URL('../src/core-entry.ts', import.meta.url).href,
    new URL('../../core/src/kit-loader.ts', import.meta.url).href], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  })
})

test('packaged Companion Core entry retains the canonical Panel save envelope parser', () => {
  const script = `
    import assert from 'node:assert/strict';
    const selected = await import(process.argv[1]);
    const canonical = await import(process.argv[2]);
    assert.equal(typeof selected.parsePanelSaveInput, 'function');
    assert.equal(selected.parsePanelSaveInput, canonical.parsePanelSaveInput);
    assert.deepEqual(selected.parsePanelSaveInput('notes', []), { artifacts: {} });
    assert.deepEqual(selected.parsePanelSaveInput('notes', { before: null }), { before: null, artifacts: undefined });
  `
  execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script,
    new URL('../src/core-entry.ts', import.meta.url).href,
    new URL('../../core/src/panel-save.ts', import.meta.url).href], {
    cwd: fileURLToPath(new URL('../../../', import.meta.url)),
    timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'],
  })
})
