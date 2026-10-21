import {createGraphLayoutJob as originalJob} from '../src/client/graph-layout-client.ts'
import {previewPositions} from './preview-perspective-layout.mjs'
import {stressPositions} from './preview-stress.mjs'
export function createPreviewLayoutJob(scope,engine,positions,dragged){
  if(!engine.startsWith('preview-'))return originalJob(scope,engine,positions,dragged)
  const solve=engine.startsWith('preview-stress')?stressPositions:previewPositions
  const source=`const solve=${solve.toString()};self.onmessage=({data})=>{try{self.postMessage({positions:solve(data.scope,data.mode)})}catch(e){self.postMessage({error:String(e)})}}`
  const url=URL.createObjectURL(new Blob([source],{type:'text/javascript'}))
  let worker;try{worker=new Worker(url)}finally{URL.revokeObjectURL(url)}
  let done=false,reject,timer
  const finish=()=>{done=true;clearTimeout(timer);worker.terminate()}
  const result=new Promise((resolve,rejectFn)=>{
    reject=rejectFn
    worker.onmessage=({data})=>{if(done)return;finish();data.error?reject(new Error(data.error)):resolve(new Map(data.positions))}
    worker.onerror=e=>cancel(new Error(e.message))
    timer=setTimeout(()=>cancel(new Error('预览布局超时，请缩小显示范围')),30000)
    worker.postMessage({scope,mode:engine.slice(8)})
  })
  function cancel(reason=new Error('Preview layout cancelled')){if(done)return;finish();reject(reason)}
  return {result,cancel}
}
