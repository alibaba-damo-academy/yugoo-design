import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { checkResearchEvidence } from '../bundles/research/scripts/research.mjs'

const script = fileURLToPath(new URL('../bundles/research/scripts/research.mjs', import.meta.url))
const canonical = 'research/research.json'
const a = 'https://example.org/a', b = 'https://example.org/b'
const md = (body, sources = []) => `# Evidence\n\n## Key Findings\n${body}\n\n## Sources\n${sources.map(url => `- [Document](${url})`).join('\n')}\n\n## Research Conclusion\nBounded findings.\n`
const html = (body, sources = []) => `<!doctype html><html><body><h1>Conclusion</h1>${body}<h2>Sources</h2>${sources.map(url => `<a href="${url}">Document</a>`).join('')}<h2>Limits</h2>Scope remains limited.</body></html>`
function fixture(body = `[A](${a})`, sources = [a]) {
  const findings = 'research/R-1/D-1.md'
  return { state: { rounds: { 'R-1': { round_id: 'R-1', stage: 'confirmed', directions: { 'D-1': { direction_id: 'D-1', findings_file: findings, source_urls: sources } } } }, current_round_id: 'R-1' }, files: { [findings]: md(body, sources) } }
}
function result(f, options) { return checkResearchEvidence(f.state, f.files, options) }
function fails(f, pattern, options) {
  const value = result(f, options)
  assert.equal(value.valid, false)
  assert.match(value.diagnostics.join('\n'), pattern)
  return value
}

test('current-round source sets agree, deduplicate shared documents and allow a conclusion subset', () => {
  const f = fixture(`[A](${a}) and [A again](${a}); [B](${b})`, [a, b])
  f.state.rounds['R-1'].directions['D-2'] = { findings_file: 'research/R-1/D-2.md', source_urls: [a] }
  f.files['research/R-1/D-2.md'] = md(`[A](${a})`, [a])
  f.state.rounds['R-1'].conclusion_file = 'research/R-1/conclusion.html'
  f.files['research/R-1/conclusion.html'] = html(`<p><a href="${a}">A</a></p>`, [a])
  const before = JSON.stringify(f)
  const value = result(f, { maxSources: 2 })
  assert.equal(value.valid, true, value.diagnostics.join('\n'))
  assert.deepEqual(value.source_urls, [a, b])
  assert.deepEqual(value.counts, { directions: { 'D-1': { body: 2, sources: 2, canonical: 2 }, 'D-2': { body: 1, sources: 1, canonical: 1 } }, findings: 2, conclusion: 1, total: 2 })
  assert.equal(JSON.stringify(f), before)
  fails(f, /maxSources 1.*2 distinct/, { maxSources: 1 })
  assert.equal(result(f).valid, true, 'no source cap is invented')
})

test('body, bibliography, canonical and conclusion mismatches are actionable', () => {
  fails(fixture(`[A](${a}) [B](${b})`, [a]), /D-1.*Sources.*missing.*\/b/)
  fails(fixture(`[A](${a})`, [a, b]), /D-1.*Sources.*unused.*\/b/)
  const canonicalMismatch = fixture()
  canonicalMismatch.state.rounds['R-1'].directions['D-1'].source_urls = [b]
  fails(canonicalMismatch, /source_urls.*missing.*\/a/)
  const conclusion = fixture()
  conclusion.state.rounds['R-1'].conclusion_file = 'research/R-1/conclusion.html'
  conclusion.files['research/R-1/conclusion.html'] = html(`<a href="${b}">B</a>`, [b])
  fails(conclusion, /conclusion.*not present in accepted findings.*\/b/)
  conclusion.files['research/R-1/conclusion.html'] = html(`<a href="${a}">A</a>`, [a, b])
  fails(conclusion, /conclusion.*Sources.*unused.*\/b/)
})

test('Markdown parses inline, reference, collapsed, shortcut and autolinks, parentheses and entities', () => {
  const url = 'https://example.org/a_(b)?x=1&y=2'
  const f = fixture(`[inline](https://example.org/a_(b)?x=1&amp;y=2 "title")\n[reference][DOC] [doc][] [doc]\n<https://example.org/a_(b)?x=1&#38;y=2>\n\n[doc]: <https://example.org/a_(b)?x=1&y=2> "Document"`, [url])
  assert.equal(result(f).valid, true, result(f).diagnostics.join('\n'))
  f.files['research/R-1/D-1.md'] = md(`[nested label [text]](https://example.org/a_\\(b\\)?x=1&y=2)`, [url])
  assert.equal(result(f).valid, true, result(f).diagnostics.join('\n'))
})

