// Isolated process for exercising the on-disk review critical section.
import { createCompanionReviews } from '../src/reviews.mjs'
import { GitVersioning } from '../../core/lib/index.js'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
const options = JSON.parse(process.argv[2])
const exec = promisify(execFile)
const git = new GitVersioning(async ({ argv, cwd, env, signal }) => {
  try { return { ...(await exec(argv[0], argv.slice(1), { cwd, env: { ...process.env, ...env }, signal })), exitCode: 0 } }
  catch (e) { return { exitCode: e.code, stdout: e.stdout ?? '', stderr: e.stderr ?? '' } }
}, options.project.project.root, 'design_files')
const reviews = createCompanionReviews({ ...options, project: {
  ...options.project, mutateAssessment: action => action(), readWorkspace: async () => options.workspace,
  store: {
    head: () => git.head(),
    designEvidenceRevisionAt: commit => git.designEvidenceRevisionAt(commit),
    sameDesignEvidenceAt: async (a,b) => (await git.designEvidenceRevisionAt(a)) === (await git.designEvidenceRevisionAt(b)),
  },
} })
process.on('message', async ({ id, method, params }) => {
  try { process.send({ id, value: await reviews[method](params) }) }
  catch (error) { process.send({ id, error: error.message }) }
})
process.send({ ready: true })
