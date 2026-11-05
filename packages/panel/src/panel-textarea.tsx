import { forwardRef, useCallback, useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react'

/** Ordinary multiline inputs fit their content up to five lines. A native
 * manual resize belongs to the user and survives subsequent value updates. */
export const PanelTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function PanelTextarea(
  { className, value, defaultValue, onInput, rows = 5, ...props }, forwardedRef,
) {
  const element = useRef<HTMLTextAreaElement | null>(null)
  const sizing = useRef({ width: 0, height: 0, writtenHeight: '', manual: false, visible: false })
  const automaticRows = Math.min(5, Math.max(3, rows))
  const fit = useCallback(() => {
    const node = element.current
    if (!node || !node.getClientRects().length) { sizing.current.visible = false; return }
    sizing.current.visible = true
    const css = getComputedStyle(node)
    const line = parseFloat(css.lineHeight) || parseFloat(css.fontSize) * 1.6
    const border = parseFloat(css.borderTopWidth) + parseFloat(css.borderBottomWidth)
    const padding = parseFloat(css.paddingTop) + parseFloat(css.paddingBottom)
    const minimum = line + padding + border
    node.style.minHeight = `${minimum}px`
    // Native resize writes an inline height. Notice it before a controlled
    // rerender can run, rather than depending on ResizeObserver delivery order.
    if (sizing.current.writtenHeight && node.style.height !== sizing.current.writtenHeight) sizing.current.manual = true
    if (!sizing.current.manual) {
      const scroll = node.scrollTop
      node.style.height = '0px'
      node.style.height = `${node.value === '' ? minimum : Math.min(line * automaticRows + padding + border, Math.max(minimum, node.scrollHeight + border))}px`
      sizing.current.writtenHeight = node.style.height
      node.scrollTop = document.activeElement === node && node.selectionEnd === node.value.length ? node.scrollHeight : scroll
    }
    const rect = node.getBoundingClientRect()
    sizing.current.width = rect.width
    sizing.current.height = rect.height
  }, [automaticRows])
  const ref = useCallback((node: HTMLTextAreaElement | null) => {
    element.current = node
    if (typeof forwardedRef === 'function') forwardedRef(node)
    else if (forwardedRef) forwardedRef.current = node
  }, [forwardedRef])
  useLayoutEffect(() => {
    fit()
    const node = element.current
    if (!node) return
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      if (!node.getClientRects().length) { sizing.current.visible = false; return }
      const rect = node.getBoundingClientRect(), previous = sizing.current
      if (!previous.visible || Math.abs(rect.width - previous.width) > 0.5) fit()
      else if (Math.abs(rect.height - previous.height) > 0.5) {
        previous.manual = true
        previous.height = rect.height
      }
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [fit])
  useLayoutEffect(fit, [fit, value, defaultValue])
  return <textarea {...props} ref={ref} rows={1} className={`dsh-panel-textarea${className ? ` ${className}` : ''}`}
    value={value} defaultValue={defaultValue} onInput={event => { onInput?.(event); fit() }} />
})
