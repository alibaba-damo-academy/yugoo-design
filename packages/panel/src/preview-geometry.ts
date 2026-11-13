/** Measurement algorithm ported from provider-web-app PageDesignPanel/pageDesignPrototype.ts;
 * native references remain preserved. Read-only layout evidence for the current state. Hidden
 * conditional branches are not current triggers; absent bindings and visible
 * zero-size controls remain errors. This never changes canonical design data.
 */
export function previewGeometryMarkup(channel: string, regions: readonly string[]): string {
  const config = JSON.stringify({ channel, regions }).replace(/</g, '\\u003c')
  return '<script>(()=>{const {channel,regions}=' + config + ';' + String.raw`
    let stopped=false, frame=0, lastReport;
    function intentionallyHidden(element){
      for(let current=element;current;current=current.parentElement){
        const style=window.getComputedStyle(current);
        if(current.hidden||style.display==='none'||style.visibility==='hidden'||style.visibility==='collapse'||style.contentVisibility==='hidden'||Number(style.opacity||1)===0)return true;
        const parent=current.parentElement;
        if(parent&&parent.tagName==='DETAILS'&&!parent.open&&current.tagName!=='SUMMARY')return true;
      }
      return false;
    }
    function inViewport(rect){return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.left<window.innerWidth&&rect.top<window.innerHeight}
    function hasVisibleBox(element){return !intentionallyHidden(element)&&Array.prototype.some.call(element.getClientRects(),inViewport)}
    function hasVisibleBodyContent(body){
      const walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);let text;
      while((text=walker.nextNode())){
        if((text.nodeValue||'').trim()&&text.parentElement&&hasVisibleBox(text.parentElement)){
          const range=document.createRange();range.selectNodeContents(text);
          if(Array.prototype.some.call(range.getClientRects(),inViewport))return true;
        }
      }
      return Array.prototype.some.call(body.querySelectorAll('*'),element=>!/^(SCRIPT|STYLE|LINK|META|TEMPLATE|TITLE)$/.test(element.tagName)&&hasVisibleBox(element));
    }
    const observed=new Set();
    const resize=typeof ResizeObserver==='function'?new ResizeObserver(schedule):null;
    function reportGeometry(){
      if(stopped)return;
      const issues=[],html=document.documentElement,body=document.body;
      const htmlCount=document.querySelectorAll('html').length,bodyCount=document.querySelectorAll('body').length;
      if(!html||html.tagName!=='HTML'||htmlCount!==1||!body||bodyCount!==1||body.parentElement!==html)issues.push('document-root:'+htmlCount+'/'+bodyCount);
      else if(!hasVisibleBodyContent(body))issues.push('body-empty');
      const elements=new Map();
      document.querySelectorAll('[data-prototype-id]').forEach(element=>{
        const id=element.getAttribute('data-prototype-id');if(!elements.has(id))elements.set(id,element);
      });
      const current=new Set([html,body].filter(Boolean));
      regions.forEach(id=>{
        const element=elements.get(id);
        if(!element){issues.push('region-missing:'+id);return}
        current.add(element);
        if(intentionallyHidden(element))return;
        const rect=element.getBoundingClientRect();
        if(rect.width<=0||rect.height<=0)issues.push('region-invisible:'+id);
      });
      if(html&&html.scrollWidth>html.clientWidth+1)issues.push('horizontal-overflow:'+html.scrollWidth);
      if(resize){
        observed.forEach(element=>{if(!current.has(element)){resize.unobserve(element);observed.delete(element)}});
        current.forEach(element=>{if(!observed.has(element)){observed.add(element);resize.observe(element)}});
      }
      const serialized=JSON.stringify(issues);
      if(serialized!==lastReport){lastReport=serialized;window.parent.postMessage({type:'design-preview:geometry',channel,issues},'*')}
    }
    // Batch state/style changes after rendering; no polling or perpetual RAF.
    function schedule(){if(stopped||frame)return;frame=requestAnimationFrame(()=>{frame=requestAnimationFrame(()=>{frame=0;reportGeometry()})})}
    const mutations=new MutationObserver(schedule);
    mutations.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class','style','hidden','open','data-prototype-id']});
    const events=['input','change','click','toggle','load'];
    events.forEach(event=>document.addEventListener(event,schedule,true));
    window.addEventListener('resize',schedule);
    function stop(){
      stopped=true;if(frame)cancelAnimationFrame(frame);frame=0;
      mutations.disconnect();if(resize)resize.disconnect();observed.clear();
      events.forEach(event=>document.removeEventListener(event,schedule,true));
      window.removeEventListener('resize',schedule);window.removeEventListener('pagehide',stop);
    }
    window.addEventListener('pagehide',stop);
    schedule();
  ` + '})()</script>'
}

export function previewGeometryReport(value: unknown, channel: string): string[] | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return
  const message = value as Record<string, unknown>
  if (Object.keys(message).sort().join(',') !== 'channel,issues,type'
    || message.type !== 'design-preview:geometry' || message.channel !== channel
    || !Array.isArray(message.issues) || message.issues.length > 64
    || message.issues.some(issue => typeof issue !== 'string' || !issue || issue.length > 256)) return
  return [...message.issues] as string[]
}
