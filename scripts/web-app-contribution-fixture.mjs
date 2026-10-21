/** Deterministic official Web App Bundle contributions for built acceptance smokes. */
import {
  DesignBundleContributionRegistry,
  deriveDesignBundleAuthorityId,
} from '../packages/core/lib/index.js'
import {
  WEB_APP_KIT_SOURCE_ID,
  createWebAppBundleContributions,
} from '../packages/provider-web-app/lib/index.js'

export const TEST_ARTIFACT_INPUT_LIMITS = Object.freeze({
  maxFileCount: 256,
  maxPathBytes: 1024,
  maxFileBytes: 1_048_576,
  maxTotalBytes: 8_388_608,
})

export const TEST_ARTIFACT_PUBLICATION_LIMITS = Object.freeze({
  maxArtifactCount: 16,
  maxTextBytes: 4_194_304,
  maxBinaryBytes: 16_777_216,
  maxTotalBytes: 25_165_824,
})

export const WEB_APP_BUNDLE_CONTRIBUTIONS = createWebAppBundleContributions()

export const WEB_APP_CONTRIBUTION_REGISTRY = new DesignBundleContributionRegistry()
for (const contribution of WEB_APP_BUNDLE_CONTRIBUTIONS) {
  WEB_APP_CONTRIBUTION_REGISTRY.registerBundleContribution(contribution)
}

export function webAppBundleAuthority(bundle) {
  return deriveDesignBundleAuthorityId(WEB_APP_KIT_SOURCE_ID, bundle)
}
