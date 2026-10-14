import * as THREE from 'three';
import { clamp, damp, lerp, rand } from './util.js';

// ---- helpers ------------------------------------------------------------------------
const sphere = (r, w = 10, h = 8) => new THREE.SphereGeometry(r, w, h);
const boxG = (w, h, d) => new THREE.BoxGeometry(w, h, d);

function mesh(geo, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent?.add(m);
  return m;
}

// Cylinder lying along +x from 0 to len (r0 at base, r1 at tip).
function limbGeo(len, r0, r1, seg = 5) {
  const g = new THREE.CylinderGeometry(r1, r0, len, seg, 1);
  g.rotateZ(-Math.PI / 2);
  g.translate(len / 2, 0, 0);
  return g;
}

// Position-based displacement so seams stay closed.
function lumpy(geo, amt, freq = 5) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const n = Math.sin(x * freq + y * 1.3 * freq) * Math.sin(z * freq * 1.1 - y * freq * 0.7);
    const s = 1 + n * amt;
    p.setXYZ(i, x * s, y * s, z * s);
  }
  geo.computeVertexNormals();
  return geo;
}

const glow = (c, i = 3) => new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(i) });
const V = new THREE.Vector3();

// ---- base class ---------------------------------------------------------------------
class Monster {
  constructor(game, x) {
    this.game = game;
    this.group = new THREE.Group();
    this.group.position.x = x;
    game.scene.add(this.group);
    this.alive = true;
    this.dead = false;
    this.deathT = 0;
    this.deathTime = 1.8;
    this.hitT = 0;
    this.hp = 1;
    this.score = 100;
    this.hitParts = [];
    this.mats = [];
    this.blood = '#7a0d0d';
    this.dir = 1;
    this.t = 0;
    this.vx = 0;
    this.vy = 0;
  }

  get x() { return this.group.position.x; }

  mat(c, o = {}) {
    const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, flatShading: true, ...o });
    m.userData.e = m.emissive.clone();
    this.mats.push(m);
    return m;
  }

  addHit(obj, r) { this.hitParts.push({ obj, r }); }

  face(dir) {
    this.dir = dir;
    this.group.scale.x = dir;
  }

  testPoint(p) {
    for (const h of this.hitParts) {
      h.obj.getWorldPosition(V);
      if (V.distanceToSquared(p) < h.r * h.r) return true;
    }
    return false;
  }

  touchesPlayer(n = this.hitParts.length) {
    const p = this.game.player;
    if (p.state !== 'alive') return false;
    for (let i = 0; i < n; i++) {
      const h = this.hitParts[i];
      h.obj.getWorldPosition(V);
      if (Math.abs(V.x - p.x) < h.r + 0.22 && V.y - h.r < 1.75 && V.y + h.r > 0.05 && Math.abs(V.z) < h.r + 0.6) return true;
    }
    return false;
  }

  damage(n, point) {
    if (!this.alive) return false;
    this.hp -= n;
    this.hitT = 0.15;
    this.game.fx.blood(point, this.blood, 14, 3.5);
    this.game.audio.sfx('hit');
    this.onHit?.();
    if (this.hp <= 0) this.kill(point);
    return true;
  }

  kill(point) {
    this.alive = false;
    this.game.fx.blood(point, this.blood, 40, 5);
    this.game.audio.sfx('kill');
    this.game.onKill(this);
  }

  base(dt) {
    this.t += dt;
    if (this.hitT > 0) {
      this.hitT -= dt;
      for (const m of this.mats) {
        if (this.hitT > 0) m.emissive.setRGB(0.9, 0.08, 0.05);
        else m.emissive.copy(m.userData.e);
      }
    }
    if (!this.alive) {
      this.deathT += dt;
      this.dieAnim(dt);
      if (this.deathT > this.deathTime) this.dead = true;
    }
  }

  dieAnim(dt) {
    const k = this.deathT;
    this.group.position.y = -k * k * 0.8;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.group.traverse((o) => {
      if (o.userData.shared) return;
      o.geometry?.dispose();
    });
    for (const m of this.mats) m.dispose();
  }
}

