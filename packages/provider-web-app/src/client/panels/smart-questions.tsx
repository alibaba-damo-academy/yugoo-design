/**
 * smart_questions adapter: converts the Design File question map to the
 * original AIQuestion array payload and writes edits back to stable values.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { MessagesSquare } from 'lucide-react'
import {
  StandardQuestionList,
  standardQuestionAnswered,
  type StandardQuestionItem,
} from 'dsh-design-panel/client-api'
import { AIQuestion } from '../ported/design/AIQuestion/AIQuestion.tsx'
import { QuestionImageAttachments } from '../ported/design/AIQuestion/QuestionImageAttachments.tsx'
import { NativeDesignPanelFrame } from '../ported/design/OfficialWebAppPanels/NativeDesignPanelFrame.tsx'
import {
  DesignPanelHeader,
  DesignPanelNavItem,
  DesignPanelSidebar,
  DesignPanelTitle,
} from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import type {
  IQuestionAnswer,
  IQuestionType,
  ISelection,
  ISmartQuestionsPanel,
  ISingleChoiceSuggest,
} from '../ported/design/AIQuestion/types.ts'
import { currentLanguage, useLang } from '../ported/host.ts'
import {
  isSmartQuestionPreviewImage,
  legacySmartQuestionImagePath,
  smartQuestionAttachmentPath,
  smartQuestionAttachmentMime,
} from './smart-question-attachments.ts'
import { isRecord, type PendingSmartQuestionImageUpload, type SmartQuestion, type SmartQuestionImageAnswer, type SmartQuestionsState } from '../types.ts'
import type { BinaryArtifactRead } from './shared.ts'
import {
  deriveSmartQuestionBatches,
  mergeSmartQuestionUpdates,
  reconcileSmartQuestionBatchSelection,
  type SmartQuestionBatch,
} from './smart-question-batches.ts'

interface PanelProps {
  draft: unknown
  onChange: (next: SmartQuestionsState) => void
  originalState?: unknown
  /** Save in flight; workspace must pass this to reproduce save-time collapse. */
  running?: boolean
  readBinaryArtifact: (relPath: string) => Promise<BinaryArtifactRead>
}

const PANEL_ID = 'smart_questions'

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)))
  }
  return btoa(binary)
}

async function pendingUpload(questionId: string, file: File): Promise<{ ref: SmartQuestionImageAnswer; upload: PendingSmartQuestionImageUpload }> {
  const mimeType = smartQuestionAttachmentMime(file.type)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const digestBytes = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes))
  const digest = [...digestBytes].map((byte) => byte.toString(16).padStart(2, '0')).join('')
  const clientDigest = digest.slice(0, 32)
  const ref: SmartQuestionImageAnswer = {
    type: 'file',
    file_md5: clientDigest,
    filename: file.name,
    mime_type: mimeType,
    size_bytes: bytes.byteLength,
    artifact_file: smartQuestionAttachmentPath(digest, mimeType),
  }
  return {
    ref,
    upload: {
      ...ref,
      question_id: questionId,
      client_digest: clientDigest,
      base64: bytesToBase64(bytes),
    },
  }
}

function orderedQuestionEntries(state: SmartQuestionsState): [string, SmartQuestion][] {
  const questions = state.questions ?? {}
  const orderedIds = state.question_order ?? []
  const seen = new Set<string>()
  const entries: [string, SmartQuestion][] = []
  for (const id of orderedIds) {
    const question = questions[id]
    if (question === undefined || seen.has(id)) continue
    entries.push([id, question])
    seen.add(id)
  }
  for (const entry of Object.entries(questions)) {
    if (seen.has(entry[0])) continue
    entries.push(entry)
  }
  return entries
}

function selections(question: SmartQuestion): ISelection[] {
  return (question.choices ?? []).map((choice, index) => ({
    index,
    label: choice.label,
    value: choice.value,
  }))
}

function selectedItem(options: ISelection[], value: string): { selected_index: number; selected_value: string } {
  const option = options.find((candidate) => candidate.value === value)
  return {
    selected_index: option?.index ?? -1,
    selected_value: option?.value ?? '',
  }
}

