/** Align shell headers to actual project geometry, without changing Panel styles. */
export function alignConversationHeader(root, observers = globalThis) {
  let project, conversation, resize
  const sync = () => {
    if (!project) return
    const height = project.getBoundingClientRect().height
    if (Number.isFinite(height) && height > 0) {
      root.style.setProperty('--companion-top-header-height', `${height}px`)
      if (conversation) conversation.style.minHeight = `${height}px`
    }
  }
  const bind = () => {
    const nextProject = root.querySelector('.dsh-design-dock .dsh-design-project-header')
    const nextConversation = root.querySelector('.companion-conversation > .dsh-design-project-header')
    if (nextProject === project && nextConversation === conversation) return
    resize?.disconnect()
    conversation?.style.removeProperty('min-height')
    project = nextProject; conversation = nextConversation
    if (!project) { root.style.removeProperty('--companion-top-header-height'); return }
    sync()
    resize = new observers.ResizeObserver(sync)
    resize.observe(project)
  }
  const mutation = new observers.MutationObserver(bind)
  mutation.observe(root, { childList: true, subtree: true })
  bind()
  return () => {
    mutation.disconnect(); resize?.disconnect()
    conversation?.style.removeProperty('min-height')
    root.style.removeProperty('--companion-top-header-height')
  }
}
