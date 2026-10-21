import { useEffect, useState } from 'react'
import { readDesignSourceReference, type DesignSourceReference, type DesignSourceReferenceRead } from 'dsh-design-core/source-reference'
import type { RenderOptions } from './interpreter.ts'
import { usePanelI18n } from './panel-i18n.tsx'

/** Read-only, version-pinned evidence; never adopts source content into a draft. */
function SourceCard({ reference, options }: { reference: DesignSourceReference; options?: RenderOptions }) {
  const { t } = usePanelI18n()
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<DesignSourceReferenceRead>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    setResult(undefined); setFailed(false)
    if (!open) return
    if (!options?.readArtifact || !options.sourceRevision) { setFailed(true); return }
    const controller = new AbortController()
    void readDesignSourceReference(reference, options.sourceRevision, async (revision, file) => {
      const response = await options.readArtifact!(file, revision)
      if (response.content.length > 262144) throw new Error('Source exceeds preview size')
      return response.found ? response.content : undefined
    }, controller.signal).then(value => { if (!controller.signal.aborted) setResult(value) })
      .catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [open, options?.sourceRevision, options?.readArtifact, reference.file, reference.pointer, reference.revision])
  const excerpt = (value: unknown) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''
    return text.length > 2500 ? `${text.slice(0, 2500)}\n…` : text
  }
  const status = result?.historical !== 'found' ? 'sourceUnverified'
    : result.current === 'matching' ? 'sourceMatching' : result.current === 'changed' ? 'sourceChanged'
      : result.current === 'missing' ? 'sourceMissing' : result.current === 'historical-only' ? 'sourceHistorical' : 'sourceUnverified'
  return <details className="dsh-source-reference" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{reference.note || reference.file}</summary>
    {open ? <><p>{reference.file}{reference.pointer === undefined ? '' : `#${reference.pointer}`}</p>
      <p>{t('sourceRevision')}: {reference.revision}</p>
      <p role="status">{failed ? t('sourceUnverified') : !result ? t('sourceLoading') : t(status)}</p>
      {result?.historicalValue !== undefined ? <section><strong>{t('sourcePinned')}</strong><pre>{excerpt(result.historicalValue)}</pre></section> : null}
      {result?.current === 'changed' && result.currentValue !== undefined ? <section><strong>{t('sourceCurrent')}</strong><pre>{excerpt(result.currentValue)}</pre></section> : null}
      <p>{t('sourceNotice')}</p></> : null}
  </details>
}

export function SourceReferences({ value, options }: { value: unknown; options?: RenderOptions }) {
  const { t } = usePanelI18n()
  if (value === undefined) return <span>{t('noSources')}</span>
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return <p role="alert">{t('invalidRecords')}</p>
  return <div>{Object.entries(value).map(([id, entry]) => {
    if (!entry || typeof entry !== 'object' || typeof entry.file !== 'string' || typeof entry.revision !== 'string') return <p key={id} role="alert">{t('sourceUnverified')}</p>
    return <SourceCard key={`${id}:${entry.file}:${entry.pointer ?? ''}:${entry.revision}`} reference={entry} options={options} />
  })}</div>
}
