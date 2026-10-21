import { useEffect, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import type { ComponentNode, PanelManifest } from './dsl.ts'
import type { RenderOptions } from './interpreter.ts'
import { usePanelI18n } from './panel-i18n.tsx'
import { fieldsForSection } from './record-state.ts'

/** A request is user input to the current host, not a canonical record mutation. */
export function RecordRequestDialog({ node, manifest, options, onClose }: {
  node: ComponentNode; manifest: PanelManifest; options?: RenderOptions; onClose: () => void
}) {
  const { t } = usePanelI18n()
  const request = node.board!.request_create!
  const section = manifest.sections.find(item => item.id === node.source)!
  const sectionFields = fieldsForSection(manifest.fields, node.source!)
  const fields = request.fields.map(key => sectionFields.find(field => field.key === key)!)
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map(field => [field.key, String(section.create?.defaults?.[field.key] ?? '')])))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const dialog = useRef<HTMLDialogElement>(null)
  const sending = useRef(false)
  const writable = !!options?.editable && !!options.sendPrompt && fields.every(field => field && !field.readonly && !field.hidden)
  const valid = fields.every(field => (!field.required || values[field.key]?.trim()) && (!field.options || field.options.some(option => option.value === values[field.key])))
  useEffect(() => { const element = dialog.current!; element.showModal(); return () => element.close() }, [])
  return <dialog ref={dialog} className="dsh-record-request-dialog" aria-labelledby={`${node.id}-request-title`} onCancel={event => { event.preventDefault(); if (!sending.current) onClose() }}>
    <header><h2 id={`${node.id}-request-title`}>{t('addItem', { item: section.item_name ?? section.title })}</h2><button type="button" aria-label={t('cancel')} disabled={pending} onClick={onClose}><X size={18} /></button></header>
    <form onSubmit={async event => {
      event.preventDefault()
      if (!writable || !valid || sending.current) return
      sending.current = true; setPending(true); setError('')
      try {
        await options!.sendPrompt!(`${request.prompt}\n${fields.map(field => `${field.label}: ${field.options?.find(option => option.value === values[field.key])?.label ?? values[field.key].trim()}`).join('\n')}`)
        onClose()
      } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
      finally { sending.current = false; setPending(false) }
    }}>
      {fields.map(field => <label key={field.key}><span>{field.label}{field.required ? <span className="dsh-design-required-mark" aria-hidden="true" title={t('requiredField')}> *</span> : null}</span>
        {field.options ? <select disabled={!writable || pending} required={field.required} value={values[field.key]} onChange={event => setValues({ ...values, [field.key]: event.target.value })}>
          {field.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select> : field.control === 'textarea' ? <textarea rows={2} disabled={!writable || pending} required={field.required} value={values[field.key]} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />
          : <input disabled={!writable || pending} required={field.required} value={values[field.key]} onChange={event => setValues({ ...values, [field.key]: event.target.value })} />}
      </label>)}
      {error ? <p role="alert">{error}</p> : null}
      <footer><button type="button" disabled={pending} onClick={onClose}>{t('cancel')}</button><button type="submit" disabled={!writable || !valid || pending}><Sparkles size={16} />{request.submit_label}</button></footer>
    </form>
  </dialog>
}