/** Translate canonical question state to the native-panel data model. */
export function stateQuestionToPanel(id: string, question: SmartQuestion): IQuestionType {
  const options = selections(question)
  const answerValue = question.answer ?? ''
  const detail = question.detail ?? ''
  const isAnswered = standardQuestionAnswered({
    id,
    prompt: question.prompt,
    kind: question.kind ?? 'single',
    answer: answerValue,
    detail,
    // Context alone is not a response. Agents can preserve context/provenance in
    // detail, but must not make a new unanswered card look answered by doing so.
    answered: answerValue.trim() !== '' || (question.multimodal_answer?.length ?? 0) > 0,
  })
  const recommended = (question.choices ?? [])
    .map((choice, index) => ({ choice, index }))
    .filter(({ choice }) => choice.recommended === true)
    .map(({ choice, index }): ISingleChoiceSuggest => ({
      selected_index: index,
      selected_value: choice.value,
    }))

  let type: IQuestionType['type']
  let answer: IQuestionAnswer
  let suggest: IQuestionType['suggest']
  switch (question.kind ?? 'single') {
    case 'multiple': {
      type = 'multiple_choice'
      const values = answerValue.split(',').map((value) => value.trim()).filter((value) => value !== '')
      answer = values.map((value) => selectedItem(options, value)).filter((item) => item.selected_value !== '')
      suggest = recommended
      break
    }
    case 'text':
      type = 'text_input'
      answer = { text: answerValue }
      suggest = null
      break
    case 'single':
      type = 'single_choice'
      answer = selectedItem(options, answerValue)
      suggest = recommended[0] ?? null
      break
  }

  return {
    question_id: id,
    type,
    question: question.prompt,
    is_answer: isAnswered,
    generate_epoch: question.round ?? 0,
    suggest,
    answer,
    selections: options,
    supplement: detail,
    multimodal_answer: question.multimodal_answer,
    rejected: question.rejected,
  }
}

function stateToPanel(state: SmartQuestionsState, title: string): ISmartQuestionsPanel {
  return {
    panel_id: PANEL_ID,
    title,
    questions: orderedQuestionEntries(state).map(([id, question]) => stateQuestionToPanel(id, question)),
  }
}

function answerToValue(question: IQuestionType): string {
  switch (question.type) {
    case 'text_input':
      return question.answer !== null && !Array.isArray(question.answer)
        && typeof question.answer === 'object' && 'text' in question.answer
        ? question.answer.text
        : ''
    case 'multiple_choice':
      return Array.isArray(question.answer)
        ? question.answer.map((item) => item.selected_value).filter((value) => value !== '').join(',')
        : ''
    case 'single_choice':
      return question.answer !== null && !Array.isArray(question.answer)
        && typeof question.answer === 'object' && 'selected_value' in question.answer
        ? question.answer.selected_value
        : ''
  }
}

/** Merge native-panel edits back into the complete canonical question state. */
export function panelToState(panel: ISmartQuestionsPanel, base: SmartQuestionsState): SmartQuestionsState {
  const questions: Record<string, SmartQuestion> = {}
  for (const question of panel.questions) {
    const previous = base.questions?.[question.question_id]
    const recommendedValues = new Set(
      Array.isArray(question.suggest)
        ? question.suggest.map((item) => item.selected_value)
        : question.suggest === null ? [] : [question.suggest.selected_value],
    )
    const next: SmartQuestion = {
      ...previous,
      prompt: question.question,
      kind: question.type === 'single_choice'
        ? 'single'
        : question.type === 'multiple_choice' ? 'multiple' : 'text',
      choices: question.type === 'text_input'
        ? undefined
        : question.selections.map((selection) => ({
            value: selection.value,
            label: selection.label,
            recommended: recommendedValues.has(selection.value),
          })),
      answer: answerToValue(question),
      detail: question.supplement,
      multimodal_answer: question.multimodal_answer ?? previous?.multimodal_answer,
    }
    if (question.question_id.startsWith('const_')) {
      delete next.round
      delete next.rejected
    } else {
      next.round = question.generate_epoch
      next.rejected = question.rejected === true
    }
    questions[question.question_id] = next
  }
  const state = mergeSmartQuestionUpdates(base, questions)
  delete state.question_order
  return state
}

