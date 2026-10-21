/** Minimal question/edit contract fixture; no shipped Kit or domain facts. */
export const questionSchema = {
  type: 'object', required: ['schema_version', 'questions', 'question_order'],
  properties: {
    schema_version: { type: 'number', knowledge: { role: 'metadata' } },
    questions: { type: 'map', value: {
      type: 'object', required: ['prompt', 'answer'], properties: {
        prompt: { type: 'string' }, answer: { type: 'string' }, detail: { type: 'string' },
        kind: { type: 'string' },
        choices: { type: 'array', items: { type: 'object', properties: {
          value: { type: 'string' }, label: { type: 'string' },
        } } },
      },
    } },
    question_order: { type: 'array', items: { type: 'string' }, knowledge: { role: 'metadata' } },
  },
}
export const questionState = {
  schema_version: 1,
  questions: {
    purpose: { prompt: 'What should this example record?', answer: 'A saved user response.',
      detail: 'Fixture context remains separate from the answer.', kind: 'text', choices: [] },
    future: { prompt: 'What should happen next?', answer: '',
      detail: 'No later action is authorized by this fixture.', kind: 'text', choices: [] },
  },
  question_order: ['purpose', 'future'],
}
export const questionPanel = {
  version: 1, panel_kind: 'document',
  sections: [{ id: 'questions', title: 'Questions', order: 'question_order' }],
  fields: [
    { key: 'prompt', control: 'textarea', readonly: true, applies_to: ['questions'] },
    { key: 'answer', control: 'textarea', applies_to: ['questions'] },
    { key: 'detail', control: 'textarea', readonly: true, applies_to: ['questions'] },
  ],
  ui: { id: 'questions', component: 'question_workspace', source: 'questions', title: 'Questions',
    sidebar_icon: 'message-circle-question', guidance: 'Review each question and save your answers.' },
}
// JSON is accepted YAML, and keeps this fixture independent of loader/runtime imports.
export const questionSchemaYaml = JSON.stringify(questionSchema)
export const questionPanelYaml = JSON.stringify(questionPanel)
export const questionContext = {
  kit: 'test_catalog', kitVersion: '0.1', bundle: 'questions_fixture', bundleVersion: '0.1',
  schema: questionSchema, state: questionState,
}
export const questionValidation = { skill: 'questions_fixture', rules: [{
  id: 'questions-present', scope: ['completion'], code: 'fixture.questions_empty',
  message: 'The fixture needs at least one question.', check: { non_empty_map: 'questions' },
}] }
export const questionValidationYaml = JSON.stringify(questionValidation)
