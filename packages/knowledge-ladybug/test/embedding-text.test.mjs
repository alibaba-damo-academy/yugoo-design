import test from 'node:test'
import assert from 'node:assert/strict'
import { embeddingWindows, combineEmbeddingWindows } from '../src/embedding-text.mjs'

test('windows count prefix tokens and retain Unicode content in order', () => {
  const tokenizer = { encode: text => Array.from(text).flatMap(() => [1, 2, 3]) }
  const text = '标题\n/long/path：中文和 English 👩🏽‍🔬\n'.repeat(200)
  const windows = embeddingWindows(text, 'query: ', tokenizer, 512, 128)
  assert.equal(windows.map(w => w.content).join(''), text)
  assert.ok(windows.every(w => tokenizer.encode(w.input).length <= 512))
  assert.deepEqual(combineEmbeddingWindows(windows.map(() => [1, 0]), windows), [1, 0])
  assert.throws(() => embeddingWindows(text, 'query: ', tokenizer, 512, 2), /bounded/)
  assert.throws(() => embeddingWindows('a', 'x'.repeat(512), tokenizer), /bounded/)
})

test('local cached tokenizer covers Chinese, English and long field paths without truncation', { skip: process.env.SEMANTIC_LOCAL_ONLY !== '1' }, async () => {
  const { AutoTokenizer, env } = await import('@huggingface/transformers')
  const { homedir } = await import('node:os'), { resolve } = await import('node:path')
  env.cacheDir = resolve(homedir(), '.cache/design-system/embeddings'); env.allowRemoteModels = false
  const tokenizer = await AutoTokenizer.from_pretrained('Xenova/multilingual-e5-small', { revision: '761b726dd34fb83930e26aab4e9ac3899aa1fa78' })
  for (const text of ['中文设计说明'.repeat(200), 'Read the saved evidence and retain its context. '.repeat(50), '标题\n/' + 'nested_field/'.repeat(160) + '：结尾设计内容']) {
    const windows = embeddingWindows(text, 'query: ', tokenizer)
    assert.equal(windows.map(w => w.content).join(''), text)
    assert.ok(windows.every(w => tokenizer.encode(w.input).length <= 512))
    assert.ok(windows.length > 1)
  }
})