test('Markdown excludes code, images, comments and unused reference definitions', () => {
  const f = fixture(`[A](${a})\n\n\`[fake](${b})\`\n\n~~~md\n[fake](${b})\n~~~\n\n    [fake](${b})\n\n![asset](${b})\n![asset][image]\n[image]: ${b}\n[unused]: ${b}\n<!-- [fake](${b}) -->`, [a])
  assert.equal(result(f).valid, true, result(f).diagnostics.join('\n'))
  assert.equal(result(f).counts.total, 1)
  f.files['research/R-1/D-1.md'] = md(`[A](${a})`, [a]) + `\n[Late claim](${b})\n`
  fails(f, /Sources.*missing.*\/b/, undefined)
})

test('Markdown supports Setext Sources and reports unsupported or broken citation syntax', () => {
  const f = fixture()
  f.files['research/R-1/D-1.md'] = `# Evidence\n[A](${a})\n\nSources\n-------\n- [A](${a})\n\nConclusion\n----------\nDone.`
  assert.equal(result(f).valid, true, result(f).diagnostics.join('\n'))
  for (const [body, pattern] of [[`[A](${a}`, /unclosed Markdown link/], [`${a}`, /bare URL.*unsupported/], [`<a href="${a}">A</a>`, /raw HTML.*unsupported/], [`[A](https://example.org/a&unknown;)`, /unsupported.*entity/]]) {
    fails(fixture(body, [a]), pattern)
  }
})

test('authored sources headings support other report languages without canonical metadata', () => {
  const f = fixture()
  f.files['research/R-1/D-1.md'] = md(`[A](${a})`, [a]).replace('## Sources', '## Fuentes')
  f.state.rounds['R-1'].conclusion_file = 'research/R-1/conclusion.html'
  f.files['research/R-1/conclusion.html'] = html(`<a href="${a}">A</a>`, [a]).replace('<h2>Sources</h2>', '<h2>Fuentes</h2>')
  assert.equal(result(f, { sourcesHeading: 'Fuentes' }).valid, true)
  fails(f, /Sources.*missing/)
  fails(f, /sourcesHeading must be non-empty text/, { sourcesHeading: '' })
})

test('code delimiters and canonical URL spelling do not get silently normalized', () => {
  const f = fixture(`\`<!--\` [A](${a})\n\`\`code \` [fake](${b}) \`\`\n\`multiline\n<!--\` [A](${a})`, [a])
  assert.equal(result(f).valid, true, result(f).diagnostics.join('\n'))
  const url = 'https://example.org/a?x=1&y=2'
  const different = fixture(`[A](${url})`, [url])
  different.state.rounds['R-1'].directions['D-1'].source_urls = [url.replace('&', '&amp;')]
  fails(different, /source_urls.*missing/)
})

test('HTML reads actual anchor attributes and ignores assets, local links, comments and raw text', () => {
  const url = 'https://example.org/a?x=1&y=2'
  const f = fixture(`[A](${url})`, [url])
  f.state.rounds['R-1'].conclusion_file = 'research/R-1/conclusion.html'
  f.files['research/R-1/conclusion.html'] = `<!doctype html><html><body><h1>Conclusion</h1><a title="greater > lesser" HREF='https://example.org/a?x=1&amp;y=2'>A</a><img src="${b}"><a href="#local">Local</a><a href="figure.svg">Asset</a><!-- <a href="${b}">fake</a> --><script>const x='<a href="${b}">fake</a>';</script><textarea><a href="${b}">fake</a></textarea><template><a href="${b}">fake</a></template><h2 id="sources">Fuentes</h2><a href=https://example.org/a?x=1&#38;y=2>A</a><h2>Limits</h2>Limited.</body></html>`
  assert.equal(result(f).valid, true, result(f).diagnostics.join('\n'))
  assert.equal(result(f).counts.conclusion, 1)
  f.files['research/R-1/conclusion.html'] = html(`<a href="${url}" href="${b}">A</a>`, [url])
  fails(f, /duplicate.*href/)
  f.files['research/R-1/conclusion.html'] = `<html><body><a href="${a}`
  fails(f, /unterminated HTML/)
})