/** The strict-port smart_questions panel bound to the dsh draft. */
export function SmartQuestionsPanel(props: PanelProps): ReactElement {
  const t = useLang()
  const state = (isRecord(props.draft) ? props.draft : {}) as SmartQuestionsState
  const stateRef = useRef(state)
  stateRef.current = state
  const batches = useMemo(() => deriveSmartQuestionBatches(state), [state])
  const latest = batches[0]?.id ?? null
  const previousLatestRef = useRef<number | null>(latest)
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(latest)
  useEffect(() => {
    const next = reconcileSmartQuestionBatchSelection({
      selected: selectedBatchId,
      previousLatest: previousLatestRef.current,
      batches,
    })
    previousLatestRef.current = latest
    if (next !== selectedBatchId) setSelectedBatchId(next)
  }, [batches, latest, selectedBatchId])

  const selectedBatch = batches.find((batch) => batch.id === selectedBatchId) ?? batches[0]
  const selectedQuestionIds = new Set(selectedBatch?.questionIds ?? [])
  const selectedState = useMemo((): SmartQuestionsState => ({
    ...state,
    questions: Object.fromEntries(Object.entries(state.questions ?? {}).filter(([id]) =>
      selectedQuestionIds.has(id))),
  }), [state, selectedQuestionIds])
  const panel = useMemo(() => stateToPanel(selectedState, t.intelligent_questioning), [selectedState, t])
  const isLatest = selectedBatch !== undefined && selectedBatch.id === latest
  const isZh = currentLanguage() === 'zh_CN'
  const updateImages = useCallback((questionId: string, images: readonly SmartQuestionImageAnswer[]): void => {
    const current = stateRef.current
    const question = current.questions?.[questionId]
    if (question === undefined) return
    const retained = new Set(images.map((image) => `${image.file_md5}/${image.filename}`))
    const pending = (current.pending_multimodal_uploads ?? []).filter((upload) =>
      upload.question_id !== questionId || retained.has(`${upload.client_digest}/${upload.filename}`))
    const next: SmartQuestionsState = {
      ...current,
      questions: { ...current.questions, [questionId]: { ...question, multimodal_answer: [...images] } },
      ...(pending.length === 0 ? {} : { pending_multimodal_uploads: pending }),
    }
    if (pending.length === 0) delete next.pending_multimodal_uploads
    stateRef.current = next
    props.onChange(next)
  }, [props])
  const uploadImages = useCallback(async (questionId: string, files: readonly File[]): Promise<void> => {
    const current = stateRef.current
    const question = current.questions?.[questionId]
    if (question === undefined) throw new Error('问题已不存在，请刷新后重试')
    const additions = await Promise.all(files.map(async (file) => pendingUpload(questionId, file)))
    const existing = question.multimodal_answer ?? []
    const mergedRefs = [...existing, ...additions.map((entry) => entry.ref)].filter((image, index, images) =>
      images.findIndex((candidate) => candidate.file_md5 === image.file_md5 && candidate.filename === image.filename) === index)
    const mergedPending = [...(current.pending_multimodal_uploads ?? []), ...additions.map((entry) => entry.upload)].filter((upload, index, uploads) =>
      uploads.findIndex((candidate) => candidate.question_id === upload.question_id
        && candidate.client_digest === upload.client_digest && candidate.filename === upload.filename) === index)
    const next: SmartQuestionsState = {
      ...current,
      questions: { ...current.questions, [questionId]: { ...question, multimodal_answer: mergedRefs } },
      pending_multimodal_uploads: mergedPending,
    }
    stateRef.current = next
    props.onChange(next)
  }, [props])
  const resolveImagePreview = useCallback(async (image: SmartQuestionImageAnswer): Promise<string | undefined> => {
    if (!isSmartQuestionPreviewImage(image.mime_type)) return undefined
    const pending = stateRef.current.pending_multimodal_uploads?.find((upload) =>
      upload.client_digest === image.file_md5 && upload.filename === image.filename)
    if (pending !== undefined) return `data:${pending.mime_type};base64,${pending.base64}`
    const result = await props.readBinaryArtifact(image.artifact_file
      ?? legacySmartQuestionImagePath(image.file_md5.toLowerCase(), image.mime_type))
    return result.found ? `data:${result.mediaType};base64,${result.base64}` : undefined
  }, [props.readBinaryArtifact])

  if (selectedBatch === undefined) {
    return (
      <div className='flex h-full min-h-0 items-center justify-center overflow-y-auto px-6 text-sm text-[var(--ds-text-tertiary)]'>
        {isZh ? '暂无待回答的问题。' : 'No question rounds yet.'}
      </div>
    )
  }

  return (
    <NativeDesignPanelFrame autoSaveId='smart-question-round-sidebar'>
      <DesignPanelSidebar
        icon={<MessagesSquare className='size-4 text-[var(--ds-text-7)]' />}
        title={isZh ? '问题轮次' : 'Question rounds'}
      >
        {batches.map((batch) => (
          <BatchButton
            key={batch.id}
            batch={batch}
            current={batch.id === latest}
            selected={batch.id === selectedBatch.id}
            isZh={isZh}
            onSelect={() => { setSelectedBatchId(batch.id) }}
          />
        ))}
      </DesignPanelSidebar>
      <main className='min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-4'>
        <DesignPanelHeader variant='workspace' className='sticky top-0 z-10 -mx-4 mb-3 items-start border-[var(--ds-divider-default)] bg-white py-3'>
          <div className='min-w-0'>
            <div className='flex items-center gap-2'>
              <DesignPanelTitle>{roundLabel(selectedBatch, isZh)}</DesignPanelTitle>
              {isLatest ? <span className='rounded-full bg-[var(--ds-brand-2)] px-2 py-0.5 text-xs text-[var(--ds-brand-8)]'>{isZh ? '当前' : 'Current'}</span> : null}
            </div>
            <p className='mt-1 truncate text-xs text-[var(--ds-text-tertiary)]' title={selectedBatch.title}>{selectedBatch.title}</p>
          </div>
          <BatchStatus batch={selectedBatch} isZh={isZh} />
        </DesignPanelHeader>
        {isLatest
          ? (
            <AIQuestion
              key={selectedBatch.id}
              panel={panel}
              disabled={props.running === true}
              defaultCollapsed={false}
              collapseOnSaved={props.running === true}
              flushTop
              onMultimodalAnswerChange={updateImages}
              onUploadFiles={uploadImages}
              resolveImagePreview={resolveImagePreview}
              onChange={(next) => { props.onChange(panelToState(next, state)) }}
            />
          )
          : <ReadOnlyQuestionBatch batch={selectedBatch} state={state} isZh={isZh} resolveImagePreview={resolveImagePreview} />}
      </main>
    </NativeDesignPanelFrame>
  )
}