// ---- Spider: drops from the canopy on a thread, scuttles and pounces ----------------------
export class Spider extends Monster {
  constructor(game, x) {
    super(game, x);
    this.hp = Math.round(2 * game.hpMul);
    this.score = 150;
    this.blood = '#6f9a22';
    const shell = this.mat('#2b1d26'), hair = this.mat('#3d2a2a'), mark = this.mat('#9a1c1c', { emissive: '#300000' });
    const rig = (this.rig = new THREE.Group());
    this.group.add(rig);
    const ceph = mesh(lumpy(sphere(0.38, 12, 9), 0.06), shell, rig, 0.35, 0, 0);
    ceph.scale.set(1.15, 0.8, 0.95);
    const abd = mesh(lumpy(sphere(0.6, 14, 11), 0.08, 7), hair, rig, -0.55, 0.18, 0);
    abd.scale.set(1.25, 0.95, 1);
    for (const [x, y, z, s] of [[-0.5, 0.7, 0, 0.12], [-0.78, 0.6, 0.2, 0.08], [-0.78, 0.6, -0.2, 0.08], [-0.25, 0.66, 0, 0.07]]) mesh(sphere(s, 6, 5), mark, rig, x, y, z);
    const eye = glow('#ff2010', 3);
    for (const [x, y, z, r] of [[0.74, 0.1, 0.08, 0.05], [0.74, 0.1, -0.08, 0.05], [0.7, 0.18, 0.15, 0.035], [0.7, 0.18, -0.15, 0.035], [0.66, 0.04, 0.18, 0.03], [0.66, 0.04, -0.18, 0.03]]) mesh(sphere(r, 6, 5), eye, rig, x, y, z);
    for (const z of [0.07, -0.07]) {
      const f = mesh(new THREE.ConeGeometry(0.05, 0.22, 5), this.mat('#d8c8a0'), rig, 0.78, -0.16, z);
      f.rotation.z = Math.PI;
    }
    this.legs = [];
    const A = [0.95, 0.4, -0.2, -0.75];
    for (let i = 0; i < 4; i++) {
      for (const side of [1, -1]) {
        const yaw = new THREE.Group();
        yaw.position.set(0.32 - i * 0.1, 0, side * 0.2);
        rig.add(yaw);
        const dx = Math.sin(A[i]), dz = side * Math.cos(A[i]);
        yaw.rotation.y = Math.atan2(-dz, dx);
        const lift = new THREE.Group();
        lift.rotation.z = 0.75;
        yaw.add(lift);
        mesh(limbGeo(0.8, 0.065, 0.045), shell, lift);
        const knee = new THREE.Group();
        knee.position.x = 0.8;
        knee.rotation.z = -2.05;
        lift.add(knee);
        mesh(limbGeo(1.15, 0.045, 0.012), shell, knee);
        this.legs.push({ yaw, lift, knee, base: yaw.rotation.y, ph: i * Math.PI / 2 + (side > 0 ? 0 : Math.PI) });
      }
    }
    const tg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 30, 0)]);
    this.thread = new THREE.Line(tg, new THREE.LineBasicMaterial({ color: '#d8d8d0', transparent: true, opacity: 0.55 }));
    this.group.add(this.thread);

    this.state = 'drop';
    rig.position.y = 11;
    this.leapCd = 1;
    this.face(Math.sign(game.player.x - x) || 1);
    this.addHit(ceph, 0.5);
    this.addHit(abd, 0.7);
    game.audio.sfx('hiss');
  }

  update(dt) {
    this.base(dt);
    const rig = this.rig;
    if (!this.alive) return;
    const g = this.game, p = g.player;
    const dx = p.x - this.x;
    const dir = Math.sign(dx) || 1;
    let moving = 0;
    if (this.state === 'drop') {
      rig.position.y -= dt * 3.2 * g.spdMul;
      rig.rotation.z = Math.sin(this.t * 2) * 0.15;
      moving = 0.3;
      const pos = this.thread.geometry.attributes.position;
      pos.setY(0, rig.position.y + 0.3);
      pos.needsUpdate = true;
      if (rig.position.y <= 0.56) {
        rig.position.y = 0.56;
        rig.rotation.z = 0;
        this.state = 'walk';
        this.thread.visible = false;
      }
    } else if (this.state === 'walk') {
      this.face(dir);
      this.group.position.x += dir * 2.4 * g.spdMul * dt;
      moving = 1;
      this.leapCd -= dt;
      if (Math.abs(dx) < 4.2 && this.leapCd <= 0) {
        this.state = 'leap';
        this.vx = dir * 6.5;
        this.vy = 6.5;
        g.audio.sfx('hiss');
      }
    } else if (this.state === 'leap') {
      this.group.position.x += this.vx * dt;
      this.vy -= 16 * dt;
      rig.position.y += this.vy * dt;
      rig.rotation.z = this.vy * 0.04;
      moving = 0.2;
      if (rig.position.y <= 0.56 && this.vy < 0) {
        rig.position.y = 0.56;
        rig.rotation.z = 0;
        this.state = 'walk';
        this.leapCd = 1.4;
        g.audio.sfx('land');
      }
    }
    const k = this.t * 9 * g.spdMul;
    for (const L of this.legs) {
      const s = Math.sin(k + L.ph);
      L.lift.rotation.z = 0.75 + Math.max(0, s) * 0.35 * moving + (this.state === 'drop' ? Math.sin(this.t * 3 + L.ph) * 0.2 : 0);
      L.yaw.rotation.y = L.base + Math.cos(k + L.ph) * 0.22 * moving;
    }
    if (this.touchesPlayer()) g.killPlayer(this);
  }

  dieAnim(dt) {
    this.thread.visible = false;
    this.rig.position.y = Math.max(0.3, this.rig.position.y - dt * 6);
    this.rig.rotation.x = Math.min(Math.PI, this.deathT * 7);
    for (const L of this.legs) L.knee.rotation.z = damp(L.knee.rotation.z, -2.7, 6, dt);
    if (this.deathT > 1) this.group.position.y -= dt * 0.8;
  }
}

