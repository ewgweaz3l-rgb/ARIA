/* =====================================================================
   ARIA VR — WebXR panel mode (SteamVR / OpenXR headsets via Chrome or Edge).
   The two MFDs, the UFC deck and the app band float in a cockpit arc.
   Controllers: point at a panel and pull the trigger to click what's there.
   Cougar buttons, voice and push-to-talk keep working as they are.
   Raw WebGL (no engine); html2canvas turns the live DOM panels into textures.
   ===================================================================== */
const VR = {
  session: null, gl: null, refSpace: null, panels: [], prog: null, quad: null, cursorTex: null, busy: false, lastCap: 0,
  status: 'unknown', supported: false,
  cfg() { return {dist: 0.9, height: 1.25, spread: 38, scale: 1, pitch: -8, ...store.get('vrCfg', {})}; },
  setCfg(o) { store.set('vrCfg', {...this.cfg(), ...o}); this.layout(); }
};
async function vrCheck() {
  if (!navigator.xr) { VR.status = 'This browser has no WebXR. Use Chrome or Edge with an OpenXR runtime (SteamVR / Pimax / Oculus) running.'; VR.supported = false; return false; }
  try { VR.supported = await navigator.xr.isSessionSupported('immersive-vr'); VR.status = VR.supported ? 'Headset ready.' : 'No VR runtime found. Start SteamVR (or your headset\'s software) and reload.'; }
  catch (e) { VR.supported = false; VR.status = 'WebXR error: ' + e.message; }
  return VR.supported;
}
// ---- tiny matrix helpers (column-major, WebGL style) ----
const M4 = {
  mul(a, b) { const o = new Float32Array(16); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + i] * b[j * 4 + k]; o[j * 4 + i] = s; } return o; },
  trs(x, y, z, yaw, pitch, sx, sy) {  // translate, rotate Y then X, scale
    const cy = Math.cos(yaw), sy_ = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const ry = [cy, 0, -sy_, 0, 0, 1, 0, 0, sy_, 0, cy, 0, 0, 0, 0, 1], rx = [1, 0, 0, 0, 0, cp, sp, 0, 0, -sp, cp, 0, 0, 0, 0, 1];
    const r = M4.mul(ry, rx); const o = new Float32Array(r);
    o[0] *= sx; o[1] *= sx; o[2] *= sx; o[4] *= sy; o[5] *= sy; o[6] *= sy; o[12] = x; o[13] = y; o[14] = z; return o;
  },
  xform(m, v) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2] + m[12], m[1] * v[0] + m[5] * v[1] + m[9] * v[2] + m[13], m[2] * v[0] + m[6] * v[1] + m[10] * v[2] + m[14]]; },
  dir(m, v) { return [m[0] * v[0] + m[4] * v[1] + m[8] * v[2], m[1] * v[0] + m[5] * v[1] + m[9] * v[2], m[2] * v[0] + m[6] * v[1] + m[10] * v[2]]; }
};
const V3 = {sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], norm(a) { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }};

