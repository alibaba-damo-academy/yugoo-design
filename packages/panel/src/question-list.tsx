import { useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { PanelWorkspace, PanelWorkspaceNavigation, type PanelWorkspaceNavItem } from './panel-workspace.tsx'
import { QuestionAttachments, type StandardQuestionAttachment } from './question-attachments.tsx'
import type { SidebarIcon } from './dsl.ts'
import { sidebarIcon } from './sidebar-icon.tsx'
import { panelText, usePanelI18n } from './panel-i18n.tsx'

export type StandardQuestionKind = 'text' | 'single' | 'multiple'

export interface StandardQuestionChoice {
  value: string
  label: string
  recommended?: boolean
}

/** Provider-neutral question shape shared by declarative and native panels. */
export interface StandardQuestionItem {
  id: string
  prompt: string
  note?: string
  kind: StandardQuestionKind
  choices?: readonly StandardQuestionChoice[]
  /** Fixed configuration recommendations use the native floating badge. */
  recommendationVariant?: 'inline' | 'fixed-badge'
  answer: string | readonly string[]
  detail?: string
  answered?: boolean
  round?: number
  rejected?: boolean
  attachments?: readonly StandardQuestionAttachment[]
}

export interface StandardQuestionLabels {
  answerPlaceholder: string
  detail: string
  edit: string
  unanswered: string
  recommended: string
}

const DEFAULT_LABELS: StandardQuestionLabels = {
  answerPlaceholder: '填写你的回答，也可以说明暂不确定的部分',
  detail: '补充说明（选填）',
  edit: '编辑',
  unanswered: '未回答',
  recommended: '推荐',
}

export interface StandardQuestionListProps {
  questions: readonly StandardQuestionItem[]
  cardGroups?: readonly { id: string; title: string; questionIds: readonly string[];
    presentation?: { alwaysExpanded?: boolean; showDetail?: boolean; showAttachments?: boolean }
  }[]
  editable?: boolean
  disabled?: boolean
  collapseAnswered?: boolean
  collapseToken?: unknown
  emptyText?: string
  labels?: Partial<StandardQuestionLabels>
  className?: string
  onAnswerChange?: (id: string, answer: string | readonly string[]) => void
  /** Trusted adapters map this to their existing canonical kind field. */
  onKindChange?: (id: string, kind: 'multiple') => void
  allowChoiceActions?: boolean
  choiceActionExcludedIds?: readonly string[]
  onDetailChange?: (id: string, detail: string) => void
  onRejectedChange?: (id: string, rejected: boolean) => void
  protectedQuestionIds?: readonly string[]
  onAttachmentsChange?: (id: string, attachments: readonly StandardQuestionAttachment[]) => void
  onUploadFiles?: (id: string, files: readonly File[]) => Promise<void>
  resolveAttachmentPreview?: (attachment: StandardQuestionAttachment) => Promise<string | undefined>
  renderActions?: (question: StandardQuestionItem, editing: boolean) => ReactNode
  renderAccessory?: (question: StandardQuestionItem, editing: boolean) => ReactNode
}

function answerValues(answer: StandardQuestionItem['answer']): readonly string[] {
  if (Array.isArray(answer)) return answer.map(String).filter(Boolean)
  return String(answer ?? '').split(',').map(value => value.trim()).filter(Boolean)
}

export function standardQuestionAnswered(question: StandardQuestionItem): boolean {
  if (question.answered !== undefined) return question.answered
  if (question.kind === 'text') {
    return typeof question.answer === 'string'
      ? question.answer.trim() !== ''
      : question.answer.some(value => String(value).trim() !== '')
  }
  return answerValues(question.answer).length > 0
}

export function standardQuestionSummary(question: StandardQuestionItem): string {
  if (question.kind === 'text') {
    return typeof question.answer === 'string' ? question.answer : question.answer.join(', ')
  }
  const values = answerValues(question.answer)
  const labels = new Map((question.choices ?? []).map(choice => [choice.value, choice.label]))
  return values.map(value => labels.get(value) ?? value).join('、')
}

function QuestionActionIcon({ action }: { action: 'edit' | 'skip' | 'restore' | 'multiple' }): ReactElement {
  return <svg viewBox='0 0 20 20' aria-hidden='true' focusable='false'>
    {action === 'edit'
      ? <path d='m12 4 4 4M4 12l9-9 4 4-9 9-5 1z' />
      : action === 'multiple'
        ? <path d='M3 4h3v3H3zM3 12h3v3H3zM9 5h8M9 13h8' />
      : action === 'restore'
        ? <path d='M4 4v5h5M4 9a6 6 0 1 1 1 6' />
        : <path d='m5 5 10 10M15 5 5 15' />}
  </svg>
}

function StandardQuestionCard(props: {
  question: StandardQuestionItem
  embedded?: boolean
  presentation?: NonNullable<StandardQuestionListProps['cardGroups']>[number]['presentation']
  editable: boolean
  disabled: boolean
  collapseAnswered: boolean
  collapseToken?: unknown
  labels: StandardQuestionLabels
  onAnswerChange?: StandardQuestionListProps['onAnswerChange']
  onKindChange?: StandardQuestionListProps['onKindChange']
  allowChoiceActions: boolean
  onDetailChange?: StandardQuestionListProps['onDetailChange']
  onRejectedChange?: StandardQuestionListProps['onRejectedChange']
  onAttachmentsChange?: StandardQuestionListProps['onAttachmentsChange']
  onUploadFiles?: StandardQuestionListProps['onUploadFiles']
  resolveAttachmentPreview?: StandardQuestionListProps['resolveAttachmentPreview']
  renderActions?: StandardQuestionListProps['renderActions']
  renderAccessory?: StandardQuestionListProps['renderAccessory']
}): ReactElement {
  const { t } = usePanelI18n()
  const answered = standardQuestionAnswered(props.question)
  const [editing, setEditing] = useState(() => props.editable && (!props.collapseAnswered || !answered))
  const previousCollapseToken = useRef(props.collapseToken)
  useEffect(() => {
    if (!props.editable || props.disabled || props.question.rejected) setEditing(false)
    else if (!props.collapseAnswered || !answered) setEditing(true)
  }, [props.disabled, props.editable, props.question.rejected, props.collapseAnswered, answered])
  useEffect(() => {
    if (previousCollapseToken.current === props.collapseToken) return
    previousCollapseToken.current = props.collapseToken
    if (props.collapseAnswered && answered) setEditing(false)
  }, [answered, props.collapseAnswered, props.collapseToken])

  const expanded = props.presentation?.alwaysExpanded === true || editing
  const canEdit = props.editable && !props.disabled && !props.question.rejected
  const canManageRejection = props.editable && !props.disabled
  const showDetail = props.presentation?.showDetail !== false
  const showAttachments = props.presentation?.showAttachments !== false
  const selected = useMemo(() => answerValues(props.question.answer), [props.question.answer])
  const summary = standardQuestionSummary(props.question)
  const hasSummary = summary.trim() !== ''
  const choices = props.question.choices ?? []
  const canUseChoiceActions = props.allowChoiceActions && canEdit && expanded
  const allSelected = choices.length > 0 && choices.every(choice => selected.includes(choice.value))
  const detailReadLabel = props.labels.detail.replace(/\s*(?:（选填）|\(optional\))$/iu, '')
  const textContext = showDetail && props.question.kind === 'text' && props.question.detail?.trim()
    ? <div className='dsh-standard-question-context' data-testid='standard-question-context'>
        <span>{detailReadLabel}</span>
        <div className='dsh-standard-question-answer-info'>{props.question.detail}</div>
      </div>
    : null

  const answerControl = props.question.kind === 'text'
    ? (
      <textarea
        className='dsh-standard-question-text'
        aria-label={props.question.prompt}
        placeholder={props.labels.answerPlaceholder}
        value={typeof props.question.answer === 'string' ? props.question.answer : selected.join(', ')}
        disabled={!canEdit}
        onChange={(event) => { if (canEdit) props.onAnswerChange?.(props.question.id, event.target.value) }}
      />
    )
    : (
      <div className='dsh-standard-question-options'>
        {choices.map(choice => {
          const checked = selected.includes(choice.value)
          return (
            <label key={choice.value} className={`dsh-standard-question-option question-option-frame${checked ? ' is-selected' : ''}${!canEdit ? ' is-disabled' : ''}`}>
              <input
                type={props.question.kind === 'single' ? 'radio' : 'checkbox'}
                name={props.question.kind === 'single' ? `dsh-question-${props.question.id}` : undefined}
                checked={checked}
                disabled={!canEdit}
                onChange={() => {
                  if (!canEdit) return
                  if (props.question.kind === 'single') {
                    props.onAnswerChange?.(props.question.id, choice.value)
                    return
                  }
                  props.onAnswerChange?.(
                    props.question.id,
                    checked ? selected.filter(value => value !== choice.value) : [...selected, choice.value],
                  )
                }}
              />
              <span>{choice.label}</span>
              {choice.recommended === true
                ? <span className={`dsh-standard-question-recommended${props.question.recommendationVariant === 'fixed-badge' ? ' is-fixed' : ''}`}>{props.labels.recommended}</span>
                : null}
            </label>
          )
        })}
      </div>
    )

  const supplement = props.question.kind === 'text' ? answerControl : showDetail ? (
    <label className='dsh-standard-question-detail-label'>
      <span className='dsh-question-visually-hidden'>{props.labels.detail}</span>
      <input type='text' placeholder={props.labels.detail} className='dsh-standard-question-detail'
        data-testid='standard-question-detail' value={props.question.detail ?? ''} disabled={!canEdit}
        onChange={event => { if (canEdit) props.onDetailChange?.(props.question.id, event.target.value) }} />
    </label>
  ) : null

  return (
    <article className={`dsh-standard-question-card${props.embedded ? ' is-embedded' : ''}`} data-question-id={props.question.id} data-answered={answered ? 'true' : 'false'}>
      <header className='dsh-standard-question-header'>
        <div className='dsh-standard-question-heading'>
          <h3>{props.question.prompt}</h3>
          {props.question.note ? <p>{props.question.note}</p> : null}
        </div>
        <div className='dsh-standard-question-actions'>
          {props.editable && !expanded && !props.question.rejected
            ? <button type='button' data-testid='standard-question-edit' disabled={props.disabled} onClick={() => { if (canEdit) setEditing(true) }}><QuestionActionIcon action='edit' /><span>{props.labels.edit}</span></button>
            : null}
          {props.renderActions?.(props.question, editing && canEdit)}
          {canUseChoiceActions && props.question.kind === 'single' && props.onKindChange
            ? <button type='button' data-testid='standard-question-to-multiple' onClick={() => {
                if (canUseChoiceActions && props.question.kind === 'single') props.onKindChange?.(props.question.id, 'multiple')
              }}><QuestionActionIcon action='multiple' /><span>{t('switchMultiple')}</span></button>
            : null}
          {canUseChoiceActions && props.question.kind === 'multiple' && choices.length > 0 && props.onAnswerChange
            ? <button type='button' data-testid='standard-question-select-all' onClick={() => {
                if (canUseChoiceActions && props.question.kind === 'multiple') props.onAnswerChange?.(props.question.id, allSelected ? [] : choices.map(choice => choice.value))
              }}>{t(allSelected ? 'deselectAll' : 'selectAll')}</button>
            : null}
          {props.editable && props.onRejectedChange
            ? <button type='button' disabled={!canManageRejection} onClick={() => { if (canManageRejection) props.onRejectedChange?.(props.question.id, !props.question.rejected) }}><QuestionActionIcon action={props.question.rejected ? 'restore' : 'skip'} /><span>{t(props.question.rejected ? 'restoreQuestion' : 'skipQuestion')}</span></button>
            : null}
          {props.question.rejected === true ? <span className='dsh-standard-question-rejected'>{t('skipped')}</span> : null}
        </div>
      </header>
      {expanded
        ? (
          <div className='dsh-standard-question-editor'>
            <div className={props.question.kind === 'text' ? 'dsh-standard-question-answer-shell' : undefined}>
              {props.question.kind !== 'text' ? answerControl : null}
              {showAttachments ? <QuestionAttachments
                attachments={props.question.attachments ?? []}
                editable={canEdit}
                disabled={!canEdit}
                resolvePreview={props.resolveAttachmentPreview}
                onUploadFiles={props.onUploadFiles ? files => canEdit ? props.onUploadFiles?.(props.question.id, files) ?? Promise.resolve() : Promise.resolve() : undefined}
                onChange={props.onAttachmentsChange ? attachments => { if (canEdit) props.onAttachmentsChange?.(props.question.id, attachments) } : undefined}
              >{supplement}</QuestionAttachments> : supplement}
              {textContext}
            </div>
            {props.renderAccessory?.(props.question, editing && canEdit)}
          </div>
        )
        : (
          <div className='dsh-standard-question-result'>
            {showAttachments ? <QuestionAttachments
              attachments={props.question.attachments ?? []}
              editable={false}
              resolvePreview={props.resolveAttachmentPreview}
            /> : null}
            {props.renderAccessory?.(props.question, false)}
            {hasSummary
              ? <div>{summary}</div>
              : !answered
                ? <div className='is-empty'>{props.labels.unanswered}</div>
                : null}
            {props.question.kind === 'text' ? textContext : showDetail && props.question.detail?.trim()
              ? <p><span>{detailReadLabel}</span>{props.question.detail}</p>
              : null}
          </div>
        )}
    </article>
  )
}

/**
 * Standard controlled question-list interaction. Product Bundles adapt their
 * canonical state into this model; rounds, attachments and rejection remain
 * optional provider extensions rather than requirements of the base widget.
 */
export function StandardQuestionList(props: StandardQuestionListProps): ReactElement {
  const { t } = usePanelI18n()
  const labels = { ...Object.fromEntries(Object.keys(DEFAULT_LABELS).map(key => [key, t(key as keyof StandardQuestionLabels)])) as unknown as StandardQuestionLabels, ...props.labels }
  const editable = props.editable === true
  const indices = new Map(props.questions.map((question, index) => [question.id, index]))
  const grouped = new Map<number, NonNullable<StandardQuestionListProps['cardGroups']>[number]>()
  const consumed = new Set<number>()
  const claimed = new Set<string>()
  const groupIds = new Set<string>()
  let invalid = false
  for (const group of props.cardGroups ?? []) {
    const positions = group.questionIds.map(id => indices.get(id))
    if (positions.every(index => index === undefined)) continue
    const first = positions[0]
    if (!group.id.trim() || !group.title.trim() || groupIds.has(group.id) || group.questionIds.length === 0
      || new Set(group.questionIds).size !== group.questionIds.length
      || group.questionIds.some(id => claimed.has(id))
      || first === undefined || positions.some((index, offset) => index !== first + offset)) {
      invalid = true
      continue
    }
    groupIds.add(group.id)
    group.questionIds.forEach(id => claimed.add(id))
    grouped.set(first, group)
    positions.slice(1).forEach(index => consumed.add(index!))
  }
  const renderCard = (question: StandardQuestionItem, embedded = false, presentation?: NonNullable<StandardQuestionListProps['cardGroups']>[number]['presentation']) => (
    <StandardQuestionCard
      key={question.id}
      embedded={embedded}
      presentation={presentation}
      question={question}
      editable={editable}
      disabled={props.disabled === true}
      collapseAnswered={props.collapseAnswered !== false}
      collapseToken={props.collapseToken}
      labels={labels}
      onAnswerChange={props.onAnswerChange}
      onKindChange={props.onKindChange}
      allowChoiceActions={props.allowChoiceActions === true && !props.choiceActionExcludedIds?.includes(question.id)}
      onDetailChange={props.onDetailChange}
      onRejectedChange={props.protectedQuestionIds?.includes(question.id) ? undefined : props.onRejectedChange}
      onAttachmentsChange={props.onAttachmentsChange}
      onUploadFiles={props.onUploadFiles}
      resolveAttachmentPreview={props.resolveAttachmentPreview}
      renderActions={props.renderActions}
      renderAccessory={props.renderAccessory}
    />
  )
  return (
    <div className={`dsh-standard-question-list${props.className ? ` ${props.className}` : ''}`}>
      {invalid ? <p role='alert'>{t('invalidQuestionCardGroup')}</p> : null}
      {props.questions.length === 0 ? <p className='dsh-standard-question-empty'>{props.emptyText ?? t('noQuestions')}</p> : null}
      {props.questions.map((question, index) => {
        if (consumed.has(index)) return null
        const group = grouped.get(index)
        return group
          ? <section key={question.id} className='dsh-standard-question-card-group' data-question-card-group={group.id}>
              <h3 className='dsh-standard-question-card-group-title'>{group.title}</h3>
              {props.questions.slice(index, index + group.questionIds.length).map(item => renderCard(item, true, group.presentation))}
            </section>
          : renderCard(question)
      })}
    </div>
  )
}

export interface StandardQuestionGroup {
  id: string
  label: string
  title?: string
  /** Independent round context; absence preserves the authored legacy title projection. */
  description?: string
  current?: boolean
  questionIds: readonly string[]
}

export interface StandardQuestionWorkspaceProps extends Omit<StandardQuestionListProps, 'questions'> {
  questions: readonly StandardQuestionItem[]
  groups?: readonly StandardQuestionGroup[]
  /** Explicit context keyed by numeric round strings; empty means no authored context. */
  rounds?: Readonly<Record<string, { title: string; description: string }>>
  title?: string
  description?: string
  firstRoundIds?: readonly string[]
  historyReadonly?: boolean
  numberedRounds?: boolean
  sidebarIcon?: SidebarIcon
}

/** Display only: keep the complete authored introduction in canonical data. */
function questionRoundCopy(introduction?: string): { title?: string; description?: string } {
  const text = introduction?.trim()
  if (!text) return {}
  // Accept either colon; a pre-existing first-line title remains a boundary.
  const boundary = /[:：]|\r?\n/.exec(text)
  if (!boundary || boundary.index === 0) return { title: text }
  return {
    title: text.slice(0, boundary.index).trim(),
    description: text.slice(boundary.index + boundary[0].length).trim() || undefined,
  }
}

export function inferredQuestionGroups(questions: readonly StandardQuestionItem[], firstRoundIds: readonly string[] = [], numberedRounds = false, locale = 'zh-CN', context?: StandardQuestionWorkspaceProps['rounds']): readonly StandardQuestionGroup[] {
  const rounds = new Map<number, string[]>()
  const fixed: string[] = []
  for (const question of questions) {
    if (firstRoundIds.includes(question.id)) { fixed.push(question.id); continue }
    const round = Number.isFinite(question.round) ? Math.max(0, Math.trunc(Number(question.round))) : 0
    const ids = rounds.get(round) ?? []
    ids.push(question.id)
    rounds.set(round, ids)
  }
  if (fixed.length > 0) {
    const first = rounds.size === 0 ? 0 : Math.min(...rounds.keys())
    rounds.set(first, [...(rounds.get(first) ?? []), ...fixed])
  }
  const ordered = [...rounds.entries()].sort((a, b) => b[0] - a[0])
  return ordered.map(([round, questionIds], index) => ({
    id: `round-${round}`,
    label: numberedRounds ? panelText('round', locale, { number: ordered.length - index }) : ordered.length === 1 ? panelText('currentQuestions', locale) : round > 0 ? panelText('round', locale, { number: round }) : panelText('baseQuestions', locale),
    title: context !== undefined ? context[String(round)]?.title : numberedRounds ? questions.find(question => question.id === questionIds[0])?.prompt : undefined,
    description: context !== undefined ? context[String(round)]?.description : undefined,
    current: index === 0,
    questionIds,
  }))
}

/** Full question workspace: reusable navigation, round context, cards and attachments. */
export function StandardQuestionWorkspace(props: StandardQuestionWorkspaceProps): ReactElement {
  const { t, locale } = usePanelI18n()
  const groups = props.groups ?? inferredQuestionGroups(props.questions, props.firstRoundIds, props.numberedRounds, locale, props.rounds)
  const [selected, setSelected] = useState(groups[0]?.id ?? '')
  const latest = groups.find(group => group.current)?.id ?? groups[0]?.id ?? ''
  const previousLatest = useRef(latest)
  useEffect(() => {
    if (previousLatest.current !== latest) {
      previousLatest.current = latest
      setSelected(latest)
      return
    }
    if (groups.some(group => group.id === selected)) return
    setSelected(groups[0]?.id ?? '')
  }, [groups, selected, latest])
  const group = groups.find(candidate => candidate.id === selected) ?? groups[0]
  const questionMap = new Map(props.questions.map(question => [question.id, question]))
  const visible = group?.questionIds.flatMap(id => questionMap.get(id) ?? []) ?? []
  const invalidRoundGroups = new Set((props.cardGroups ?? []).filter(cardGroup =>
    cardGroup.questionIds.some(id => visible.some(question => question.id === id))
      && groups.filter(round => cardGroup.questionIds.some(id => questionMap.has(id) && round.questionIds.includes(id))).length > 1,
  ))
  const cardGroups = props.cardGroups?.filter(cardGroup => !invalidRoundGroups.has(cardGroup))
  const copyOf = (candidate?: StandardQuestionGroup) => candidate?.description !== undefined
    ? { title: candidate.title?.trim() || undefined, description: candidate.description.trim() || undefined }
    : questionRoundCopy(candidate?.title)
  const roundCopy = copyOf(group)
  const navItems: PanelWorkspaceNavItem[] = groups.map(candidate => {
    const title = copyOf(candidate).title
    return { id: candidate.id, label: title ?? candidate.label, eyebrow: title ? candidate.label : undefined }
  })
  return (
    <PanelWorkspace
      guidance={props.description}
      className='dsh-question-workspace'
      autoSaveId='question-workspace'
      sidebar={<PanelWorkspaceNavigation icon={sidebarIcon(props.sidebarIcon)} title={props.title ?? t('questions')} items={navItems} selectedId={group?.id ?? ''} onSelect={setSelected} />}
    >
      <div className='dsh-question-workspace-content'>
        <div className='dsh-question-workspace-sticky'>
          <header className='dsh-question-workspace-header'>
            <div>
              <h2>{roundCopy.title ?? group?.label ?? props.title ?? t('questions')}</h2>
              {roundCopy.description ? <p>{roundCopy.description}</p> : null}
            </div>
            <span>{visible.filter(standardQuestionAnswered).length}/{visible.length} {t('answered')}</span>
          </header>
        </div>
        {invalidRoundGroups.size > 0 ? <p role='alert'>{t('invalidQuestionCardGroup')}</p> : null}
        <StandardQuestionList {...props} cardGroups={cardGroups} questions={visible} choiceActionExcludedIds={[...(props.choiceActionExcludedIds ?? []), ...(props.firstRoundIds ?? [])]} editable={props.editable && (!props.historyReadonly || group?.id === latest)} />
      </div>
    </PanelWorkspace>
  )
}
