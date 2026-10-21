/** Local Companion lifecycle only; never starts a host or model. */
import { join, isAbsolute } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { startCompanion } from './server.mjs'
import { startWorkBuddyRelay } from './workbuddy-mcp-relay.mjs'
import { createWorkBuddyConnection } from './workbuddy-connection.mjs'
export async function startWorkBuddyPanel(options) {
  for (const key of ['projectRoot','nativeCwd','transcriptPath','runtimeRoot','stateRoot']) if (!isAbsolute(options[key] ?? '')) throw Error(`Exact absolute ${key} required.`)
  let panel, started=false
  const relay=await startWorkBuddyRelay({idleTimeoutMs:3600000,maxLifetimeMs:14400000,
    getLastActivityAt:()=>panel?.lastAuthenticatedActivityAt,
    onClose:async lifecycle=>{
      // Preserve a bounded, credential-free diagnostic before revoking the live
      // connection. This receipt cannot grant routing or execution authority.
      if (panel) await writeFile(panel.connectionPath+'.closed.json',JSON.stringify({format:1,host:'workbuddy',
        threadId:options.threadId,projectId:panel.project.project.metadata.id,
        lastAuthenticatedActivityAt:panel.lastAuthenticatedActivityAt,...lifecycle}),{mode:0o600,flag:'wx'})
        .catch(()=>console.error('WorkBuddy shutdown receipt unavailable.'))
      await panel?.close();if(started)options.onStopped?.()
    }})
  try {
    const connection=createWorkBuddyConnection({threadId:options.threadId,queue:relay.queue})
    panel=await startCompanion({host:'workbuddy',threadId:options.threadId,connection,
      browserAccess:options.browserAccess,
      projectRoot:options.projectRoot,nativeCwd:options.nativeCwd,transcriptPath:options.transcriptPath,stateRoot:options.stateRoot,
      kitRoot:join(options.runtimeRoot,'kits/web_app'),staticRoot:join(options.runtimeRoot,'web'),
      indexPath:join(options.runtimeRoot,'web/index.html'),statusEntryPath:join(options.runtimeRoot,'scripts/design.mjs'),
      embedding:{localOnly:true},
      workbuddyProducer:options.workbuddyProducer===true,
    })
    started=true
    return { origin:relay.origin, widgetToken:relay.widgetToken, url:panel.url, browserAccess:panel.browserAccess,
      connectionPath:panel.connectionPath, threadId:options.threadId, projectId:panel.project.project.metadata.id,
      projectName:panel.project.project.metadata.name, close:()=>relay.close() }
  } catch(error) { await relay.close(); throw error }
}
if (process.argv.includes('--workbuddy-panel-service') && process.send) {
  process.once('message', async options => {
    try {
      const panel=await startWorkBuddyPanel({...options,onStopped:()=>process.exit(0)})
      const {close,...descriptor}=panel
      process.send({ok:true,...descriptor})
      for (const signal of ['SIGTERM','SIGINT']) process.once(signal,()=>{void close().then(()=>process.exit(0))})
    } catch(error) { process.send({ok:false,error:String(error.message ?? error)}); process.disconnect();process.exitCode=1 }
  })
}
