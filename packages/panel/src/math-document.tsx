import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import katex from 'katex'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import type { ComponentNode, EditorField, PanelManifest } from './dsl.ts'
import type { MathEntriesBinding } from 'dsh-design-core/dsl'
import { PanelDisclosureIcon, PanelEditableTitle, PanelRecordHeader } from './panel-workspace.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { fieldIsVisible } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'

type ArtifactContext = Pick<RenderOptions, 'readArtifact' | 'artifactFiles' | 'sourceRevision'>

/** No shared macros, external resources, raw HTML or formula execution.
 * MathML uses the browser's math layout and avoids a second global font/CSS set. */
export function renderMath(value: string, display = true): { markup?: string; error?: string } {
  if (!value.trim()) return {}
  if (value.length > 12000) return { error: 'length' }
  try {
    return { markup: katex.renderToString(value, { output: 'mathml', displayMode: display,
      throwOnError: true, trust: false, strict: 'error', maxExpand: 300, maxSize: 20, macros: {} }) }
  } catch { return { error: 'syntax' } }
}

export function MathFormula({ value, inline = false }: { value: string; inline?: boolean }) {
  const { t } = usePanelI18n()
  const result = useMemo(() => renderMath(value, !inline), [value, inline])
  if (!value.trim()) return <span className="dsh-math-empty">{t('mathMissingFormula')}</span>
  const ErrorContainer = inline ? 'span' : 'div'
  if (!result.markup) return <ErrorContainer className={`dsh-math-error${inline ? ' is-inline' : ''}`} role="status">
    <span>{t(result.error === 'length' ? 'mathTooLong' : 'mathInvalid')}</span><code>{value}</code>
  </ErrorContainer>
  return <span className={`dsh-math-formula${inline ? ' is-inline' : ''}`} tabIndex={inline ? undefined : 0}
    dangerouslySetInnerHTML={{ __html: result.markup }} />
}

/** Explicit inline LaTeX delimiters leave ordinary text and currency untouched. */
export function MathProse({ value }: { value: string }) {
  const parts: ReactNode[] = []
  let start = 0
  for (const match of value.matchAll(/\\\((.+?)\\\)/g)) {
    parts.push(value.slice(start, match.index))
    parts.push(<MathFormula key={match.index} value={match[1]!} inline />)
    start = match.index! + match[0].length
  }
  parts.push(value.slice(start))
  return <>{parts}</>
}

// Compare rendered notation, not substrings such as the i inside \\min or text
// inside \\text. This projects existing definitions; it does not infer equivalent
// algebra or invent a definition for an unrecognized symbol.
function mathPresentation(value: string): string | undefined {
  const body = renderMath(value, false).markup?.match(/<semantics>([\s\S]*?)<annotation(?:\s|>)/)?.[1]
  return body?.startsWith('<mrow>') && body.endsWith('</mrow>') ? body.slice(6, -7) : body
}
export function matchingMathSymbols(formula: string, symbols: readonly string[]): number[] {
  const expression = mathPresentation(formula)
  if (!expression) return []
  return symbols.flatMap((symbol, index) => {
    const notation = mathPresentation(symbol)
    return notation && expression.includes(notation) ? [index] : []
  })
}

const stringOf = (value: unknown) => typeof value === 'string' ? value : ''
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

/** Same save-success signal used by Smart Question; typing is still a draft. */
function useSavedEditing<T>(collapseToken: unknown) {
  const [editing, setEditing] = useState<T>()
  const previous = useRef(collapseToken)
  useEffect(() => {
    if (previous.current === collapseToken) return
    previous.current = collapseToken
    setEditing(undefined)
  }, [collapseToken])
  return [editing, setEditing] as const
}

