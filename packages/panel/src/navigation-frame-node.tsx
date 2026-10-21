import { useEffect, useRef, useState } from 'react'
import { NodeResizer, type NodeProps } from '@xyflow/react'
import { usePanelI18n } from './panel-i18n.tsx'

/** Generic grouping chrome; the owner supplies binding-aware transactions. */
export function NavigationFrameNode({ data, selected }: NodeProps) {
  const { t } = usePanelI18n()
  const label = String(data.label ?? '')
  const editable = data.editable === true
  const [text, setText] = useState(label)
  const cancelled = useRef(false)
  useEffect(() => { setText(label); cancelled.current = false }, [label, editable])
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return }
    const value = text.trim()
    if (!editable || !value || value === label) { setText(label); return }
    ;(data.rename as (value: string) => void)(value)
  }
  return <>
    <NodeResizer isVisible={selected && editable} minWidth={368} minHeight={300}
      onResizeEnd={(_, box) => {
        if (editable) (data.resize as (box: { x: number; y: number; width: number; height: number }) => void)(box)
      }} />
    <div className="dsh-navigation-group-header">
      <input className="nodrag nopan" aria-label={t('navigationGroupName')} value={text} disabled={!editable}
        onChange={event => setText(event.target.value)} onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') event.currentTarget.blur()
          if (event.key === 'Escape') {
            cancelled.current = true; setText(label); event.currentTarget.blur()
          }
        }} />
      <span>{t('navigationGroupCount', { count: Number(data.count ?? 0) })}</span>
      <button type="button" className="nodrag nopan" disabled={!editable}
        aria-label={t('remove', { item: label })}
        onClick={() => { if (editable) (data.remove as () => void)() }}>×</button>
    </div>
  </>
}
