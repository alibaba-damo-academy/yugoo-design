/** Native MCP App binds an explicitly selected project to its originating conversation. */
import { fork } from 'node:child_process'
import { join, isAbsolute } from 'node:path'
import { homedir } from 'node:os'
import { relayWidget } from './workbuddy-relay-probe.mjs'
import { resolveBrowserAccess, localBrowserBase, companionView } from './browser-access.mjs'
const uri='ui://yugoo-workbuddy-panel/connect-v3'
export function spawnWorkBuddyPanel(options) {
  return new Promise((resolve,reject)=>{
    const child=fork(join(options.runtimeRoot,'scripts/workbuddy-panel-service.mjs'),['--workbuddy-panel-service'],{detached:true,windowsHide:true,execArgv:[],stdio:['ignore','ignore','ignore','ipc']})
    const fail=error=>{clearTimeout(timer);child.kill();reject(error)}
    const timer=setTimeout(()=>fail(Error('WorkBuddy Panel startup timed out.')),30000)
    child.once('error',fail);child.once('exit',()=>fail(Error('WorkBuddy Panel exited before startup.')))
    child.once('message',result=>{
      if(!result?.ok)return fail(Error(result?.error??'Invalid Panel startup result.'))
      clearTimeout(timer);child.removeAllListeners('exit');child.removeListener('error',fail)
      child.disconnect();child.unref();resolve(result)
    })
    child.send(options)
  })
}
export function createWorkBuddyPanelMcp({runtimeRoot,start=spawnWorkBuddyPanel,stateRoot=join(homedir(),'.local/state/design-system/companion'),browserAccess:configuredAccess}={}) {
  const browserAccess=resolveBrowserAccess(configuredAccess)
  return { async handle({id,method,params={}}) {
    const ok=result=>({jsonrpc:'2.0',id,result}), meta={ui:{resourceUri:uri}}
    if(method==='tools/list')return ok({tools:[{name:'yugoo_workbuddy_open_panel',description:'Open the shared Companion for one existing Design Project in this original WorkBuddy conversation. Supply current Hook sessionId/nativeCwd/transcriptPath and selected.root from design_command. The MCP App connects automatically. Optional view=panel-only (legacy design alias accepted) hides history/composer in this page only; full remains the default. Does not create a project or start a model. Serial foreground Producers require separate native receipt verification. Workers remain unsupported. GRA is conditional on current-service native background readiness: read design_status.hostCapabilities and backgroundReviewProtocol before dispatch. An attached Agent result is not background execution. Reuse the returned exact connection; do not repeat startup after success.',inputSchema:{type:'object',properties:{projectRoot:{type:'string'},sessionId:{type:'string'},nativeCwd:{type:'string'},transcriptPath:{type:'string'},view:{type:'string',enum:['full','panel-only','design']}},required:['projectRoot','sessionId','nativeCwd','transcriptPath'],additionalProperties:false},_meta:meta}]})
    if(method==='resources/list')return ok({resources:[{uri,name:'WorkBuddy Design Panel connection',mimeType:'text/html;profile=mcp-app'}]})
    if(method==='resources/read'&&params.uri===uri)return ok({contents:[{uri,mimeType:'text/html;profile=mcp-app',text:relayWidget({dynamic:true,autoConnect:true,origin:'',widgetToken:'',url:''}),_meta:{ui:{csp:{connectDomains:['http://127.0.0.1:*'],resourceDomains:[]}}}}]})
    if(method==='tools/call'&&params.name==='yugoo_workbuddy_open_panel') {
      try {
        const args=params.arguments??{}
        if(Object.keys(args).some(key=>!['projectRoot','sessionId','nativeCwd','transcriptPath','view'].includes(key))||!isAbsolute(args.projectRoot??'')||!isAbsolute(args.nativeCwd??'')||!isAbsolute(args.transcriptPath??'')||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(args.sessionId??'')||(args.view!==undefined&&!['full','panel-only','design'].includes(args.view))||!isAbsolute(runtimeRoot??''))throw Error('Exact existing project root, current native session UUID/cwd/transcriptPath and installed runtime required.')
        const result=await start({runtimeRoot,stateRoot,browserAccess,workbuddyProducer:true,projectRoot:args.projectRoot,nativeCwd:args.nativeCwd,transcriptPath:args.transcriptPath,threadId:args.sessionId})
        const view=companionView(args.view)
        const pageUrl=new URL(result.url)
        if(pageUrl.protocol!=='http:'||pageUrl.hostname!=='127.0.0.1'||!pageUrl.port||pageUrl.search||pageUrl.username||pageUrl.password||(browserAccess==='local'?(!localBrowserBase(pageUrl.pathname)||pageUrl.hash):(pageUrl.pathname!=='/'||!/^#[a-f0-9]{64}$/.test(pageUrl.hash))))throw Error('Panel returned an invalid local browser entry.')
        if(view==='panel-only')pageUrl.searchParams.set('view','panel-only')
        else pageUrl.searchParams.delete('view')
        // Native URL navigation is distinct from the rejected HTML-artifact
        // handoff. Like CLI serve, supply the already-issued local browser URL;
        // the native tool can record it. Do not expose the separate relay key.
        const nativePreview=view==='panel-only'?{tool:'present_files',arguments:{files:[pageUrl.href],cwd:args.nativeCwd,explanation:'在 WorkBuddy 中打开当前项目的设计面板。'}}:undefined
        return ok({content:[{type:'text',text:JSON.stringify({host:'workbuddy',view,connection:result.connectionPath,projectId:result.projectId,projectName:result.projectName,threadId:result.threadId,...(nativePreview?{nativePreview}:{}),instruction:(view==='panel-only'?'现在将 nativePreview.arguments 原样传给原生 present_files 调用一次，由 WorkBuddy 自动打开本地设计面板。不要把手动复制地址或查找其他浏览器 Skill 作为前置步骤。此完整本地 URL 允许用于本次原生导航；不要拆取 token 或交给无关工具/服务。本地页可能不显示地址栏，这不阻止自动打开，也不代表地址栏问题已修复。仅在工具不可用或导航失败时，使用控件「连接帮助」中的复制地址恢复方式。连接控件加载后会自动接通原对话；连接就绪后「保存并继续」直接回到本对话。控件「其他打开方式」中的「在系统浏览器打开」是可选入口；内嵌页面成功打开时无需引导用户点击。导航失败或结果不明时，不重启已成功的服务，不自动重试。':'连接控件会自动接通原对话；点击「在系统浏览器打开」可打开完整工作区。')+'复用此精确 connection；不要读取连接文件或单独输出 token。支持 main Bundle 和经原生回执核验的串行前台 Producer；请按 yugoo Skill 启动、绑定、恢复同一 Agent。Workers 仍不可用。GRA 须遵循 design_status.hostCapabilities 和 backgroundReviewProtocol：仅当前服务已验证 ready 且 backgroundReviews=true 时，才可按真实后台回执启动与绑定；未就绪时请求保持 pending，attached 返回不是后台执行。'})}],_meta:{...meta,workbuddyPanel:{...result,url:pageUrl.href,view,reopenArgs:{projectRoot:args.projectRoot,sessionId:args.sessionId,nativeCwd:args.nativeCwd,transcriptPath:args.transcriptPath,view}}}})
      }catch(error){return ok({isError:true,content:[{type:'text',text:String(error.message??error)}]})}
    }
  } }
}
