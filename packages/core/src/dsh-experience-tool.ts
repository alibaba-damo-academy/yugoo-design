/** DSH adapter only; experience content and persistence are host-neutral. */
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type DesignService from './design-service.ts'
import { nodeFs, requireAgent } from './service-tools.ts'
import { operateExperience, type ExperienceRequest } from './experience-service.ts'

export function registerExperienceTool(ctx: Context, design: DesignService): void {
  ctx.tools.register(defineTool({
    name: 'design_experience',
    description: 'System-level cross-Bundle derived experience view, not a Design Bundle. After the user opts to explore a concrete situation: prepare with an id and relevant Design File source paths (optional landed CSS stylesheet); read those files with native read tools; write standalone HTML sections with the returned version; publish title, purpose and sections with source references and explicit demo assumptions. HTML can be a comparison, diagram, narrative or bounded simulation, not necessarily steps or pages. Never modify product facts here. prepare captures source bytes automatically; publish rejects drift. write accepts up to 32 KiB per call: offset 0 replaces draft HTML, otherwise offset must equal current UTF-8 byte length. Published views remain available until a new version passes publication. Use existing Bundle workflows for requested product changes. Do not publish on behalf of an unrequested tour.',
    // Detailed guidance is delivered on demand, not injected into every turn.
    parameters: {
      action: { type: 'string', required: true, enum: ['prepare', 'write', 'publish'], description: 'prepare: id + sources; follow the returned system-owned authoring.guide before writing, with optional authoring.htmlStarter. write: id + version + artifactId + content. publish: id + version + title + purpose + sections.' },
      id: { type: 'string', required: true, description: 'Experience name, 1–80 letters/digits/underscores/hyphens. Reuse it across prepare, write and publish.' },
      version: { type: 'string', description: 'Required for write and publish. Copy the exact version returned by prepare; do not invent a version.' },
      sources: { type: 'array', description: 'prepare: relevant source paths relative to Design Files; at least one source including optional stylesheet.', items: { type: 'string' } }, stylesheet: { type: 'string' },
      artifactId: { type: 'string', description: 'Required for write. Section name without .html, e.g. overview; 1–80 letters/digits/underscores/hyphens. Not the experience id or version. Publish the same value as sections[].id.' },
      content: { type: 'string', description: 'Required for write: nonempty HTML chunk, at most 32 KiB UTF-8 per call.' },
      offset: { type: 'number', description: 'write: 0 replaces draft HTML (default); append using the previous write result bytes, not character count.' },
      title: { type: 'string', description: 'Required for publish: user-facing experience title.' },
      purpose: { type: 'string', description: 'Required for publish: what this experience helps the user judge.' },
      sections: { type: 'array', description: 'Required for publish: 1–24 written sections, each referencing captured sources and listing demonstration assumptions (may be empty).', items: { type: 'object', additionalProperties: false, properties: {
        id: { type: 'string', required: true, description: 'Exactly the artifactId used to write this section, without .html.' }, title: { type: 'string', required: true },
        sources: { type: 'array', required: true, items: { type: 'string' } },
        assumptions: { type: 'array', required: true, items: { type: 'string' } },
      } } },
    },
    output: { schema: { type: 'object', additionalProperties: false, properties: { content: { type: 'string', required: true } } },
      render: (_args, result) => [{ type: 'text', text: result.content }] },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const project = await design.projectForAgent(agent, exec.signal)
      return design.withProjectMutationFor(agent, project.projectId, async () => {
        const store = await design.designFilesForProject(agent, project.projectId, nodeFs, exec.signal)
        const result = await operateExperience(store, args as ExperienceRequest, exec.signal)
        return { content: JSON.stringify({ ...result, designFiles: project.designFilesRoot }) }
      })
    },
  }))
}
