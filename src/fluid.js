/* ─────────────────────────────────────────────────────────────
   ABHIJEET KANASE — the fluid (v8 · background)

   A real-time fluid simulation (Navier–Stokes on a 128² velocity grid, dye at
   512) painted on a transparent WebGL canvas inside the one background layer
   (.bg), behind everything. Cursor-only, like the reference: a burst when the
   page opens, then it moves only when the pointer or a finger moves, and the dye
   dissipates back to plain black in ~3 s.

   Adapted from Pavel Dobryakov's WebGL-Fluid-Simulation (MIT, 2017) — the same
   solver helloshivam.com runs — rewritten for this page:
     · transparent over the black (the dye is added; the black remains the
       fallback for no-JS, reduced motion, missing WebGL, context loss)
     · pointer events on window, the canvas never intercepts a click or a drag
     · runs inside main.js's single requestAnimationFrame loop (AK.loop)
     · sleeps when the dye is gone (no idle GPU work), wakes on the next move
     · a frame-time guard steps the quality down, then off, on machines that
       cannot hold 30 fps with it — the page never gets slower than it was
     · no per-frame layout reads: sizes arrive via the page's measure() event
   Tunables live in C below; window.AK_FLUID exposes them for live tweaking.

   Simulation and shaders: MIT License, Copyright (c) 2017 Pavel Dobryakov
   (github.com/PavelDoGreat/WebGL-Fluid-Simulation). Permission is hereby granted,
   free of charge, to any person obtaining a copy of this software and associated
   documentation files (the "Software"), to deal in the Software without
   restriction, including without limitation the rights to use, copy, modify,
   merge, publish, distribute, sublicense, and/or sell copies of the Software, and
   to permit persons to whom the Software is furnished to do so, subject to the
   following conditions: The above copyright notice and this permission notice
   shall be included in all copies or substantial portions of the Software. THE
   SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED,
   INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
   PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
   COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
   IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
   CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
   ───────────────────────────────────────────────────────────── */
