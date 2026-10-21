/** Screen-space label placement for the experiment; never moves graph nodes. */
export const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y

export function wrapLabel(text,measure,maxWidth=154,maxLines=3){
  const chars=[...text],lines=[];let line=''
  for(let i=0;i<chars.length;i++){
    if(line&&measure(line+chars[i])>maxWidth){
      lines.push(line);line=''
      if(lines.length===maxLines){
        let last=lines.pop();while(last&&measure(last+'…')>maxWidth)last=[...last].slice(0,-1).join('')
        lines.push(last+'…');return lines
      }
    }
    line+=chars[i]
  }
  if(line)lines.push(line)
  return lines
}

export function placeLabels(items,obstacles,width,height){
  const placed=[],hidden=[]
  for(const item of items){
    const {x,y,w,h,gap=14}=item
    // Nearby cardinal positions first; diagonals/second ring only if needed.
    const offsets=[[ -w/2,gap],[-w/2,-gap-h],[gap,-h/2],[-gap-w,-h/2],
      [gap,gap],[-gap-w,gap],[gap,-gap-h],[-gap-w,-gap-h]]
    for(let i=0;i<16;i++){
      const a=i*Math.PI/8
      offsets.push([Math.cos(a)*(w/2+gap)-w/2,Math.sin(a)*(h/2+gap)-h/2])
    }
    const fits=candidate=>candidate.x>=8&&candidate.y>=8&&candidate.x+w<=width-8&&candidate.y+h<=height-8&&
      !placed.some(p=>intersects(candidate,p.box))&&!obstacles.some(o=>intersects(candidate,o))
    let box=item.preferred&&fits(item.preferred)?item.preferred:undefined
    for(const extra of [0,12,26,42]){
      if(box)break
      for(const [dx,dy]of offsets){
        const candidate={x:x+dx+(dx>0?extra:dx===-w/2?0:-extra),y:y+dy+(dy>0?extra:dy===-h/2?0:-extra),w,h}
        if(w>width-16||h>height-16)continue
        candidate.x=Math.max(8,Math.min(candidate.x,width-8-w))
        candidate.y=Math.max(8,Math.min(candidate.y,height-8-h))
        if(!fits(candidate))continue
        box=candidate;break
      }
      if(box)break
    }
    if(box)placed.push({...item,box});else hidden.push(item.id)
  }
  return {placed,hidden}
}

/** A quarter turn changes no distances or crossings; use the roomier orientation. */
export function orientToViewport(positions,width,height){
  const points=[...positions.values()];if(!points.length)return positions
  const xs=points.map(p=>p.x),ys=points.map(p=>p.y),w=Math.max(...xs)-Math.min(...xs),h=Math.max(...ys)-Math.min(...ys)
  const straight=Math.min(width/Math.max(1,w),height/Math.max(1,h)),turned=Math.min(width/Math.max(1,h),height/Math.max(1,w))
  return turned>straight*1.08?new Map([...positions].map(([id,p])=>[id,{x:-p.y,y:p.x}])):positions
}
