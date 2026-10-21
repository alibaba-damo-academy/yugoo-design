/** Native-panel presentation contributions for the official Web App Bundles. */
import type { Context } from '@deepseek-ai/cordis'
import { fileURLToPath } from 'node:url'
import { attachPackagedCssAssetRoutes } from '../../../scripts/css-asset-host.mjs'
import DesignService, {
  DesignDriverId,
  deriveDesignBundleAuthorityId,
  type DesignBundleContribution,
  type DesignBundleAuthorityId,
} from 'dsh-design-core'

/** Stable presentation identities referenced by Web App Bundle manifests. */
export const WEB_APP_DRIVER_IDS = Object.freeze({
  smartQuestions: DesignDriverId('io.deepseek.design.web-app.smart-questions/v1'),
  research: DesignDriverId('io.deepseek.design.web-app.research/v1'),
  functionModules: DesignDriverId('io.deepseek.design.web-app.function-modules/v2'),
  legacyFunctionModules: DesignDriverId('io.deepseek.design.web-app.function-modules/v1'),
  flowDesign: DesignDriverId('io.deepseek.design.web-app.flow-design/v1'),
  designStyle: DesignDriverId('io.deepseek.design.web-app.design-style/v1'),
  businessData: DesignDriverId('io.deepseek.design.web-app.business-data/v1'),
  businessRules: DesignDriverId('io.deepseek.design.web-app.business-rules/v1'),
  roleAccess: DesignDriverId('io.deepseek.design.web-app.role-access/v1'),
  integrationDesign: DesignDriverId('io.deepseek.design.web-app.integration-design/v1'),
  notificationDesign: DesignDriverId('io.deepseek.design.web-app.notification-design/v1'),
  qualityAcceptance: DesignDriverId('io.deepseek.design.web-app.quality-acceptance/v1'),
  pageDesign: DesignDriverId('io.deepseek.design.web-app.page-design/v1'),
  webAppPrdAssembly: DesignDriverId('io.deepseek.design.web-app.web-app-prd-assembly/v1'),
  whiteboard: DesignDriverId('io.deepseek.design.web-app.whiteboard/v1'),
})

/** Deployment-owned source identity used by the package Kit loader. */
export const WEB_APP_KIT_SOURCE_ID = 'package:dsh-design-skills-web-app'
const QUESTION_ROUND_CAPABILITY = DesignDriverId('io.deepseek.design.capability.question-round/v1')

function webAppBundleAuthority(bundle: string): DesignBundleAuthorityId {
  return deriveDesignBundleAuthorityId(WEB_APP_KIT_SOURCE_ID, bundle)
}

const presentations = Object.freeze([
  ['smart_questions', WEB_APP_DRIVER_IDS.smartQuestions],
  ['research', WEB_APP_DRIVER_IDS.research],
  ['function_modules', WEB_APP_DRIVER_IDS.functionModules],
  ['function_modules', WEB_APP_DRIVER_IDS.legacyFunctionModules],
  ['flow_design', WEB_APP_DRIVER_IDS.flowDesign],
  ['design_style', WEB_APP_DRIVER_IDS.designStyle],
  ['business_data', WEB_APP_DRIVER_IDS.businessData],
  ['business_rules', WEB_APP_DRIVER_IDS.businessRules],
  ['role_access', WEB_APP_DRIVER_IDS.roleAccess],
  ['integration_design', WEB_APP_DRIVER_IDS.integrationDesign],
  ['notification_design', WEB_APP_DRIVER_IDS.notificationDesign],
  ['quality_acceptance', WEB_APP_DRIVER_IDS.qualityAcceptance],
  ['page_design', WEB_APP_DRIVER_IDS.pageDesign],
  ['web_app_prd_assembly', WEB_APP_DRIVER_IDS.webAppPrdAssembly],
  ['whiteboard', WEB_APP_DRIVER_IDS.whiteboard],
] as const)

/** Construct one presentation-only contribution per official Web App Bundle. */
export function createWebAppBundleContributions(): readonly DesignBundleContribution[] {
  return Object.freeze(presentations.map(([bundle, presentation]) => Object.freeze({
    authority: webAppBundleAuthority(bundle),
    ...(bundle === 'smart_questions' ? { capabilities: Object.freeze([QUESTION_ROUND_CAPABILITY]) } : {}),
    presentation,
  })))
}

export const name = 'dsh-design-provider-web-app'
export const inject = ['design']
export type Config = Record<string, never>

/** Register native presentation contributions; Bundle logic stays in the Kit. */
export async function apply(ctx: Context, _config: Config = {}): Promise<void> {
  attachPackagedCssAssetRoutes(ctx, fileURLToPath(new URL('.', import.meta.url)), [
    '/design-system-assets/dsh-design-provider-web-app-client/',
  ])
  const design = (ctx as unknown as { design: DesignService }).design
  for (const contribution of createWebAppBundleContributions()) {
    ctx.effect(() => design.registerBundleContribution(contribution))
  }
}