(() => {
  'use strict';
  try {
  const AK = window.AK, host = document.querySelector('.bg');
  if (!AK || !host || AK.reduce) return;                         // no loop, no layer, or reduced motion → plain black

  const C = Object.assign({
    SIM_RESOLUTION: 128, DYE_RESOLUTION: 512,
    DENSITY_DISSIPATION: 2.5, VELOCITY_DISSIPATION: 0.8, PRESSURE: 0.8, PRESSURE_ITERATIONS: 20, CURL: 0,
    SPLAT_RADIUS: 0.25, SPLAT_FORCE: 3000,
    BRIGHTNESS: 0.12, COLOR_UPDATE_SPEED: 10,                     // hue cycles 10×/s; .15 is the reference's neon, .12 keeps the type first
    SHADING: true,
    BLOOM: true, BLOOM_ITERATIONS: 8, BLOOM_RESOLUTION: 256, BLOOM_INTENSITY: 0.65, BLOOM_THRESHOLD: 0.6, BLOOM_SOFT_KNEE: 0.7,
    SUNRAYS: true, SUNRAYS_RESOLUTION: 196, SUNRAYS_WEIGHT: 1.0,
    IMMEDIATE: true, SLEEP_AFTER: 4, MAX_DPR: 1, GUARD: true,        // MAX_DPR 1: the dye is a 512 px texture — extra display pixels add cost, not detail
  }, window.AK_FLUID_CONFIG || {});

  /* ───────────── context: WebGL2 or WebGL1 + half-float render targets, else plain black ───────────── */
  function supportRenderTextureFormat(gl, internalFormat, format, type) {
    const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 4, 4, 0, format, type, null);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fbo); gl.deleteTexture(tex);
    return ok;
  }
  function getContext(canvas) {
    const params = { alpha: true, depth: false, stencil: false, antialias: false, preserveDrawingBuffer: false, premultipliedAlpha: true };
    let gl = canvas.getContext('webgl2', params); const isWebGL2 = !!gl;
    if (!gl) gl = canvas.getContext('webgl', params) || canvas.getContext('experimental-webgl', params);
    if (!gl) return null;
    let halfFloat = null, supportLinearFiltering = true;
    if (isWebGL2) { gl.getExtension('EXT_color_buffer_float'); gl.getExtension('EXT_color_buffer_half_float'); }   // 16F filtering is core in WebGL2
    else { halfFloat = gl.getExtension('OES_texture_half_float'); supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear'); }
    const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat && halfFloat.HALF_FLOAT_OES;
    if (!halfFloatTexType) return null;
    gl.clearColor(0, 0, 0, 0);
    const fmt = (internalFormat, format) => (supportRenderTextureFormat(gl, internalFormat, format, halfFloatTexType) ? { internalFormat, format } : null);
    let formatRGBA, formatRG, formatR;
    if (isWebGL2) { formatRGBA = fmt(gl.RGBA16F, gl.RGBA); formatRG = fmt(gl.RG16F, gl.RG) || formatRGBA; formatR = fmt(gl.R16F, gl.RED) || formatRG; }
    else formatRGBA = formatRG = formatR = fmt(gl.RGBA, gl.RGBA);
    if (!formatRGBA) return null;
    return { gl, ext: { formatRGBA, formatRG, formatR, halfFloatTexType, supportLinearFiltering } };
  }

  const canvas = document.createElement('canvas');
  canvas.className = 'bg__fluid'; canvas.setAttribute('aria-hidden', 'true');
  const ctx = getContext(canvas);
  if (!ctx) return;                                                // no WebGL / no half-float render targets → plain black
  const { gl, ext } = ctx;
  const ac = ('AbortController' in window) ? new AbortController() : null, signal = ac ? ac.signal : undefined;
  let live = false;

  /* ───────────── shaders (GLSL ES 1.0) ───────────── */
  const VERT = `precision highp float; attribute vec2 aPosition; varying vec2 vUv, vL, vR, vT, vB; uniform vec2 texelSize;
    void main () { vUv = aPosition * 0.5 + 0.5; vL = vUv - vec2(texelSize.x, 0.0); vR = vUv + vec2(texelSize.x, 0.0); vT = vUv + vec2(0.0, texelSize.y); vB = vUv - vec2(0.0, texelSize.y); gl_Position = vec4(aPosition, 0.0, 1.0); }`;
  const VERT_BLUR = `precision highp float; attribute vec2 aPosition; varying vec2 vUv, vL, vR; uniform vec2 texelSize;
    void main () { vUv = aPosition * 0.5 + 0.5; float offset = 1.33333333; vL = vUv - texelSize * offset; vR = vUv + texelSize * offset; gl_Position = vec4(aPosition, 0.0, 1.0); }`;
  const MED = 'precision mediump float; precision mediump sampler2D;\n', HI = 'precision highp float; precision highp sampler2D;\n';
  const FS = {
    blur: MED + `varying vec2 vUv, vL, vR; uniform sampler2D uTexture;
      void main () { vec4 sum = texture2D(uTexture, vUv) * 0.29411764; sum += texture2D(uTexture, vL) * 0.35294117; sum += texture2D(uTexture, vR) * 0.35294117; gl_FragColor = sum; }`,
    copy: MED + `varying highp vec2 vUv; uniform sampler2D uTexture; void main () { gl_FragColor = texture2D(uTexture, vUv); }`,
    clear: MED + `varying highp vec2 vUv; uniform sampler2D uTexture; uniform float value; void main () { gl_FragColor = value * texture2D(uTexture, vUv); }`,
    display: HI + `varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uTexture; uniform sampler2D uBloom; uniform sampler2D uSunrays; uniform vec2 texelSize;
      vec3 linearToGamma (vec3 color) { color = max(color, vec3(0)); return max(1.055 * pow(color, vec3(0.416666667)) - 0.055, vec3(0)); }
      void main () {
        vec3 c = texture2D(uTexture, vUv).rgb;
      #ifdef SHADING
        vec3 lc = texture2D(uTexture, vL).rgb; vec3 rc = texture2D(uTexture, vR).rgb; vec3 tc = texture2D(uTexture, vT).rgb; vec3 bc = texture2D(uTexture, vB).rgb;
        float dx = length(rc) - length(lc); float dy = length(tc) - length(bc);
        vec3 n = normalize(vec3(dx, dy, length(texelSize))); vec3 l = vec3(0.0, 0.0, 1.0);
        float diffuse = clamp(dot(n, l) + 0.7, 0.7, 1.0); c *= diffuse;
      #endif
      #ifdef BLOOM
        vec3 bloom = texture2D(uBloom, vUv).rgb;
      #endif
      #ifdef SUNRAYS
        float sunrays = texture2D(uSunrays, vUv).r; c *= sunrays;
      #ifdef BLOOM
        bloom *= sunrays;
      #endif
      #endif
      #ifdef BLOOM
        float noise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) * 2.0 - 1.0;   /* dither: no banding in the glow */
        bloom += noise / 255.0; bloom = linearToGamma(bloom); c += bloom;
      #endif
        float a = max(c.r, max(c.g, c.b));                        /* premultiplied: the dye adds to the black beneath */
        gl_FragColor = vec4(c, a);
      }`,
    bloomPrefilter: MED + `varying vec2 vUv; uniform sampler2D uTexture; uniform vec3 curve; uniform float threshold;
      void main () { vec3 c = texture2D(uTexture, vUv).rgb; float br = max(c.r, max(c.g, c.b)); float rq = clamp(br - curve.x, 0.0, curve.y); rq = curve.z * rq * rq; c *= max(rq, br - threshold) / max(br, 0.0001); gl_FragColor = vec4(c, 0.0); }`,
    bloomBlur: MED + `varying vec2 vL, vR, vT, vB; uniform sampler2D uTexture;
      void main () { vec4 sum = vec4(0.0); sum += texture2D(uTexture, vL); sum += texture2D(uTexture, vR); sum += texture2D(uTexture, vT); sum += texture2D(uTexture, vB); sum *= 0.25; gl_FragColor = sum; }`,
    bloomFinal: MED + `varying vec2 vL, vR, vT, vB; uniform sampler2D uTexture; uniform float intensity;
      void main () { vec4 sum = vec4(0.0); sum += texture2D(uTexture, vL); sum += texture2D(uTexture, vR); sum += texture2D(uTexture, vT); sum += texture2D(uTexture, vB); sum *= 0.25; gl_FragColor = sum * intensity; }`,
    sunraysMask: HI + `varying vec2 vUv; uniform sampler2D uTexture;
      void main () { vec4 c = texture2D(uTexture, vUv); float br = max(c.r, max(c.g, c.b)); c.a = 1.0 - min(max(br * 20.0, 0.0), 0.8); gl_FragColor = c; }`,
    sunrays: HI + `varying vec2 vUv; uniform sampler2D uTexture; uniform float weight;
      #define ITERATIONS 16
      void main () { float Density = 0.3; float Decay = 0.95; float Exposure = 0.7; vec2 coord = vUv; vec2 dir = vUv - 0.5; dir *= 1.0 / float(ITERATIONS) * Density; float illuminationDecay = 1.0; float color = texture2D(uTexture, vUv).a;
        for (int i = 0; i < ITERATIONS; i++) { coord -= dir; float col = texture2D(uTexture, coord).a; color += col * illuminationDecay * weight; illuminationDecay *= Decay; }
        gl_FragColor = vec4(color * Exposure, 0.0, 0.0, 1.0); }`,
    splat: HI + `varying vec2 vUv; uniform sampler2D uTarget; uniform float aspectRatio; uniform vec3 color; uniform vec2 point; uniform float radius;
      void main () { vec2 p = vUv - point.xy; p.x *= aspectRatio; vec3 splat = exp(-dot(p, p) / radius) * color; vec3 base = texture2D(uTarget, vUv).xyz; gl_FragColor = vec4(base + splat, 1.0); }`,
    advection: HI + `varying vec2 vUv; uniform sampler2D uVelocity; uniform sampler2D uSource; uniform vec2 texelSize; uniform vec2 dyeTexelSize; uniform float dt; uniform float dissipation;
      vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) { vec2 st = uv / tsize - 0.5; vec2 iuv = floor(st); vec2 fuv = fract(st);
        vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize); vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize); vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize); vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);
        return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y); }
      void main () {
      #ifdef MANUAL_FILTERING
        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).xy * texelSize; vec4 result = bilerp(uSource, coord, dyeTexelSize);
      #else
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize; vec4 result = texture2D(uSource, coord);
      #endif
        float decay = 1.0 + dissipation * dt; gl_FragColor = result / decay; }`,
    divergence: MED + `varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity;
      void main () { float L = texture2D(uVelocity, vL).x; float R = texture2D(uVelocity, vR).x; float T = texture2D(uVelocity, vT).y; float B = texture2D(uVelocity, vB).y; vec2 C = texture2D(uVelocity, vUv).xy;
        if (vL.x < 0.0) { L = -C.x; } if (vR.x > 1.0) { R = -C.x; } if (vT.y > 1.0) { T = -C.y; } if (vB.y < 0.0) { B = -C.y; }
        float div = 0.5 * (R - L + T - B); gl_FragColor = vec4(div, 0.0, 0.0, 1.0); }`,
    curl: MED + `varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity;
      void main () { float L = texture2D(uVelocity, vL).y; float R = texture2D(uVelocity, vR).y; float T = texture2D(uVelocity, vT).x; float B = texture2D(uVelocity, vB).x; float vorticity = R - L - T + B; gl_FragColor = vec4(0.5 * vorticity, 0.0, 0.0, 1.0); }`,
    vorticity: HI + `varying vec2 vUv, vL, vR, vT, vB; uniform sampler2D uVelocity; uniform sampler2D uCurl; uniform float curl; uniform float dt;
      void main () { float L = texture2D(uCurl, vL).x; float R = texture2D(uCurl, vR).x; float T = texture2D(uCurl, vT).x; float B = texture2D(uCurl, vB).x; float C = texture2D(uCurl, vUv).x;
        vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L)); force /= length(force) + 0.0001; force *= curl * C; force.y *= -1.0;
        vec2 velocity = texture2D(uVelocity, vUv).xy; velocity += force * dt; velocity = min(max(velocity, -1000.0), 1000.0); gl_FragColor = vec4(velocity, 0.0, 1.0); }`,
    pressure: MED + `varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uPressure; uniform sampler2D uDivergence;
      void main () { float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x; float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x; float C = texture2D(uPressure, vUv).x; float divergence = texture2D(uDivergence, vUv).x; float pressure = (L + R + B + T - divergence) * 0.25; gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0); }`,
    gradientSubtract: MED + `varying highp vec2 vUv, vL, vR, vT, vB; uniform sampler2D uPressure; uniform sampler2D uVelocity;
      void main () { float L = texture2D(uPressure, vL).x; float R = texture2D(uPressure, vR).x; float T = texture2D(uPressure, vT).x; float B = texture2D(uPressure, vB).x; vec2 velocity = texture2D(uVelocity, vUv).xy; velocity.xy -= vec2(R - L, T - B); gl_FragColor = vec4(velocity, 0.0, 1.0); }`,
  };

  function compileShader(type, source, keywords) {
    if (keywords && keywords.length) source = keywords.map((k) => '#define ' + k + '\n').join('') + source;
    const sh = gl.createShader(type); gl.shaderSource(sh, source); gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error('fluid shader: ' + gl.getShaderInfoLog(sh));
    return sh;
  }
  function makeProgram(vs, fsSource, keywords) {
    const p = gl.createProgram();
    gl.attachShader(p, vs); gl.attachShader(p, compileShader(gl.FRAGMENT_SHADER, fsSource, keywords));
    gl.bindAttribLocation(p, 0, 'aPosition'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('fluid program: ' + gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { u, bind() { gl.useProgram(p); } };
  }

  /* ───────────── GL state: one quad, programs, framebuffers ───────────── */
  let P = {}, displayProgram = null, displayKey = '';
  let dye, velocity, divergence, curl, pressure, bloom, bloomFBs = [], sunrays, sunraysTemp;
  let cw = 1, ch = 1, aspectKey = 0, needResize = true;

  function blit(target) {
    if (target == null) { gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight); gl.bindFramebuffer(gl.FRAMEBUFFER, null); }
    else { gl.viewport(0, 0, target.width, target.height); gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); }
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  }
  function createFBO(w, h, internalFormat, format, type, param) {
    gl.activeTexture(gl.TEXTURE0);
    const texture = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);
    const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    gl.viewport(0, 0, w, h); gl.clear(gl.COLOR_BUFFER_BIT);
    return { texture, fbo, width: w, height: h, texelSizeX: 1 / w, texelSizeY: 1 / h,
      attach(id) { gl.activeTexture(gl.TEXTURE0 + id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; },
      dispose() { gl.deleteFramebuffer(fbo); gl.deleteTexture(texture); } };
  }
  function createDoubleFBO(w, h, internalFormat, format, type, param) {
    let a = createFBO(w, h, internalFormat, format, type, param), b = createFBO(w, h, internalFormat, format, type, param);
    return { width: w, height: h, texelSizeX: a.texelSizeX, texelSizeY: a.texelSizeY,
      get read() { return a; }, set read(v) { a = v; }, get write() { return b; }, set write(v) { b = v; },
      swap() { const t = a; a = b; b = t; }, dispose() { a.dispose(); b.dispose(); } };
  }
  function resizeFBO(target, w, h, internalFormat, format, type, param) {
    const next = createFBO(w, h, internalFormat, format, type, param);
    P.copy.bind(); gl.uniform1i(P.copy.u.uTexture, target.attach(0)); blit(next);
    target.dispose();
    return next;
  }
  function resizeDoubleFBO(target, w, h, internalFormat, format, type, param) {
    if (target.width === w && target.height === h) return target;
    target.read = resizeFBO(target.read, w, h, internalFormat, format, type, param);
    target.write.dispose(); target.write = createFBO(w, h, internalFormat, format, type, param);
    target.width = w; target.height = h; target.texelSizeX = 1 / w; target.texelSizeY = 1 / h;
    return target;
  }
  function getResolution(resolution) {
    let aspect = gl.drawingBufferWidth / gl.drawingBufferHeight; if (aspect < 1) aspect = 1 / aspect;
    const min = Math.round(resolution), max = Math.round(resolution * aspect);
    return gl.drawingBufferWidth > gl.drawingBufferHeight ? { width: max, height: min } : { width: min, height: max };
  }
  function initFramebuffers() {
    const simRes = getResolution(C.SIM_RESOLUTION), dyeRes = getResolution(C.DYE_RESOLUTION);
    const type = ext.halfFloatTexType, rgba = ext.formatRGBA, rg = ext.formatRG, r = ext.formatR, filtering = ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST;
    gl.disable(gl.BLEND);
    dye = dye ? resizeDoubleFBO(dye, dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, type, filtering) : createDoubleFBO(dyeRes.width, dyeRes.height, rgba.internalFormat, rgba.format, type, filtering);
    velocity = velocity ? resizeDoubleFBO(velocity, simRes.width, simRes.height, rg.internalFormat, rg.format, type, filtering) : createDoubleFBO(simRes.width, simRes.height, rg.internalFormat, rg.format, type, filtering);
    [divergence, curl, pressure, bloom, sunrays, sunraysTemp, ...bloomFBs].forEach((f) => f && f.dispose());
    divergence = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, type, gl.NEAREST);
    curl = createFBO(simRes.width, simRes.height, r.internalFormat, r.format, type, gl.NEAREST);
    pressure = createDoubleFBO(simRes.width, simRes.height, r.internalFormat, r.format, type, gl.NEAREST);
    // bloom: a mip chain down from BLOOM_RESOLUTION
    const bRes = getResolution(C.BLOOM_RESOLUTION);
    bloom = createFBO(bRes.width, bRes.height, rgba.internalFormat, rgba.format, type, filtering);
    bloomFBs = [];
    for (let i = 0; i < C.BLOOM_ITERATIONS; i++) {
      const w = bRes.width >> (i + 1), h = bRes.height >> (i + 1);
      if (w < 2 || h < 2) break;
      bloomFBs.push(createFBO(w, h, rgba.internalFormat, rgba.format, type, filtering));
    }
    const sRes = getResolution(C.SUNRAYS_RESOLUTION);
    sunrays = createFBO(sRes.width, sRes.height, r.internalFormat, r.format, type, filtering);
    sunraysTemp = createFBO(sRes.width, sRes.height, r.internalFormat, r.format, type, filtering);
  }
  function updateDisplayProgram() {
    const keys = []; if (C.SHADING) keys.push('SHADING'); if (C.BLOOM) keys.push('BLOOM'); if (C.SUNRAYS) keys.push('SUNRAYS');
    const key = keys.join(',');
    if (key === displayKey && displayProgram) return;
    displayKey = key; displayProgram = makeProgram(P.vs, FS.display, keys);
  }
  function resizeCanvas() {                                        // sizes come from the page's measure() (one layout read per resize, none per frame)
    if (!needResize) return false; needResize = false;
    cw = canvas.clientWidth || innerWidth; ch = canvas.clientHeight || innerHeight;
    const dpr = Math.min(devicePixelRatio || 1, C.MAX_DPR);
    const w = Math.max(1, Math.floor(cw * dpr)), h = Math.max(1, Math.floor(ch * dpr));
    if (canvas.width === w && canvas.height === h) return false;
    // a phone's URL bar collapsing (≈ 10 % of height) must not clear the dye: within 15 % the CSS size just stretches the buffer
    if (canvas.width > 1 && Math.abs(w - canvas.width) / w < 0.15 && Math.abs(h - canvas.height) / h < 0.15) return false;
    canvas.width = w; canvas.height = h;
    const key = Math.round((w / h) * 8);                           // the sim's own grids follow the aspect ratio only when it moves ≈ 12 %
    if (key === aspectKey) return false;
    aspectKey = key; return true;
  }

  /* ───────────── pointers: window-level, passive — the canvas is never in the hit-test ───────────── */
  const pointers = new Map();
  let splatStack = [], colorTimer = 0, lastInput = -1e9, awake = false;
  const HSVtoRGB = (h, s, v) => {
    const i = Math.floor(h * 6), f = h * 6 - i, p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s);
    switch (i % 6) { case 0: return [v, t, p]; case 1: return [q, v, p]; case 2: return [p, v, t]; case 3: return [p, q, v]; case 4: return [t, p, v]; default: return [v, p, q]; }
  };
  const generateColor = () => HSVtoRGB(Math.random(), 1, 1).map((c) => c * C.BRIGHTNESS);
  const aspect = () => canvas.width / canvas.height;
  const correctDeltaX = (d) => (aspect() < 1 ? d * aspect() : d);
  const correctDeltaY = (d) => (aspect() > 1 ? d / aspect() : d);
  const wake = () => { lastInput = performance.now() / 1000; awake = true; };   // same clock as the loop's timestamp
  function pointerFor(id) {
    let p = pointers.get(id);
    if (!p) { p = { id, x: 0, y: 0, dx: 0, dy: 0, moved: false, fresh: true, color: generateColor() }; pointers.set(id, p); }
    return p;
  }
  function moveTo(p, clientX, clientY) {
    const x = clientX / cw, y = 1 - clientY / ch;
    if (p.fresh || Math.abs(x - p.x) > 0.2 || Math.abs(y - p.y) > 0.2) { p.fresh = false; p.x = x; p.y = y; return; }   // first sample, or a pointer re-entering from far away: place it, no jet across the screen
    p.dx = correctDeltaX(x - p.x); p.dy = correctDeltaY(y - p.y); p.x = x; p.y = y;
    p.moved = p.dx !== 0 || p.dy !== 0;
    if (p.moved) wake();
  }
  addEventListener('pointermove', (e) => { if (!live || e.pointerType === 'touch') return; moveTo(pointerFor(-1), e.clientX, e.clientY); }, { passive: true, signal });
  addEventListener('touchstart', (e) => { if (!live) return; for (const t of e.changedTouches) { const p = pointerFor(t.identifier); p.fresh = true; p.color = generateColor(); moveTo(p, t.clientX, t.clientY); } }, { passive: true, signal });
  addEventListener('touchmove', (e) => { if (!live) return; for (const t of e.changedTouches) moveTo(pointerFor(t.identifier), t.clientX, t.clientY); }, { passive: true, signal });
  const endTouch = (e) => { for (const t of e.changedTouches) pointers.delete(t.identifier); };
  addEventListener('touchend', endTouch, { passive: true, signal }); addEventListener('touchcancel', endTouch, { passive: true, signal });
  document.addEventListener('page:measured', () => { needResize = true; }, { signal });
  document.addEventListener('motion:reduce', (e) => { if (e.detail) destroy(); }, { signal });
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); destroy(); }, { signal });

  /* ───────────── the solver ───────────── */
  function splat(x, y, dx, dy, color) {
    P.splat.bind();
    gl.uniform1i(P.splat.u.uTarget, velocity.read.attach(0));
    gl.uniform1f(P.splat.u.aspectRatio, aspect());
    gl.uniform2f(P.splat.u.point, x, y);
    gl.uniform3f(P.splat.u.color, dx, dy, 0);
    let radius = C.SPLAT_RADIUS / 100; if (aspect() > 1) radius *= aspect();
    gl.uniform1f(P.splat.u.radius, radius);
    blit(velocity.write); velocity.swap();
    gl.uniform1i(P.splat.u.uTarget, dye.read.attach(0));
    gl.uniform3f(P.splat.u.color, color[0], color[1], color[2]);
    blit(dye.write); dye.swap();
  }
  function multipleSplats(amount) {
    for (let i = 0; i < amount; i++) {
      const c = generateColor().map((v) => v * 5);                // the opening burst: brighter than a trail, gone in ~3 s (the reference uses 10× — too much under the orbit)
      splat(Math.random(), Math.random(), 1000 * (Math.random() - 0.5), 1000 * (Math.random() - 0.5), c);
    }
  }
  function applyInputs() {
    if (splatStack.length) multipleSplats(splatStack.pop());
    pointers.forEach((p) => { if (p.moved) { p.moved = false; splat(p.x, p.y, p.dx * C.SPLAT_FORCE, p.dy * C.SPLAT_FORCE, p.color); } });
  }
  function updateColors(dt) {
    colorTimer += dt * C.COLOR_UPDATE_SPEED;
    if (colorTimer >= 1) { colorTimer %= 1; pointers.forEach((p) => { p.color = generateColor(); }); }
  }
  function step(dt) {
    gl.disable(gl.BLEND);
    if (C.CURL > 0) {
      P.curl.bind();
      gl.uniform2f(P.curl.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(P.curl.u.uVelocity, velocity.read.attach(0));
      blit(curl);
      P.vorticity.bind();
      gl.uniform2f(P.vorticity.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
      gl.uniform1i(P.vorticity.u.uVelocity, velocity.read.attach(0));
      gl.uniform1i(P.vorticity.u.uCurl, curl.attach(1));
      gl.uniform1f(P.vorticity.u.curl, C.CURL);
      gl.uniform1f(P.vorticity.u.dt, dt);
      blit(velocity.write); velocity.swap();
    }
    P.divergence.bind();
    gl.uniform2f(P.divergence.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.divergence.u.uVelocity, velocity.read.attach(0));
    blit(divergence);
    P.clear.bind();
    gl.uniform1i(P.clear.u.uTexture, pressure.read.attach(0));
    gl.uniform1f(P.clear.u.value, C.PRESSURE);
    blit(pressure.write); pressure.swap();
    P.pressure.bind();
    gl.uniform2f(P.pressure.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.pressure.u.uDivergence, divergence.attach(0));
    for (let i = 0; i < C.PRESSURE_ITERATIONS; i++) {
      gl.uniform1i(P.pressure.u.uPressure, pressure.read.attach(1));
      blit(pressure.write); pressure.swap();
    }
    P.gradientSubtract.bind();
    gl.uniform2f(P.gradientSubtract.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    gl.uniform1i(P.gradientSubtract.u.uPressure, pressure.read.attach(0));
    gl.uniform1i(P.gradientSubtract.u.uVelocity, velocity.read.attach(1));
    blit(velocity.write); velocity.swap();
    P.advection.bind();
    gl.uniform2f(P.advection.u.texelSize, velocity.texelSizeX, velocity.texelSizeY);
    if (!ext.supportLinearFiltering) gl.uniform2f(P.advection.u.dyeTexelSize, velocity.texelSizeX, velocity.texelSizeY);
    const vid = velocity.read.attach(0);
    gl.uniform1i(P.advection.u.uVelocity, vid);
    gl.uniform1i(P.advection.u.uSource, vid);
    gl.uniform1f(P.advection.u.dt, dt);
    gl.uniform1f(P.advection.u.dissipation, C.VELOCITY_DISSIPATION);
    blit(velocity.write); velocity.swap();
    if (!ext.supportLinearFiltering) gl.uniform2f(P.advection.u.dyeTexelSize, dye.texelSizeX, dye.texelSizeY);
    gl.uniform1i(P.advection.u.uVelocity, velocity.read.attach(0));
    gl.uniform1i(P.advection.u.uSource, dye.read.attach(1));
    gl.uniform1f(P.advection.u.dissipation, C.DENSITY_DISSIPATION);
    blit(dye.write); dye.swap();
  }
  function applyBloom(source, destination) {
    if (bloomFBs.length < 2) return;
    let last = destination;
    gl.disable(gl.BLEND);
    P.bloomPrefilter.bind();
    const knee = C.BLOOM_THRESHOLD * C.BLOOM_SOFT_KNEE + 0.0001;
    gl.uniform3f(P.bloomPrefilter.u.curve, C.BLOOM_THRESHOLD - knee, knee * 2, 0.25 / knee);
    gl.uniform1f(P.bloomPrefilter.u.threshold, C.BLOOM_THRESHOLD);
    gl.uniform1i(P.bloomPrefilter.u.uTexture, source.attach(0));
    blit(last);
    P.bloomBlur.bind();
    for (let i = 0; i < bloomFBs.length; i++) {
      const dest = bloomFBs[i];
      gl.uniform2f(P.bloomBlur.u.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(P.bloomBlur.u.uTexture, last.attach(0));
      blit(dest); last = dest;
    }
    gl.blendFunc(gl.ONE, gl.ONE); gl.enable(gl.BLEND);
    for (let i = bloomFBs.length - 2; i >= 0; i--) {
      const base = bloomFBs[i];
      gl.uniform2f(P.bloomBlur.u.texelSize, last.texelSizeX, last.texelSizeY);
      gl.uniform1i(P.bloomBlur.u.uTexture, last.attach(0));
      blit(base); last = base;
    }
    gl.disable(gl.BLEND);
    P.bloomFinal.bind();
    gl.uniform2f(P.bloomFinal.u.texelSize, last.texelSizeX, last.texelSizeY);
    gl.uniform1i(P.bloomFinal.u.uTexture, last.attach(0));
    gl.uniform1f(P.bloomFinal.u.intensity, C.BLOOM_INTENSITY);
    blit(destination);
  }
  function applySunrays(source, mask, destination) {
    gl.disable(gl.BLEND);
    P.sunraysMask.bind();
    gl.uniform1i(P.sunraysMask.u.uTexture, source.attach(0));
    blit(mask);
    P.sunrays.bind();
    gl.uniform1f(P.sunrays.u.weight, C.SUNRAYS_WEIGHT);
    gl.uniform1i(P.sunrays.u.uTexture, mask.attach(0));
    blit(destination);
  }
  function blur(target, temp, iterations) {
    P.blur.bind();
    for (let i = 0; i < iterations; i++) {
      gl.uniform2f(P.blur.u.texelSize, target.texelSizeX, 0); gl.uniform1i(P.blur.u.uTexture, target.attach(0)); blit(temp);
      gl.uniform2f(P.blur.u.texelSize, 0, target.texelSizeY); gl.uniform1i(P.blur.u.uTexture, temp.attach(0)); blit(target);
    }
  }
  function render() {
    if (C.BLOOM) applyBloom(dye.read, bloom);
    if (C.SUNRAYS) { applySunrays(dye.read, dye.write, sunrays); blur(sunrays, sunraysTemp, 1); }
    gl.disable(gl.BLEND);                                          // the canvas itself is the compositor: premultiplied dye over the black
    displayProgram.bind();
    if (C.SHADING) gl.uniform2f(displayProgram.u.texelSize, 1 / gl.drawingBufferWidth, 1 / gl.drawingBufferHeight);
    gl.uniform1i(displayProgram.u.uTexture, dye.read.attach(0));
    if (C.BLOOM) gl.uniform1i(displayProgram.u.uBloom, bloom.attach(1));
    if (C.SUNRAYS) gl.uniform1i(displayProgram.u.uSunrays, sunrays.attach(2));
    blit(null);
  }

  /* ───────────── the guard: the fluid's OWN cost (awake frame time − asleep frame time), sustained → lighter, then off.
     A page that is slow for other reasons keeps its fluid; a fluid that costs > 12 ms a frame loses quality, then goes.
     Until the first sleep there is no baseline, so only an unusable page (< 20 fps) counts. ───────────── */
  let warm = 0, emaIdle = -1, emaAwake = -1, slow = 0, level = 0, lastT = 0;
  function guard(t, stepped) {
    if (!C.GUARD) return;
    const dt = lastT ? Math.min(t - lastT, 0.1) : 1 / 60; lastT = t;   // real frame time (the loop clamps its dt); a hidden tab's gap counts as one 100 ms frame
    if (!stepped) { emaIdle = emaIdle < 0 ? dt : emaIdle + (dt - emaIdle) * 0.05; return; }
    warm += dt; if (warm < 2) return;                              // shader warm-up and image decoding do not count
    emaAwake = emaAwake < 0 ? dt : emaAwake + (dt - emaAwake) * 0.05;
    const cost = emaIdle < 0 ? 0 : emaAwake - emaIdle;
    const bad = cost > 0.012 || emaAwake > 0.05;
    slow = bad ? slow + dt : Math.max(0, slow - dt * 0.5);
    if (slow < 2) return;
    slow = 0; emaAwake = -1; level++;
    if (level === 1) { C.DYE_RESOLUTION = 256; C.BLOOM_RESOLUTION = 128; C.SUNRAYS = false; C.SHADING = false; updateDisplayProgram(); initFramebuffers(); }
    else destroy();
  }

  /* ───────────── the frame (inside the one loop) ───────────── */
  function tick(dt, t) {
    if (!live) return;
    if (resizeCanvas()) initFramebuffers();
    if (!awake) { guard(t, false); return; }
    const sdt = Math.min(dt, 1 / 60);                              // the solver never integrates more than a 60 Hz step (stability); the guard sees the real frame time
    updateColors(sdt); applyInputs(); step(sdt); render();
    if (t - lastInput > C.SLEEP_AFTER) {                           // dye at e^(−2.5·4) — gone. Sleep: clear the canvas, stop stepping until the next move.
      awake = false; gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.clear(gl.COLOR_BUFFER_BIT);
    }
    guard(t, true);
  }
  function destroy() {
    if (!live) return; live = false;
    AK.loop.remove(tick); ac && ac.abort();
    canvas.classList.add('is-gone');                               // CSS fades it out; the black is already underneath
    setTimeout(() => { const lc = gl.getExtension('WEBGL_lose_context'); lc && lc.loseContext(); canvas.remove(); }, 900);
  }

  /* ───────────── boot ───────────── */
  try {
    host.appendChild(canvas);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); gl.enableVertexAttribArray(0);
    P.vs = compileShader(gl.VERTEX_SHADER, VERT);
    const vsBlur = compileShader(gl.VERTEX_SHADER, VERT_BLUR);
    P.blur = makeProgram(vsBlur, FS.blur);
    for (const k of ['copy', 'clear', 'bloomPrefilter', 'bloomBlur', 'bloomFinal', 'sunraysMask', 'sunrays', 'splat', 'divergence', 'curl', 'vorticity', 'pressure', 'gradientSubtract']) P[k] = makeProgram(P.vs, FS[k]);
    P.advection = makeProgram(P.vs, FS.advection, ext.supportLinearFiltering ? null : ['MANUAL_FILTERING']);
    updateDisplayProgram();
    resizeCanvas(); initFramebuffers();
    live = true;
    if (C.IMMEDIATE) { splatStack.push(Math.floor(Math.random() * 4) + 5); wake(); }   // 5–8 splats: a burst, not a wash
    AK.loop.add(tick);
  } catch (err) {
    live = false; canvas.remove();                                 // any GL hiccup → the gradient, silently (the page's error fail-safe is for the page)
    if (console && console.warn) console.warn('fluid off:', err && err.message);
    return;
  }

  window.AK_FLUID = Object.freeze({
    config: C,
    burst(n) { splatStack.push(n || 8); wake(); },
    wake, destroy,
    get live() { return live; }, get awake() { return awake; }, get level() { return level; },
  });
  } catch (err) { if (window.console) console.warn('fluid off:', err && err.message); }   // never the page's problem: the gradient is always there
})();

