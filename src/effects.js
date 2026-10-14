import * as THREE from 'three';
import { rand } from './util.js';

const GROUND = 1, LANDED = 2, SHRINK = 4;

const VS = `
attribute float size;
attribute vec4 pcolor;
uniform float uScale;
varying vec4 vColor;
void main(){
  vColor = pcolor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FS = `
varying vec4 vColor;
void main(){
  float d = length(gl_PointCoord - 0.5);
  if (d > 0.5) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * smoothstep(0.5, 0.15, d));
  #include <colorspace_fragment>
}`;

// CPU particle pool rendered as one Points object.
class Particles {
  constructor(scene, cap, additive) {
    this.cap = cap;
    this.next = 0;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.col = new Float32Array(cap * 4);
    this.size = new Float32Array(cap);
    this.baseSize = new Float32Array(cap);
    this.baseA = new Float32Array(cap);
    this.life = new Float32Array(cap);
    this.max = new Float32Array(cap);
    this.grav = new Float32Array(cap);
    this.flags = new Uint8Array(cap);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VS,
      fragmentShader: FS,
      uniforms: { uScale: { value: 1000 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, c, size, life, grav, flags = 0, alpha = 1) {
    const i = this.next;
    this.next = (i + 1) % this.cap;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.col.set([c.r, c.g, c.b, alpha], i * 4);
    this.size[i] = this.baseSize[i] = size;
    this.baseA[i] = alpha;
    this.life[i] = this.max[i] = life;
    this.grav[i] = grav;
    this.flags[i] = flags;
  }

  update(dt) {
    const { pos, vel, col, size, life, max, grav, flags } = this;
    const drag = Math.exp(-1.2 * dt);
    for (let i = 0; i < this.cap; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      if (life[i] <= 0) {
        size[i] = 0;
        continue;
      }
      const o = i * 3;
      if (!(flags[i] & LANDED)) {
        vel[o + 1] -= grav[i] * dt;
        vel[o] *= drag; vel[o + 1] *= drag; vel[o + 2] *= drag;
        pos[o] += vel[o] * dt;
        pos[o + 1] += vel[o + 1] * dt;
        pos[o + 2] += vel[o + 2] * dt;
        if (flags[i] & GROUND && pos[o + 1] < 0.03) {
          pos[o + 1] = 0.03;
          flags[i] |= LANDED;
          size[i] *= 1.6; // splat
          this.baseSize[i] = size[i];
        }
      }
      const f = life[i] / max[i];
      col[i * 4 + 3] = this.baseA[i] * (flags[i] & LANDED ? Math.min(1, life[i] / 1.5) : Math.min(1, f * 2.5));
      if (flags[i] & SHRINK) size[i] = this.baseSize[i] * f;
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = a.pcolor.needsUpdate = a.size.needsUpdate = true;
  }
}

const tmp = new THREE.Color();

export class Effects {
  constructor(scene) {
    this.soft = new Particles(scene, 3500, false);
    this.glow = new Particles(scene, 2000, true);
  }

  setScale(s) {
    this.soft.mat.uniforms.uScale.value = s;
    this.glow.mat.uniforms.uScale.value = s;
  }

  blood(p, color = '#8a0f0f', n = 20, spd = 4) {
    const base = new THREE.Color(color);
    for (let i = 0; i < n; i++) {
      tmp.copy(base).multiplyScalar(rand(0.6, 1.2));
      this.soft.spawn(p.x, p.y, p.z, rand(-0.7, 0.7) * spd, rand(0.3, 1.2) * spd, rand(-0.4, 0.4) * spd,
        tmp, rand(0.05, 0.13), rand(3, 5), 14, GROUND);
    }
  }

  dirt(p, n = 10, spd = 2.5) {
    for (let i = 0; i < n; i++) {
      tmp.set(Math.random() < 0.5 ? '#4a3a26' : '#2f3a1c');
      this.soft.spawn(p.x + rand(-0.3, 0.3), Math.max(0.05, p.y), p.z + rand(-0.3, 0.3),
        rand(-1, 1) * spd, rand(0.5, 1.4) * spd, rand(-0.5, 0.5) * spd, tmp, rand(0.07, 0.15), rand(0.8, 1.4), 12, GROUND);
    }
  }

  sparks(p, n = 20, color = '#ff9a30', spd = 5) {
    tmp.set(color).multiplyScalar(3);
    for (let i = 0; i < n; i++) {
      this.glow.spawn(p.x, p.y, p.z, rand(-1, 1) * spd, rand(-0.3, 1.2) * spd, rand(-0.6, 0.6) * spd,
        tmp, rand(0.05, 0.12), rand(0.3, 0.8), 8, SHRINK);
    }
  }

  fire(p, n = 2) {
    for (let i = 0; i < n; i++) {
      tmp.setRGB(4, rand(1.2, 2.2), 0.3);
      this.glow.spawn(p.x + rand(-0.1, 0.1), p.y + rand(-0.1, 0.1), p.z + rand(-0.1, 0.1),
        rand(-0.4, 0.4), rand(0.2, 1), rand(-0.4, 0.4), tmp, rand(0.2, 0.4), rand(0.2, 0.45), -1, SHRINK);
    }
  }

  smoke(p, n = 6, color = '#2a2430', size = 0.6) {
    tmp.set(color);
    for (let i = 0; i < n; i++) {
      this.soft.spawn(p.x + rand(-0.4, 0.4), p.y + rand(-0.4, 0.4), p.z + rand(-0.3, 0.3),
        rand(-0.6, 0.6), rand(0.3, 1.2), rand(-0.3, 0.3), tmp, rand(0.6, 1.2) * size, rand(1.0, 2.0), -0.4, 0, 0.5);
    }
  }

  magic(p, n = 6, color = '#b050ff') {
    tmp.set(color).multiplyScalar(3);
    for (let i = 0; i < n; i++) {
      this.glow.spawn(p.x + rand(-1, 1), p.y + rand(-1, 1), p.z + rand(-0.5, 0.5),
        rand(-0.3, 0.3), rand(0.5, 2), rand(-0.3, 0.3), tmp, rand(0.08, 0.2), rand(0.6, 1.4), -0.5, SHRINK);
    }
  }

  update(dt) {
    this.soft.update(dt);
    this.glow.update(dt);
  }
}