function Disclosure({ title, className = 'dsh-math-disclosure', children, onOpenChange }: { title: ReactNode; className?: string; children: ReactNode; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return <details className={className} onToggle={event => { setOpen(event.currentTarget.open); onOpenChange?.(event.currentTarget.open) }}>
    <summary aria-expanded={open}><span>{title}</span><PanelDisclosureIcon expanded={open} /></summary>{children}
  </details>
}

/** Read an indexed, declared artifact at the owning source revision, as inert
 * text only. This adds no file access beyond the existing host artifact port. */
function ReadonlyArtifact({ field, path, context }: { field: EditorField; path: string; context?: ArtifactContext }) {
  const { t } = usePanelI18n()
  const [open, setOpen] = useState(false)
  const [attempt, retry] = useState(0)
  const [result, setResult] = useState<{ key: string; content?: string; error?: 'mathFileUnavailable' | 'mathFileTooLarge' }>()
  const revision = context?.sourceRevision, read = context?.readArtifact
  const indexed = !!context?.artifactFiles && Object.hasOwn(context.artifactFiles, path)
  const safe = !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..') && !/[\\:\x00-\x1f]/.test(path)
  const key = JSON.stringify([path, revision, indexed, attempt])
  useEffect(() => {
    if (!open || !safe || !indexed || !revision || !read) return
    let live = true
    void read(path, revision).then(value => {
      if (!live) return
      setResult(!value.found ? { key, error: 'mathFileUnavailable' }
        : value.content.length > 262144 ? { key, error: 'mathFileTooLarge' } : { key, content: value.content })
    }).catch(() => { if (live) setResult({ key, error: 'mathFileUnavailable' }) })
    return () => { live = false }
  }, [open, safe, indexed, path, revision, read, key])
  const available = safe && indexed && !!revision && !!read
  return <Disclosure className="dsh-math-file dsh-math-disclosure" onOpenChange={setOpen}
    title={<>{field.label ?? t('mathModelFile')}<code>{path.split('/').pop()}</code></>}>
    {open ? <><p className="dsh-math-file-path">{path}</p>
      {!available ? <p role="status">{t('mathFileUnavailable')}</p>
        : result?.key !== key ? <p role="status">{t('mathFileLoading')}</p>
          : result.error ? <p role="status">{t(result.error)} <button type="button" onClick={() => retry(value => value + 1)}>{t('artifactRetryPreview')}</button></p>
            : <pre className="dsh-math-file-preview">{result.content}</pre>}</> : null}
  </Disclosure>
}

function Source({ value }: { value: string }) {
  const { t } = usePanelI18n()
  return value.trim() ? <Disclosure className="dsh-math-source" title={t('mathSource')}><code>{value}</code></Disclosure> : null
}

function ExplanationEntries({ binding, field, value, editable, collapseToken, onChange, symbols = false, renderNotation }: {
  binding: MathEntriesBinding; field: EditorField; value: unknown; editable: boolean
  collapseToken?: unknown
  renderNotation?: (formula: string) => ReactNode
  onChange: (value: unknown) => void; symbols?: boolean
}) {
  const { t } = usePanelI18n()
  const [editing, setEditing] = useSavedEditing<number>(collapseToken)
  const [limit, setLimit] = useState(20)
  const [collapsed, setCollapsed] = useState<Record<number, boolean>>({})
  const container = useRef<HTMLElement>(null)
  useEffect(() => { if (editing !== undefined) container.current?.querySelector<HTMLTextAreaElement>(`[data-math-entry="${editing}"] .dsh-math-editor textarea`)?.focus() }, [editing])
  const rows = Array.isArray(value) ? value : []
  if (value !== undefined && (!Array.isArray(value) || rows.some(row => !isRecord(row)))) return <p role="alert">{t('mathMalformed')}</p>
  const change = (index: number, key: string, text: string) => onChange(rows.map((row, i) => i === index ? { ...row, [key]: text } : row))
  const formulaLabel = field.columns?.find(column => column.key === binding.formula)?.label ?? t('mathFormula')
  const used = new Set([binding.title, binding.formula, binding.meaning, binding.source, ...binding.details ?? []])
  return <section ref={container} className={`dsh-math-entries${symbols ? ' is-notation' : ''}`} data-math-field={field.key}>
    {!symbols ? <h3>{field.label ?? field.key}</h3> : null}
    {rows.length === 0 ? <p className="dsh-math-empty">{t('mathEmptyEntries')}</p> : null}
    {rows.slice(0, limit).map((row, index) => {
      const title = binding.title ? stringOf(row[binding.title]) : ''
      const isEditing = editable && editing === index
      const input = (key: string, rows = 2, labelVisible = false) => {
        const column = field.columns!.find(column => column.key === key)!
        const prose = key === binding.meaning
        return <div className="dsh-math-editor is-inline"><label className={prose ? 'dsh-panel-prose-editor' : undefined}>
          {labelVisible ? <span>{key === binding.formula ? `${formulaLabel} · LaTeX` : column.label}</span> : null}
          <textarea className={prose ? 'dsh-panel-prose-input' : undefined} rows={rows} value={stringOf(row[key])} aria-label={`${column.label} · ${index + 1}`}
            spellCheck={key === binding.formula ? false : undefined} data-math-input={key}
            data-math-kind={key === binding.formula ? 'formula' : 'text'}
            onChange={event => change(index, key, event.currentTarget.value)} />
        </label></div>
      }
      return <article className={`dsh-math-entry${symbols ? '' : ' is-statement'}`} key={index} data-math-entry={index}>
        <div className="dsh-math-entry-heading">
          {symbols ? <div className="dsh-math-symbol-heading"><MathFormula value={stringOf(row[binding.formula])} inline />
            {isEditing ? input(binding.formula, 1, true) : null}
            {binding.title ? isEditing ? input(binding.title, 1) : <span>{title}</span> : null}</div>
            : isEditing && binding.title ? <div className="dsh-math-title-edit">{input(binding.title, 1)}</div>
              : <h4><button type="button" className="dsh-math-card-toggle" aria-expanded={!collapsed[index]}
                onClick={() => setCollapsed(current => ({ ...current, [index]: !current[index] }))}>
                <span>{title || t('mathUntitled')}</span><PanelDisclosureIcon expanded={!collapsed[index]} /></button></h4>}
          {editable ? <button type="button" className="dsh-math-edit" aria-expanded={editing === index}
            aria-label={t(editing === index ? 'mathFinishEntry' : 'mathEditEntry', { item: title || stringOf(row[binding.formula]) || index + 1 })}
            onClick={() => { setCollapsed(current => ({ ...current, [index]: false })); setEditing(editing === index ? undefined : index) }}>
            <Pencil size={14} aria-hidden="true" />{t(editing === index ? 'mathFinish' : 'mathEdit')}</button> : null}
        </div>
        <div className="dsh-math-entry-body" hidden={!symbols && !isEditing && collapsed[index]}>
        {isEditing ? input(binding.meaning) : <p className="dsh-math-meaning dsh-panel-prose-reading"><MathProse value={stringOf(row[binding.meaning]) || t('mathMissingMeaning')} /></p>}
        {binding.details?.length ? <dl className="dsh-math-details">{binding.details.map(key => isEditing || row[key] ? <div key={key}>
          <dt>{field.columns?.find(column => column.key === key)?.label ?? key}</dt><dd>{isEditing ? input(key, 1) : <MathProse value={stringOf(row[key])} />}</dd></div> : null)}</dl> : null}
        {!symbols ? <div className="dsh-math-expression"><MathFormula value={stringOf(row[binding.formula])} />
          {isEditing ? input(binding.formula, 2, true) : null}</div> : null}
        {!symbols ? renderNotation?.(stringOf(row[binding.formula])) : null}
        {field.columns?.filter(column => !used.has(column.key)).map(column => isEditing ? <div key={column.key}>{input(column.key, 2, true)}</div> : row[column.key] ? <p key={column.key}>
          <span className="dsh-math-empty">{column.label} · </span><MathProse value={stringOf(row[column.key])} /></p> : null)}
        {binding.source ? <Source value={stringOf(row[binding.source])} /> : null}
        {isEditing ? <div className="dsh-math-entry-actions">
          <p className="dsh-math-edit-hint">{t('mathEditHint')}</p>
          <button type="button" className="dsh-math-remove" onClick={() => {
            if (!window.confirm(t('mathDeleteConfirm'))) return
            onChange(rows.filter((_, i) => i !== index)); setEditing(undefined); setCollapsed({})
          }}><Trash2 size={14} aria-hidden="true" />{t('mathDelete')}</button>
        </div> : null}
        </div>
      </article>
    })}
    {rows.length > limit ? <button type="button" onClick={() => setLimit(limit + 20)}>{t('mathShowMore', { count: rows.length - limit })}</button> : null}
    {editable && (field.max_rows === undefined || rows.length < field.max_rows) ? <button type="button" className="dsh-math-add" onClick={() => {
      const row = Object.fromEntries((field.columns ?? []).map(column => [column.key, '']))
      onChange([...rows, row]); setLimit(Math.max(limit, rows.length + 1)); setEditing(rows.length)
    }}><Plus size={14} aria-hidden="true" />{t('mathAddEntry')}</button> : null}
  </section>
}

/** A generic same-record reading projection. Unconsumed declared fields retain
 * the existing form controls; other workspace sources use their ordinary form. */
export function MathDocument({ node, manifest, value, editable, collapseToken, onChange, renderField, artifactContext }: {
  node: ComponentNode; manifest: PanelManifest; value: Record<string, unknown>; editable: boolean
  collapseToken?: unknown
  artifactContext?: ArtifactContext
  onChange: (field: EditorField, value: unknown) => void; renderField: (field: EditorField) => ReactNode
}) {
  const { t } = usePanelI18n()
  const [editing, setEditing] = useSavedEditing<string>(collapseToken)
  const container = useRef<HTMLDivElement>(null)
  const complete = useRef<HTMLDivElement>(null)
  const notation = useRef<HTMLDivElement>(null)
  useEffect(() => { if (editing) container.current?.querySelector<HTMLTextAreaElement>(`[data-math-field="${editing}"] .dsh-math-editor textarea`)?.focus() }, [editing])
  const config = node.math!
  const fields = manifest.fields.filter(field => !field.hidden && field.applies_to?.includes(node.source!) && fieldIsVisible(field, value))
  const fieldOf = (key: string | undefined) => fields.find(field => field.key === key)
  const canEdit = (field: EditorField | undefined) => !!field && editable && !field.readonly
  const textBlock = (key: string | undefined, formula = false) => {
    const field = fieldOf(key)
    if (!field) return null
    return <section className="dsh-math-text" data-math-field={field.key}>
      <div className="dsh-math-entry-heading">{!formula ? <h3>{field.label ?? key}</h3> : <span />}
        {canEdit(field) ? <button type="button" className="dsh-math-edit" aria-expanded={editing === key}
          aria-label={t(editing === key ? 'mathFinishEntry' : 'mathEditEntry', { item: field.label ?? field.key })}
          onClick={() => setEditing(editing === key ? undefined : key)}><Pencil size={14} aria-hidden="true" />{t(editing === key ? 'mathFinish' : 'mathEdit')}</button> : null}</div>
      {formula ? <MathFormula value={stringOf(value[field.key])} /> : !(canEdit(field) && editing === key) ? <p className="dsh-panel-prose-reading"><MathProse value={stringOf(value[field.key]) || t('mathNoText')} /></p> : null}
      {canEdit(field) && editing === key ? <div className="dsh-math-editor is-inline"><label className={formula ? undefined : 'dsh-panel-prose-editor'}>{formula ? <span>LaTeX</span> : null}
        <textarea className={formula ? undefined : 'dsh-panel-prose-input'} aria-label={field.label ?? field.key} rows={formula ? 8 : 4} value={stringOf(value[field.key])}
          maxLength={field.max_length} data-math-kind={formula ? 'formula' : 'text'} spellCheck={formula ? false : undefined} onChange={event => onChange(field, event.currentTarget.value)} /></label>
        {formula ? <p className="dsh-math-edit-hint">{t('mathEditHint')}</p> : null}</div> : null}
    </section>
  }
  const symbolField = fieldOf(config.symbols?.field)
  const symbolValue = symbolField ? value[symbolField.key] : undefined
  const definitions: Record<string, unknown>[] = Array.isArray(symbolValue) ? symbolValue.filter(isRecord) : []
  const openNotation = () => {
    for (const node of [complete.current, notation.current]) {
      const details = node?.querySelector('details')
      if (details) details.open = true
    }
    notation.current?.focus({ preventScroll: true })
    notation.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
  const inlineNotation = (formula: string) => {
    const binding = config.symbols
    if (!binding) return null
    const indices = matchingMathSymbols(formula, definitions.map(row => stringOf(row[binding.formula])))
    if (!indices.length) return null
    return <Disclosure className="dsh-math-inline-notation dsh-math-disclosure" title={<>{t('mathSymbolsHere')}<span className="dsh-math-count">{indices.length}</span></>}>
      <div className="dsh-math-notation-heading">
        <button type="button" onClick={openNotation}>{t(canEdit(symbolField) ? 'mathEditNotation' : 'mathViewNotation')}</button></div>
      <dl>{indices.map(index => <div key={index}><dt><MathFormula value={stringOf(definitions[index]![binding.formula])} inline /></dt>
        <dd><MathProse value={stringOf(definitions[index]![binding.meaning]) || t('mathMissingMeaning')} /></dd></div>)}</dl>
    </Disclosure>
  }
  const entries = (binding: MathEntriesBinding | undefined, symbols = false) => {
    const field = binding && fieldOf(binding.field)
    return field && binding ? <ExplanationEntries key={binding.field} binding={binding} field={field} value={value[field.key]}
      editable={canEdit(field)} collapseToken={collapseToken} onChange={next => onChange(field, next)} symbols={symbols}
      renderNotation={!symbols ? inlineNotation : undefined} /> : null
  }
  const heading = fieldOf(config.heading)
  const consumed = new Set([config.heading, config.introduction, config.notes, config.complete, config.symbols?.field, config.statements.field,
    config.output?.file, config.output?.format, config.checks?.status, config.checks?.summary, config.checks?.evidence, ...config.provenance ?? []])
  const other = fields.filter(field => !consumed.has(field.key))
  const hasText = (field: EditorField | undefined) => !!field && stringOf(value[field.key]).trim().length > 0
  const output = fieldOf(config.output?.file), outputFormat = fieldOf(config.output?.format)
  const status = fieldOf(config.checks?.status), checkSummary = fieldOf(config.checks?.summary)
  const statusLabel = status?.options?.find(option => option.value === value[status.key])?.label ?? t('mathNoCheckStatus')
  const provenance = [...config.provenance ?? [], ...config.checks?.evidence ? [config.checks.evidence] : []]
    .map(fieldOf).filter((field): field is EditorField => hasText(field))
  return <div ref={container} className="dsh-design-record has-form-header is-detail dsh-math-document">
    <PanelRecordHeader variant="detail">{heading ? <PanelEditableTitle aria-label={heading.label ?? heading.key}
      value={stringOf(value[heading.key])} readOnly={!canEdit(heading)}
      onChange={canEdit(heading) ? event => onChange(heading, event.currentTarget.value) : undefined} /> : null}</PanelRecordHeader>
    {textBlock(config.introduction)}
    {entries(config.statements)}
    {textBlock(config.notes)}
    {fieldOf(config.complete) || symbolField ? <div ref={complete} data-math-complete>
      <Disclosure className="dsh-math-card dsh-math-disclosure" title={fieldOf(config.complete)?.label ?? t('mathComplete')}>
        <div className="dsh-math-card-content"><p className="dsh-math-section-hint">{t('mathCompleteHint')}</p>{textBlock(config.complete, true)}
          {symbolField ? <div ref={notation} tabIndex={-1} className="dsh-math-all-notation">
            <Disclosure title={<>{symbolField.label ?? t('mathNotation')}<span className="dsh-math-count">{definitions.length}</span></>}>
              <p className="dsh-math-section-hint">{t('mathNotationHint')}</p>{entries(config.symbols, true)}</Disclosure></div> : null}
        </div></Disclosure></div> : null}
    {hasText(output) ? <section className="dsh-math-card dsh-math-output" data-math-output>
      <h3>{t('mathModelFile')}</h3><ReadonlyArtifact field={{ ...output!, label: t('mathViewFile') }} path={stringOf(value[output!.key])} context={artifactContext} />
      {hasText(outputFormat) ? <p className="dsh-math-section-hint">{outputFormat!.label} · {stringOf(value[outputFormat!.key])}</p> : null}</section> : null}
    {config.checks ? <section className="dsh-math-card dsh-math-checks" data-math-checks>
      <div className="dsh-math-entry-heading"><h3>{t('mathModelChecks')}</h3><span className="dsh-math-check-status">{statusLabel}</span></div>
      <p><MathProse value={hasText(checkSummary) ? stringOf(value[checkSummary!.key]) : t('mathNoCheckSummary')} /></p>
    </section> : null}
    {provenance.length ? <Disclosure className="dsh-math-card dsh-math-disclosure dsh-math-provenance" title={t('mathProvenance')}>
      <div className="dsh-math-card-content"><p className="dsh-math-section-hint">{t('mathProvenanceHint')}</p>
        <dl>{provenance.map(field => <div key={field.key}><dt>{field.label ?? field.key}</dt><dd>{field.control === 'artifact_ref'
          ? <ReadonlyArtifact field={{ ...field, label: t('mathViewFile') }} path={stringOf(value[field.key])} context={artifactContext} /> : stringOf(value[field.key])}</dd></div>)}</dl></div></Disclosure> : null}
    {other.length ? <Disclosure className="dsh-math-card dsh-math-disclosure" title={t('mathOtherFields')}>
      <div className="dsh-math-card-content"><div className="dsh-math-evidence">{other.map(field => renderField(field))}</div></div></Disclosure> : null}
  </div>
}
