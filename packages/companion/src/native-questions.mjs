/** Presentation of exact native question payloads; never infer questions from prose. */
export function nativeQuestions(value) {
  if (typeof value === 'string') {
    if (value.length > 65536) return []
    try { value = JSON.parse(value) } catch { return [] }
  }
  if (!Array.isArray(value?.questions)) return []
  return value.questions.slice(0, 6).flatMap((q, i) => {
    if (typeof q?.question !== 'string' || !q.question.trim()) return []
    return [{ id: typeof q.id === 'string' ? q.id : String(i),
      question: q.question.slice(0, 4000),
      options: (Array.isArray(q.options) ? q.options : []).slice(0, 12).flatMap(o =>
        typeof o?.label === 'string' ? [{ label: o.label.slice(0, 500),
          description: typeof o.description === 'string' ? o.description.slice(0, 2000) : '' }] : []) }]
  })
}