test('plans, partial rounds, zero sources and unrelated historical rounds remain valid', () => {
  const f = fixture('', [])
  delete f.state.rounds['R-1'].directions['D-1'].source_urls
  assert.equal(result(f).valid, true, 'optional source_urls is not a new required field')
  f.state.rounds['R-1'].directions.pending = { source_urls: [b] }
  f.state.rounds.old = { directions: { ignored: { findings_file: '../outside.md' } } }
  assert.equal(result(f, { maxSources: 0 }).valid, true)
  delete f.state.rounds['R-1'].directions['D-1'].findings_file
  assert.equal(result(f).valid, true)
  assert.equal(result(f).counts.total, 0)
  fails(f, /maxSources must be a non-negative safe integer/, { maxSources: '4' })
  const missingSources = fixture()
  delete missingSources.state.rounds['R-1'].directions['D-1'].source_urls
  fails(missingSources, /source_urls.*missing cited source/)
  missingSources.state.rounds['R-1'].directions['D-1'].source_urls = 'invalid'
  fails(missingSources, /source_urls must be an array/)
})

test('the existing Host script tool supplies authoritative file bytes and script_io without writes', async () => {
  const { register } = await import('tsx/esm/api'); register()
  const { createDesignSkillScriptTool } = await import('../../core/src/dsh-producer-design-tools.ts')
  const f = fixture(), inputs = { [canonical]: JSON.stringify(f.state), ...f.files }, reads = []
  const tool = createDesignSkillScriptTool({
    async read(path) { reads.push(path); return { encoding: 'utf8', content: inputs[path] } },
    async write() { throw new Error('read-only checker must not write') },
  }, {
    async run(path, args, input) {
      assert.equal(path, 'research.mjs')
      const envelope = JSON.parse(input.slice(0, input.indexOf('\n')))
      assert.deepEqual(envelope.script_io, { input_file: canonical, output_file: null })
      const child = spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8' })
      return { stdout: child.stdout, stderr: child.stderr, exitCode: child.status }
    },
  }, output => assert.equal(output, undefined))
  const value = await tool.execute({ path: 'research.mjs', args: ['validate-round-file'], input_file: canonical,
    input_files: Object.keys(f.files), input_context: { maxSources: 1, script_io: { input_file: 'spoof', output_file: 'spoof' }, state: {} } },
  { signal: new AbortController().signal })
  assert.equal(value.exit_code, 0, value.stdout + value.stderr)
  assert.deepEqual(JSON.parse(value.stdout), result(f, { maxSources: 1 }))
  assert.deepEqual(reads, [canonical, ...Object.keys(f.files)])

  // The Host-facing example must be discoverable in the reader's first chunk
  // and executable through the real file-input tool, including its conclusion.
  const contract = readFileSync(new URL('../bundles/research/reference/artifact-contract.md', import.meta.url), 'utf8')
  const example = JSON.parse(contract.slice(0, 4000).match(/```json\n([\s\S]*?)\n```/)[1])
  const [findingPath, conclusionPath] = example.input_files
  inputs[findingPath] = inputs[f.state.rounds['R-1'].directions['D-1'].findings_file]
  inputs[conclusionPath] = html(`<a href="${a}">A</a>`, [a])
  const documentedState = structuredClone(f.state)
  documentedState.rounds['R-1'].directions['D-1'].findings_file = findingPath
  documentedState.rounds['R-1'].conclusion_file = conclusionPath
  inputs[canonical] = JSON.stringify(documentedState)
  const documented = await tool.execute(example, { signal: new AbortController().signal })
  assert.equal(documented.exit_code, 0, documented.stdout + documented.stderr)
  assert.equal(JSON.parse(documented.stdout).counts.conclusion, 1)
})

