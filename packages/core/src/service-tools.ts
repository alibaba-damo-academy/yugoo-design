/**
 * Model-facing design discovery tools. Registration exposes mindset selection
 * and curated Bundle resources; Design execution and persistence enter through
 * `run_design_skill`.
 */
import { missingDesignSkillResource } from './design-generation-guidance.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { designSessionEvents } from './dsh-session-events.ts'
import { defineTool, type ToolRuntime } from '@deepseek-ai/dsh-tools'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import type DesignService from './design-service.ts'
import type { FsLike } from './design-files.ts'
import { designText, latestDirectHumanText, resolveConversationLocale } from './design-locale.ts'
import type { DesignKit, DesignSkill } from './types.ts'
import { skillAlias } from './skill-names.ts'
import { registerExperienceTool } from './dsh-experience-tool.ts'
import { registerKnowledgeQueryTool } from './dsh-knowledge-query-tool.ts'
import { registerKnowledgeOrchestrationTools } from './dsh-knowledge-orchestration-tools.ts'
import { registerDesignGitReadTool } from './dsh-git-read-tool.ts'
import { pageDesignSkillResource, DESIGN_SKILL_RESOURCE_PAGE_CHARACTERS } from './dsh-producer-design-tools.ts'

async function atomicReplaceText(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { encoding: 'utf8', flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

async function atomicReplaceBytes(path: string, content: Uint8Array): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    await writeFile(temporary, content, { flag: 'wx' })
    await rename(temporary, path)
  } finally {
    await rm(temporary, { force: true }).catch(() => {})
  }
}

