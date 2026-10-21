// Source-plane regression: the actual read-only Kit file route and shared file reader.
import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { KitFiles } from '../src/KitFiles.tsx'
import { renderStudioDocument, splitFrontmatter } from '../src/markdown.tsx'

for (const [name, source, metadata, body] of [
  ['LF', '---\nname: demo\nversion: "1.0"\n---\n\n# Expert\n\nThink together.', 'name: demo\nversion: "1.0"', '\n# Expert\n\nThink together.'],
  ['BOM and CRLF', '\uFEFF---\r\nname: demo\r\n---\r\n\r\n# Expert\r\n', 'name: demo', '\r\n# Expert\r\n'],
  ['closing marker at EOF', '---\nname: demo\n---', 'name: demo', ''],
]) test(`complete frontmatter separates from the body: ${name}`, () => {
  assert.deepEqual(splitFrontmatter(source), { frontmatter: metadata, body })
})

test('incomplete, false or non-leading frontmatter never consumes document content', () => {
  for (const source of ['---\nname: demo\n# Keep this', '---\nname: demo\n---suffix\n# Keep this', '# Expert\n\n---\nname: demo\n---\n']) {
    assert.deepEqual(splitFrontmatter(source), { body: source })
  }
})

test('Kit file reading folds metadata and leads with the real Markdown body', () => {
  const source = '---\nname: demo\nversion: "1.0"\n---\n\n# Expert\n\nThink together.\n'
  const html = renderToStaticMarkup(React.createElement(KitFiles, { client: {}, name: 'demo', version: '1.0', mindset: source, locale: 'zh' }))
  assert.match(html, /<details class="ygd-studio-file-metadata"><summary>文件元信息/)
  assert.match(html, /<pre class="ygd-studio-frontmatter" aria-label="frontmatter">name: demo/)
  assert.match(html, /<div aria-label="Kit document"><div class="ygd-studio-markdown"><h1>Expert<\/h1>/)
  assert.doesNotMatch(html, /<p>--- name:/)
})

test('shared file reading retains metadata as escaped text without changing plain documents', () => {
  const html = renderToStaticMarkup(renderStudioDocument('---\ntitle: <img src=x onerror=alert(1)>\n---\n# Method', { locale: 'en', ariaLabel: 'File body' }))
  assert.match(html, /File metadata · expand to view/)
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/)
  assert.doesNotMatch(html, /<img|<details[^>]*\bopen(?:=|>)/)
  assert.match(html, /aria-label="File body"><div class="ygd-studio-markdown"><h1>Method<\/h1>/)
  const plain = renderToStaticMarkup(renderStudioDocument('# Plain\n\nBody', { locale: 'en' }))
  assert.doesNotMatch(plain, /<details/)
  assert.match(plain, /<h1>Plain<\/h1><p>Body<\/p>/)
})
