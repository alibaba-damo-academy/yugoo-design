/** On-demand, escaped source reading: no HTML execution or automatic adoption. */
import { createContext, useContext, useEffect, useState } from 'react'
import { readDesignSourceReference, type DesignSourceReferenceRead } from 'dsh-design-core/source-reference'
import type { FunctionSourceReference } from '../types.ts'

export const FunctionSourceReaderContext = createContext<{
  revision?: string
  readArtifact?: (path: string, revision?: string) => Promise<{ found: boolean; content: string }>
}>({})
const statuses = { matching: '当前来源与所引内容一致', changed: '当前来源已变化，请以最新用户意图复核', missing: '当前来源已移除，保留历史依据',
  'historical-only': '仅作为历史依据，未推断当前记录身份', unreadable: '当前来源暂不可读' }
const excerpt = (value: unknown) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
  return text.length > 2500 ? `${text.slice(0, 2500)}\n…内容节选` : text
}

export function FunctionSourceCard({ reference }: { reference: FunctionSourceReference }) {
  const reader = useContext(FunctionSourceReaderContext)
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<DesignSourceReferenceRead>()
  const [error, setError] = useState('')
  useEffect(() => {
    setResult(undefined); setError('')
    if (!open) return
    if (!reader.readArtifact || !reader.revision) { setError('此连接没有可核验的来源读取能力；不展示未经核验的摘录。'); return }
    const controller = new AbortController()
    const read = async (revision: string, file: string) => {
      const data = await reader.readArtifact!(file, revision)
      // Bound parsing and rendering, without silently presenting a truncated
      // whole-file response as verified JSON evidence.
      if (data.content.length > 262144) throw new Error('Source exceeds bounded preview size')
      return data.found ? data.content : undefined
    }
    void readDesignSourceReference(reference, reader.revision, read, controller.signal)
      .then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(() => { if (!controller.signal.aborted) setError('来源定位无法读取，请检查文件、指针和版本；设计内容仍然保留。') })
    return () => controller.abort()
  }, [open, reader.readArtifact, reader.revision, reference.file, reference.pointer, reference.revision])
  return <details className='mt-1 break-words' onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className='cursor-pointer'>{reference.note || reference.file}</summary>
    <p>{reference.file}{reference.pointer === undefined ? '' : `#${reference.pointer}`}</p>
    <p className='text-[var(--ds-text-secondary)]'>所引版本：{reference.revision}</p>
    {error ? <p role='status'>{error}</p> : !result ? <p role='status'>正在读取来源…</p> : <>
      <p role='status'>{result.historical === 'found' ? statuses[result.current] : result.historical === 'missing'
        ? '所引版本未找到来源；未推断当前关联。' : '所引版本暂不可读；未推断当前关联。'}</p>
      {result.historicalValue !== undefined && <section><h6 className='font-medium'>所引内容</h6><pre className='whitespace-pre-wrap break-words font-sans'>{excerpt(result.historicalValue)}</pre></section>}
      {result.current === 'changed' && result.currentValue !== undefined && <section><h6 className='font-medium'>当前已保存内容</h6><pre className='whitespace-pre-wrap break-words font-sans'>{excerpt(result.currentValue)}</pre></section>}
    </>}
    <p className='text-[var(--ds-text-secondary)]'>来源是证据位置，不代表用户确认或自动更新此功能。</p>
  </details>
}