// ---- Wasp: giant hornets that circle and dive in swarms ---------------------------------------
export class Wasp extends Monster {
  constructor(game, x, i = 0) {
    super(game, x);
    this.hp = Math.round(1 * game.hpMul);
    this.score = 100;
    this.blood = '#d8d040';
    this.deathTime = 2.4;
    this.seed = Math.random() * 10;
    this.side = i % 2 ? 1 : -1;
    const yel = this.mat('#e0a816'), blk = this.mat('#1d1712');
    const rig = (this.rig = new THREE.Group());
    rig.scale.setScalar(1.35);
    this.group.add(rig);
    const thorax = mesh(sphere(0.2), blk, rig);
    thorax.scale.set(1.2, 1, 1);
    mesh(sphere(0.15), yel, rig, 0.3, 0.02, 0);
    const eye = glow('#ff4020', 2);
    mesh(sphere(0.07, 6, 5), eye, rig, 0.36, 0.06, 0.08);
    mesh(sphere(0.07, 6, 5), eye, rig, 0.36, 0.06, -0.08);
    let abd;
    [[-0.3, 0.2, yel], [-0.52, 0.21, blk], [-0.72, 0.17, yel], [-0.88, 0.11, blk]].forEach(([x, r, m], k) => {
      const s = mesh(sphere(r), m, rig, x, -0.05 - k * 0.035, 0);
      if (k === 1) abd = s;
    });
    const sting = mesh(new THREE.ConeGeometry(0.04, 0.22, 5), blk, rig, -1.02, -0.17, 0);
    sting.rotation.z = Math.PI / 2;
    for (let k = 0; k < 3; k++) {
      const l = mesh(limbGeo(0.35, 0.02, 0.012, 3), blk, rig, 0.05 - k * 0.1, -0.12, 0);
      l.rotation.z = -1.9;
    }
    const wingMat = new THREE.MeshStandardMaterial({ color: '#dfefff', transparent: true, opacity: 0.38, side: THREE.DoubleSide, roughness: 0.2, depthWrite: false });
    this.mats.push(wingMat);
    wingMat.userData.e = wingMat.emissive.clone();
    this.wings = [];
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0, 0.16, 0);
      rig.add(pivot);
      const wg = new THREE.PlaneGeometry(0.3, 0.75);
      wg.rotateX(-Math.PI / 2);
      wg.translate(-0.05, 0, s * 0.38);
      const w = new THREE.Mesh(wg, wingMat);
      pivot.add(w);
      this.wings.push({ pivot, s });
    }
    this.group.position.set(x, rand(2.5, 5), rand(-0.3, 0.3));
    this.state = 'hover';
    this.diveT = rand(3, 6);
    this.addHit(thorax, 0.45);
    this.addHit(abd, 0.42);
    if (i === 0) game.audio.sfx('buzz');
  }

  update(dt) {
    this.base(dt);
    for (const w of this.wings) w.pivot.rotation.x = w.s * Math.sin(this.t * 55) * (this.alive ? 0.9 : 0.1);
    if (!this.alive) return;
    const g = this.game, p = g.player, pos = this.group.position;
    let tx, ty, maxV, lam;
    // Hornets hover at 3 u/s and dive at 4 u/s; the archer walks at 4.6, so running away works.
    if (this.state === 'hover') {
      tx = p.x + this.side * (2.8 + Math.sin(this.t * 0.9 + this.seed) * 1.6);
      ty = 2.7 + Math.sin(this.t * 2.1 + this.seed) * 1.1;
      maxV = 3.0 * g.spdMul;
      lam = 2.5;
      this.diveT -= dt;
      if (this.diveT <= 0) {
        this.state = 'windup';
        this.diveT = 0.5;
        g.audio.sfx('buzz');
      }
    } else if (this.state === 'windup') {
      // Short hesitation before the dive, so the player sees it coming.
      tx = pos.x;
      ty = pos.y + 0.3;
      maxV = 0.6;
      lam = 6;
      this.rig.position.x = Math.sin(this.t * 60) * 0.04;
      this.diveT -= dt;
      if (this.diveT <= 0) {
        this.state = 'dive';
        this.diveT = 1.1;
        this.rig.position.x = 0;
      }
    } else {
      tx = p.x;
      ty = 0.9;
      maxV = 4.0 * g.spdMul;
      lam = 4;
      this.diveT -= dt;
      if (this.diveT <= 0) {
        this.state = 'hover';
        this.diveT = rand(3, 6);
        this.side = Math.random() < 0.5 ? 1 : -1;
      }
    }
    const dx = tx - pos.x, dy = ty - pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const sp = maxV * Math.min(1, len / 1.5);
    this.vx = damp(this.vx, (dx / len) * sp, lam, dt);
    this.vy = damp(this.vy, (dy / len) * sp, lam, dt);
    pos.x += this.vx * dt;
    pos.y += this.vy * dt + Math.sin(this.t * 9 + this.seed) * 0.01;
    this.face(Math.abs(this.vx) > 0.5 ? Math.sign(this.vx) : Math.sign(p.x - pos.x) || 1);
    this.rig.rotation.z = clamp(this.vy * 0.1, -0.6, 0.6);
    if (this.touchesPlayer()) g.killPlayer(this);
  }

  dieAnim(dt) {
    const pos = this.group.position;
    this.vy -= 12 * dt;
    pos.x += this.vx * dt * 0.3;
    pos.y = Math.max(0.12, pos.y + this.vy * dt);
    this.rig.rotation.x += dt * 9;
    if (this.deathT > 1.6) pos.y -= dt * 0.5;
  }
}

// ---- Toad: hops at you and lashes its tongue ---------------------------------------------------
export class Toad extends Monster {
  constructor(game, x) {
    super(game, x);
    this.hp = Math.round(3 * game.hpMul);
    this.score = 200;
    const skin = this.mat('#4f6b2a'), belly = this.mat('#b9b06a'), dark = this.mat('#2c3d17'), tongueM = this.mat('#d65a7a');
    const rig = (this.rig = new THREE.Group());
    this.group.add(rig);
    this.body = mesh(lumpy(sphere(0.85, 16, 12), 0.07, 6), skin, rig, 0, 0.8, 0);
    this.body.scale.set(1.3, 0.85, 1.05);
    mesh(sphere(0.7), belly, rig, 0.25, 0.55, 0).scale.set(1.1, 0.7, 0.9);
    mesh(boxG(0.5, 0.05, 0.95), dark, rig, 0.82, 0.72, 0);
    for (const s of [1, -1]) {
      mesh(sphere(0.21), skin, rig, 0.55, 1.36, s * 0.38);
      mesh(sphere(0.15), glow('#ffcc33', 1.6), rig, 0.68, 1.42, s * 0.4);
      mesh(boxG(0.04, 0.18, 0.05), new THREE.MeshBasicMaterial({ color: 0 }), rig, 0.82, 1.42, s * 0.4);
    }
    this.hind = [];
    for (const s of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(-0.6, 0.55, s * 0.62);
      rig.add(hip);
      mesh(sphere(0.42), skin, hip).scale.set(1.3, 0.8, 0.7);
      mesh(boxG(0.75, 0.1, 0.32), dark, hip, 0.25, -0.5, 0);
      this.hind.push(hip);
      mesh(new THREE.CylinderGeometry(0.08, 0.11, 0.6, 5), skin, rig, 0.7, 0.3, s * 0.5);
      mesh(boxG(0.3, 0.08, 0.25), dark, rig, 0.8, 0.04, s * 0.5);
    }
    this.tongue = new THREE.Group();
    this.tongue.position.set(0.95, 0.75, 0);
    rig.add(this.tongue);
    mesh(limbGeo(1, 0.07, 0.07), tongueM, this.tongue);
    this.tongue.scale.x = 0.001;
    this.state = 'sit';
    this.sitT = rand(0.6, 1.4);
    this.tongueT = -1;
    this.tongueCd = 1;
    this.addHit(this.body, 1.05);
  }

