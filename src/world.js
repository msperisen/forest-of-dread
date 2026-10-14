import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { rng, rand, pick, clamp, lerp, canvasTexture } from './util.js';

// The action happens on the plane z = 0. Scenery lives at many depths in front of
// and behind it; the perspective camera turns that into natural parallax.
export const CAM_Z = 12.5;
const rangeFor = (z) => (CAM_Z - z) * 0.95 + 6;
const UP = new THREE.Vector3(0, 1, 0);

// ---- time-of-day palette ------------------------------------------------------
const RAW_KEYS = [
  { t: 0.0, top: '#4f86d0', hor: '#c6dbe2', fog: '#93ad9f', fogD: 0.019, hemiS: '#d6e8ff', hemiG: '#3d4c2a', hemiI: 1.25, sun: '#fff0d0', sunI: 2.4, stars: 0, moon: 0, sunA: 1, mist: 0.22 },
  { t: 0.35, top: '#4a66a8', hor: '#e8bd86', fog: '#a39270', fogD: 0.021, hemiS: '#ffd9a8', hemiG: '#3a3222', hemiI: 1.0, sun: '#ffc070', sunI: 2.0, stars: 0, moon: 0, sunA: 1, mist: 0.28 },
  { t: 0.55, top: '#272152', hor: '#c2546a', fog: '#583a52', fogD: 0.026, hemiS: '#d890a8', hemiG: '#2a1f28', hemiI: 0.75, sun: '#ff7a50', sunI: 1.3, stars: 0.35, moon: 0.4, sunA: 0.7, mist: 0.38 },
  { t: 0.75, top: '#060a1e', hor: '#1e2c4e', fog: '#16233a', fogD: 0.03, hemiS: '#7088cc', hemiG: '#10121c', hemiI: 0.62, sun: '#a8baff', sunI: 1.0, stars: 1, moon: 1, sunA: 0, mist: 0.45 },
  { t: 1.0, top: '#05040c', hor: '#1c1428', fog: '#140e1e', fogD: 0.034, hemiS: '#6a5a96', hemiG: '#0a080e', hemiI: 0.55, sun: '#9096d8', sunI: 0.85, stars: 0.6, moon: 0.85, sunA: 0, mist: 0.55 },
];
const COLOR_KEYS = ['top', 'hor', 'fog', 'hemiS', 'hemiG', 'sun'];
const NUM_KEYS = ['fogD', 'hemiI', 'sunI', 'stars', 'moon', 'sunA', 'mist'];
const KEYS = RAW_KEYS.map((k) => {
  const o = { ...k };
  for (const c of COLOR_KEYS) o[c] = new THREE.Color(k[c]);
  return o;
});

function samplePalette(t, out) {
  t = clamp(t, 0, 1);
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const f = clamp((t - a.t) / (b.t - a.t), 0, 1);
  for (const k of COLOR_KEYS) out[k].lerpColors(a[k], b[k], f);
  for (const k of NUM_KEYS) out[k] = lerp(a[k], b[k], f);
  return out;
}

