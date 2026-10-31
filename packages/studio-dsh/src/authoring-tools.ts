/** Host conversation and Studio use the same guarded working-copy service. */
import type { Context } from '@deepseek-ai/cordis'
import type { WebServer } from '@deepseek-ai/dsh-host-webserver'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { DshStudioAuthoringService } from './authoring-service.ts'
import { STUDIO_AUTHORING_RPC_SCHEMAS as schemas } from './authoring.remote-client.ts'
import { STUDIO_AUTHORING_METHOD_GUIDANCE } from './authoring-material.ts'

const actions = ['catalog', 'list', 'read', 'copy', 'rename', 'readFile', 'prepareChanges', 'saveChanges', 'updateMounts', 'preview'] as const

export function registerStudioCustomizationTool(ctx: Context, service: DshStudioAuthoringService): void {
  ctx.systemPrompt.section({ name: 'studio:customization-methods', order: 550,
    text: `${STUDIO_AUTHORING_METHOD_GUIDANCE} Use studio_customize action read with request {authoring:{}} for the creator index, then request {authoring:{resource,offset}} for an indexed resource, or request {components:{name?,reference?,type?}} for installed component references. Read bound source separately using the existing working-copy id and file list. Packaged methods grant no write, save, publication or installation authority.` })
  ctx.tools.register(defineTool({
    name: 'studio_customize',
    description: 'Customize reusable Kit/Bundle methods and Panels in the SAME working copies shown in Studio. '
      + 'This edits authoring content, not a Design Project. Before editing, use read request {authoring:{}} for creator methods; for Panel changes discover {components:{}} then exact {components:{name,reference:"contract"}} and docs/examples before choosing parameters. catalog.currentKits lists available installed and local Kits for project selection; catalog.kits/bundles inspect installed source pins only, so absence there does not mean a local Kit is unavailable. Use list/read to reopen current local source; '
      + 'copy with kind and an exact kit or bundle {name,version}; readFile for source; rename requires id, expectedRevision and title {zh,en}. Read the current copy before selecting its revision. prepareChanges with id, expectedRevision and complete-file changes '
      + 'to inspect the diff, diagnostics and Panel preview before saving. Preparation never saves. '
      + 'Call saveChanges only when the user explicitly requests saving; pass the same changes, revision and candidate digest, '
      + 'using mode validated for a validated candidate or draft when the user wants to retain incomplete work. '
      + 'Kit mount changes use updateMounts. Saves do not publish, export or change installed content. '
      + 'After a conflict or an uncertain response, read the current working copy before proposing a new save; never blindly retry. '
      + 'request is the existing Studio operation input; it never accepts an agent identity, filesystem root or model configuration.',
    parameters: {
      action: { type: 'string', required: true, enum: [...actions] },
      request: { type: 'object', required: true, properties: {}, additionalProperties: true,
        description: 'Action-specific Studio input. Before authoring, read with {authoring:{}} for creator methods; read a listed resource with {authoring:{resource,offset}} and follow nextOffset. Source read: {id}; readFile: {id,path}. catalog: {query?}; list: {}; copy: {kind:"bundle",bundle:{name:"exact-name",version:"exact-version"}} (or kind:"kit",kit:{name,version}). rename: {id,expectedRevision,title:{zh,en}}. prepareChanges: {id,expectedRevision,changes:[{path,content}],bundle?}; saveChanges also sends mode (validated or draft) and the same candidate digest. preview: {id,expectedRevision,bundle?}. Use the current read receipt for expectedRevision; never guess or omit it on writes.' },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }] },
    async execute(args, exec) {
      const agent = exec.agent
      if (!agent) throw new Error('Studio customization requires the actual calling Agent')
      exec.signal?.throwIfAborted()
      const input = args.request
      let result: unknown
      switch (args.action) {
        case 'catalog': result = await service.catalog(agent, input); break
        case 'list': result = await service.list(agent, schemas.list.request.parse(input)); break
        case 'read':
          if (Object.hasOwn(input, 'components')) {
            if (Object.keys(input).some(key => key !== 'components')) throw new Error('Read component references separately from working-copy source')
            result = await service.readPanelComponents(agent, input.components)
          } else if (Object.hasOwn(input, 'authoring')) {
            if (Object.keys(input).some(key => key !== 'authoring')) throw new Error('Read authoring methods separately from working-copy source')
            result = await service.readAuthoringMaterial(agent, input.authoring)
          } else result = await service.read(agent, schemas.read.request.parse(input))
          break
        case 'copy': result = await service.copy(agent, schemas.copy.request.parse(input)); break
        case 'rename': result = await service.rename(agent, schemas.rename.request.parse(input)); break
        case 'readFile': result = await service.readFile(agent, schemas.readFile.request.parse(input)); break
        case 'prepareChanges': result = await service.prepareChanges(agent, schemas.prepareChanges.request.parse(input)); break
        case 'saveChanges': result = await service.saveChanges(agent, schemas.saveChanges.request.parse(input)); break
        case 'updateMounts': result = await service.updateMounts(agent, schemas.updateMounts.request.parse(input)); break
        case 'preview': result = await service.preview(agent, schemas.preview.request.parse(input)); break
        default: throw new Error('Unknown Studio customization action')
      }
      const candidate = args.action === 'prepareChanges' ? schemas.prepareChanges.result.parse(result) : undefined
      const studioPath = candidate?.authoring?.url ?? `/design-studio/?agentId=${encodeURIComponent(String(agent.id))}`
      // Native Markdown treats relative URLs as file paths. The local Web Host
      // exposes its actual listening port, including OS-assigned ports.
      const webServer = ctx.get('webServer') as WebServer | undefined
      const studioUrl = webServer
        ? new URL(studioPath, `http://127.0.0.1:${webServer.port}`).href
        : studioPath
      return { content: JSON.stringify({ result, studioUrl }) }
    },
  }))
}