  update(dt) {
    this.base(dt);
    if (!this.alive) return;
    const g = this.game, p = g.player, pos = this.group.position;
    const dx = p.x - this.x;
    const dir = Math.sign(dx) || 1;
    if (this.state === 'sit') {
      this.rig.scale.y = damp(this.rig.scale.y, 1, 8, dt);
      this.body.scale.y = 0.85 + Math.sin(this.t * 4) * 0.03;
      this.sitT -= dt;
      this.tongueCd -= dt;
      if (this.tongueT >= 0) {
        this.tongueT += dt;
        const ext = Math.sin(Math.PI * Math.min(1, this.tongueT / 0.45)) * 3.4;
        this.tongue.scale.x = Math.max(0.001, ext);
        if (this.tongueT < 0.3 && 0.95 + ext > Math.abs(dx) - 0.25 && Math.sign(dx) === this.dir) g.killPlayer(this);
        if (this.tongueT >= 0.45) {
          this.tongueT = -1;
          this.tongue.scale.x = 0.001;
          this.tongueCd = 1.6;
        }
      } else {
        this.face(dir);
        if (Math.abs(dx) < 3.8 && this.tongueCd <= 0) {
          this.tongueT = 0;
          g.audio.sfx('tongue');
        } else if (this.sitT <= 0) {
          this.state = 'hop';
          this.vx = dir * rand(3.5, 5) * g.spdMul;
          this.vy = rand(6.5, 8);
          g.audio.sfx('hop');
        }
      }
    } else {
      pos.x += this.vx * dt;
      this.vy -= 18 * dt;
      pos.y += this.vy * dt;
      for (const h of this.hind) h.rotation.z = this.vy > 0 ? -0.9 : -0.3;
      this.rig.rotation.z = this.vy * 0.03;
      if (pos.y <= 0) {
        pos.y = 0;
        this.state = 'sit';
        this.sitT = rand(0.5, 1.3);
        this.rig.scale.y = 0.75;
        this.rig.rotation.z = 0;
        for (const h of this.hind) h.rotation.z = 0;
        g.fx.dirt(new THREE.Vector3(pos.x, 0.1, 0), 8);
        g.audio.sfx('land');
      }
    }
    if (this.touchesPlayer()) g.killPlayer(this);
  }

  dieAnim(dt) {
    this.tongue.scale.x = 0.001;
    this.group.position.y = Math.max(0, this.group.position.y - dt * 4);
    this.rig.rotation.z = -Math.min(1, this.deathT * 3) * 1.3;
    if (this.deathT > 1) this.group.position.y = -(this.deathT - 1) * 1.5;
  }
}

// ---- Serpent: slithers out of the ground, rears up and strikes ---------------------------------
export class Serpent extends Monster {
  constructor(game, x) {
    super(game, 0);
    this.hp = Math.round(4 * game.hpMul);
    this.score = 300;
    this.deathTime = 2.4;
    const scale = this.mat('#3d6b3a'), band = this.mat('#c9a83a'), jawM = this.mat('#b8c070');
    this.head = new THREE.Group();
    this.group.add(this.head);
    const skull = mesh(sphere(0.3, 12, 9), scale, this.head, 0.1, 0, 0);
    skull.scale.set(1.5, 0.75, 0.95);
    mesh(boxG(0.5, 0.08, 0.35), jawM, this.head, 0.22, -0.17, 0);
    const eye = glow('#ffe14a', 2.2);
    mesh(sphere(0.05, 6, 5), eye, this.head, 0.32, 0.12, 0.17);
    mesh(sphere(0.05, 6, 5), eye, this.head, 0.32, 0.12, -0.17);
    for (const z of [0.08, -0.08]) mesh(new THREE.ConeGeometry(0.03, 0.14, 4), this.mat('#eeeeee'), this.head, 0.48, -0.14, z).rotation.z = Math.PI;
    this.forked = mesh(boxG(0.35, 0.02, 0.04), glow('#ff3050', 1.2), this.head, 0.6, -0.08, 0);
    this.segs = [];
    const n = 18;
    for (let i = 0; i < n; i++) {
      const r = 0.3 * (1 - (i / n) * 0.7);
      const s = mesh(sphere(r, 10, 8), i % 3 === 0 ? band : scale, this.group);
      s.userData.r = r;
      this.segs.push(s);
    }
    const dir0 = Math.sign(game.player.x - x) || 1;
    this.dir = dir0;
    this.trail = [];
    for (let k = 60; k >= 1; k--) this.trail.push(new THREE.Vector3(x - dir0 * k * 0.1, -1.3, 0));
    this.head.position.set(x, -0.8, 0);
    this.state = 'emerge';
    this.st = 0;
    this.addHit(skull, 0.45);
    for (let i = 0; i < 10; i++) this.addHit(this.segs[i], this.segs[i].userData.r + 0.06);
    game.audio.sfx('hiss');
    game.fx.dirt(new THREE.Vector3(x, 0.1, 0), 16);
  }

  get x() { return this.head.position.x; }

