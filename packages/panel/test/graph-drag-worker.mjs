import {solveLocalDrag} from './graph-local-drag.mjs'

// Pure geometry on copied data. No network, project files, or semantic inference.
self.onmessage=({data})=>{
  try{self.postMessage({result:solveLocalDrag(data.scope,data.positions,data.id,data.point,data.options)})}
  catch(error){self.postMessage({error:String(error)})}
}