// ---- procedural textures ----------------------------------------------------------
function barkTexture() {
  const t = canvasTexture(128, 256, (g, w, h) => {
    g.fillStyle = '#8a7a6a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * w;
      let y = Math.random() * h;
      g.strokeStyle = `rgba(${20 + Math.random() * 30 | 0},${14 + Math.random() * 20 | 0},10,${0.25 + Math.random() * 0.5})`;
      g.lineWidth = 1 + Math.random() * 3;
      g.beginPath();
      g.moveTo(x, y);
      for (let k = 0; k < 6; k++) {
        y += 10 + Math.random() * 25;
        g.lineTo(x + (Math.random() - 0.5) * 6, y);
      }
      g.stroke();
    }
    for (let i = 0; i < 40; i++) {
      g.fillStyle = `rgba(70,110,50,${Math.random() * 0.25})`;
      g.fillRect(Math.random() * w, Math.random() * h, 6 + Math.random() * 16, 4 + Math.random() * 10);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1, 3);
  return t;
}

function groundTexture() {
  const t = canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#3a4524';
    g.fillRect(0, 0, w, h);
    const blob = (x, y, r, c) => {
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, c);
        gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    };
    for (let i = 0; i < 70; i++) blob(Math.random() * w, Math.random() * h, 10 + Math.random() * 40, pick(['rgba(70,90,40,0.5)', 'rgba(45,35,22,0.5)', 'rgba(30,50,25,0.5)', 'rgba(90,80,50,0.35)']));
    for (let i = 0; i < 500; i++) {
      g.fillStyle = pick(['#55642f', '#2b3519', '#6b5a35', '#4a3a24']);
      g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

// Safari keeps canvas pixels premultiplied, so nearly transparent pixels lose their
// colour and show up as rainbow speckles. Soft-edged textures are therefore drawn fully
// opaque: colour in one canvas, transparency as greyscale in another (used as alphaMap).
function pathTextures() {
  const map = canvasTexture(256, 128, (g, w, h) => {
    g.fillStyle = '#5c4830';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      const y = h * (0.2 + Math.random() * 0.6);
      g.fillStyle = pick(['#3c2d1e', '#82704f', '#2a1f14']);
      g.fillRect(Math.random() * w, y, 1 + Math.random() * 4, 1 + Math.random() * 3);
    }
  });
  const alpha = canvasTexture(4, 128, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#000');
    grad.addColorStop(0.25, '#e6e6e6');
    grad.addColorStop(0.75, '#e6e6e6');
    grad.addColorStop(1, '#000');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, false);
  map.wrapS = alpha.wrapS = THREE.RepeatWrapping;
  return { map, alpha };
}

// Greyscale mist density on black, used as an alphaMap (see pathTextures).
function mistTexture() {
  const t = canvasTexture(512, 128, (g, w, h) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 90; i++) {
      const x = Math.random() * w, y = h * (0.35 + Math.random() * 0.4), r = 20 + Math.random() * 60;
      for (const ox of [-w, 0, w]) {
        const gr = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        gr.addColorStop(0, 'rgb(82,82,82)');
        gr.addColorStop(1, 'rgb(0,0,0)');
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y - r, r * 2, r * 2);
      }
    }
  }, false);
  t.wrapS = THREE.RepeatWrapping;
  return t;
}

function orbTexture(kind) {
  return canvasTexture(256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#000'; // opaque: drawn with additive blending, black adds nothing
    g.fillRect(0, 0, w, w);
    const glow = g.createRadialGradient(c, c, 0, c, c, c);
    if (kind === 'sun') {
      glow.addColorStop(0, 'rgb(255,250,230)');
      glow.addColorStop(0.12, 'rgb(255,240,200)');
      glow.addColorStop(0.2, 'rgb(115,95,63)');
      glow.addColorStop(1, 'rgb(0,0,0)');
      g.fillStyle = glow;
      g.fillRect(0, 0, w, w);
      return;
    }
    glow.addColorStop(0.15, 'rgb(70,78,100)');
    glow.addColorStop(1, 'rgb(0,0,0)');
    g.fillStyle = glow;
    g.fillRect(0, 0, w, w);
    g.fillStyle = '#eef0e4';
    g.beginPath();
    g.arc(c, c, w * 0.14, 0, Math.PI * 2);
    g.fill();
    for (let i = 0; i < 9; i++) {
      g.fillStyle = 'rgb(200,200,190)';
      g.beginPath();
      const a = Math.random() * 6.28, d = Math.random() * w * 0.1;
      g.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 2 + Math.random() * 6, 0, Math.PI * 2);
      g.fill();
    }
  });
}