  update(dt) {
    this.base(dt);
    const hp = this.head.position;
    if (this.alive) {
      const g = this.game, p = g.player;
      const dx = p.x - hp.x;
      const dir = Math.sign(dx) || 1;
      const spd = g.spdMul;
      this.st += dt;
      switch (this.state) {
        case 'emerge':
          hp.y = damp(hp.y, 0.5, 2, dt);
          hp.x += this.dir * 1.2 * dt;
          if (this.st > 1.2) this.state = 'slither';
          break;
        case 'slither':
          this.dir = dir;
          hp.x += dir * 2.6 * spd * dt;
          hp.y = 0.45 + Math.sin(this.t * 5) * 0.3;
          if (Math.abs(dx) < 4.5) { this.state = 'rear'; this.st = 0; }
          break;
        case 'rear':
          hp.y = damp(hp.y, 1.7, 5, dt);
          hp.x -= this.dir * 0.6 * dt;
          if (this.st > 0.7 / spd) { this.state = 'strike'; this.st = 0; g.audio.sfx('hiss'); }
          break;
        case 'strike':
          hp.x += this.dir * 10 * spd * dt;
          hp.y = damp(hp.y, 1.0, 8, dt);
          if (this.st > 0.32) { this.state = 'recoil'; this.st = 0; }
          break;
        case 'recoil':
          hp.x -= this.dir * 3 * dt;
          hp.y = damp(hp.y, 0.6, 4, dt);
          if (this.st > 0.9) { this.state = 'slither'; this.st = 0; }
          break;
      }
      this.forked.visible = Math.sin(this.t * 14) > 0.3;
      if (this.touchesPlayer(1)) g.killPlayer(this);
    } else {
      hp.y = damp(hp.y, 0.2, 3, dt);
    }

    // Body follows the head's trail.
    const last = this.trail[this.trail.length - 1];
    if (last.distanceToSquared(hp) > 0.0025) this.trail.push(hp.clone());
    if (this.trail.length > 300) this.trail.shift();
    const sp = 0.28;
    let target = sp, acc = 0, a = hp, si = 0;
    const n = this.segs.length;
    for (let k = this.trail.length - 1; k >= 0 && si < n; k--) {
      const b = this.trail[k];
      const L = a.distanceTo(b);
      while (si < n && acc + L >= target) {
        this.segs[si].position.lerpVectors(a, b, (target - acc) / L);
        si++;
        target += sp;
      }
      acc += L;
      a = b;
    }
    for (; si < n; si++) this.segs[si].position.copy(this.trail[0]);
    if (!this.alive) for (const s of this.segs) s.position.y = Math.max(s.userData.r * 0.6, s.position.y - this.deathT * 0.05);

    const nb = this.segs[0].position;
    const pitch = Math.atan2(hp.y - nb.y, Math.abs(hp.x - nb.x) + 0.001);
    this.head.rotation.set(0, this.dir < 0 ? Math.PI : 0, pitch);
  }

  dieAnim() {
    if (this.deathT > 1.2) this.group.position.y = -(this.deathT - 1.2) * 0.8;
  }
}

