/** Exact tokenizer windows. Preserve every character; never silently truncate evidence. */
export function embeddingWindows(text, prefix, tokenizer, limit = 512, maxParts = 32) {
  const pending = [text], result = []
  while (pending.length) {
    const content = pending.pop(), input = prefix + content, tokens = tokenizer.encode(input).length
    if (tokens <= limit) { result.push({ input, content, tokens }); continue }
    const chars = Array.from(content)
    if (chars.length < 2 || result.length + pending.length + 2 > maxParts) throw new Error('Embedding text exceeds bounded tokenizer windows')
    const middle = Math.floor(chars.length / 2)
    pending.push(chars.slice(middle).join(''), chars.slice(0, middle).join(''))
  }
  return result
}

export function combineEmbeddingWindows(vectors, windows) {
  if (!vectors.length || vectors.length !== windows.length) throw new Error('Embedding window count mismatch')
  const sum = Array(vectors[0].length).fill(0)
  for (let i = 0; i < vectors.length; i++) for (let j = 0; j < sum.length; j++) sum[j] += vectors[i][j] * windows[i].tokens
  const norm = Math.hypot(...sum)
  if (!Number.isFinite(norm) || norm < 1e-12) throw new Error('Invalid combined embedding')
  return sum.map(x => x / norm)
}
