/** Trusted native client drivers bundled with the official Web App Kit. */
import type { NativePanelDefinition, NativePanelRegistry } from 'dsh-design-panel/client-api'
import { WEB_APP_DRAFT_COMPARATORS } from './web-app-draft-comparators.ts'
import { SmartQuestionsPanel } from '../panels/smart-questions.tsx'
import { prepareSmartQuestionsPanelSave } from '../panels/smart-question-attachments.ts'
import { FunctionModulesPanel } from '../panels/function-modules.tsx'
import { FlowDesignPanel, prepareFlowDesignPanelSave } from '../panels/flow-design.tsx'
import { ResearchPanel } from '../panels/research.tsx'
import { DesignStylePanel } from '../panels/design-style.tsx'
import { BusinessDataPanel } from '../panels/business-data.tsx'
import { BusinessRulesPanel } from '../panels/business-rules.tsx'
import { RoleAccessPanel } from '../panels/role-access.tsx'
import { IntegrationDesignPanel } from '../panels/integration-design.tsx'
import { NotificationDesignPanel } from '../panels/notification-design.tsx'
import { QualityAcceptancePanel } from '../panels/quality-acceptance.tsx'
import { PageDesignPanel } from '../panels/page-design.tsx'
import { PrdAssemblyPanel } from '../panels/prd-assembly.tsx'
import { WhiteboardPanel } from '../panels/whiteboard.tsx'
import { prepareWhiteboardIndexSave } from '../panels/whiteboard-scene.ts'