// ---- tree geometry ----------------------------------------------------------------
function bentTrunk(R, h, r, bend) {
  const ph = R() * 6.283, ph2 = R() * 6.283;
  const center = (t) => new THREE.Vector3(
    (Math.sin(t * 2.3 + ph) - Math.sin(ph)) * bend * t,
    t * h,
    (Math.sin(t * 1.6 + ph2) - Math.sin(ph2)) * bend * 0.5 * t,
  );
  const g = new THREE.CylinderGeometry(r * 0.3, r, h, 9, 16);
  g.translate(0, h / 2, 0);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const t = v.y / h;
    const ang = Math.atan2(v.z, v.x);
    const knot = 1 + 0.16 * Math.sin(ang * 3 + t * 11 + ph) + 0.08 * Math.sin(ang * 5 - t * 23);
    const flare = 1 + Math.max(0, 0.15 - t) * 7;
    const c = center(t);
    p.setXYZ(i, v.x * knot * flare + c.x, v.y, v.z * knot * flare + c.z);
  }
  g.computeVertexNormals();
  return { g, center };
}

function addBranch(parts, tips, base, dir, len, rad, R, depth) {
  const g = new THREE.CylinderGeometry(rad * 0.35, rad, len, 6, 3);
  g.translate(0, len / 2, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const t = p.getY(i) / len;
    p.setX(i, p.getX(i) + Math.sin(t * 3 + depth) * len * 0.07);
  }
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir));
  g.translate(base.x, base.y, base.z);
  g.computeVertexNormals();
  parts.push(g);
  tips.push(base.clone().addScaledVector(dir, len));
  if (depth > 1) {
    const n = 1 + Math.floor(R() * 2);
    for (let k = 0; k < n; k++) {
      const d2 = dir.clone().add(new THREE.Vector3(R() - 0.5, R() * 0.6 - 0.1, R() - 0.5)).normalize();
      const at = base.clone().addScaledVector(dir, len * (0.55 + R() * 0.4));
      addBranch(parts, tips, at, d2, len * (0.4 + R() * 0.3), rad * 0.5, R, depth - 1);
    }
  }
}

function leafBlob(r, at) {
  const g = new THREE.IcosahedronGeometry(r, 1);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = 1 + 0.22 * Math.sin((x / r) * 3.6 + (y / r) * 3.3) * Math.cos((z / r) * 2.7 + (x / r) * 1.3);
    p.setXYZ(i, x * n, y * n * 0.75, z * n);
  }
  g.translate(at.x, at.y, at.z);
  g.computeVertexNormals();
  return g;
}

function buildTreeTemplate(seed, kind) {
  const R = rng(seed);
  const h = kind === 'pine' ? 12 + R() * 6 : 9 + R() * 7;
  const r = 0.35 + R() * 0.3;
  const bend = kind === 'pine' ? 0.3 : kind === 'dead' ? 1.6 + R() * 1.2 : 0.8 + R();
  const { g, center } = bentTrunk(R, h, r, bend);
  const parts = [g];
  const tips = [];
  if (kind !== 'pine') {
    const nb = kind === 'dead' ? 5 + Math.floor(R() * 3) : 3 + Math.floor(R() * 3);
    for (let i = 0; i < nb; i++) {
      const t = 0.4 + R() * 0.5;
      const side = R() < 0.5 ? -1 : 1;
      const dir = new THREE.Vector3(side * (0.5 + R() * 0.7), kind === 'dead' ? 0.2 + R() * 0.8 : 0.5 + R() * 0.9, (R() - 0.5) * 1.4).normalize();
      addBranch(parts, tips, center(t), dir, h * (0.2 + R() * 0.22), r * (1 - 0.7 * t) * 0.6, R, kind === 'dead' ? 3 : 2);
    }
  }
  const trunk = mergeGeometries(parts);
  let foliage = null;
  if (kind === 'oak') {
    const blobs = tips.map((t) => leafBlob(1.1 + R() * 1.1, t));
    blobs.push(leafBlob(2.3, center(1).add(new THREE.Vector3(0, 0.6, 0))));
    foliage = mergeGeometries(blobs);
  } else if (kind === 'pine') {
    const cones = [];
    const n = 6;
    for (let k = 0; k < n; k++) {
      const c = center(0.35 + (k / n) * 0.65);
      const cg = new THREE.ConeGeometry((1 - k / n) * 2.4 + 0.4, 2.6, 8, 1);
      cg.translate(c.x, c.y + 0.8, c.z);
      cones.push(cg);
    }
    foliage = mergeGeometries(cones);
  }
  return { trunk, foliage, kind };
}

