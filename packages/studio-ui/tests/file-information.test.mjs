import test from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { FileInfoSidebar, FilePurpose, standardFileDescription } from '../src/FileInfoSidebar.tsx'
import { STUDIO_WORKSPACE_CSS } from '../src/styles.ts'

test('known file roles follow locale and exact standard paths; unknown files have no guessed purpose', () => {
  assert.match(standardFileDescription('mindset.md', 'zh'), /设计心智/)
  assert.match(standardFileDescription('mindset.md', 'en'), /Design mindset/)
  assert.match(standardFileDescription('reference\\canvas-guide.md', 'zh'), /画布方法/)
  assert.match(standardFileDescription('SKILL.md', 'en'), /Skill method/)
  for (const path of ['custom.md', 'reference/custom.md', 'reference/examples/schema.yaml', '../mindset.md', '/mindset.md', undefined]) {
    assert.equal(standardFileDescription(path, 'en'), undefined)
    assert.equal(renderToStaticMarkup(createElement(FilePurpose, { path, locale: 'zh' })), '')
  }
})

test('intro uses supplied display copy without transforming or modifying authored content', () => {
  const copy = '# Custom API Name\n\nmy Chosen wording stays SAME. <script>not executable</script>'
  const html = renderToStaticMarkup(createElement(FileInfoSidebar, { kind: 'kit', description: copy, locale: 'en' }))
  assert.match(html, /About This Kit/)
  assert.match(html, /my Chosen wording stays SAME/)
  assert.doesNotMatch(html, /<script>/)
  assert.equal(renderToStaticMarkup(createElement(FileInfoSidebar, { kind: 'kit', description: '', locale: 'en' })), '')
  assert.match(renderToStaticMarkup(createElement(FileInfoSidebar, { kind: 'bundle', description: '中文简介', locale: 'zh' })), /技能包简介/)
  assert.match(STUDIO_WORKSPACE_CSS, /\.ygd-studio-file-purpose\{font:400 12px\/1\.6[^}]*color:var\(--ds-text-secondary\)/)
  assert.match(STUDIO_WORKSPACE_CSS, /\.ygd-studio-file-info\{[^}]*overflow:auto/)
  assert.match(STUDIO_WORKSPACE_CSS, /@media\(max-width:800px\)/)
})
