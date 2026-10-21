export function alignConversationHeader(root: HTMLElement, observers?: {
  ResizeObserver: typeof ResizeObserver
  MutationObserver: typeof MutationObserver
}): () => void