// ---- the forest ---------------------------------------------------------------------
export class Forest {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    this.flash = 0;
    this.reflash = 0;
    this.nextStrike = 4;
    this.night = 0;
    this.onStrike = null;
    this.recycle = [];
    this.pal = {};
    for (const k of COLOR_KEYS) this.pal[k] = new THREE.Color();

    scene.fog = new THREE.FogExp2(0x000000, 0.02);

    this._sky();
    this._lights();
    this._ground();
    this._trees();
    this._undergrowth();
    this._mist();
    this._rain();
    this._fireflies();
  }

  _sky() {
    this.skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: new THREE.Color() },
        horizon: { value: new THREE.Color() },
        bottom: { value: new THREE.Color() },
      },
      vertexShader: `varying vec3 vDir;
        void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
        void main(){
          float h = vDir.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(clamp(h * 1.6, 0.0, 1.0), 0.7)) : mix(horizon, bottom, clamp(-h * 5.0, 0.0, 1.0));
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
    });
    this.sky = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 16), this.skyMat);
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    const n = 700;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const u = Math.random() * Math.PI * 2;
      const v = Math.acos(1 - Math.random() * 0.9);
      pos[i * 3] = Math.sin(v) * Math.cos(u) * 300;
      pos[i * 3 + 1] = Math.cos(v) * 300;
      pos[i * 3 + 2] = Math.sin(v) * Math.sin(u) * 300;
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, color: 0xffffff, transparent: true, fog: false, depthWrite: false }));
    this.scene.add(this.stars);

    this.sunSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTexture('sun'), fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.sunSprite.scale.setScalar(70);
    this.moonSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: orbTexture('moon'), fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.moonSprite.scale.setScalar(60);
    this.scene.add(this.sunSprite, this.moonSprite);
  }

  _lights() {
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 1);
    this.scene.add(this.hemi);
    const d = (this.dir = new THREE.DirectionalLight(0xffffff, 2));
    d.castShadow = true;
    d.shadow.mapSize.set(2048, 2048);
    Object.assign(d.shadow.camera, { left: -24, right: 24, top: 18, bottom: -8, near: 1, far: 100 });
    d.shadow.bias = -0.0006;
    d.shadow.normalBias = 0.03;
    this.scene.add(d, d.target);
    // Cool rim light from behind gives the cut-out 2.5D figures an outline.
    this.rim = new THREE.DirectionalLight(0x8899ff, 0.5);
    this.scene.add(this.rim, this.rim.target);
  }

  _ground() {
    const gt = groundTexture();
    gt.repeat.set(60, 16);
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 160),
      new THREE.MeshStandardMaterial({ map: gt, roughness: 1, color: 0xbbbbbb }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.z = -50;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    const pt = pathTextures();
    pt.map.repeat.set(60, 1);
    pt.alpha.repeat.set(60, 1);
    this.path = new THREE.Mesh(
      new THREE.PlaneGeometry(600, 3.4),
      new THREE.MeshStandardMaterial({ map: pt.map, alphaMap: pt.alpha, transparent: true, roughness: 1, depthWrite: false }),
    );
    this.path.rotation.x = -Math.PI / 2;
    this.path.position.set(0, 0.01, 0.2);
    this.path.receiveShadow = true;
    this.scene.add(this.path);
  }

  _trees() {
    const bark = barkTexture();
    this.barkMat = new THREE.MeshStandardMaterial({ color: '#7a6658', map: bark, roughness: 1 });
    this.fgBarkMat = new THREE.MeshStandardMaterial({ color: '#3a2e28', map: bark, roughness: 1 });
    const leafMats = ['#1f3c22', '#2b3d1a', '#2c2442', '#24331f'].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.95, flatShading: true }),
    );
    const pineMat = new THREE.MeshStandardMaterial({ color: '#173029', roughness: 0.95, flatShading: true });

    this.foreground = [];
    const kinds = ['dead', 'dead', 'dead', 'oak', 'oak', 'oak', 'pine', 'pine'];
    const templates = kinds.map((k, i) => buildTreeTemplate(1000 + i * 77, k));

    const place = (z, tpl, s, trunkOnly) => {
      const grp = new THREE.Group();
      const near = z > -14;
      const fg = z > 2;
      const tr = new THREE.Mesh(tpl.trunk, fg ? this.fgBarkMat.clone() : this.barkMat);
      if (fg) {
        tr.material.transparent = true;
        this.foreground.push(grp);
      }
      tr.castShadow = near;
      tr.receiveShadow = z > -25;
      grp.add(tr);
      if (tpl.foliage && !trunkOnly) {
        const f = new THREE.Mesh(tpl.foliage, tpl.kind === 'pine' ? pineMat : pick(leafMats));
        f.castShadow = near;
        grp.add(f);
      }
      grp.scale.setScalar(s);
      grp.rotation.y = Math.random() * Math.PI * 2;
      const range = rangeFor(z);
      grp.position.set(rand(-1, 1) * range, 0, z);
      grp.userData.range = range;
      this.scene.add(grp);
      this.recycle.push(grp);
    };

    for (let i = 0; i < 190; i++) place(-2.8 - Math.pow(Math.random(), 0.9) * 62, pick(templates), rand(0.8, 1.35));
    for (let i = 0; i < 5; i++) place(rand(4.5, 7.5), pick(templates), rand(1.0, 1.4), true);

    // Rocks
    const rockMat = new THREE.MeshStandardMaterial({ color: '#5d6058', roughness: 1, flatShading: true });
    for (let i = 0; i < 34; i++) {
      const g = new THREE.DodecahedronGeometry(1, 0);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setY(k, p.getY(k) * 0.6);
      const m = new THREE.Mesh(g, rockMat);
      const z = Math.random() < 0.85 ? rand(-22, -2.5) : rand(3, 6);
      m.scale.set(rand(0.3, 1.2), rand(0.3, 0.9), rand(0.3, 1));
      m.rotation.y = Math.random() * 6;
      m.position.set(rand(-1, 1) * rangeFor(z), 0.05, z);
      m.castShadow = m.receiveShadow = true;
      m.userData.range = rangeFor(z);
      this.scene.add(m);
      this.recycle.push(m);
    }
  }

  _undergrowth() {
    // Grass tufts: one instanced mesh, recycled around the camera.
    const blades = [];
    for (let i = 0; i < 5; i++) {
      const b = new THREE.ConeGeometry(0.05, 0.55 + Math.random() * 0.3, 3);
      b.translate(0, 0.3, 0);
      b.rotateZ((Math.random() - 0.5) * 0.7);
      b.rotateX((Math.random() - 0.5) * 0.7);
      b.translate((Math.random() - 0.5) * 0.25, 0, (Math.random() - 0.5) * 0.25);
      blades.push(b);
    }
    const tuft = mergeGeometries(blades);
    const N = 1100;
    this.grass = new THREE.InstancedMesh(tuft, new THREE.MeshStandardMaterial({ roughness: 1 }), N);
    this.grassData = [];
    const col = new THREE.Color();
    for (let i = 0; i < N; i++) {
      let z = rand(-26, 7);
      if (Math.abs(z) < 1.7) z += z < 0 ? -1.7 : 1.7;
      this.grassData.push({ x: rand(-1, 1) * rangeFor(z), z, s: rand(0.6, 1.5), r: Math.random() * 6 });
      col.set(pick(['#4f6b2c', '#5d7a32', '#3e5a26', '#6b7a3a']));
      this.grass.setColorAt(i, col);
    }
    this.grass.receiveShadow = true;
    this.scene.add(this.grass);

    // Glowing mushrooms: they light up at night (and catch the bloom pass).
    const M = 60;
    const stem = new THREE.CylinderGeometry(0.03, 0.045, 0.22, 5);
    stem.translate(0, 0.11, 0);
    const cap = new THREE.SphereGeometry(0.12, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2);
    cap.scale(1, 0.7, 1);
    cap.translate(0, 0.2, 0);
    this.capMat = new THREE.MeshStandardMaterial({ color: '#7fd8c8', emissive: '#30e8c0', emissiveIntensity: 0.1, roughness: 0.6 });
    this.stems = new THREE.InstancedMesh(stem, new THREE.MeshStandardMaterial({ color: '#d8d0b8' }), M);
    this.caps = new THREE.InstancedMesh(cap, this.capMat, M);
    this.mushData = [];
    for (let i = 0; i < M; i++) {
      const z = Math.random() < 0.7 ? rand(-7, -1.8) : rand(2, 4.5);
      this.mushData.push({ x: rand(-1, 1) * rangeFor(z), z, s: rand(0.7, 1.8), r: Math.random() * 6 });
    }
    this.scene.add(this.stems, this.caps);
    this._dummy = new THREE.Object3D();
    this._writeInstances(this.grass, this.grassData, true);
    this._writeInstances(this.stems, this.mushData, true);
    this._writeInstances(this.caps, this.mushData, true);
  }

  _writeInstances(mesh, data, force, camX = 0) {
    let dirty = force;
    const d = this._dummy;
    for (let i = 0; i < data.length; i++) {
      const e = data[i];
      const r = rangeFor(e.z);
      let moved = force;
      while (e.x < camX - r) { e.x += 2 * r; moved = true; }
      while (e.x > camX + r) { e.x -= 2 * r; moved = true; }
      if (!moved) continue;
      d.position.set(e.x, 0, e.z);
      d.rotation.set(0, e.r, 0);
      d.scale.setScalar(e.s);
      d.updateMatrix();
      mesh.setMatrixAt(i, d.matrix);
      dirty = true;
    }
    if (dirty) mesh.instanceMatrix.needsUpdate = true;
  }

  _mist() {
    const base = mistTexture();
    this.mists = [-6, -15, -28, -46].map((z, i) => {
      const tex = base.clone();
      tex.needsUpdate = true;
      tex.repeat.set(3, 1);
      const mat = new THREE.MeshBasicMaterial({ alphaMap: tex, transparent: true, depthWrite: false, opacity: 0.3 });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(300, 9 + i * 3), mat);
      m.position.set(0, 2.5 + i * 1.2, z);
      m.userData = { drift: (i % 2 ? 1 : -1) * (0.004 + i * 0.002), k: 1 - i * 0.12 };
      this.scene.add(m);
      return m;
    });
  }

  _rain() {
    const n = 1400;
    this.rainPos = new Float32Array(n * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3));
    this.rainLines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#a8b8d0', transparent: true, opacity: 0.4, depthWrite: false }));
    this.rainLines.frustumCulled = false;
    this.rainLines.visible = false;
    this.rainDrops = [];
    for (let i = 0; i < n; i++) this.rainDrops.push({ x: rand(-26, 26), y: rand(0, 20), z: rand(-16, 9), v: rand(18, 26) });
    this.scene.add(this.rainLines);
  }

  _fireflies() {
    const n = 90;
    this.flyData = [];
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.flyData.push({ x: rand(-24, 24), y: rand(0.4, 4), z: rand(-12, 5), p: Math.random() * 10 });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ size: 0.13, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.color.setRGB(2.2, 3, 0.8);
    this.flies = new THREE.Points(g, mat);
    this.flies.frustumCulled = false;
    this.scene.add(this.flies);
  }

  strike(camX) {
    if (this.bolt) {
      this.scene.remove(this.bolt);
      this.bolt.geometry.dispose();
    }
    const x0 = camX + rand(-28, 28), z = rand(-48, -18);
    const parts = [];
    const seg = (a, b, w) => {
      const len = a.distanceTo(b);
      const c = new THREE.CylinderGeometry(w, w, len, 4, 1);
      c.translate(0, len / 2, 0);
      c.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, b.clone().sub(a).normalize()));
      c.translate(a.x, a.y, a.z);
      parts.push(c);
    };
    const jag = (start, steps, dy, spread, w, branches) => {
      let p = start.clone();
      for (let i = 0; i < steps; i++) {
        const q = p.clone().add(new THREE.Vector3(rand(-spread, spread), -dy * rand(0.7, 1.3), rand(-0.5, 0.5)));
        if (q.y < 0) q.y = 0;
        seg(p, q, w);
        if (branches && Math.random() < 0.25) jag(q, 4, dy * 0.7, spread, w * 0.5, false);
        p = q;
        if (p.y <= 0) break;
      }
    };
    jag(new THREE.Vector3(x0, 48, z), 16, 3.2, 2.2, 0.12, true);
    const mat = new THREE.MeshBasicMaterial({ fog: false, transparent: true });
    mat.color.setRGB(5, 5, 7);
    this.bolt = new THREE.Mesh(mergeGeometries(parts), mat);
    this.scene.add(this.bolt);
    this.flash = 1;
    this.reflash = 0.14;
    const dist = Math.abs(x0 - camX) + Math.abs(z);
    this.onStrike?.(clamp(dist / 60, 0.15, 1.4), clamp(1.3 - dist / 80, 0.4, 1));
  }

  update(dt, camera, tod, storm, rain, playerX = camera.position.x) {
    this.time += dt;
    const camX = camera.position.x;
    const P = samplePalette(tod, this.pal);
    const night = (this.night = clamp((tod - 0.5) / 0.25, 0, 1));

    // Lightning
    if (storm > 0) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.strike(camX);
        this.nextStrike = rand(3, 9) / storm;
      }
    }
    if (this.reflash > 0) {
      this.reflash -= dt;
      if (this.reflash <= 0) this.flash = Math.max(this.flash, 0.85);
    }
    this.flash = Math.max(0, this.flash - dt * 2.2);
    const fl = this.flash;
    if (this.bolt) {
      this.bolt.visible = fl > 0.05;
      this.bolt.material.opacity = Math.min(1, fl * 2);
    }

    // Palette
    const flashCol = new THREE.Color(0.75, 0.75, 1.0);
    this.scene.fog.color.copy(P.fog).lerp(flashCol, fl * 0.35);
    this.scene.fog.density = P.fogD * (1 + rain * 0.15);
    this.skyMat.uniforms.top.value.copy(P.top).lerp(flashCol, fl * 0.5);
    this.skyMat.uniforms.horizon.value.copy(P.hor).lerp(flashCol, fl * 0.6);
    this.skyMat.uniforms.bottom.value.copy(this.scene.fog.color);
    this.hemi.color.copy(P.hemiS);
    this.hemi.groundColor.copy(P.hemiG);
    this.hemi.intensity = P.hemiI * (1 - rain * 0.15) + fl * 3;
    this.dir.color.copy(P.sun);
    this.dir.intensity = P.sunI * (1 - rain * 0.3);
    this.rim.intensity = 0.25 + night * 0.6 + fl * 2;

    // Light direction moves from high sun to low sun to moon.
    const el = tod < 0.6 ? lerp(1.0, 0.25, clamp(tod / 0.6, 0, 1)) : lerp(0.25, 0.8, clamp((tod - 0.6) / 0.2, 0, 1));
    const lx = tod < 0.6 ? -0.6 : 0.5;
    const ldir = new THREE.Vector3(lx, el, 0.55).normalize();
    this.dir.target.position.set(camX, 0, 0);
    this.dir.position.set(camX + ldir.x * 45, ldir.y * 45, ldir.z * 45);
    this.rim.target.position.set(camX, 0, 0);
    this.rim.position.set(camX + 10, 20, -40);

    // Sky dome, stars, sun and moon ride along with the camera.
    this.sky.position.copy(camera.position);
    this.stars.position.copy(camera.position);
    this.stars.material.opacity = P.stars * (1 - rain * 0.8);
    const sunY = lerp(110, 4, clamp(tod / 0.6, 0, 1));
    this.sunSprite.position.set(camera.position.x - 40, sunY, camera.position.z - 230);
    this.sunSprite.material.opacity = P.sunA;
    this.sunSprite.visible = P.sunA > 0.01;
    this.moonSprite.position.set(camera.position.x + 55, 75, camera.position.z - 230);
    this.moonSprite.material.opacity = P.moon * (1 - rain * 0.6);
    this.moonSprite.visible = P.moon > 0.01;

    // Infinite forest: recycle anything that scrolled out of range.
    for (const o of this.recycle) {
      const r = o.userData.range;
      while (o.position.x < camX - r) o.position.x += 2 * r;
      while (o.position.x > camX + r) o.position.x -= 2 * r;
    }
    // Foreground trunks fade out while they pass in front of the archer.
    for (const t of this.foreground) {
      const screenX = (t.position.x - camX) * CAM_Z / (CAM_Z - t.position.z);
      const d = Math.abs(screenX - (playerX - camX));
      const m = t.children[0].material;
      m.opacity = lerp(m.opacity, d < 2.2 ? 0.18 : 1, 1 - Math.exp(-8 * dt));
      m.depthWrite = m.opacity > 0.9;
    }
    this._writeInstances(this.grass, this.grassData, false, camX);
    this._writeInstances(this.stems, this.mushData, false, camX);
    this._writeInstances(this.caps, this.mushData, false, camX);
    this.capMat.emissiveIntensity = 0.05 + night * 2.2;

    // Ground scrolls in whole texture tiles so it looks fixed in the world.
    const snap = Math.round(camX / 10) * 10;
    this.ground.position.x = snap;
    this.path.position.x = snap;

    for (const m of this.mists) {
      m.position.x = camX;
      m.material.alphaMap.offset.x = (camX / 300) * 3 + this.time * m.userData.drift;
      m.material.color.copy(P.fog).lerp(new THREE.Color(1, 1, 1), 0.25 + fl * 0.3);
      m.material.opacity = P.mist * m.userData.k * (1 + rain * 0.3);
    }

    // Rain
    this.rainLines.visible = rain > 0.02;
    if (this.rainLines.visible) {
      this.rainLines.material.opacity = 0.35 * rain + fl * 0.3;
      const a = this.rainPos;
      this.rainDrops.forEach((d, i) => {
        d.y -= d.v * dt;
        d.x -= d.v * 0.12 * dt;
        if (d.y < 0) {
          d.y = rand(16, 22);
          d.x = camX + rand(-26, 26);
        }
        if (d.x < camX - 26) d.x += 52;
        if (d.x > camX + 26) d.x -= 52;
        const o = i * 6;
        a[o] = d.x; a[o + 1] = d.y; a[o + 2] = d.z;
        a[o + 3] = d.x + 0.07; a[o + 4] = d.y + 0.55; a[o + 5] = d.z;
      });
      this.rainLines.geometry.attributes.position.needsUpdate = true;
    }

    // Fireflies
    this.flies.visible = night > 0.05 && rain < 0.5;
    if (this.flies.visible) {
      this.flies.material.opacity = night;
      const a = this.flies.geometry.attributes.position.array;
      this.flyData.forEach((f, i) => {
        if (f.x < camX - 24) f.x += 48;
        if (f.x > camX + 24) f.x -= 48;
        const t = this.time + f.p;
        a[i * 3] = f.x + Math.sin(t * 0.7) * 0.8;
        a[i * 3 + 1] = f.y + Math.sin(t * 1.3) * 0.4;
        a[i * 3 + 2] = f.z + Math.cos(t * 0.5) * 0.6;
      });
      this.flies.geometry.attributes.position.needsUpdate = true;
      this.flies.material.size = 0.1 + 0.05 * Math.sin(this.time * 3);
    }
  }
}
