/** DSH host composition for the private embedded Ladybug knowledge provider. */
import type { Context } from '@deepseek-ai/cordis'
import {
  DesignKnowledgeManager,
  DesignKnowledgeProviderId,
  restoreDesignKnowledgeRecords,
  saveDesignKnowledgeRecords,
  readDesignKnowledgePublication,
  commitDesignProjectRecords,
  type DesignKnowledgeProjectLocation,
} from 'dsh-design-core'
import { resolve } from 'node:path'
import type DesignService from 'dsh-design-core'
import { resolveLadybugKnowledgeConfig, type LadybugKnowledgeConfigInput } from './config.ts'
import { LadybugDesignKnowledgeProvider, type LadybugRecoveryState } from './provider.ts'
import { DesignSemanticIndex, type EmbeddingConfig } from './semantic-index.ts'

export const name = 'dsh-design-knowledge-ladybug'
export const inject = ['design']

/** Stable provider id persisted in Design Project metadata by this composition. */
export const LADYBUG_WASM_PROVIDER_ID = DesignKnowledgeProviderId('ladybug-wasm')

/** Deployment tunables for the embedded provider; project state owns each database root. */
export type Config = Omit<LadybugKnowledgeConfigInput, 'databaseRoot'> & { embedding?: EmbeddingConfig }

function projectConfig(location: DesignKnowledgeProjectLocation, config: Config): LadybugKnowledgeConfigInput {
  if (location.provider !== LADYBUG_WASM_PROVIDER_ID) {
    throw new Error(`Ladybug Design Knowledge host cannot open provider ${JSON.stringify(location.provider)}`)
  }
  return { ...config, databaseRoot: resolve(location.stateRoot, 'design-knowledge') }
}

function aggregate(primary: unknown, secondary: unknown, message: string): unknown {
  if (primary === undefined) return secondary
  if (secondary === undefined) return primary
  return new AggregateError([primary, secondary], message)
}

/** Install the default embedded provider without exposing its implementation to consumers. */
export function apply(ctx: Context, config: Config = {}): void {
  const { embedding, ...databaseConfig } = config
  const semantic = new DesignSemanticIndex(embedding)
  const providers = new Map<string, LadybugDesignKnowledgeProvider>()
  const recoveryStates = new Map<string, LadybugRecoveryState>()
  const retries = new Set<string>()
  const design = (ctx as Context & { readonly design: DesignService }).design
  const validated = resolveLadybugKnowledgeConfig({ ...databaseConfig, databaseRoot: resolve('.') })
  const { databaseRoot: _validationRoot, ...providerConfig } = validated
  const manager = new DesignKnowledgeManager({
    open: async (location) => {
      const provider = await LadybugDesignKnowledgeProvider.open(location.projectId, projectConfig(location, providerConfig), {
        retryFailed: retries.delete(location.projectId),
        rebuild: candidate => design.rebuildDerivedKnowledge(location.projectId, candidate),
        onState: state => { recoveryStates.set(location.projectId, state) },
      })
      try {
        await restoreDesignKnowledgeRecords({
          projectRoot: await design.knowledgeProjectRoot(location.projectId),
          projectId: location.projectId, service: provider, cache: provider,
          resetCache: () => provider.resetCache(location.projectId),
        })
      } catch (error) { await provider.close(); throw error }
      providers.set(location.projectId, provider)
      return Object.freeze({
        projectId: location.projectId,
        service: provider,
        close: async () => { await design.releaseKnowledgeIndex(location.projectId); semantic.cancelProject(location.projectId); semantic.cancelProject(location.projectId + ':kag'); providers.delete(location.projectId); await provider.close() },
      })
    },
  })
  const unregister = design.registerDesignKnowledgeRuntime({
    persistProjectRecords: async projectId => {
      const provider = providers.get(projectId)
      if (!provider) throw new Error('Knowledge project cache is not open')
      const projectRoot = await design.knowledgeProjectRoot(projectId)
      await saveDesignKnowledgeRecords({
        projectRoot, projectId, service: provider, cache: provider,
        publication: await readDesignKnowledgePublication(provider),
        persist: paths => commitDesignProjectRecords({ projectRoot, paths, message: 'design(knowledge): save project records' }),
      })
    },
    recoveryStatus: projectId => recoveryStates.get(projectId),
    retryRecovery: projectId => { retries.add(projectId) },
    defaultProvider: LADYBUG_WASM_PROVIDER_ID,
    administration: manager,
    service: manager.service,
    semantic: { identity: semantic.publicationIdentity, publicationCache: projectId => providers.get(projectId), read: async (projectId, graph) => {
      const provider = providers.get(projectId)
      // File-derived similarity must not require a healthy historical Knowledge DB.
      // The index reports bounded volatile caching; it never replaces Knowledge facts.
      return semantic.read(projectId, graph, provider)
    }, ...(semantic.config.provider === 'disabled' ? {} : { compute: async (projectId: string, graph: Parameters<DesignSemanticIndex['compute']>[1], signal?: AbortSignal) =>
      semantic.compute(projectId + ':kag', graph, providers.get(projectId), signal) }) },
  })
  ctx.effect(() => async () => {
    let failure: unknown
    await semantic.close()
    try {
      await unregister()
    } catch (error) {
      failure = error
    }
    try {
      await manager.shutdown()
    } catch (error) {
      failure = aggregate(failure, error, 'Ladybug Design Knowledge host disposal failed')
    }
    if (failure !== undefined) throw failure
  })
}