// ---- Wyvern: circles overhead, spits fire, swoops ----------------------------------------------
export class Wyvern extends Monster {
  constructor(game, x) {
    super(game, x);
    this.hp = Math.round(6 * game.hpMul);
    this.score = 500;
    this.deathTime = 3.2;
    const hide = this.mat('#5a2420'), bellyM = this.mat('#a0703a'), horn = this.mat('#d8cfb0');
    const memb = this.mat('#4a1a16', { side: THREE.DoubleSide, roughness: 0.95 });
    const rig = (this.rig = new THREE.Group());
    this.group.add(rig);
    const body = mesh(lumpy(sphere(0.7, 14, 10), 0.05), hide, rig);
    body.scale.set(1.7, 0.85, 0.85);
    mesh(sphere(0.55), bellyM, rig, 0.1, -0.25, 0).scale.set(1.6, 0.6, 0.7);
    [[1.1, 0.25, 0.34], [1.4, 0.42, 0.29], [1.7, 0.6, 0.25]].forEach(([x, y, r]) => mesh(sphere(r), hide, rig, x, y, 0));
    this.head = new THREE.Group();
    this.head.position.set(2.1, 0.75, 0);
    rig.add(this.head);
    const skull = mesh(sphere(0.32), hide, this.head);
    skull.scale.set(1.6, 0.8, 0.8);
    mesh(boxG(0.5, 0.22, 0.3), hide, this.head, 0.45, -0.06, 0);
    this.jaw = mesh(boxG(0.5, 0.08, 0.26), bellyM, this.head, 0.4, -0.2, 0);
    for (const s of [1, -1]) {
      const h = mesh(new THREE.ConeGeometry(0.07, 0.55, 5), horn, this.head, -0.25, 0.25, s * 0.15);
      h.rotation.z = 2.0;
      mesh(sphere(0.06, 6, 5), glow('#ffa020', 3), this.head, 0.15, 0.12, s * 0.21);
    }
    this.tail = [];
    for (let i = 0; i < 9; i++) {
      const t = mesh(sphere(0.35 * (1 - i / 10) + 0.05, 8, 6), hide, rig, -1.1 - i * 0.32, -0.05 * i, 0);
      t.userData.y = t.position.y;
      this.tail.push(t);
    }
    const spade = mesh(new THREE.ConeGeometry(0.15, 0.4, 4), hide, rig, -4.1, -0.5, 0);
    spade.rotation.z = Math.PI / 2;
    this.spade = spade;
    for (const s of [1, -1]) {
      const l = mesh(limbGeo(0.6, 0.08, 0.05), hide, rig, 0.2, -0.45, s * 0.3);
      l.rotation.z = -2.0;
    }
    this.wings = [];
    for (const s of [1, -1]) {
      const pivot = new THREE.Group();
      pivot.position.set(0.1, 0.45, s * 0.35);
      rig.add(pivot);
      const v = [0, 0, 0, 0.9, 0, s * 1.3, 0.2, 0, s * 3.2, -0.6, 0, s * 2.7, -1.3, 0, s * 1.7, -0.8, 0, s * 0.4];
      const wg = new THREE.BufferGeometry();
      wg.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      wg.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5]);
      wg.computeVertexNormals();
      mesh(wg, memb, pivot);
      mesh(limbGeo(1.6, 0.06, 0.03), hide, pivot).rotation.y = -Math.atan2(s * 1.3, 0.9);
      this.wings.push({ pivot, s });
    }
    rig.rotation.x = 0.25;
    this.group.position.y = 6;
    this.side = Math.sign(x - game.player.x) || 1;
    this.state = 'cruise';
    this.actionT = rand(2, 3);
    this.actions = 0;
    this.landed = false;
    this.addHit(body, 1.0);
    this.addHit(skull, 0.5);
    game.audio.sfx('roar');
  }

  update(dt) {
    this.base(dt);
    const flapSpeed = this.state === 'swoop' ? 4 : 6;
    for (const w of this.wings) w.pivot.rotation.x = this.alive ? w.s * Math.sin(this.t * flapSpeed) * 0.75 : w.s * -0.6;
    this.tail.forEach((t, i) => (t.position.y = t.userData.y + Math.sin(this.t * 3 - i * 0.6) * 0.03 * i));
    this.spade.position.y = this.tail[8].position.y - 0.1;
    if (!this.alive) return;
    const g = this.game, p = g.player, pos = this.group.position;
    if (this.state === 'cruise') {
      const tx = p.x + this.side * 7 + Math.sin(this.t * 0.7) * 2;
      const ty = 5.8 + Math.sin(this.t * 1.3) * 0.8;
      pos.x = damp(pos.x, tx, 1.2, dt);
      pos.y = damp(pos.y, ty, 1.5, dt);
      this.face(Math.sign(p.x - pos.x) || 1);
      this.jaw.rotation.z = damp(this.jaw.rotation.z, 0, 6, dt);
      this.actionT -= dt;
      if (this.actionT <= 0) {
        this.actions++;
        if (this.actions % 3 === 0) {
          this.state = 'swoop';
          this.st = 0;
          this.sx = pos.x;
          this.sy = pos.y;
          this.ex = p.x - this.side * 8;
          g.audio.sfx('roar');
        } else {
          this.spit();
          this.actionT = rand(2, 3.4) / g.spdMul;
        }
      }
    } else {
      this.st += (dt / 1.8) * g.spdMul;
      const f = Math.min(1, this.st);
      pos.x = lerp(this.sx, this.ex, f);
      pos.y = this.sy - Math.sin(Math.PI * f) * (this.sy - 1.1);
      this.face(Math.sign(this.ex - this.sx) || 1);
      if (f >= 1) {
        this.state = 'cruise';
        this.side = -this.side;
        this.actionT = rand(1.5, 3);
      }
    }
    if (this.touchesPlayer()) g.killPlayer(this);
  }

  spit() {
    const g = this.game;
    const from = new THREE.Vector3();
    this.jaw.getWorldPosition(from);
    from.z = 0;
    this.jaw.rotation.z = -0.5;
    const to = new THREE.Vector3(g.player.x + g.player.vx * 0.4, 0.9, 0);
    const vel = to.sub(from).normalize().multiplyScalar(9 * g.spdMul);
    g.spawnFireball(from, vel);
  }

  dieAnim(dt) {
    const pos = this.group.position;
    this.vy -= 10 * dt;
    pos.y = Math.max(0.6, pos.y + this.vy * dt);
    this.rig.rotation.z = damp(this.rig.rotation.z, -0.3, 3, dt);
    if (pos.y <= 0.6 && !this.landed) {
      this.landed = true;
      this.game.fx.dirt(new THREE.Vector3(pos.x, 0.2, 0), 30, 4);
      this.game.audio.sfx('boom');
      this.game.shake = 0.5;
    }
    if (this.deathT > 2.2) pos.y -= dt * 1.2;
  }
}