test('missing, unsafe and malformed authoritative inputs fail without fallback', () => {
  const f = fixture()
  fails({ ...f, files: {} }, /missing.*research\/R-1\/D-1.md/)
  fails({ ...f, files: undefined }, /input_files.*required/)
  fails({ state: {}, files: {} }, /current_round_id/)
  f.state.rounds['R-1'].directions['D-1'].findings_file = '../outside.md'
  fails(f, /safe.*Design Files/)
  f.state.rounds['R-1'].directions['D-1'].findings_file = 'research/R-1/D-1.md'
  f.files['research/R-1/D-1.md'] = ''
  fails(f, /empty/)
})

test('standalone copied CLI uses exact file-mode bytes, confines native reads and never writes reports', () => {
  const temp = mkdtempSync(join(tmpdir(), 'research-evidence-'))
  try {
    const copied = join(temp, 'research.mjs'), root = join(temp, 'design_files')
    copyFileSync(script, copied)
    const f = fixture()
    const inputs = { [canonical]: JSON.stringify(f.state), ...f.files }
    for (const [path, bytes] of Object.entries(inputs)) { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), bytes) }
    const call = (args, input) => spawnSync(process.execPath, [copied, 'validate-round-file', ...args], { input, encoding: 'utf8' })
    const context = { input_files: f.files, script_io: { input_file: canonical, output_file: null } }
    const piped = call([], JSON.stringify(context) + '\n' + inputs[canonical])
    assert.equal(piped.status, 0, piped.stdout + piped.stderr)
    const native = call(['--design-files', root, '--input-file', canonical])
    assert.equal(native.status, 0, native.stdout + native.stderr)
    assert.deepEqual(JSON.parse(native.stdout), JSON.parse(piped.stdout))
    const mixed = call(['--design-files', root, '--input-file', canonical],
      JSON.stringify({ ...context, input_files: {} }) + '\n' + inputs[canonical])
    assert.equal(mixed.status, 2, 'must not silently validate native disk instead of the supplied WorkingCopy')
    assert.match(mixed.stdout, /cannot combine.*native.*file.*input/iu)
    assert.match(mixed.stdout, /Host run_skill_script file input/)
    assert.match(mixed.stdout, /do not put native CLI options in args/)
    const spanishFiles = Object.fromEntries(Object.entries(f.files).map(([path, bytes]) => [path, bytes.replace('## Sources', '## Fuentes')]))
    const spanish = call([], JSON.stringify({ ...context, input_files: spanishFiles, sourcesHeading: 'Fuentes' }) + '\n' + inputs[canonical])
    assert.equal(spanish.status, 0, spanish.stdout)
    for (const [path, bytes] of Object.entries(spanishFiles)) writeFileSync(join(root, path), bytes)
    const spanishNative = call(['--design-files', root, '--input-file', canonical, '--sources-heading', 'Fuentes'])
    assert.equal(spanishNative.status, 0, spanishNative.stdout)
    assert.deepEqual(JSON.parse(spanish.stdout), JSON.parse(spanishNative.stdout))
    for (const [path, bytes] of Object.entries(f.files)) writeFileSync(join(root, path), bytes)
    const missing = call([], JSON.stringify({ state: f.state, input_files: {} }) + '\n' + inputs[canonical])
    assert.equal(missing.status, 2)
    assert.equal(JSON.parse(missing.stdout).kind, 'input_error')
    assert.match(missing.stdout, /missing/)
    assert.equal(call([], inputs[canonical]).status, 2, 'raw JSON is not file-mode input')
    assert.equal(call([], JSON.stringify({ ...context, script_io: { input_file: 'wrong.json', output_file: null } }) + '\n' + inputs[canonical]).status, 2)
    assert.equal(call(['--design-files', root, '--input-file', canonical, '--max-sources', '0']).status, 1)
    for (const [path, bytes] of Object.entries(inputs)) assert.equal(readFileSync(join(root, path), 'utf8'), bytes)
    const outside = join(temp, 'outside.md'); writeFileSync(outside, md(`[A](${a})`, [a]))
    rmSync(join(root, 'research/R-1/D-1.md')); symlinkSync(outside, join(root, 'research/R-1/D-1.md'))
    const escaped = call(['--design-files', root, '--input-file', canonical])
    assert.equal(escaped.status, 2)
    assert.match(escaped.stdout, /realpath escapes/)
    assert.equal(readFileSync(outside, 'utf8'), md(`[A](${a})`, [a]))
  } finally { rmSync(temp, { recursive: true, force: true }) }
})