const DEFINITIONS: readonly NativePanelDefinition[] = [
  {
    id: 'io.deepseek.design.web-app.whiteboard/v1',
    scrollOwner: 'panel',
    metadata: { artifactBacked: true },
    prepareSave: prepareWhiteboardIndexSave,
    render: props => <WhiteboardPanel {...props} />,
  },
  {
    id: 'io.deepseek.design.web-app.smart-questions/v1',
    scrollOwner: 'panel',
    metadata: { artifactBacked: true, feature: { skill: 'smart_questions', order: 1, labelKey: 'intelligent_questioning', quickPromptKey: 'design_feature_smart_questions_quick_message' } },
    equalsDraft: WEB_APP_DRAFT_COMPARATORS['io.deepseek.design.web-app.smart-questions/v1'],
    prepareSave: prepareSmartQuestionsPanelSave,
    render: (props) => <SmartQuestionsPanel draft={props.draft} onChange={props.onChange} originalState={props.originalState} running={props.running} readBinaryArtifact={props.readBinaryArtifact} />,
  },
  {
    id: 'io.deepseek.design.web-app.function-modules/v1',
    scrollOwner: 'panel',
    metadata: { artifactBacked: true, feature: { skill: 'function_modules', order: 3, labelKey: 'capability_board', quickPromptKey: 'design_feature_function_modules_quick_message' } },
    equalsDraft: WEB_APP_DRAFT_COMPARATORS['io.deepseek.design.web-app.function-modules/v1'],
    render: (props) => <FunctionModulesPanel draft={props.draft} onChange={props.onChange} sendPrompt={props.sendPrompt} running={props.running} />,
  },
  {
    id: 'io.deepseek.design.web-app.function-modules/v2',
    scrollOwner: 'panel',
    metadata: { artifactBacked: true, feature: { skill: 'function_modules', order: 3, labelKey: 'capability_board', quickPromptKey: 'design_feature_function_modules_quick_message' } },
    equalsDraft: WEB_APP_DRAFT_COMPARATORS['io.deepseek.design.web-app.function-modules/v1'],
    render: props => <FunctionModulesPanel draft={props.draft} onChange={props.onChange} sendPrompt={props.sendPrompt} running={props.running} detailsEnabled sourceRevision={props.sourceRevision} readArtifact={props.readArtifact} />,
  },
  {
    id: 'io.deepseek.design.web-app.flow-design/v1',
    scrollOwner: 'panel',
    metadata: { artifactBacked: true, feature: { skill: 'flow_design', order: 4, labelKey: 'flow_design_label', quickPromptKey: 'design_feature_flow_design_quick_message' } },
    equalsDraft: WEB_APP_DRAFT_COMPARATORS['io.deepseek.design.web-app.flow-design/v1'],
    prepareSave: prepareFlowDesignPanelSave,
    render: (props) => <FlowDesignPanel {...props} />,
  },
  {
    id: 'io.deepseek.design.web-app.research/v1',
    scrollOwner: 'panel',
    metadata: {
      artifactBacked: true,
      feature: { skill: 'research', order: 2, labelKey: 'research_analysis', quickPromptKey: 'design_feature_research_quick_message' },
    },
    render: (props) => <ResearchPanel {...props} />,
  },
  {
    id: 'io.deepseek.design.web-app.design-style/v1',
    scrollOwner: 'panel',
    metadata: { artifactBacked: true, feature: { skill: 'design_style', order: 5, labelKey: 'design_style_label', quickPromptKey: 'design_feature_design_style_quick_message' } },
    equalsDraft: WEB_APP_DRAFT_COMPARATORS['io.deepseek.design.web-app.design-style/v1'],
    action: ({ saveAndRegenerate }) => { saveAndRegenerate() },
    render: (props) => <DesignStylePanel {...props} onSaveAndRegenerate={props.onAction} />,
  },
  {
    id: 'io.deepseek.design.web-app.business-data/v1',
    scrollOwner: 'panel',
    render: (props) => <BusinessDataPanel draft={props.draft} onChange={props.onChange} disabled={props.running} />,
  },
  {
    id: 'io.deepseek.design.web-app.business-rules/v1',
    scrollOwner: 'panel',
    render: (props) => <BusinessRulesPanel draft={props.draft} onChange={props.onChange} disabled={props.running} />,
  },
  {
    id: 'io.deepseek.design.web-app.role-access/v1',
    scrollOwner: 'panel',
    render: (props) => <RoleAccessPanel draft={props.draft} onChange={props.onChange} running={props.running} />,
  },
  {
    id: 'io.deepseek.design.web-app.integration-design/v1',
    scrollOwner: 'panel',
    render: (props) => <IntegrationDesignPanel draft={props.draft} onChange={props.onChange} running={props.running} />,
  },
  {
    id: 'io.deepseek.design.web-app.notification-design/v1',
    scrollOwner: 'panel',
    render: (props) => <NotificationDesignPanel draft={props.draft} onChange={props.onChange} running={props.running} />,
  },
  {
    id: 'io.deepseek.design.web-app.quality-acceptance/v1',
    scrollOwner: 'panel',
    render: (props) => <QualityAcceptancePanel draft={props.draft} onChange={props.onChange} running={props.running} />,
  },
  {
    id: 'io.deepseek.design.web-app.page-design/v1',
    scrollOwner: 'panel',
    metadata: {
      artifactBacked: true,
    },
    equalsDraft: WEB_APP_DRAFT_COMPARATORS['io.deepseek.design.web-app.page-design/v1'],
    render: (props) => (
      <PageDesignPanel
        {...props}
      />
    ),
  },
  {
    id: 'io.deepseek.design.web-app.web-app-prd-assembly/v1',
    scrollOwner: 'panel',
    metadata: { artifactBacked: true },
    render: (props) => (
      <PrdAssemblyPanel
        draft={props.draft}
        onChange={props.onChange}
        originalState={props.originalState}
        readArtifact={props.readArtifact}
        readBinaryArtifact={props.readBinaryArtifact}
        onNavigateSkill={props.selectPanel}
        executionAttempts={props.executionAttempts}
      />
    ),
  },
]

/** Register the official Web App Kit's currently active native panels. */
export function registerWebAppNativePanels(registry: NativePanelRegistry): () => void {
  const disposers: Array<() => void> = []
  try {
    for (const definition of DEFINITIONS) disposers.push(registry.register(definition))
  } catch (error) {
    for (const dispose of disposers.reverse()) dispose()
    throw error
  }
  return () => { for (const dispose of disposers.reverse()) dispose() }
}