// ---- Ghoul: skeletons that claw their way out of the forest floor -------------------------------
export class Ghoul extends Monster {
  constructor(game, x) {
    super(game, x);
    this.hp = Math.round(2 * game.hpMul);
    this.score = 150;
    this.blood = '#9a9478';
    const bone = this.mat('#d8cfb4'), rag = this.mat('#2f3a2a');
    const rig = (this.rig = new THREE.Group());
    rig.position.y = -2.0;
    this.group.add(rig);
    mesh(boxG(0.22, 0.14, 0.34), bone, rig, 0, 0.95, 0);
    mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.6, 5), bone, rig, 0, 1.28, 0);
    let chest;
    for (let k = 0; k < 4; k++) {
      const r = mesh(new THREE.TorusGeometry(0.18 - k * 0.015, 0.024, 4, 12), bone, rig, 0.03, 1.22 + k * 0.09, 0);
      r.rotation.x = Math.PI / 2;
      r.scale.set(0.8, 1, 1);
      if (k === 1) chest = r;
    }
    this.skull = new THREE.Group();
    this.skull.position.set(0.05, 1.72, 0);
    rig.add(this.skull);
    const head = mesh(sphere(0.17), bone, this.skull);
    head.scale.set(1, 1.1, 0.9);
    this.jaw = mesh(boxG(0.14, 0.06, 0.16), bone, this.skull, 0.05, -0.17, 0);
    const eye = glow('#7dff6a', 3);
    mesh(sphere(0.035, 6, 5), eye, this.skull, 0.13, 0.03, 0.06);
    mesh(sphere(0.035, 6, 5), eye, this.skull, 0.13, 0.03, -0.06);
    mesh(boxG(0.04, 0.6, 0.42), rag, rig, -0.13, 1.18, 0).rotation.z = 0.05;
    mesh(boxG(0.3, 0.3, 0.38), rag, rig, -0.02, 0.85, 0).rotation.z = -0.1;
    this.arms = [];
    for (const s of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(0, 1.52, s * 0.22);
      rig.add(sh);
      mesh(limbGeo(0.4, 0.035, 0.03), bone, sh);
      const el = new THREE.Group();
      el.position.x = 0.4;
      sh.add(el);
      mesh(limbGeo(0.38, 0.03, 0.02), bone, el);
      for (let c = 0; c < 3; c++) mesh(limbGeo(0.12, 0.012, 0.004, 3), bone, el, 0.38, 0, (c - 1) * 0.03).rotation.z = -0.4;
      this.arms.push({ sh, el, s });
    }
    this.legs = [];
    for (const s of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.92, s * 0.1);
      rig.add(hip);
      mesh(limbGeo(0.45, 0.045, 0.035), bone, hip);
      const knee = new THREE.Group();
      knee.position.x = 0.45;
      hip.add(knee);
      mesh(limbGeo(0.45, 0.035, 0.03), bone, knee);
      mesh(boxG(0.06, 0.18, 0.08), bone, knee, 0.46, 0.06, 0);
      this.legs.push({ hip, knee, s });
    }
    this.state = 'rise';
    this.phase = Math.random() * 6;
    this.face(Math.sign(game.player.x - x) || 1);
    this.addHit(chest, 0.42);
    this.addHit(head, 0.26);
    game.audio.sfx('rise');
  }

  update(dt) {
    this.base(dt);
    if (!this.alive) return;
    const g = this.game, p = g.player, rig = this.rig;
    if (this.state === 'rise') {
      const f = Math.min(1, this.t / 1.8);
      rig.position.y = -2 + (1 - (1 - f) * (1 - f)) * 2;
      rig.rotation.z = Math.sin(this.t * 7) * 0.08;
      if (Math.random() < 0.4) g.fx.dirt(new THREE.Vector3(this.x, 0.05, 0), 2, 2);
      for (const a of this.arms) a.sh.rotation.z = 1.2 + Math.sin(this.t * 8 + a.s) * 0.3;
      for (const L of this.legs) L.hip.rotation.z = -Math.PI / 2;
      if (f >= 1) this.state = 'walk';
      return;
    }
    const dir = Math.sign(p.x - this.x) || 1;
    this.face(dir);
    this.phase += dt * 4 * g.spdMul;
    const ph = this.phase;
    this.group.position.x += dir * 1.4 * g.spdMul * dt * (0.6 + 0.4 * Math.abs(Math.sin(ph)));
    for (const L of this.legs) {
      const s = Math.sin(ph + (L.s > 0 ? 0 : Math.PI));
      L.hip.rotation.z = -Math.PI / 2 + s * 0.4;
      L.knee.rotation.z = Math.max(0, -s) * 0.6;
    }
    for (const a of this.arms) {
      a.sh.rotation.z = -0.15 + Math.sin(ph * 0.5 + a.s) * 0.15;
      a.el.rotation.z = 0.15 + Math.sin(ph * 0.7 + a.s) * 0.1;
    }
    rig.rotation.z = -0.08 + Math.sin(ph) * 0.05;
    rig.position.y = Math.abs(Math.sin(ph)) * 0.04;
    this.jaw.position.y = -0.17 - Math.max(0, Math.sin(this.t * 6)) * 0.04;
    this.skull.rotation.z = Math.sin(this.t * 1.7) * 0.15;
    if (this.touchesPlayer()) g.killPlayer(this);
  }

  dieAnim(dt) {
    this.rig.rotation.z = -Math.min(1.45, this.deathT * 3);
    this.skull.position.y = damp(this.skull.position.y, 0.3, 3, dt);
    if (this.deathT > 1) this.group.position.y -= dt * 0.8;
  }
}

