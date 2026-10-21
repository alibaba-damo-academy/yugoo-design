/** Project-owned durable records; machine caches and transport state stay external. */
import { isAbsolute, join } from 'node:path'

export const DESIGN_PROJECT_RECORDS_DIRECTORY = 'design_records'

export function designProjectRecordsRoot(projectRoot: string): string {
  if (!isAbsolute(projectRoot)) throw new Error('design records: an absolute project root is required')
  return join(projectRoot, DESIGN_PROJECT_RECORDS_DIRECTORY)
}

/** Only declared system records are auxiliary, never the entire records directory. */
export function isDesignProjectAuxiliaryPath(path: string): boolean {
  return path === 'design_records/clarity.json'
    || path.startsWith('design_records/journal/')
    || path.startsWith('design_records/reviews/')
    || path === 'design_records/knowledge/archive.json'
}
