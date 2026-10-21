/** One canonical, host-neutral authoring Skill, copied by existing package slots. */
import { mkdir, copyFile } from 'node:fs/promises'
import { join } from 'node:path'
import { constants } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const COMPONENT_SKILL_SOURCE = fileURLToPath(new URL('./plugin/design-system/skills/design-component/SKILL.md', import.meta.url))
export async function copyComponentSkill(target, source = COMPONENT_SKILL_SOURCE) {
  const directory = join(target, 'skills/design-component')
  await mkdir(directory, { recursive: true })
  const destination = join(directory, 'SKILL.md')
  await copyFile(source, destination, constants.COPYFILE_EXCL)
  return destination
}
