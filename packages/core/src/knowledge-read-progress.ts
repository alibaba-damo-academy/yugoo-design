/** One background read per project scope; only recovery is exposed as pending. */
export class KnowledgeReadProgress<T> {
  private readonly reads = new Map<string, Promise<T>>()
  async read(key: string, operation: () => Promise<T>, status: () => { state: string; message: string; generation?: string } | undefined) {
    let task = this.reads.get(key)
    if (!task) {
      task = operation()
      this.reads.set(key, task)
      void task.finally(() => { if (this.reads.get(key) === task) this.reads.delete(key) }).catch(() => {})
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const pending = Symbol('pending')
    try {
      const result = await Promise.race([task, new Promise<typeof pending>(resolve => { timer = setTimeout(() => resolve(pending), 500) })])
      if (result !== pending) return { value: result }
      const recovery = status()
      if (recovery?.state === 'rebuilding') return { recovery }
      return { value: await task }
    } finally { clearTimeout(timer) }
  }
}
