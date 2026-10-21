/** Shared cancellation observation at the library implementation's existing fences. */
export function nativeGitCancellation(cancelled: Int32Array): AbortSignal {
  const controller = new AbortController()
  const observe = (): void => {
    if (Atomics.load(cancelled, 0) !== 0 && !controller.signal.aborted) {
      controller.abort(new DOMException('Native Git operation cancelled', 'AbortError'))
    }
  }
  const original = controller.signal.throwIfAborted.bind(controller.signal)
  Object.defineProperty(controller.signal, 'throwIfAborted', { value: () => { observe(); original() } })
  observe()
  return controller.signal
}