/** Node filesystem adapter for the design workspace (host-side, trusted). */
export const nodeFs: FsLike = {
  readText: async (path) => {
    try { return await readFile(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  },
  writeText: async (path, content) => { await writeFile(path, content, 'utf8') },
  replaceText: atomicReplaceText,
  readBytes: async (path) => {
    try { return await readFile(path) } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
  },
  writeBytes: async (path, content) => { await writeFile(path, content) },
  replaceBytes: atomicReplaceBytes,
  ensureDir: async (path) => { await mkdir(path, { recursive: true }) },
  removeFile: async (path) => { await rm(path) },
}

/**
 * Normalize model-supplied design state into a plain object. Some providers emit
 * tool arguments as stringified JSON, so a string is parsed here at the tool
 * boundary before schema validation sees it.
 * @param state - the raw tool argument.
 * @returns the state as a non-null object.
 * @throws when the argument is not, and does not parse to, a JSON object.
 */
export function coerceObjectState(state: unknown): Record<string, unknown> {
  const value = typeof state === 'string' ? JSON.parse(state) : state
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('state must be a JSON object')
  }
  return value as Record<string, unknown>
}

/** The active kit's skill entry for one name, when the mindset is active. */
function sessionKit(design: DesignService, exec: { agent?: Agent }): DesignKit | undefined {
  return exec.agent === undefined ? undefined : design.kitForAgent(exec.agent)
}

/** Resolve the explicit Agent required by every stateful design operation. */
export function requireAgent(exec: { agent?: Agent }): Agent {
  if (exec.agent === undefined) throw new Error('design: this tool requires an agent session')
  return exec.agent
}

/**
 * Resolve a capability that must exist in the selected Kit before an operation starts.
 * @param kit - the exact Kit version selected by the session.
 * @param name - the required canonical skill name.
 * @returns the selected Kit's skill definition.
 */
export function requireKitSkill(kit: DesignKit, name: string): DesignSkill {
  if (name === '' || name === '.' || name === '..' || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error(`skill "${name}" is not in the active kit`)
  }
  const skill = kit.skills.find((entry) => entry.name === name)
  if (skill === undefined) throw new Error(`skill "${name}" is not in the active kit`)
  return skill
}

/**
 * Resolve a model-supplied skill argument (canonical or catalog alias) to the
 * active-kit skill entry, restoring the mindset from the session log first
 * (compaction-safe).
 * @returns the skill entry, or undefined when not in the active kit.
 */
function canonicalSkill(design: DesignService, exec: { agent?: Agent }, arg: string): DesignSkill | undefined {
  const kit = sessionKit(design, exec)
  return kit?.skills.find((skill) => skill.name === arg || skillAlias(skill.name) === arg)
}

/**
 * Settle a committed agent write in the plugin-owned Design Journal.
 * @param design - Design System service owning project and Journal state.
 * @param exec - host invocation carrying the opaque Agent conversation.
 * @param skillName - Bundle whose canonical state was committed.
 * @param state - complete committed Bundle state.
 * @param commit - optional Design Project Git checkpoint.
 */
export async function afterAgentWrite(
  design: DesignService,
  exec: { agent?: Agent },
  skillName: string,
  state: Record<string, unknown>,
  commit: string | undefined,
): Promise<void> {
  const agent = requireAgent(exec)
  const kit = design.requireKitForAgent(agent)
  const skill = requireKitSkill(kit, skillName)
  const project = await design.projectForAgent(agent)
  await design.recordDesignChange(agent, project.projectId, {
    kit: kit.name,
    version: kit.version,
    skill: skillName,
    state,
    origin: 'agent',
    ...(commit === undefined ? {} : { commit }),
    ...(typeof skill.metadata?.panelYaml === 'string' ? { panelYaml: skill.metadata.panelYaml } : {}),
    ...manifestFor(skill),
  })
}

/** The skill.yaml manifest slice the client tab bar consumes. */
export function manifestFor(skill: { metadata?: Record<string, unknown> } | undefined): { skillManifest?: Record<string, unknown> } {
  const manifest = skill?.metadata?.skillManifest
  return typeof manifest === 'object' && manifest !== null ? { skillManifest: manifest as Record<string, unknown> } : {}
}

/**
 * Register the generic parent-Agent design discovery tools.
 * @param ctx - context carrying `ctx.tools`.
 * @param design - the design seam the tools operate on.
 */
export function registerServiceTools(ctx: Context, design: DesignService): void {
  registerExperienceTool(ctx, design)
  registerKnowledgeQueryTool(ctx, design)
  registerKnowledgeOrchestrationTools(ctx, design)
  registerDesignGitReadTool(ctx, design)
  const tools = (ctx as unknown as { tools: ToolRuntime }).tools
  tools.register(defineTool({
    name: 'design_command',
    description: 'Use the same project commands as /yugoo: help, list, status, new, open, kit (mindset is a legacy alias), close, migrate, reconstruct, delete, compose_spec. Map clear natural-language intent to any action; slash syntax is not required. Main Agent only. compose_spec prepares guidance to assemble saved design into the coding workspace existing specs; follow it to actually write/check files, without treating preparation as completion or implementation authorization. For a design request without a selected project, create/open a project before selecting a Kit. Never inspect cwd as a substitute. Changing selection must follow user intent; delete requires explicit user authorization and preserves files. Returned conversationPrompt is guidance, not a new user instruction.',
    parameters: {
      action: { type: 'string', required: true, enum: ['help', 'list', 'status', 'new', 'open', 'kit', 'mindset', 'close', 'migrate', 'reconstruct', 'delete', 'compose_spec'] },
      argument: { type: 'string', description: 'Exact project name, ID, path or Kit required by the action; optional scoped brief for compose_spec. Omit for help/list/status/close.' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: {
        kind: { type: 'string', required: true, enum: ['success', 'error'] },
        text: { type: 'string', required: true },
        sourceRevision: { type: 'number' },
        conversationPrompt: { type: 'string' },
      } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      return design.executeProjectCommand(requireAgent(exec), `${args.action}${args.argument === undefined ? '' : ` ${args.argument}`}`, exec.signal)
    },
  }))
  tools.register(defineTool({
    name: 'select_design_mindset',
    description: 'Activate a design mindset (Design Kit) by name for an already selected Design Project. If no project is selected, first use design_command new/open. Available names are listed in available_design_mindsets.',
    parameters: {
      name: { type: 'string', required: true, description: 'The mindset/kit name to activate.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          activated: { type: 'string', required: true },
          skills: { type: 'array', required: true, items: { type: 'string' } },
          summary: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.summary,
      }],
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      const kit = await design.selectProjectMindset(agent, args.name, exec.signal)
      const locale = resolveConversationLocale(latestDirectHumanText(designSessionEvents(agent.session)))
      const titles = kit.skills.map(skill => designText(skill.title, locale))
      const summary = locale === 'zh'
        ? `已激活设计理念「${kit.name}」，可用设计技能：${titles.join('、')}。`
        : `Activated mindset "${kit.name}" with skills: ${titles.join(', ')}.`
      return { activated: kit.name, skills: kit.skills.map((s) => s.name), summary }
    },
  }))

  tools.register(defineTool({
    name: 'read_skill_resource',
    description: "Read one reference/asset file bundled with a design skill. This Bundle is already mounted; paths are Bundle-relative, not project or Host filesystem paths. Persistent generation or revision starts with run_design_skill, which supplies the method and scoped tools. Follow next_offset until complete=true; one displayed page is not a complete long guide.",
    parameters: {
      skill: { type: 'string', required: true, description: 'The design skill name.' },
      path: { type: 'string', required: true, description: 'Path relative to the skill directory, e.g. `reference/bpmn_authoring.md`.' },
      offset: { type: 'integer', description: 'Zero-based Unicode-character offset. Defaults to 0.' },
      max_chars: { type: 'integer', description: `Maximum Unicode characters per page, 1 through ${DESIGN_SKILL_RESOURCE_PAGE_CHARACTERS}.` },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          content: { type: 'string', required: true },
          offset: { type: 'integer', required: true }, total_chars: { type: 'integer', required: true },
          complete: { type: 'boolean', required: true }, next_offset: { type: 'integer' },
        },
      },
      render: (args, value) => [{ type: 'text', text: [
        `${args.path} (characters ${value.offset}-${value.offset + Array.from(value.content).length} of ${value.total_chars})`,
        value.content, value.complete ? 'End of resource.' : `Continue with offset=${value.next_offset}.`,
      ].join('\n') }],
    },
    async execute(args, exec) {
      const skill = canonicalSkill(design, exec, args.skill)
      const kit = sessionKit(design, exec)
      if (skill === undefined || kit === undefined) {
        throw new Error(`skill "${args.skill}" is not in the active kit`)
      }
      const parts = args.path.split('/')
      if (args.path.startsWith('/') || args.path.includes('\\') || args.path.includes('\0')
        || parts.some((part) => part === '' || part === '.' || part === '..')) {
        throw new Error('resource paths must stay inside the skill package')
      }
      const content = kit.resources[`${skill.name}/${args.path}`]
      if (content === undefined) throw missingDesignSkillResource(args.path)
      const page = pageDesignSkillResource(content, args.offset, args.max_chars)
      return { content: page.content, offset: page.offset, total_chars: page.totalCharacters,
        complete: page.complete, ...(page.nextOffset === undefined ? {} : { next_offset: page.nextOffset }) }
    },
  }))
}
