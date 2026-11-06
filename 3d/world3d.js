// Gravity Gulp 3D: draws the galaxy with three.js under the unchanged 2D game logic.
// The game plays on a flat plane (x right, y down). Here that plane is X = x, Y = -y, and Z is up.
// A tilted camera looks at it, and a space-time grid dents into a funnel under every black hole;
// junk slides down the funnel as it is pulled in. The 2D canvas on top keeps the HUD and the names.
import * as THREE from './three.module.min.js';

const H = window.GG3D;
const TAU = Math.PI * 2;
const FOV = 32, TILT = 30 * Math.PI / 180;          // camera field of view, and how far it leans back from straight down
const MAXH = 8;                                      // holes the grid shader knows about

const glCanvas = document.getElementById('gl');
let renderer = null;
try { renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, powerPreference: 'high-performance' }); } catch (e) { renderer = null; }
if (!renderer || !H) dispatchEvent(new Event('world3dfail'));

if (renderer && H){
const lowEnd = (navigator.hardwareConcurrency || 4) <= 4 && matchMedia('(pointer: coarse)').matches;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(FOV, 1, 10, 20000);
camera.up.set(0, 0, 1);

// ---------- light: a bright star off to the upper left, a soft violet fill ----------
const hemi = new THREE.HemisphereLight(0xb8b0ff, 0x1a1040, 1.1); hemi.position.set(0, 0, 1); scene.add(hemi);
const star = new THREE.DirectionalLight(0xfff2e0, 2.8); scene.add(star, star.target);
const rim = new THREE.DirectionalLight(0xff70c8, .9); scene.add(rim, rim.target);

// ---------- helpers ----------
const hash = n => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const col = c => new THREE.Color(c);
function canvasTex(w, h, paint, srgb = true){
  const c = document.createElement('canvas'); c.width = w; c.height = h; paint(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const glowTex = canvasTex(128, 128, (g, w) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 64); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(.25, 'rgba(255,255,255,.45)'); r.addColorStop(.6, 'rgba(255,255,255,.1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, w, w); });
const ringTex = canvasTex(256, 256, (g) => { const r = g.createRadialGradient(128, 128, 96, 128, 128, 128); r.addColorStop(0, 'rgba(255,255,255,0)'); r.addColorStop(.55, 'rgba(255,255,255,1)'); r.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = r; g.fillRect(0, 0, 256, 256); });
const glowMat = color => new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true });
const rand = seed => { let a = seed | 0; return () => { a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };

// ---------- the space-time well: depth under every hole, the same formula in JS and in the shader ----------
const holeU = Array.from({ length: MAXH }, () => new THREE.Vector4(0, 0, 0, 1));
let wellHoles = [];
function setWell(list){ wellHoles = list; for (let i = 0; i < MAXH; i++){ const h = list[i]; if (h) holeU[i].set(h.x, -h.y, h.R * 2.6, h.R * 2.4); else holeU[i].set(0, 0, 0, 1); } }
function depthAt(X, Y){ let d = 0; for (let i = 0; i < MAXH; i++){ const u = holeU[i]; if (u.z <= 0) continue; const dx = X - u.x, dy = Y - u.y; d += u.z / (1 + (dx * dx + dy * dy) / (u.w * u.w)); } return d; }
const surfZ = (x, y) => -depthAt(x, -y);

// the grid: a fine mesh pulled down by the holes, with glowing lines drawn in the shader
const W = H.WORLD, PAD = 900;
const ripU = Array.from({ length: 4 }, () => new THREE.Vector4(0, 0, 99, 0));
const gridUni = { uRip: { value: ripU }, uHoles: { value: holeU }, uTime: { value: 0 }, uNova: { value: 0 }, uWorld: { value: W }, uCol: { value: col(0x8f7bff) }, uHot: { value: col(0xff8ad8) } };
const gridMat = new THREE.ShaderMaterial({
  uniforms: gridUni, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `
    uniform vec4 uHoles[${MAXH}]; uniform vec4 uRip[4];
    varying vec2 vP; varying float vD; varying float vW;
    void main(){
      vec3 p = position; float d = 0.0;
      for (int i = 0; i < ${MAXH}; i++){ vec4 h = uHoles[i]; if (h.z <= 0.0) continue; vec2 q = p.xy - h.xy; d += h.z / (1.0 + dot(q, q) / (h.w * h.w)); }
      // shockwaves: a ring that runs out across the grid after a big swallow
      float w = 0.0;
      for (int i = 0; i < 4; i++){ vec4 r = uRip[i]; if (r.z > 2.0) continue; float x = length(p.xy - r.xy) - r.z * 900.0; w += r.w * exp(-x * x / 9000.0) * (1.0 - r.z / 2.0); }
      p.z = -d + w * 0.6; vP = p.xy; vD = d; vW = w;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: `
    uniform float uTime, uNova, uWorld; uniform vec3 uCol, uHot;
    varying vec2 vP; varying float vD; varying float vW;
    float lines(vec2 p, float s, float w){ vec2 g = abs(fract(p / s - 0.5) - 0.5) / (fwidth(p / s) * w); return 1.0 - min(min(g.x, g.y), 1.0); }
    void main(){
      vec2 w = vec2(vP.x, -vP.y);
      float inside = step(0.0, w.x) * step(w.x, uWorld) * step(0.0, w.y) * step(w.y, uWorld);
      float edge = min(min(w.x, uWorld - w.x), min(w.y, uWorld - w.y));
      float fadeOut = clamp(1.0 + edge / 500.0, 0.0, 1.0);                // beyond the wall the grid fades away
      float l = max(lines(vP, 100.0, 1.3) * 0.6, lines(vP, 400.0, 1.8));
      float hot = clamp(vD / 120.0, 0.0, 1.0);
      vec3 c = mix(uCol, uHot, hot); c = mix(c, vec3(1.0, 0.62, 0.3), uNova * 0.7);
      float a = l * (0.3 + hot * 0.9) * (inside > 0.5 ? 1.0 : 0.35) * fadeOut;
      a += hot * hot * 0.12 * inside;
      a += l * clamp(vW / 40.0, 0.0, 1.0) * 0.9; c = mix(c, vec3(1.0, 0.9, 0.95), clamp(vW / 60.0, 0.0, 0.6));                                       // the well itself glows faintly
      gl_FragColor = vec4(c * a, a);
    }`,
});
const gridGeo = new THREE.PlaneGeometry(W + PAD * 2, W + PAD * 2, lowEnd ? 140 : 220, lowEnd ? 140 : 220);
gridGeo.translate(W / 2, -W / 2, 0);
const grid = new THREE.Mesh(gridGeo, gridMat); grid.frustumCulled = false; grid.renderOrder = -1; scene.add(grid);

// the world's wall: a glowing pink band
const wallMat = new THREE.MeshBasicMaterial({ color: 0xff5daa, transparent: true, opacity: .32, blending: THREE.AdditiveBlending, depthWrite: false });
for (const [x, y, w, h] of [[W / 2, 0, W + 12, 6], [W / 2, W, W + 12, 6], [0, W / 2, 6, W + 12], [W, W / 2, 6, W + 12]]){
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, 18), wallMat); m.position.set(x, -y, 6); scene.add(m);
  const m2 = new THREE.Mesh(new THREE.BoxGeometry(w + 30, h + 30, 2), new THREE.MeshBasicMaterial({ color: 0xff5daa, transparent: true, opacity: .05, blending: THREE.AdditiveBlending, depthWrite: false })); m2.position.set(x, -y, 1); scene.add(m2);
}

// deep stars far below the plane: real parallax as the camera moves
{
  const n = lowEnd ? 1400 : 2600, p = new Float32Array(n * 3), c = new Float32Array(n * 3), r = rand(7);
  for (let i = 0; i < n; i++){
    p[i * 3] = -1500 + r() * (W + 3000); p[i * 3 + 1] = 1500 - r() * (W + 3000); p[i * 3 + 2] = -300 - r() * 2600;
    const k = r(), cc = k < .2 ? col(0xc9b8ff) : k < .3 ? col(0xffd6a0) : col(0xffffff); const b = .5 + r() * .5;
    c[i * 3] = cc.r * b; c[i * 3 + 1] = cc.g * b; c[i * 3 + 2] = cc.b * b;
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3)); g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const starPts = new THREE.Points(g, new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, vertexColors: true, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
  starPts.frustumCulled = false; scene.add(starPts);
}

// ---------- textures for the round things ----------
function bandTex(seed, stops, bandCol){
  return canvasTex(512, 256, (g, w, h) => {
    const r = rand(seed), gr = g.createLinearGradient(0, 0, 0, h); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 26; i++){ const y = r() * h, hh = 2 + r() * 14; g.fillStyle = `rgba(${r() < .5 ? bandCol : '0,10,40'},${.08 + r() * .22})`; g.fillRect(0, y, w, hh); }
    for (let i = 0; i < 5; i++){ const x = r() * w, y = h * (.3 + r() * .4), rr = 6 + r() * 14; g.fillStyle = `rgba(${bandCol},.35)`; g.beginPath(); g.ellipse(x, y, rr * 1.8, rr, 0, 0, TAU); g.fill(); }
  });
}
const moonTex = canvasTex(512, 256, (g, w, h) => {
  const r = rand(3); g.fillStyle = '#c9c6d8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 2600; i++){ g.fillStyle = `rgba(${r() < .5 ? '255,255,255' : '40,36,60'},${r() * .08})`; g.fillRect(r() * w, r() * h, 3, 3); }
  for (let i = 0; i < 70; i++){ const x = r() * w, y = r() * h, cr = 3 + r() * 16; g.fillStyle = 'rgba(40,36,70,.32)'; g.beginPath(); g.ellipse(x, y, cr, cr * .9, 0, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,.16)'; g.beginPath(); g.ellipse(x - cr * .25, y - cr * .25, cr * .55, cr * .5, 0, 0, TAU); g.fill(); }
});
const planetTex = bandTex(11, ['#d8fff4', '#5fe6d0', '#2fbfb0', '#167a88', '#0b3a5a', '#2fbfb0', '#c9fff0'], '190,255,240');
const giantTex = bandTex(23, ['#e8f6ff', '#9fd2ff', '#3f8fd8', '#1d4f9a', '#0d2560', '#3f8fd8', '#bfe6ff'], '200,230,255');
const giantRingTex = canvasTex(256, 8, (g, w) => { const r = rand(5); for (let x = 0; x < w; x++){ const a = (.15 + r() * .6) * Math.sin(x / w * Math.PI); g.fillStyle = `rgba(210,230,255,${a})`; g.fillRect(x, 0, 1, 8); } });

// ---------- the junk: one instanced mesh per kind ----------
function jitterGeo(geo, amt, seed){
  const g = geo.toNonIndexed(), p = g.attributes.position, r = rand(seed), key = new Map();
  for (let i = 0; i < p.count; i++){
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!key.has(k)) key.set(k, 1 + (r() - .5) * amt);
    const s = key.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
  }
  g.computeVertexNormals(); return g;
}
function merged(parts){       // [geometry, color] → one geometry with vertex colours
  const P = [], N = [], C = [];
  for (const [geo, c] of parts){ const g = geo.index ? geo.toNonIndexed() : geo; g.computeVertexNormals(); const cc = col(c); const p = g.attributes.position.array, n = g.attributes.normal.array; for (let i = 0; i < p.length; i++){ P.push(p[i]); N.push(n[i]); } for (let i = 0; i < p.length / 3; i++) C.push(cc.r, cc.g, cc.b); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(C, 3)); return g;
}
const satGeo = merged([
  [new THREE.CylinderGeometry(.32, .32, 1.1, 10).rotateZ(Math.PI / 2), 0x3a5cc8],
  [new THREE.CylinderGeometry(.36, .36, .22, 10).rotateZ(Math.PI / 2).translate(.6, 0, 0), 0xff9a3d],
  [new THREE.CylinderGeometry(.36, .36, .22, 10).rotateZ(Math.PI / 2).translate(-.6, 0, 0), 0xff9a3d],
  [new THREE.BoxGeometry(.5, 1.5, .04).translate(0, 1.1, 0), 0x6ab4ff],
  [new THREE.BoxGeometry(.5, 1.5, .04).translate(0, -1.1, 0), 0x6ab4ff],
  [new THREE.BoxGeometry(.06, .5, .06).translate(0, .45, 0), 0xc9d4ff],
  [new THREE.BoxGeometry(.06, .5, .06).translate(0, -.45, 0), 0xc9d4ff],
]);
const stationGeo = merged([
  [new THREE.TorusGeometry(.75, .13, 8, 28), 0xffb347],
  [new THREE.BoxGeometry(.14, 1.5, .14), 0xc9d4ff], [new THREE.BoxGeometry(1.5, .14, .14), 0xc9d4ff],
  [new THREE.SphereGeometry(.26, 14, 10), 0xffd34d],
  [new THREE.CylinderGeometry(.08, .08, .7, 8).rotateX(Math.PI / 2).translate(0, 0, .3), 0xe8ecff],
]);
const KIND3 = {
  dust:    { geo: new THREE.IcosahedronGeometry(.8, 0), mat: new THREE.MeshBasicMaterial({ color: 0xd8ccff }), tint: () => col(0xffffff).lerp(col(0xb8a0ff), Math.random()), glow: 0 },
  rock:    { geo: jitterGeo(new THREE.IcosahedronGeometry(1, 1), .45, 1), mat: new THREE.MeshStandardMaterial({ roughness: .9, flatShading: true }), tint: i => col(0x9a90b8).multiplyScalar(.7 + hash(i) * .5) },
  ast:     { geo: jitterGeo(new THREE.IcosahedronGeometry(1, 1), .6, 2), mat: new THREE.MeshStandardMaterial({ roughness: .95, flatShading: true }), tint: i => col(0x9a7a68).multiplyScalar(.7 + hash(i) * .5) },
  sat:     { geo: satGeo, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .4, metalness: .3, emissive: 0x10204a }) },
  station: { geo: stationGeo, mat: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35, metalness: .4, emissive: 0x3a2200 }) },
  moon:    { geo: new THREE.SphereGeometry(1, 28, 18), mat: new THREE.MeshStandardMaterial({ map: moonTex, roughness: .95 }), tint: i => col(0xffffff).multiplyScalar(.85 + hash(i) * .2) },
  planet:  { geo: new THREE.SphereGeometry(1, 36, 22), mat: new THREE.MeshStandardMaterial({ map: planetTex, roughness: .7 }), halo: 0x50f0dc },
  giant:   { geo: new THREE.SphereGeometry(1, 40, 26), mat: new THREE.MeshStandardMaterial({ map: giantTex, roughness: .65 }), halo: 0x78c8ff },
};
const objGroup = new THREE.Group(); scene.add(objGroup);
const CAP = { dust: 700, rock: 520, ast: 260, sat: 200, station: 120, moon: 70, planet: 40, giant: 20 };
for (const k in KIND3){
  const K = KIND3[k];
  K.mesh = new THREE.InstancedMesh(K.geo, K.mat, CAP[k]); K.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); K.mesh.frustumCulled = false;
  if (K.tint || k === 'dust') K.mesh.setColorAt(0, col(0xffffff));
  objGroup.add(K.mesh);
}
// rings for gas giants, halos for planets (pools)
const giantRingGeo = new THREE.RingGeometry(1.35, 2.25, 64, 1);
{ const uv = giantRingGeo.attributes.uv, p = giantRingGeo.attributes.position; for (let i = 0; i < p.count; i++){ const r = Math.hypot(p.getX(i), p.getY(i)); uv.setXY(i, (r - 1.35) / .9, .5); } }
const giantRingMat = new THREE.MeshStandardMaterial({ map: giantRingTex, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: .8 });
const ringPool = [], haloPool = [];
const poolGet = (pool, make, i) => { while (pool.length <= i){ const o = make(); scene.add(o); pool.push(o); } const o = pool[i]; o.visible = true; return o; };

// ---------- black holes ----------
const discMat = color => new THREE.ShaderMaterial({
  uniforms: { uCol: { value: col(color) }, uTime: { value: 0 }, uGlow: { value: 1 } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: `varying vec2 vP; void main(){ vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform vec3 uCol; uniform float uTime, uGlow; varying vec2 vP;
    float n(float x){ return fract(sin(x) * 43758.5453); }
    void main(){
      float r = length(vP), a = atan(vP.y, vP.x);
      float t = (r - 1.0) / 1.6;                                            // 0 at the core, 1 at the outer edge
      float swirl = a * 2.0 + log(r) * 7.0 - uTime;
      float s = 0.55 + 0.45 * sin(swirl * 3.0) * sin(swirl * 1.3 + 1.7);
      float streak = pow(max(0.0, sin(swirl * 5.0 + r * 3.0)), 6.0);
      float fall = pow(1.0 - clamp(t, 0.0, 1.0), 2.2);
      vec3 c = mix(uCol, vec3(1.0, 0.95, 0.88), pow(fall, 3.0) * 0.8);
      float k = (fall * (0.7 + 0.5 * s) + streak * fall * 0.9) * uGlow * 1.6;
      k *= smoothstep(0.0, 0.08, t);                                        // soft inner edge
      gl_FragColor = vec4(c * k, k);
    }`,
});
const coreMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
const coreGeo = new THREE.SphereGeometry(1, 32, 20), discGeo = new THREE.RingGeometry(1.02, 2.6, 96, 4), tiltGeo = new THREE.RingGeometry(1.1, 3.3, 96, 4);
function holeModel(){
  const g = new THREE.Group();
  const halo = new THREE.Sprite(glowMat(0xffffff)); halo.renderOrder = 1; g.add(halo);
  const disc = new THREE.Mesh(discGeo, discMat(0xffffff)); disc.renderOrder = 2; g.add(disc);                              // the swirl lying on the grid
  const tilt = new THREE.Mesh(tiltGeo, discMat(0xffffff)); tilt.renderOrder = 2; tilt.rotation.set(-.74, .16, 0); g.add(tilt);   // a bright band leaning toward the camera, crossing the core
  const core = new THREE.Mesh(coreGeo, coreMat); g.add(core);
  const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: ringTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); ring.renderOrder = 3; g.add(ring);
  // power-up visuals: a magnet ring on the grid, a hexagon shield bubble
  const mag = new THREE.Mesh(new THREE.TorusGeometry(1, .012, 6, 96), new THREE.MeshBasicMaterial({ color: 0xff5fc8, transparent: true, opacity: .7, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(mag);
  const shield = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x5ef0a0, wireframe: true, transparent: true, opacity: .75, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(shield);
  const shieldFill = new THREE.Mesh(new THREE.IcosahedronGeometry(.98, 2), new THREE.MeshBasicMaterial({ color: 0x5ef0a0, transparent: true, opacity: .12, blending: THREE.AdditiveBlending, depthWrite: false })); g.add(shieldFill);
  g.userData = { halo, disc, tilt, core, ring, mag, shield, shieldFill, color: '' };
  scene.add(g); return g;
}
const holePool = [];
function placeHole(i, h, now, glow = 1){
  const g = poolGet(holePool, holeModel, i), u = g.userData, R = h.R;
  if (u.color !== h.color){ u.color = h.color; u.disc.material.uniforms.uCol.value.set(h.color); u.tilt.material.uniforms.uCol.value.set(h.color).lerp(col(0xffe0b0), .35); u.halo.material.color.set(h.color); u.ring.material.color.set(h.color).lerp(col(0xffffff), .6); }
  const z = surfZ(h.x, h.y) * .55;
  g.position.set(h.x, -h.y, z);
  u.core.scale.setScalar(R); u.disc.scale.setScalar(R); u.disc.material.uniforms.uTime.value = h.spin * 1.2; u.disc.material.uniforms.uGlow.value = glow * .8;
  u.tilt.scale.setScalar(R); u.tilt.material.uniforms.uTime.value = h.spin * 1.6; u.tilt.material.uniforms.uGlow.value = glow * 1.1;
  u.halo.scale.setScalar(R * 6.5); u.halo.material.opacity = .5 * glow;
  u.ring.scale.setScalar(R * 2.45);
  const mOn = h.pw && h.pw.magnet > 0; u.mag.visible = mOn;
  if (mOn){ const pr = H.pullR(h); u.mag.scale.set(pr, pr, pr); u.mag.position.z = surfZ(h.x + pr, h.y) - z + 2; u.mag.rotation.z = now * .8; u.mag.material.opacity = .45 + Math.sin(now * 8) * .2; }
  const sOn = h.pw && h.pw.shield > 0; u.shield.visible = u.shieldFill.visible = sOn;
  if (sOn){ const f = h.pw.shield < 1 ? (Math.sin(now * 30) > 0 ? 1 : .35) : 1; u.shield.scale.setScalar(R * 1.5); u.shieldFill.scale.setScalar(R * 1.5); u.shield.rotation.set(now * .4, now * .6, 0); u.shield.material.opacity = .75 * f; u.shieldFill.material.opacity = .12 * f; }
  return g;
}

// ---------- power-ups: a glowing orb, a halo and the symbol on a card that faces the camera ----------
function iconTex(type, c){
  return canvasTex(128, 128, (g) => {
    g.translate(64, 64); g.strokeStyle = '#fff'; g.lineWidth = 11; g.lineCap = 'round'; g.lineJoin = 'round'; const r = 40;
    if (type === 'speed'){ for (const dx of [-.35, .25]){ g.beginPath(); g.moveTo((dx - .25) * r, -.55 * r); g.lineTo((dx + .25) * r, 0); g.lineTo((dx - .25) * r, .55 * r); g.stroke(); } }
    else if (type === 'magnet'){ g.beginPath(); g.arc(0, -.05 * r, .5 * r, Math.PI, 0, true); g.stroke(); g.beginPath(); g.moveTo(-.5 * r, -.05 * r); g.lineTo(-.5 * r, -.6 * r); g.moveTo(.5 * r, -.05 * r); g.lineTo(.5 * r, -.6 * r); g.stroke(); }
    else { g.beginPath(); for (let k = 0; k <= 6; k++){ const a = k / 6 * TAU + Math.PI / 6; g[k ? 'lineTo' : 'moveTo'](Math.cos(a) * .62 * r, Math.sin(a) * .62 * r); } g.stroke(); }
  });
}
const ICON = {}; for (const k in H.POWERS) ICON[k] = iconTex(k, H.POWERS[k].c);
function pupModel(){
  const g = new THREE.Group();
  const orb = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: .6, roughness: .2, metalness: .1, transparent: true, opacity: .85 })); g.add(orb);
  const halo = new THREE.Sprite(glowMat(0xffffff)); g.add(halo);
  const icon = new THREE.Sprite(new THREE.SpriteMaterial({ map: ICON.speed, depthTest: false, transparent: true })); icon.renderOrder = 5; g.add(icon);
  const band = new THREE.Mesh(new THREE.TorusGeometry(1.3, .07, 6, 40, 1.8), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .85 })); g.add(band);
  g.userData = { orb, halo, icon, band, type: '' };
  scene.add(g); return g;
}
const pupPool = [];

// ---------- sparks: the game's particles, as small glowing bits on the grid ----------
const SPARK_MAX = 500;
const sparks = new THREE.InstancedMesh(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }), SPARK_MAX);
sparks.instanceMatrix.setUsage(THREE.DynamicDrawUsage); sparks.frustumCulled = false; sparks.setColorAt(0, col(0xffffff)); scene.add(sparks);
// trails left by the speed power-up
const trail = []; let trailT = 0;

// ---------- the menu: one big showpiece hole and a few worlds drifting past it ----------
const MENU_C = { x: 1600, y: 1600 };
const menuHole = { x: 0, y: 0, R: 80, color: '#ff8a3d', spin: 0, pw: {} };
const menuJunk = []; { const r = rand(42), kinds = ['planet', 'moon', 'ast', 'ast', 'rock', 'rock', 'rock', 'sat', 'sat', 'station', 'giant', 'rock', 'ast', 'sat']; for (let i = 0; i < kinds.length; i++) menuJunk.push({ k: kinds[i], a: r() * TAU, d: 260 + r() * 520, sp: .05 + r() * .08, rot: r() * TAU, i }); }

// ---------- per frame ----------
const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), V3 = new THREE.Vector3(), S3 = new THREE.Vector3(), E = new THREE.Euler(), tmpC = new THREE.Color();
const Mdir = new THREE.Matrix4(), Minv = new THREE.Matrix4(), Mscl = new THREE.Matrix4(), Mobj = new THREE.Matrix4();
const KOBJ = {};   // per-kind fill counts
function putJunk(kname, idx, x, y, r, rot, pull, towards, key){
  const K = KIND3[kname], n = KOBJ[kname] || 0; if (n >= CAP[kname]) return; KOBJ[kname] = n + 1;
  const big = kname === 'moon' || kname === 'planet' || kname === 'giant';
  const sz = kname === 'dust' ? r * .6 : r * (big ? 1 : kname === 'sat' ? .75 : kname === 'station' ? 1 : .9);
  const X = x, Y = -y, Z = surfZ(x, y) + sz * (big ? 1.05 : 1.3);
  // its own tumble: the 2D spin angle about a fixed random axis (planets turn about their own pole)
  const ax = V3.set(hash(key) - .5, hash(key + 1) - .5, big ? 2 : hash(key + 2) - .5).normalize();
  Q.setFromAxisAngle(ax, rot); if (big) Q.premultiply(new THREE.Quaternion().setFromEuler(E.set(.45, 0, hash(key) * TAU)));
  Mobj.compose(new THREE.Vector3(0, 0, 0), Q, S3.set(sz, sz, sz));
  // stretched toward the hole that's eating it
  if (pull > .05 && towards){
    const a = Math.atan2(-(towards.y - y), towards.x - x);
    Mdir.makeRotationZ(a); Minv.makeRotationZ(-a); Mscl.makeScale(1 + pull * 1.1, 1 - pull * .45, 1 - pull * .45);
    Mobj.premultiply(Minv).premultiply(Mscl).premultiply(Mdir);
  }
  Mobj.setPosition(X, Y, Z);
  K.mesh.setMatrixAt(n, Mobj);
  if (K.tint) K.mesh.setColorAt(n, K.tint(key));
  if (kname === 'giant'){ const ring = poolGet(ringPool, () => new THREE.Mesh(giantRingGeo, giantRingMat), giantRingI++); ring.position.set(X, Y, Z); ring.scale.setScalar(sz); ring.rotation.set(1.15, .25, hash(key) * 2); }
  if (K.halo){ const s = poolGet(haloPool, () => new THREE.Sprite(glowMat(0xffffff)), haloI++); s.material.color.set(K.halo); s.material.opacity = .5; s.position.set(X, Y, Z); s.scale.setScalar(sz * 3.6); }
}
let giantRingI = 0, haloI = 0;

function render(now){
  const VW = H.VW, VH = H.VH, dpr = H.dpr, G = H.G;
  if (!VW || !VH) return;
  governor(now);
  const dt0 = Math.min(.05, Math.max(0, now - lastNow0)); lastNow0 = now;
  const pr = Math.min(dpr, Qs.maxRes), pw = Math.round(VW * pr), ph = Math.round(VH * pr);
  if (glCanvas.width !== pw || glCanvas.height !== ph){ renderer.setPixelRatio(pr); renderer.setSize(VW, VH, false); }

  // the painted nebula from the 2D game is the sky
  const bg = H.backdrop(!G);
  if (bg && bg !== lastBg){ lastBg = bg; if (bgTex) bgTex.dispose(); bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex; }

  // camera: the same scale as the 2D game at the point it looks at, leaning back by TILT
  let cx, cy, z;
  if (G){ cx = G.cam.x; cy = G.cam.y; z = G.cam.z; const sh = G.shake; cx += (Math.random() - .5) * sh / z; cy += (Math.random() - .5) * sh / z; }
  else { cx = MENU_C.x; cy = MENU_C.y; z = Math.min(VW, VH) / 1100; }
  const focal = (VH / 2) / Math.tan(FOV * Math.PI / 360), dist = focal / z;
  const tz = G ? surfZ(cx, cy) * .3 : 0;
  camera.aspect = VW / VH; camera.position.set(cx, -cy - dist * Math.sin(TILT), tz + dist * Math.cos(TILT)); camera.lookAt(cx, -cy, tz); camera.updateProjectionMatrix();
  camera.far = dist * 4 + 4000; camera.near = Math.max(5, dist * .05);
  star.position.set(cx - 900, -cy + 1400, 1600); star.target.position.set(cx, -cy, 0);
  rim.position.set(cx + 1200, -cy - 600, 300); rim.target.position.set(cx, -cy, 0);

  // holes shape the grid
  const nova = G && G.nova && !G.over ? 1 : 0;
  gridUni.uNova.value += (nova - gridUni.uNova.value) * .05;
  if (G) setWell(G.holes.filter(h => !h.dead).sort((a, b) => b.R - a.R).slice(0, MAXH));
  else { const R = Math.min(VW, VH) / z * .1; menuHole.R = R; menuHole.spin = now * 1.5; const a = projectBack(VW * .78, VH * .56, 0); menuHole.x = a.x; menuHole.y = a.y; setWell([menuHole]); }

  for (const r of ripU) r.z += dt0;
  // junk in view (generous: the tilted view sees further at the top)
  for (const k in KOBJ) KOBJ[k] = 0; giantRingI = 0; haloI = 0;
  const hw = VW / 2 / z * 1.7 + 120, up = VH / 2 / z * 2.4 + 160, down = VH / 2 / z * 1.3 + 120;
  if (G){
    for (let i = 0; i < G.objs.length; i++){
      const o = G.objs[i]; if (o.gone) continue;
      if (o.x < cx - hw || o.x > cx + hw || o.y < cy - up || o.y > cy + down) continue;
      if (o._k === undefined) o._k = Math.random() * 1000;
      putJunk(o.kind.k, i, o.x, o.y, o.r, o.rot, o.pull, o.towards, o._k);
    }
  } else {
    for (const j of menuJunk){ const a = j.a + now * j.sp * .3, x = menuHole.x + Math.cos(a) * j.d * menuHole.R / 90, y = menuHole.y + Math.sin(a) * j.d * .55 * menuHole.R / 90, r = H.KINDS.find(k => k.k === j.k).r; putJunk(j.k, j.i, x, y, r * menuHole.R / 70, j.rot + now * .3, 0, null, j.i * 7); }
  }
  for (const k in KIND3){ const m = KIND3[k].mesh; m.count = KOBJ[k] || 0; m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; }
  for (let i = giantRingI; i < ringPool.length; i++) ringPool[i].visible = false;
  for (let i = haloI; i < haloPool.length; i++) haloPool[i].visible = false;

  // holes
  let hi = 0;
  if (G){ for (const h of G.holes){ if (h.dead) continue; if (Math.abs(h.x - cx) > hw + h.R * 3 || h.y < cy - up - h.R * 3 || h.y > cy + down + h.R * 3) continue; placeHole(hi++, h, now, 1 + nova * .4); } }
  else placeHole(hi++, menuHole, now, 1.2);
  for (let i = hi; i < holePool.length; i++) holePool[i].visible = false;

  // power-ups
  let pi = 0;
  if (G) for (const u of G.pups){
    if (Math.abs(u.x - cx) > hw || u.y < cy - up || u.y > cy + down) continue;
    const g = poolGet(pupPool, pupModel, pi++), ud = g.userData, P = H.POWERS[u.type], r = Math.max(H.PUP_R, 12 / z);
    if (ud.type !== u.type){ ud.type = u.type; ud.orb.material.color.set(P.c); ud.orb.material.emissive.set(P.c); ud.halo.material.color.set(P.c); ud.icon.material.map = ICON[u.type]; ud.icon.material.needsUpdate = true; }
    g.position.set(u.x, -u.y, surfZ(u.x, u.y) + r * 1.6 + Math.sin(now * 3 + u.ph) * r * .3);
    ud.orb.scale.setScalar(r); ud.halo.scale.setScalar(r * 5); ud.icon.scale.setScalar(r * 1.3); ud.band.scale.setScalar(r); ud.band.rotation.set(1.1, 0, now * 2 + u.ph);
  }
  for (let i = pi; i < pupPool.length; i++) pupPool[i].visible = false;

  // sparks and speed trails
  let si = 0;
  const dt = Math.min(.05, Math.max(0, now - lastNow)); lastNow = now;
  if (G){
    for (const p of G.parts){ if (si >= SPARK_MAX) break; const s = 2.2 * Math.min(1, p.life * 2.5) + .6; M4.compose(V3.set(p.x, -p.y, surfZ(p.x, p.y) + 6), Q.setFromEuler(E.set(now * 3, p.x, 0)), S3.set(s, s, s)); sparks.setMatrixAt(si, M4); sparks.setColorAt(si, tmpC.set(p.c)); si++; }
    trailT -= dt;
    if (trailT <= 0){ trailT = .03; for (const h of G.holes) if (!h.dead && h.pw.speed > 0 && Math.hypot(h.vx, h.vy) > 20) for (let k = 0; k < 2; k++){ const a = Math.random() * TAU, d = h.R * (.8 + Math.random() * .6); trail.push({ x: h.x + Math.cos(a) * d, y: h.y + Math.sin(a) * d, life: .5, c: H.POWERS.speed.c }); } }
    for (let i = trail.length - 1; i >= 0; i--){ const p = trail[i]; p.life -= dt; if (p.life <= 0){ trail.splice(i, 1); continue; } if (si >= SPARK_MAX) continue; const s = 3.5 * p.life * 2; M4.compose(V3.set(p.x, -p.y, surfZ(p.x, p.y) + 4), Q.identity(), S3.set(s, s, s)); sparks.setMatrixAt(si, M4); sparks.setColorAt(si, tmpC.set(p.c)); si++; }
  }
  sparks.count = si; sparks.instanceMatrix.needsUpdate = true; if (sparks.instanceColor) sparks.instanceColor.needsUpdate = true;

  renderer.render(scene, camera);
}
let lastBg = null, bgTex = null, lastNow = 0, lastNow0 = 0, ripI = 0;
function ripple(x, y, strength){ const r = ripU[ripI++ % 4]; r.set(x, -y, 0, strength); }

// screen ↔ world, for the 2D overlay (names, the "drag to move" ring) and for placing the menu hole
const PV = new THREE.Vector3();
function project(x, y){
  PV.set(x, -y, surfZ(x, y) * .55).project(camera);
  const sx = (PV.x + 1) / 2 * H.VW, sy = (1 - PV.y) / 2 * H.VH;
  PV.set(x + 10, -y, surfZ(x, y) * .55).project(camera);
  const k = Math.abs((PV.x + 1) / 2 * H.VW - sx) / 10;
  return { x: sx, y: sy, k, behind: PV.z > 1 };
}
function projectBack(sx, sy, planeZ){
  camera.updateMatrixWorld();
  const v = new THREE.Vector3(sx / H.VW * 2 - 1, -(sy / H.VH) * 2 + 1, .5).unproject(camera), o = camera.position, d = v.sub(o).normalize();
  const t = (planeZ - o.z) / d.z; return { x: o.x + d.x * t, y: -(o.y + d.y * t) };
}

// ---------- quality: step down automatically when frames run slow ----------
const Qs = { level: 0, maxRes: 2, ema: 16.7, last: 0, slowFor: 0 };
function setQuality(l){ Qs.level = l; Qs.maxRes = [2, 1.5, 1.25, 1][l]; renderer.setPixelRatio(Math.min(H.dpr, Qs.maxRes)); }
if (/[?&]lowgfx(&|=|$)/.test(location.search)) setQuality(3); else if (lowEnd) setQuality(1);
function governor(now){
  const dt = (now - Qs.last) * 1000; Qs.last = now;
  if (dt <= 0 || dt > 200 || document.hidden) return;
  Qs.ema += (dt - Qs.ema) * .05;
  Qs.slowFor = Qs.ema > 22 ? Qs.slowFor + dt : 0;
  if (Qs.slowFor > 2000 && Qs.level < 3){ setQuality(Qs.level + 1); Qs.slowFor = 0; Qs.ema = 16.7; }
}

glCanvas.addEventListener('webglcontextlost', e => { e.preventDefault(); window.World3D = null; glCanvas.style.display = 'none'; dispatchEvent(new Event('world3dfail')); });
window.World3D = { ok: true, render, project, ripple, scene, camera, Q: Qs, setQuality, depthAt: surfZ };
dispatchEvent(new Event('world3d'));
}
