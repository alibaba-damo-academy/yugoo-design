import {publishPublicSyncResumeClaim} from '../public-sync-resume-claim.mjs'
await publishPublicSyncResumeClaim({...JSON.parse(process.env.OWNED_RESUME_CLAIM_INPUT),
  onCheckpoint: async event => {
    if (event.stage !== process.env.OWNED_RESUME_CLAIM_STOP) return
    process.send(event)
    await new Promise(() => {})
  }})