// ---- The Horned Shade: the final horror, only fully visible when lightning strikes -----------
export class Shade extends Monster {
  constructor(game, x) {
    super(game, x);
    this.hp = Math.round(14 * game.hpMul);
    this.score = 2000;
    this.blood = '#7a2aa0';
    this.deathTime = 4;
    this.hits = 0;
    this.robe = this.mat('#1c1028', { emissive: '#1c0830', roughness: 1, transparent: true, opacity: 0.4 });
    const rig = (this.rig = new THREE.Group());
    this.group.add(rig);
    const prof = [[1.8, 0], [1.5, 0.6], [1.2, 1.8], [1.0, 3.0], [1.25, 4.2], [0.8, 4.8], [0.35, 5.05], [0.01, 5.1]].map(([r, y]) => new THREE.Vector2(r, y));
    const body = new THREE.LatheGeometry(prof, 14);
    const bp = body.attributes.position;
    for (let i = 0; i < bp.count; i++) {
      if (bp.getY(i) < 0.1) bp.setY(i, Math.sin(Math.atan2(bp.getZ(i), bp.getX(i)) * 7) * 0.15 + 0.05);
    }
    body.computeVertexNormals();
    mesh(body, this.robe, rig);
    this.headG = new THREE.Group();
    this.headG.position.set(0.25, 5.6, 0);
    rig.add(this.headG);
    const skull = mesh(lumpy(sphere(0.75, 14, 10), 0.08), this.robe, this.headG);
    skull.scale.set(1, 1.15, 0.9);
    mesh(boxG(0.6, 0.45, 0.6), this.robe, this.headG, 0.45, -0.35, 0);
    for (const s of [1, -1]) {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, 0.4, s * 0.45), new THREE.Vector3(-0.4, 1.7, s * 1.5), new THREE.Vector3(0.5, 2.2, s * 1.1));
      mesh(new THREE.TubeGeometry(curve, 12, 0.14, 6, false), this.robe, this.headG);
      const tip = mesh(new THREE.ConeGeometry(0.14, 0.5, 6), this.robe, this.headG, 0.62, 2.35, s * 1.05);
      tip.rotation.z = -0.9;
      mesh(sphere(0.12, 8, 6), glow('#ff3a1a', 5), this.headG, 0.64, 0.12, s * 0.27);
    }
    this.mouth = mesh(boxG(0.06, 0.1, 0.42), glow('#ff6a20', 2.5), this.headG, 0.76, -0.4, 0);
    this.armsG = [];
    for (const s of [1, -1]) {
      const sh = new THREE.Group();
      sh.position.set(0, 4.4, s * 1.1);
      rig.add(sh);
      mesh(limbGeo(2.7, 0.26, 0.12), this.robe, sh);
      for (let c = 0; c < 3; c++) {
        const claw = mesh(new THREE.ConeGeometry(0.06, 0.55, 4), glow('#c8b8ff', 1.2), sh, 2.85, 0, (c - 1) * 0.12);
        claw.rotation.z = -Math.PI / 2 + 0.3;
      }
      sh.rotation.z = -Math.PI / 2;
      this.armsG.push(sh);
    }
    const chest = new THREE.Object3D();
    chest.position.y = 3.2;
    const low = new THREE.Object3D();
    low.position.y = 1.2;
    rig.add(chest, low);
    this.addHit(chest, 1.3);
    this.addHit(skull, 0.95);
    this.addHit(low, 1.3);
    this.state = 'approach';
    this.st = 0;
    this.swing = 0;
    this.face(Math.sign(game.player.x - x) || 1);
    game.audio.sfx('roar');
  }

  onHit() {
    this.hits++;
    if (this.alive && this.hp > 0 && this.hits % 4 === 0) {
      this.state = 'fade';
      this.st = 0;
      this.game.audio.sfx('vanish');
    }
  }

  update(dt) {
    this.base(dt);
    const g = this.game, p = g.player, pos = this.group.position;
    const fl = Math.min(1, g.world.flash);
    let vis = 0.3 + fl * 0.7 + (this.hitT > 0 ? 0.3 : 0);
    if (!this.alive) vis *= Math.max(0, 1 - this.deathT / this.deathTime);
    if (this.state === 'fade') vis *= Math.max(0, 1 - this.st / 0.6);
    this.robe.opacity = clamp(vis, 0, 1);
    if (Math.random() < 0.3) g.fx.magic(new THREE.Vector3(pos.x, rand(0.2, 4), 0), 1, '#7030c0');
    if (!this.alive) return;
    this.rig.position.y = Math.sin(this.t * 1.5) * 0.15;
    this.mouth.scale.y = 1 + Math.max(0, Math.sin(this.t * 3)) * 1.5;
    const dx = p.x - pos.x;
    const dir = Math.sign(dx) || 1;
    this.st += dt;
    switch (this.state) {
      case 'approach':
        this.face(dir);
        pos.x += dir * 1.1 * g.spdMul * dt;
        this.swing = damp(this.swing, Math.sin(this.t * 1.4) * 0.15, 3, dt);
        if (Math.abs(dx) < 3.4) { this.state = 'wind'; this.st = 0; g.audio.sfx('roar'); }
        break;
      case 'wind':
        this.swing = -0.9 * Math.min(1, this.st / 0.6);
        if (this.st > 0.7 / g.spdMul) { this.state = 'strike'; this.st = 0; }
        break;
      case 'strike':
        this.swing = -0.9 + Math.min(1, this.st / 0.3) * 2.6;
        if (this.st > 0.08 && this.st < 0.32 && Math.abs(dx) < 4.4 && Math.sign(dx) === this.dir) g.killPlayer(this);
        if (this.st > 0.6) { this.state = 'recover'; this.st = 0; }
        break;
      case 'recover':
        this.swing = damp(this.swing, 0, 3, dt);
        pos.x -= this.dir * 0.8 * dt;
        if (this.st > 0.9) { this.state = 'approach'; this.st = 0; }
        break;
      case 'fade':
        if (this.st > 0.7) {
          g.fx.smoke(new THREE.Vector3(pos.x, 2.5, 0), 20, '#20102c', 1.2);
          pos.x = p.x - dir * 11;
          this.state = 'approach';
          this.st = 0;
          g.fx.smoke(new THREE.Vector3(pos.x, 2.5, 0), 20, '#20102c', 1.2);
        }
        break;
    }
    for (const a of this.armsG) a.rotation.z = -Math.PI / 2 + this.swing;
    if (this.state !== 'fade' && this.touchesPlayer(1) && Math.abs(dx) < 1.4) g.killPlayer(this);
  }

  dieAnim(dt) {
    this.rig.position.y -= dt * 1.4;
    this.rig.rotation.z += dt * 0.15;
    this.game.fx.magic(new THREE.Vector3(this.x, rand(0, 5), 0), 3, '#c050ff');
  }
}

export function createMonster(type, game, i = 0, side = 1) {
  const p = game.player;
  switch (type) {
    case 'spider': return new Spider(game, p.x + side * rand(4, 9));
    case 'wasp': return new Wasp(game, p.x + side * (rand(13, 16) + i * 1.3), i);
    case 'toad': return new Toad(game, p.x + side * rand(13, 16));
    case 'serpent': return new Serpent(game, p.x + side * rand(8, 12));
    case 'wyvern': return new Wyvern(game, p.x + side * 16);
    case 'ghoul': return new Ghoul(game, p.x + side * rand(5, 10));
    case 'shade': return new Shade(game, p.x + side * 14);
  }
  throw new Error('unknown monster ' + type);
}
