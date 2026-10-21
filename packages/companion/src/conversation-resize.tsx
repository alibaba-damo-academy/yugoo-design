import { useRef, type PointerEvent } from 'react'

export const DEFAULT_CHAT_WIDTH = 30
export function savedChatWidth(): number {
  try { const value = Number(localStorage.getItem('design-companion-chat-width')); return value >= 20 && value <= 70 ? value : DEFAULT_CHAT_WIDTH } catch { return DEFAULT_CHAT_WIDTH }
}
export function ConversationResize({ width, onChange }: { width: number; onChange: (width: number) => void }) {
  const dragging = useRef(false)
  const update = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const rect = event.currentTarget.parentElement!.getBoundingClientRect()
    onChange(Math.max(20, Math.min(70, (event.clientX - rect.left) / rect.width * 100)))
  }
  return <div role="separator" aria-label="调整聊天区宽度" aria-orientation="vertical" tabIndex={0}
    aria-valuemin={20} aria-valuemax={70} aria-valuenow={Math.round(width)} className="companion-resize"
    onPointerDown={event => { if (event.button !== 0) return; dragging.current = true; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault() }}
    onPointerMove={update} onPointerUp={event => { update(event); dragging.current = false; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
    onPointerCancel={() => { dragging.current = false }} onLostPointerCapture={() => { dragging.current = false }}
    onKeyDown={event => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home') {
        event.preventDefault(); onChange(event.key === 'Home' ? DEFAULT_CHAT_WIDTH : Math.max(20, Math.min(70, width + (event.key === 'ArrowLeft' ? -2 : 2))))
      }
    }} />
}