function ReadOnlyQuestionBatch(props: {
  batch: SmartQuestionBatch
  state: SmartQuestionsState
  isZh: boolean
  resolveImagePreview: (image: SmartQuestionImageAnswer) => Promise<string | undefined>
}): ReactElement {
  const questions: StandardQuestionItem[] = props.batch.questionIds.flatMap((id) => {
    const question = props.state.questions?.[id]
    if (question === undefined) return []
    return [{
      id,
      prompt: question.prompt,
      kind: question.kind ?? 'single',
      choices: question.choices,
      answer: question.answer ?? '',
      detail: question.detail,
      answered: (question.answer?.trim() ?? '') !== ''
        || (question.detail?.trim() ?? '') !== ''
        || (question.multimodal_answer?.length ?? 0) > 0,
    }]
  })
  return (
    <div data-testid='smart-question-read-only-batch'>
      <StandardQuestionList
        questions={questions}
        editable={false}
        labels={{ unanswered: props.isZh ? '未回答' : 'Unanswered', detail: props.isZh ? '补充说明' : 'Additional context' }}
        renderActions={(item) => props.state.questions?.[item.id]?.rejected === true
          ? <span className='shrink-0 rounded-full bg-[var(--ds-error-light-bg-default)] px-2 py-0.5 text-xs text-[var(--ds-error-text-primary)]'>{props.isZh ? '已拒绝' : 'Rejected'}</span>
          : null}
        renderAccessory={(item) => {
          const images = props.state.questions?.[item.id]?.multimodal_answer ?? []
          return images.length > 0
            ? <div className='mb-2' data-testid='smart-question-read-only-attachments'><QuestionImageAttachments images={images} resolvePreview={props.resolveImagePreview} /></div>
            : null
        }}
      />
    </div>
  )
}

function roundLabel(batch: SmartQuestionBatch, isZh: boolean): string {
  return isZh ? `第 ${batch.labelNumber} 轮` : `Round ${batch.labelNumber}`
}

function BatchStatus({ batch, isZh }: { batch: SmartQuestionBatch; isZh: boolean }): ReactElement {
  return (
    <span className={`shrink-0 rounded-full px-2 py-1 text-xs ${batch.complete
      ? 'bg-[var(--ds-success-light-bg-default)] text-[var(--ds-success-text-primary)]'
      : 'bg-[var(--ds-warning-light-bg-default)] text-[var(--ds-warning-text-primary)]'}`}>
      {batch.complete
        ? (isZh ? '已完成' : 'Complete')
        : `${batch.answeredCount}/${batch.questionCount} ${isZh ? '已回答' : 'answered'}`}
    </span>
  )
}

function BatchButton(props: {
  batch: SmartQuestionBatch
  current: boolean
  selected: boolean
  isZh: boolean
  onSelect: () => void
}): ReactElement {
  return (
    <DesignPanelNavItem
      selected={props.selected}
      className='block'
      onClick={props.onSelect}
    >
      <span className='flex items-center justify-between gap-2'>
        <strong className='text-sm font-medium text-[var(--ds-text-primary)]'>{roundLabel(props.batch, props.isZh)}</strong>
        {props.current ? <span className='text-[11px] text-[var(--ds-brand-8)]'>{props.isZh ? '当前' : 'Current'}</span> : null}
      </span>
      <span className='mt-1 block truncate text-xs text-[var(--ds-text-tertiary)]' title={props.batch.title}>{props.batch.title}</span>
      <span className='mt-1 flex items-center justify-between text-[11px] text-[var(--ds-text-secondary)]'>
        <span>{props.batch.questionCount} {props.isZh ? '题' : 'questions'}</span>
        <span>{props.batch.complete ? (props.isZh ? '已完成' : 'Complete') : `${props.batch.answeredCount}/${props.batch.questionCount}`}</span>
      </span>
    </DesignPanelNavItem>
  )
}

export default SmartQuestionsPanel
