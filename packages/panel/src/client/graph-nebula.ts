/**
 * KAG v5 density/nebula rendering, accepted in the 2026-10-23 visual preview.
 * Ported from complex-project-bdddb8d96909/v5 (not an astronomical image):
 * index.html SHA256 b80bc820e5d4d0ba8d2d9379e88023b79be7931528db766bb4dc12f55904aad8
 * nebula.js SHA256 2b7ef2c1dc24a09aaddfb42889bd8cfc170e3cbfa604c85f895e17a864173ecf
 * Density conveys source distribution only; texture adds no graph relationships.
 */

export interface GraphNebulaPoint {
  /** Current viewport coordinates, in CSS pixels (already panned/zoomed). */
  x: number
  y: number
  /** Bundle/source color, as #rgb or #rrggbb. */
  color: string
}

export interface GraphNebulaOptions {
  width: number
  height: number
  panX: number
  panY: number
  zoom: number
  dark: boolean
  focused: boolean
}

const VERTEX = 'attribute vec2 position;varying vec2 uv;void main(){uv=(position+1.)*.5;gl_Position=vec4(position,0.,1.);}'
// Keep the accepted v5 shader unchanged, including its viewport/pan/zoom anchoring.
const FRAGMENT = `precision highp float;
uniform sampler2D field;uniform vec2 viewport;uniform vec2 pan;uniform float zoom;uniform float opacity;
varying vec2 uv;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float s=0.,a=.5;mat2 m=mat2(.8,-.6,.6,.8);for(int i=0;i<5;i++){s+=a*noise(p);p=m*p*2.03+vec2(13.2,7.1);a*=.5;}return s;}
void main(){
 vec2 p=(uv*viewport-viewport*.5-pan)/(max(.4,zoom)*68.);
 vec2 q=vec2(fbm(p),fbm(p+vec2(4.7,2.1)));
 vec2 r=vec2(fbm(p+3.*q+vec2(1.7,9.2)),fbm(p+3.*q+vec2(8.3,2.8)));
 float vapor=fbm(p+3.2*r),fibre=1.-abs(2.*fbm(p*2.2+3.*r)-1.);
 vec2 warp=(r-.5)*vec2(14.,14.)/viewport;
 vec4 base=texture2D(field,clamp(uv+warp,vec2(0),vec2(1)));
 float envelope=smoothstep(.02,.72,base.a);
 float cloud=smoothstep(.23,.74,vapor),vein=pow(smoothstep(.2,.93,fibre),2.);
 float volume=cloud*(.28+.72*vein);
 float alpha=envelope*opacity*volume;
 vec3 color=mix(base.rgb,vec3(.72,.81,.89),.16*cloud*vein);
 gl_FragColor=vec4(color,alpha);
}`

