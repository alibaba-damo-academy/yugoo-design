/** Compact, inline function specifications; no second persisted representation. */
import { createContext, useContext, useState } from 'react'
import type { FunctionDetails } from '../types.ts'
import type { IFunctionModuleType } from '../ported/design/functionModulesTypes.ts'
import { Button } from '../ported/ui/button.tsx'
import { Textarea } from '../ported/ui/textarea.tsx'
import { FunctionSourceCard } from './function-source.tsx'

export const FunctionDetailUIContext = createContext(false)
const labels = { purpose: '用途', situation: '使用情境', behaviors: '核心行为', inputs: '输入', outputs: '结果', limits: '范围边界', exceptions: '异常反馈' } as const
type Dimension = keyof typeof labels
const prefixes = { behaviors: 'B', inputs: 'I', outputs: 'O', limits: 'L', exceptions: 'E' } as const
const fieldClass = 'min-h-[28px] rounded-md border-transparent bg-transparent px-2 py-1 text-xs leading-5 text-[var(--ds-text-secondary)] hover:border-[var(--ds-line-1)] focus:border-[var(--ds-line-1)]'
const actionClass = 'h-6 px-1 text-xs text-[var(--ds-text-tertiary)]'

export function FunctionDetailsEditor({ module, onChange, disabled }: {
  module: IFunctionModuleType; onChange?: (module: IFunctionModuleType) => void; disabled: boolean
}) {
  const enabled = useContext(FunctionDetailUIContext)
  const [open, setOpen] = useState(false)
  const details = module.details ?? {}
  const readOnly = disabled || !onChange
  const save = (next: FunctionDetails) => {
    const updated: IFunctionModuleType = { ...module, details: next }
    if (!Object.keys(next).length) delete updated.details
    onChange?.(updated)
  }
  const remove = (key: Dimension, id?: string) => {
    const next = { ...details }
    if (id === undefined) delete next[key]
    else {
      const records = { ...(details[key] as Record<string, unknown>) }; delete records[id]
      if (!Object.keys(records).length) delete next[key]
      else Object.assign(next, { [key]: records })
    }
    save(next)
  }
  const add = (key: Dimension) => {
    if (key === 'purpose' || key === 'situation') {
      if (details[key] === undefined) save({ ...details, [key]: '' })
      return
    }
    const id = `${prefixes[key]}-${crypto.randomUUID()}`
    save({ ...details, [key]: { ...details[key], [id]: key === 'exceptions'
      ? { condition: '', response: '' } : { description: '' } } })
  }
  const editEntry = (key: Dimension, id: string, field: string, value: string) => {
    const records = details[key] as Record<string, Record<string, string>>
    save({ ...details, [key]: { ...records, [id]: { ...records[id], [field]: value } } })
  }
  // Even older presentations keep the existing reason available inside the fold.
  if (!enabled && !module.reason) return null
  return <details className='mt-2 border-t border-[var(--ds-line-1)] pt-2 text-xs text-[var(--ds-text-primary)]'
    onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className='cursor-pointer py-1 font-medium'>功能详情与依据</summary>
    {open && <div className='space-y-3 pt-2' data-testid='function-detail-content'>
      {enabled && Object.entries(labels).map(([rawKey, label]) => {
        const key = rawKey as Dimension
        if (details[key] === undefined) return null
        if (key === 'purpose' || key === 'situation') return <section key={key}>
          <div className='flex items-center justify-between gap-2'><h5 className='font-medium'>{label}</h5>
            {!readOnly && <Button variant='ghost' size='sm' className={actionClass} onClick={() => remove(key)} aria-label={`移除${label}`}>移除</Button>}</div>
          <Textarea autoResize rows={1} className={fieldClass} aria-label={label} disabled={readOnly} value={details[key] ?? ''}
            onChange={event => save({ ...details, [key]: event.target.value })} />
        </section>
        const records = details[key] as Record<string, Record<string, string>>
        return <section key={key}><h5 className='mb-1 font-medium'>{label}</h5>
          {Object.entries(records).map(([id, entry], index) => <div key={id} className='mb-1 flex items-start gap-2'>
            <span className='pt-1 leading-5 text-[var(--ds-text-tertiary)]'>{index + 1}.</span>
            <div className='min-w-0 flex-1'>
              {key === 'exceptions' ? <>
                <label className='block text-[var(--ds-text-tertiary)]'>发生条件<Textarea autoResize rows={1} className={fieldClass} aria-label={`发生条件 ${index + 1}`} disabled={readOnly} value={entry.condition}
                  onChange={event => editEntry(key, id, 'condition', event.target.value)} /></label>
                <label className='block text-[var(--ds-text-tertiary)]'>反馈方式<Textarea autoResize rows={1} className={fieldClass} aria-label={`反馈方式 ${index + 1}`} disabled={readOnly} value={entry.response}
                  onChange={event => editEntry(key, id, 'response', event.target.value)} /></label>
              </> : <Textarea autoResize rows={1} className={fieldClass} aria-label={`${label} ${index + 1}`} disabled={readOnly} value={entry.description}
                onChange={event => editEntry(key, id, 'description', event.target.value)} />}
            </div>
            {!readOnly && <Button variant='ghost' size='sm' className={actionClass} onClick={() => remove(key, id)} aria-label={`移除${label} ${index + 1}`}>移除</Button>}
          </div>)}
          {!readOnly && <Button size='sm' variant='ghost' className={actionClass} onClick={() => add(key)}>＋ 添加{label}</Button>}
        </section>
      })}
      {enabled && !readOnly && Object.keys(labels).some(key => details[key as Dimension] === undefined) && <div className='flex flex-wrap items-center gap-1'>
        <span className='text-[var(--ds-text-tertiary)]'>补充详情：</span>
        {Object.entries(labels).filter(([key]) => details[key as Dimension] === undefined).map(([key, label]) =>
          <Button key={key} size='sm' variant='ghost' className={actionClass} onClick={() => add(key as Dimension)}>＋ {label}</Button>)}
      </div>}
      {(module.reason || (enabled && !readOnly)) && <section className='border-t border-[var(--ds-line-1)] pt-2'><h5 className='mb-1 font-medium'>设计原因</h5>
        <Textarea autoResize rows={1} className={fieldClass} aria-label='设计原因' disabled={readOnly} value={module.reason ?? ''}
          onChange={event => onChange?.({ ...module, reason: event.target.value })} />
      </section>}
      {enabled && module.references && Object.keys(module.references).length > 0 && <section><h5 className='mb-1 font-medium'>关联来源</h5>
        {Object.entries(module.references).map(([id, reference]) => <FunctionSourceCard key={`${id}:${reference.file}:${reference.pointer ?? ''}:${reference.revision}`} reference={reference} />)}
      </section>}
    </div>}
  </details>
}
