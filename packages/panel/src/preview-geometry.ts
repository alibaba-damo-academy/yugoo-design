/** Measurement algorithm ported from provider-web-app PageDesignPanel/pageDesignPrototype.ts.
 * Read-only browser evidence; never changes artifact completion or canonical data.
 * Native references remain preserved; shared previews use their existing source/channel fence.
 */
export function previewGeometryMarkup(channel: string, regions: readonly string[]): string {
  const config = JSON.stringify({ channel, regions }).replace(/</g, '\\u003c')
  return '<script>(()=>{const {channel,regions}=' + config + ';' +
    'function findByPrototypeId(id){return Array.prototype.find.call(document.querySelectorAll(\'[data-prototype-id]\'),function(item){return item.getAttribute(\'data-prototype-id\')===id})}' +
    'function hasVisibleBox(element){var current=element;while(current){var style=window.getComputedStyle(current);if(style.display===\'none\'||style.visibility===\'hidden\'||style.visibility===\'collapse\'||style.contentVisibility===\'hidden\'||Number(style.opacity)===0){return false}if(current===document.body){break}current=current.parentElement}return Array.prototype.some.call(element.getClientRects(),function(rect){return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.left<window.innerWidth&&rect.top<window.innerHeight})}' +
    'function hasVisibleBodyContent(body){var walker=document.createTreeWalker(body,NodeFilter.SHOW_TEXT);var textNode;while((textNode=walker.nextNode())){if((textNode.nodeValue||\'\').trim()&&textNode.parentElement&&hasVisibleBox(textNode.parentElement)){var range=document.createRange();range.selectNodeContents(textNode);if(Array.prototype.some.call(range.getClientRects(),function(rect){return rect.width>0&&rect.height>0&&rect.bottom>0&&rect.right>0&&rect.left<window.innerWidth&&rect.top<window.innerHeight})){return true}}}return Array.prototype.some.call(body.querySelectorAll(\'*\'),function(element){return !/^(SCRIPT|STYLE|LINK|META|TEMPLATE|TITLE)$/.test(element.tagName)&&hasVisibleBox(element)})}' +
    'function reportGeometry(){var issues=[];var html=document.documentElement;var body=document.body;var htmlCount=document.querySelectorAll(\'html\').length;var bodyCount=document.querySelectorAll(\'body\').length;if(!html||html.tagName!==\'HTML\'||htmlCount!==1||!body||bodyCount!==1||body.parentElement!==html){issues.push(\'document-root:\'+htmlCount+\'/\'+bodyCount)}else if(!hasVisibleBodyContent(body)){issues.push(\'body-empty\')}' +
    'regions.forEach(function(regionId){var element=findByPrototypeId(regionId);if(!element){issues.push(\'region-missing:\'+regionId);return}' +
    'var style=window.getComputedStyle(element);var rect=element.getBoundingClientRect();' +
    'if(style.display===\'none\'||style.visibility===\'hidden\'||rect.width<=0||rect.height<=0){issues.push(\'region-invisible:\'+regionId)}});' +
    'var doc=document.documentElement;if(doc.scrollWidth>doc.clientWidth+1){issues.push(\'horizontal-overflow:\'+doc.scrollWidth)}' +
    'window.parent.postMessage({type:\'design-preview:geometry\',channel:channel,issues:issues},\'*\')}' +
    'function reportRenderedGeometry(){window.requestAnimationFrame(function(){window.requestAnimationFrame(reportGeometry)})}' +
    'if(document.readyState===\'complete\'){reportRenderedGeometry()}else{window.addEventListener(\'load\',reportRenderedGeometry)}' +
    '})()</script>'
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