function vrPanelsDef() {
  // id, DOM element, physical width in metres, position in the arc: yaw (deg, + = right), height offset, extra distance
  return [
    {id: 'L', el: $('#mfdL'), w: 0.42, yaw: -1, dy: 0, dz: 0, every: 180},
    {id: 'R', el: $('#mfdR'), w: 0.42, yaw: 1, dy: 0, dz: 0, every: 180},
    {id: 'U', el: $('#cockTop'), w: 0.62, yaw: 0, dy: 0.08, dz: 0.05, every: 250},
    {id: 'A', el: $('#appShell'), w: 1.3, yaw: 0, dy: -0.52, dz: 0.1, every: 700, scale: .6}
  ].filter(p => p.el);
}
function vrLayout() {
  const c = VR.cfg(), toRad = d => d * Math.PI / 180;
  for (const p of VR.panels) {
    const r = p.el.getBoundingClientRect(); p.aspect = r.width && r.height ? r.width / r.height : 1;
    p.pw = p.w * c.scale; p.ph = p.pw / p.aspect;
    const yaw = toRad(p.yaw * c.spread), dist = c.dist + p.dz;
    p.pos = [Math.sin(yaw) * dist, c.height + p.dy, -Math.cos(yaw) * dist];
    p.model = M4.trs(p.pos[0], p.pos[1], p.pos[2], -yaw, toRad(c.pitch), p.pw, p.ph);
    p.normal = V3.norm(M4.dir(p.model, [0, 0, 1])); p.u = V3.norm(M4.dir(p.model, [1, 0, 0])); p.v = V3.norm(M4.dir(p.model, [0, 1, 0]));
  }
}
VR.layout = vrLayout;
const VS = `attribute vec2 p;uniform mat4 mvp;varying vec2 uv;void main(){uv=vec2(p.x+.5,.5-p.y);gl_Position=mvp*vec4(p,0.,1.);}`;
const FS = `precision mediump float;uniform sampler2D t;uniform float a;varying vec2 uv;void main(){vec4 c=texture2D(t,uv);gl_FragColor=vec4(c.rgb,c.a*a);}`;
function glInit(gl) {
  const sh = (t, s) => { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); return o; };
  const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr);
  VR.prog = {pr, p: gl.getAttribLocation(pr, 'p'), mvp: gl.getUniformLocation(pr, 'mvp'), t: gl.getUniformLocation(pr, 't'), a: gl.getUniformLocation(pr, 'a')};
  VR.quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, VR.quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-.5, -.5, .5, -.5, -.5, .5, .5, .5]), gl.STATIC_DRAW);
  const mk = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  for (const p of VR.panels) { p.tex = mk(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255])); }
  // cursor dot
  const cc = document.createElement('canvas'); cc.width = cc.height = 32; const x = cc.getContext('2d'); x.fillStyle = '#fff'; x.beginPath(); x.arc(16, 16, 10, 0, 7); x.fill(); x.fillStyle = '#f2a83b'; x.beginPath(); x.arc(16, 16, 6, 0, 7); x.fill();
  VR.cursorTex = mk(); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cc);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
}
async function vrCapture(p) {
  if (p.capturing || !window.html2canvas) return;
  p.capturing = true;
  try {
    const cv = await html2canvas(p.el, {backgroundColor: '#04070c', scale: p.scale || 1, logging: false, useCORS: true, ignoreElements: e => e.classList && e.classList.contains('fxcv')});
    const gl = VR.gl; if (!gl) return;
    gl.bindTexture(gl.TEXTURE_2D, p.tex); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, cv);
    p.last = performance.now();
  } catch (e) { p.err = e.message; } finally { p.capturing = false; }
}
function vrHit(origin, dir, p) {
  const denom = V3.dot(dir, p.normal); if (Math.abs(denom) < 1e-4) return null;
  const t = V3.dot(V3.sub(p.pos, origin), p.normal) / denom; if (t < 0.02) return null;
  const hit = [origin[0] + dir[0] * t, origin[1] + dir[1] * t, origin[2] + dir[2] * t], d = V3.sub(hit, p.pos);
  const u = V3.dot(d, p.u) / p.pw + .5, v = .5 - V3.dot(d, p.v) / p.ph;
  return u >= 0 && u <= 1 && v >= 0 && v <= 1 ? {t, u, v, hit} : null;
}
function vrClick(p, u, v) {
  const r = p.el.getBoundingClientRect(), x = r.left + u * r.width, y = r.top + v * r.height;
  const el = document.elementFromPoint(x, y); if (!el) return;
  const target = el.closest('button, .osb, .csq, .jstop, .chip, a, input, select, label') || el;
  if (target.tagName === 'INPUT' && (target.type === 'range' || target.type === 'checkbox')) { if (target.type === 'checkbox') target.click(); return; }
  target.click(); vlog && vlog(`VR click → ${(target.textContent || target.id || target.tagName).trim().slice(0, 20)}`);
}
function vrFrame(time, frame) {
  const s = VR.session; if (!s) return;
  s.requestAnimationFrame(vrFrame);
  const pose = frame.getViewerPose(VR.refSpace); if (!pose) return;
  const gl = VR.gl, layer = s.renderState.baseLayer;
  // refresh panel textures round-robin
  const now = performance.now();
  for (const p of VR.panels) if (!p.capturing && now - (p.last || 0) > p.every) { vrCapture(p); break; }
  // controller rays → cursors
  VR.cursors = [];
  for (const src of s.inputSources) {
    if (!src.targetRaySpace) continue;
    const rp = frame.getPose(src.targetRaySpace, VR.refSpace); if (!rp) continue;
    const m = rp.transform.matrix, o = [m[12], m[13], m[14]], d = V3.norm(M4.dir(m, [0, 0, -1]));
    let best = null;
    for (const p of VR.panels) { const h = vrHit(o, d, p); if (h && (!best || h.t < best.t)) best = {...h, p}; }
    src._hover = best; if (best) VR.cursors.push(best);
  }
  gl.bindFramebuffer(gl.FRAMEBUFFER, layer.framebuffer);
  gl.clearColor(0.015, 0.025, 0.04, 1); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(VR.prog.pr); gl.bindBuffer(gl.ARRAY_BUFFER, VR.quad); gl.enableVertexAttribArray(VR.prog.p); gl.vertexAttribPointer(VR.prog.p, 2, gl.FLOAT, false, 0, 0); gl.uniform1i(VR.prog.t, 0);
  for (const view of pose.views) {
    const vp = layer.getViewport(view); gl.viewport(vp.x, vp.y, vp.width, vp.height);
    const pv = M4.mul(view.projectionMatrix, view.transform.inverse.matrix);
    for (const p of VR.panels) { gl.uniformMatrix4fv(VR.prog.mvp, false, M4.mul(pv, p.model)); gl.bindTexture(gl.TEXTURE_2D, p.tex); gl.uniform1f(VR.prog.a, 1); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4); }
    for (const c of VR.cursors) {
      const cm = M4.trs(c.hit[0] + c.p.normal[0] * .003, c.hit[1] + c.p.normal[1] * .003, c.hit[2] + c.p.normal[2] * .003, Math.atan2(c.p.normal[0], c.p.normal[2]), 0, .018, .018);
      gl.uniformMatrix4fv(VR.prog.mvp, false, M4.mul(pv, cm)); gl.bindTexture(gl.TEXTURE_2D, VR.cursorTex); gl.uniform1f(VR.prog.a, .95); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}
async function enterVR() {
  if (VR.session) return exitVR();
  if (!await vrCheck()) { toast(esc(VR.status), 7000); return; }
  // WebXR immersive sessions are exclusive: the browser takes the headset from whatever holds it.
  // If a game is running in the headset right now, it loses the HMD (grey void) and may crash.
  if (!store.get('vrAck', false)) {
    const ok = confirm(`ARIA VR takes over the headset — it is not an overlay.\n\nOnly enter when NO game is running in VR (Star Citizen on the monitor is fine). If a game is in the headset right now, it will lose it and may crash.\n\nTo see ARIA inside a VR game, pin the ARIA window with an overlay tool instead (XSOverlay, Desktop+, OVR Toolkit).\n\nContinue?`);
    if (!ok) return;
    store.set('vrAck', true);
  }
  if (!CK.on) setCockpit(true);
  if (!window.html2canvas) { await new Promise((res, rej) => { const sc = document.createElement('script'); sc.src = 'vendor/html2canvas.min.js'; sc.onload = res; sc.onerror = rej; document.head.appendChild(sc); }).catch(() => {}); }
  if (!window.html2canvas) { toast('vendor/html2canvas.min.js is missing — update ARIA.'); return; }
  const cv = document.createElement('canvas'); cv.id = 'vrgl'; cv.style.cssText = 'position:fixed;left:-9999px;top:0;width:8px;height:8px'; document.body.appendChild(cv);
  const gl = cv.getContext('webgl', {xrCompatible: true, alpha: false, antialias: true}); if (!gl) { toast('WebGL unavailable.'); return; }
  try {
    const session = await navigator.xr.requestSession('immersive-vr', {optionalFeatures: ['local-floor', 'bounded-floor']});
    VR.session = session; VR.gl = gl; VR.panels = vrPanelsDef();
    await gl.makeXRCompatible();
    session.updateRenderState({baseLayer: new XRWebGLLayer(session, gl)});
    try { VR.refSpace = await session.requestReferenceSpace('local-floor'); } catch { VR.refSpace = await session.requestReferenceSpace('local'); VR.setCfg({height: 0.1}); }
    glInit(gl); vrLayout();
    session.addEventListener('selectstart', ev => { const h = ev.inputSource._hover; if (h) vrClick(h.p, h.u, h.v); });
    session.addEventListener('squeezestart', () => vrRecenter());
    session.addEventListener('end', () => { VR.session = null; VR.gl = null; cv.remove(); document.body.classList.remove('invr'); toast('Left VR.'); if (CK.on) ufcRender(); });
    document.body.classList.add('invr');
    session.requestAnimationFrame(vrFrame);
    say('VR panels up. Point and pull the trigger to click. Squeeze the grip to recenter.', 'vr-on');
    for (const p of VR.panels) vrCapture(p);
  } catch (e) { toast('Could not start VR: ' + esc(e.message), 8000); cv.remove(); VR.session = null; }
}
function exitVR() { if (VR.session) VR.session.end(); }
async function vrRecenter() {
  // move the arc to where you are looking now: re-request the reference space (headsets treat this as "reset view")
  try { VR.refSpace = await VR.session.requestReferenceSpace('local-floor'); } catch {}
  toast('VR view recentered.');
}
