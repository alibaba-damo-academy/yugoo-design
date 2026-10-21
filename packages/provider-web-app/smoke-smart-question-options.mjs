#!/usr/bin/env node
/** Smart Question choice rows keep visible states and working radio input. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const { register } = await import('tsx/esm/api')
register()

const { JSDOM } = await import('jsdom')
const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'https://panel.test/',
})
const { window } = dom
for (const key of [
  'window', 'document', 'navigator', 'HTMLElement', 'HTMLButtonElement', 'HTMLFormElement',
  'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame',
  'cancelAnimationFrame', 'MutationObserver', 'CustomEvent',
]) {
  if (globalThis[key] === undefined) globalThis[key] = window[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

const React = await import('react')
globalThis.React = React
const { createRoot } = await import('react-dom/client')
const { AIQuestionRadio } = await import('./src/client/ported/design/AIQuestion/AIQuestionRadio.tsx')
const { AIQuestionText } = await import('./src/client/ported/design/AIQuestion/AIQuestionText.tsx')
const { AIQuestion } = await import('./src/client/ported/design/AIQuestion/AIQuestion.tsx')
const { QuestionImageAttachments } = await import('./src/client/ported/design/AIQuestion/QuestionImageAttachments.tsx')
const { panelToState, stateQuestionToPanel } = await import('./src/client/panels/smart-questions.tsx')
const { act } = React
const emissions = []

function Harness({ disabled = false }) {
  const [selected, setSelected] = React.useState('')
  return React.createElement(AIQuestionRadio, {
    question: 'Pick one',
    options: [
      { index: 0, value: 'first', label: 'First' },
      { index: 1, value: 'second', label: 'Second' },
    ],
    selectedOption: {
      selected_index: selected === 'first' ? 0 : selected === 'second' ? 1 : -1,
      selected_value: selected,
    },
    disabled,
    is_answer: false,
    supplement: '',
    onReject: () => {},
    onChange: (value) => {
      emissions.push(value)
      setSelected(value)
    },
  })
}

const container = window.document.getElementById('root')
const root = createRoot(container)
await act(async () => { root.render(React.createElement(Harness)) })

const radios = [...container.querySelectorAll('[role="radio"]')]
assert.equal(radios.length, 2, 'the radio choices render as accessible controls')
await act(async () => {
  radios[1].dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
assert.deepEqual(emissions, ['second'], 'clicking the radio control changes the controlled value once')
assert.equal(radios[1].getAttribute('data-state'), 'checked', 'the selected radio state is rendered')
assert.ok(radios[1].closest('.question-option-frame')?.classList.contains('is-selected'), 'the selected row has the shared selected frame')

const firstRow = radios[0].closest('.question-option-frame')
assert.ok(firstRow !== null, 'each radio belongs to the shared option frame')
await act(async () => {
  firstRow.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
assert.deepEqual(emissions, ['second', 'first'], 'clicking the option row also changes the controlled value')

await act(async () => { root.render(React.createElement(Harness, { disabled: true, key: 'disabled' })) })
const disabledRadio = container.querySelectorAll('[role="radio"]')[1]
await act(async () => {
  disabledRadio.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
assert.deepEqual(emissions, ['second', 'first'], 'disabled radio controls cannot change the value')
assert.ok(disabledRadio.closest('.question-option-frame')?.classList.contains('is-disabled'), 'disabled rows expose their frame state')

const imageAnswer = {
  type: 'image',
  file_md5: '0123456789abcdef0123456789abcdef',
  filename: 'reference.webp',
  mime_type: 'image/webp',
  size_bytes: 2048,
}
const canonicalQuestion = {
  prompt: 'Attach a visual reference', kind: 'text', answer: '', detail: '',
  multimodal_answer: [imageAnswer], round: 0, rejected: false,
}
const panelQuestion = stateQuestionToPanel('visual_reference', canonicalQuestion)

// Source-supported reconstruction answers belong in the visible input;
// provenance and genuinely unknown intent must not be promoted as answers.
for (const answer of ['Chinese and English', '']) {
  const reconstructed = {
    prompt: answer ? 'Which languages are supported?' : 'What is the commercial positioning?',
    kind: 'text', answer,
    detail: answer ? 'Observed in globalLanguage.ts; translation coverage unknown.' : 'Unknown: implementation does not establish commercial intent.',
    round: 0, rejected: false,
  }
  const mapped = stateQuestionToPanel('source_fact', reconstructed)
  assert.deepEqual(mapped.answer, { text: answer })
  assert.equal(mapped.supplement, reconstructed.detail)
  await act(async () => {
    root.render(React.createElement(AIQuestionText, {
      key: `reconstruction-${answer}`, question: mapped.question, answer: mapped.answer,
      supplement: mapped.supplement,
      disabled: false, defaultCollapsed: false, is_answer: mapped.is_answer,
    }))
  })
  if (answer) assert.ok(container.textContent.includes(answer), 'source answer is visible in the card')
  assert.ok(container.querySelector('[data-testid="question-text-supplement"]')?.textContent.includes(reconstructed.detail), 'provenance remains visible separately from the answer')
  await act(async () => {
    container.querySelector('[data-tip-id="tip_qa_edit_answer"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
  })
  assert.equal(container.querySelector('textarea')?.value, answer)
  assert.equal(container.querySelectorAll('textarea').length, 1, 'a text question has one editable text area')
  assert.ok(container.querySelector('[data-testid="question-text-supplement"]')?.textContent.includes(reconstructed.detail), 'legacy detail stays visible as read-only context while editing')
  const saved = panelToState({ panel_id: 'smart_questions', questions: [mapped] }, { questions: { source_fact: reconstructed } }).questions.source_fact
  assert.equal(saved.answer, answer)
  assert.equal(saved.detail, reconstructed.detail)
}

// Exercise the real parent wiring, edits, persistence mapping and disabled state.
const detailOnly = { prompt: 'Who is this for?', kind: 'text', answer: '', detail: 'Source documents do not establish the audience.', round: 0 }
assert.equal(stateQuestionToPanel('audience', detailOnly).is_answer, false,
  'Agent context must not mark a question answered')
assert.equal(stateQuestionToPanel('scope', { ...detailOnly, kind: 'single', choices: [
  { value: 'personal', label: 'Personal' }, { value: 'team', label: 'Team' },
] }).is_answer, false, 'supplement-only choices remain unanswered')
let editedPanel
function TextPanelHarness({ disabled = false }) {
  const [panel, setPanel] = React.useState({ panel_id: 'smart_questions', questions: [stateQuestionToPanel('audience', detailOnly)] })
  return React.createElement(AIQuestion, { panel, disabled, defaultCollapsed: false, onChange: value => { editedPanel = value; setPanel(value) } })
}
await act(async () => { root.render(React.createElement(TextPanelHarness, { key: 'text-detail' })) })
assert.ok(container.textContent.includes(detailOnly.detail), 'detail-only legacy records are visible through the full panel')
// An unanswered card opens for input instead of requiring an answered-card edit action.
const answerInput = container.querySelector('textarea')
assert.equal(container.querySelectorAll('textarea').length, 1, 'detail-only text questions still have one editable text area')
assert.ok(container.querySelector('[data-testid="question-text-supplement"]')?.textContent.includes(detailOnly.detail))
await act(async () => {
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(answerInput, 'Individual researchers')
  answerInput.dispatchEvent(new window.Event('input', { bubbles: true }))
})
assert.equal(editedPanel.questions[0].supplement, detailOnly.detail)
const savedText = panelToState(editedPanel, { questions: { audience: detailOnly } }).questions.audience
assert.equal(savedText.answer, 'Individual researchers')
assert.equal(savedText.detail, detailOnly.detail, 'editing the answer preserves legacy detail')
await act(async () => { root.render(React.createElement(TextPanelHarness, { key: 'text-detail', disabled: true })) })
assert.ok(container.textContent.includes(savedText.detail), 'saved/disabled collapsed card still displays its supplement')
assert.equal(container.querySelector('textarea'), null, 'disabled transition closes the editor')
assert.equal(panelQuestion.is_answer, true, 'an image-only response counts as an answered question')
assert.deepEqual(panelQuestion.multimodal_answer, [imageAnswer], 'canonical image references reach the native-panel data model')
assert.deepEqual(
  panelToState({ panel_id: 'smart_questions', questions: [panelQuestion] }, { questions: { visual_reference: canonicalQuestion } })
    .questions.visual_reference.multimodal_answer,
  [imageAnswer],
  'a native-panel round trip preserves image references',
)

await act(async () => {
  root.render(React.createElement(AIQuestionText, {
    key: 'image-answer', question: canonicalQuestion.prompt, answer: { text: '' },
    multimodalAnswer: [imageAnswer], disabled: false, defaultCollapsed: true, is_answer: true,
  }))
})
assert.equal(container.querySelector('[data-testid="question-answer-attachments"]')?.textContent, 'reference.webp', 'image-only answers remain visible in the native panel')

let removedImages
await act(async () => {
  root.render(React.createElement(QuestionImageAttachments, {
    images: [imageAnswer],
    editable: true,
    onUploadFiles: async () => {},
    onChange: (images) => { removedImages = images },
    resolvePreview: async () => 'data:image/webp;base64,UklGRgAAAABXRUJQ',
  }))
})
await act(async () => { await Promise.resolve() })
assert.ok(container.querySelector('input[type="file"]:not([accept])'), 'the answer editor exposes an unrestricted local file input')
assert.ok(container.querySelector('button[aria-label="添加附件"]'), 'the attachment trigger is a compact icon button')
assert.equal(container.querySelector('img')?.getAttribute('src'), 'data:image/webp;base64,UklGRgAAAABXRUJQ', 'persisted local artifacts hydrate as image previews')
await act(async () => {
  container.querySelector('button[aria-label^="移除附件"]')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }))
})
assert.deepEqual(removedImages, [], 'the image remove control updates the canonical answer reference list')

await act(async () => {
  root.render(React.createElement(AIQuestionText, {
    key: 'inline-attachment-trigger', question: 'Describe the requirement', answer: { text: '' },
    multimodalAnswer: [], disabled: false, defaultCollapsed: false, is_answer: false,
    onUploadFiles: async () => {},
  }))
})
const inlineTextarea = container.querySelector('textarea')
const inlineAttachmentButton = container.querySelector('button[aria-label="添加附件"]')
assert.ok(inlineTextarea instanceof HTMLElement && inlineAttachmentButton instanceof HTMLElement)
assert.equal(inlineTextarea.parentElement?.parentElement, inlineAttachmentButton.parentElement, 'the answer control and compact attachment button share the final row')

const css = await readFile(new URL('./src/client/generated/design.tw.css', import.meta.url), 'utf8')
assert.match(css, /\.question-option-frame\{[^}]*border:[^}]*var\(--ds-line-3\)/, 'default choice frames use the visible DS line token')
assert.match(css, /\.question-option-frame\.is-selected\{[^}]*var\(--ds-brand-bg-default\)[^}]*var\(--ds-brand-light-bg-default\)/, 'selected choice frames use brand DS tokens')
assert.match(css, /\.question-option-frame\.is-disabled\{[^}]*var\(--ds-line-2\)[^}]*var\(--ds-fill-2\)/, 'disabled choice frames remain legible')

for (const file of ['AIQuestionMultiple.tsx', 'AIQuestionRadioConst.tsx', 'AIQuestionMultipleConst.tsx']) {
  const source = await readFile(new URL(`./src/client/ported/design/AIQuestion/${file}`, import.meta.url), 'utf8')
  assert.match(source, /question-option-frame/, `${file} must reuse the shared choice frame`)
  assert.match(source, /is-selected/, `${file} must expose its selected row state`)
}

await act(async () => { root.unmount() })
console.log('SMART QUESTION OPTION FRAMES OK')
