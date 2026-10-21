import React, { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { DesignWorkspace, type DesignRuntime } from '../../panel/src/client/workspace.tsx'
import type { NativePanelDefinition, NativePanelRegistry } from '../../panel/src/client/native-panel-registry.ts'
import { DOCK_CSS } from '../../panel/src/client/styles.ts'
import { SmartQuestionsPanel } from '../src/client/panels/smart-questions.tsx'

const root = document.getElementById('root')
if (root === null) throw new Error('fixture root is missing')

const smartQuestions = {
  skill_name: 'smart_questions',
  questions: {
    audience: {
      prompt: '这款产品主要面向哪类用户？',
      kind: 'single',
      choices: [
        { value: 'individual', label: '个人用户', recommended: true },
        { value: 'team', label: '团队用户' },
      ],
      answer: 'individual',
      round: 2,
    },
    scenario: {
      prompt: '最重要的使用场景是什么？',
      kind: 'text',
      answer: '',
      round: 1,
    },
    const_login: {
      prompt: '是否需要登录？',
      kind: 'single',
      choices: [
        { value: 'yes', label: '需要', recommended: true },
        { value: 'no', label: '不需要' },
      ],
      answer: 'yes',
    },
  },
  question_order: ['scenario', 'audience', 'const_login'],
}

const definitions = new Map<string, NativePanelDefinition>([
  ['fixture/dummy', {
    id: 'fixture/dummy',
    scrollOwner: 'workspace',
    render: () => <div data-testid='dummy-panel'>Dummy panel</div>,
  }],
  ['fixture/smart-questions', {
    id: 'fixture/smart-questions',
    scrollOwner: 'panel',
    render: props => (
      <SmartQuestionsPanel
        draft={props.draft}
        running={props.running}
        originalState={props.originalState}
        onChange={props.onChange}
        readBinaryArtifact={props.readBinaryArtifact}
      />
    ),
  }],
])

const nativePanels = {
  subscribe: () => () => {},
  revision: () => 0,
  get: (id: string) => definitions.get(id),
} as unknown as NativePanelRegistry

const runtime: DesignRuntime = {
  nativePanels,
  readWorkspace: async () => { throw new Error('fixture does not poll') },
  savePanel: async () => ({}),
  readArtifact: async () => ({ found: false, content: '' }),
  readBinaryArtifact: async () => ({ found: false, mediaType: 'application/pdf', base64: '', byteLength: 0 }),
  sendPrompt: async () => {},
  listSkills: async () => ({ mindsets: [] }),
  decideAdvisory: async () => {},
  listAdvisories: async () => [],
}

const design = {
  dummy: {
    state: {},
    skillManifest: {
      name: 'dummy',
      title: { en: 'Dummy' },
      order: 1,
      presentation: { mode: 'native', renderer: 'fixture/dummy' },
    },
  },
  smart_questions: {
    state: smartQuestions,
    skillManifest: {
      name: 'smart_questions',
      title: { en: 'Smart Questions' },
      order: 2,
      presentation: { mode: 'native', renderer: 'fixture/smart-questions' },
    },
  },
}

createRoot(root).render(
  <StrictMode>
    <style>{DOCK_CSS}</style>
    <div className='dsh-design-root' style={{ width: 1280, height: 700 }}>
      <DesignWorkspace
        design={design}
        projectId='fixture-project'
        access={{ mode: 'writable', writable: true, kit: { name: 'fixture', version: '1.0' } }}
        sessionId='fixture-session'
        runtime={runtime}
        dockOpen
      />
    </div>
  </StrictMode>,
)