function sourceColor(value: string): [number, number, number] {
  let hex = value.trim()
  if (/^#[\da-f]{3}$/i.test(hex)) hex = '#' + [...hex.slice(1)].map(c => c + c).join('')
  if (!/^#[\da-f]{6}$/i.test(hex)) hex = '#778899'
  return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
}

/**
 * Owns a dedicated transparent background canvas; the caller owns its CSS size,
 * stacking, repaint scheduling and foreground graph. paint uses the v5 reduced
 * backing resolution, not DPR. Call clear when changing away from the graph view
 * and dispose when unmounting. No data, selection, global styles or animation loop
 * are owned here. A context restoration takes effect on the next caller repaint.
 */
export function createGraphNebula(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')
  const surface = canvas.ownerDocument.createElement('canvas')
  let disposed = false
  let attempted = false
  let lost = false
  let gl: WebGLRenderingContext | null = null
  let program: WebGLProgram | null = null
  let buffer: WebGLBuffer | null = null
  let texture: WebGLTexture | null = null
  const shaders: WebGLShader[] = []
  let uniforms: Record<string, WebGLUniformLocation | null> = {}

  function release() {
    if (!gl) return
    if (texture) gl.deleteTexture(texture)
    if (buffer) gl.deleteBuffer(buffer)
    if (program) gl.deleteProgram(program)
    for (const shader of shaders) gl.deleteShader(shader)
    texture = buffer = program = null
    shaders.length = 0
    uniforms = {}
  }

  function onLost(event: Event) {
    event.preventDefault()
    lost = true
    release()
  }
  function onRestored() {
    lost = false
    attempted = false
  }
  surface.addEventListener('webglcontextlost', onLost)
  surface.addEventListener('webglcontextrestored', onRestored)

  function init() {
    if (attempted || lost || disposed) return
    attempted = true
    try {
      gl = surface.getContext('webgl', { alpha: true, premultipliedAlpha: false, preserveDrawingBuffer: true })
      if (!gl) return
      const context = gl
      const compile = (type: number, source: string) => {
        const shader = context.createShader(type)
        if (!shader) throw new Error('Unable to allocate graph nebula shader')
        shaders.push(shader)
        context.shaderSource(shader, source)
        context.compileShader(shader)
        if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) throw new Error('Unable to compile graph nebula shader')
        return shader
      }
      program = context.createProgram()
      if (!program) throw new Error('Unable to allocate graph nebula program')
      context.attachShader(program, compile(context.VERTEX_SHADER, VERTEX))
      context.attachShader(program, compile(context.FRAGMENT_SHADER, FRAGMENT))
      context.linkProgram(program)
      if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error('Unable to link graph nebula program')
      context.useProgram(program)
      buffer = context.createBuffer()
      texture = context.createTexture()
      if (!buffer || !texture) throw new Error('Unable to allocate graph nebula buffers')
      context.bindBuffer(context.ARRAY_BUFFER, buffer)
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW)
      const position = context.getAttribLocation(program, 'position')
      context.enableVertexAttribArray(position)
      context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0)
      context.bindTexture(context.TEXTURE_2D, texture)
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MIN_FILTER, context.LINEAR)
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_MAG_FILTER, context.LINEAR)
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_S, context.CLAMP_TO_EDGE)
      context.texParameteri(context.TEXTURE_2D, context.TEXTURE_WRAP_T, context.CLAMP_TO_EDGE)
      for (const name of ['field', 'viewport', 'pan', 'zoom', 'opacity']) uniforms[name] = context.getUniformLocation(program, name)
      context.uniform1i(uniforms.field, 0)
    } catch {
      // Shader/context allocation failures use the same restrained density fallback.
      release()
    }
  }

  function clear() {
    if (!ctx) return
    ctx.save()
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.restore()
  }

  function paint(points: readonly GraphNebulaPoint[], options: GraphNebulaOptions) {
    if (disposed || !ctx) return
    const { width, height, dark, focused } = options
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      clear()
      return
    }
    // Same sampling footprint and 34 CSS-pixel Gaussian as the accepted preview.
    const rw = Math.max(1, Math.min(640, Math.round(width / 2)))
    const rh = Math.max(1, Math.round(rw * height / width))
    canvas.width = rw
    canvas.height = rh
    if (!points.length) return
    const scale = rw / width
    const pixels = rw * rh
    const sigma = 34 * scale
    const radius = Math.ceil(sigma * 3)
    const den = 2 * sigma * sigma
    const weights = new Float32Array(radius * 2 + 1)
    for (let i = -radius; i <= radius; i++) weights[i + radius] = Math.exp(-(i * i) / den)
    const layers = new Map<string, { density: Float32Array; rgb: number[] }>()
    for (const point of points) {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) continue
      const cx = Math.round(point.x * scale)
      const cy = Math.round(point.y * scale)
      if (cx + radius < 0 || cx - radius >= rw || cy + radius < 0 || cy - radius >= rh) continue
      const rgb = sourceColor(point.color)
      const key = rgb.join(',')
      let layer = layers.get(key)
      if (!layer) {
        const luminance = .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2]
        layer = { density: new Float32Array(pixels), rgb: rgb.map(c => c * .86 + luminance * .14) }
        layers.set(key, layer)
      }
      const x0 = Math.max(0, cx - radius), x1 = Math.min(rw - 1, cx + radius)
      const y0 = Math.max(0, cy - radius), y1 = Math.min(rh - 1, cy + radius)
      for (let y = y0; y <= y1; y++) {
        const wy = weights[y - cy + radius], offset = y * rw
        for (let x = x0; x <= x1; x++) layer.density[offset + x] += wy * weights[x - cx + radius]
      }
    }
    if (!layers.size) return
    const image = ctx.createImageData(rw, rh)
    for (let j = 0; j < pixels; j++) {
      let total = 0, colorWeight = 0, r = 0, g = 0, b = 0
      for (const { density, rgb } of layers.values()) {
        const v = density[j], w = v * v
        total += v
        colorWeight += w
        r += w * rgb[0]; g += w * rgb[1]; b += w * rgb[2]
      }
      if (total < .015) continue
      const at = j * 4
      image.data[at] = r / colorWeight
      image.data[at + 1] = g / colorWeight
      image.data[at + 2] = b / colorWeight
      image.data[at + 3] = Math.min(1, Math.max(0, (Math.log1p(total) - .22) / 1.65)) * 255
    }
    const opacity = (dark ? .42 : .29) * (focused ? .4 : 1)
    init()
    if (!gl || !program || lost || gl.isContextLost()) {
      for (let i = 3; i < image.data.length; i += 4) image.data[i] *= opacity * .25
      ctx.putImageData(image, 0, 0)
      return
    }
    surface.width = rw
    surface.height = rh
    gl.viewport(0, 0, rw, rh)
    gl.useProgram(program)
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rw, rh, 0, gl.RGBA, gl.UNSIGNED_BYTE, image.data)
    gl.uniform2f(uniforms.viewport, width, height)
    gl.uniform2f(uniforms.pan, Number.isFinite(options.panX) ? options.panX : 0, Number.isFinite(options.panY) ? options.panY : 0)
    gl.uniform1f(uniforms.zoom, Number.isFinite(options.zoom) ? options.zoom : 1)
    gl.uniform1f(uniforms.opacity, opacity)
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
    ctx.save()
    ctx.translate(0, rh)
    ctx.scale(1, -1)
    ctx.drawImage(surface, 0, 0)
    ctx.restore()
  }

  function dispose() {
    if (disposed) return
    clear()
    disposed = true
    surface.removeEventListener('webglcontextlost', onLost)
    surface.removeEventListener('webglcontextrestored', onRestored)
    release()
    gl?.getExtension('WEBGL_lose_context')?.loseContext()
    gl = null
    surface.width = surface.height = 0
  }

  return { paint, clear, dispose }
}
