import * as THREE from 'three';
import { clamp, damp } from './util.js';
import { makeArrowMesh } from './arrows.js';

const M = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85, flatShading: true, ...o });

function box(w, h, d, mat, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

const BOW_R = 0.6;
const BOW_ARC = Math.PI * 0.62;
const TIP_X = -BOW_R + BOW_R * Math.cos(BOW_ARC / 2);
const TIP_Y = BOW_R * Math.sin(BOW_ARC / 2);
const HAND_X = 0.52;

// A hooded forest ranger, built from boxes so it reads well at C64-ish chunkiness.
export class Archer {
  constructor(scene) {
    this.root = new THREE.Group();
    scene.add(this.root);
    this.body = new THREE.Group();
    this.root.add(this.body);
    this.x = 0;
    this.vx = 0;
    this.facing = 1;
    this.aim = -0.04;
    this.pull = 0;
    this.cooldown = 0;
    this.fireBuffer = 0;
    this.walkPhase = 0;
    this.state = 'alive';
    this.deathT = 0;

    const cloth = M('#48662f'), clothDark = M('#2e4420'), leather = M('#5d3c22'), skin = M('#d8a37b');
    const wood = M('#8a5a2b'), hood = M('#355226');

    // Legs: hip -> thigh -> knee -> shin + boot
    this.legs = [];
    for (const side of [1, -1]) {
      const hip = new THREE.Group();
      hip.position.set(0, 0.95, side * 0.1);
      box(0.17, 0.48, 0.16, side > 0 ? cloth : clothDark, hip, 0, -0.24, 0);
      const knee = new THREE.Group();
      knee.position.y = -0.48;
      hip.add(knee);
      box(0.15, 0.42, 0.14, leather, knee, 0, -0.21, 0);
      box(0.27, 0.1, 0.15, leather, knee, 0.05, -0.44, 0);
      this.body.add(hip);
      this.legs.push({ hip, knee });
    }

    const torso = (this.torso = new THREE.Group());
    torso.position.y = 0.95;
    this.body.add(torso);
    box(0.3, 0.62, 0.4, cloth, torso, 0, 0.31, 0);
    box(0.34, 0.24, 0.42, cloth, torso, 0, 0.0, 0);
    box(0.33, 0.06, 0.43, leather, torso, 0, 0.08, 0);
    box(0.06, 0.06, 0.06, M('#c8b060', { metalness: 0.6 }), torso, 0.17, 0.08, 0);
    // Quiver with fletchings
    const quiver = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.06, 0.6, 6), leather);
    quiver.position.set(-0.2, 0.4, -0.05);
    quiver.rotation.z = 0.45;
    quiver.castShadow = true;
    torso.add(quiver);
    for (let i = 0; i < 3; i++) box(0.03, 0.12, 0.05, M('#c02828'), quiver, (i - 1) * 0.03, 0.34, (i - 1) * 0.02);
    // Cloak
    this.cloak = new THREE.Group();
    this.cloak.position.set(-0.17, 0.6, 0);
    torso.add(this.cloak);
    box(0.04, 0.85, 0.46, clothDark, this.cloak, 0, -0.42, 0);

    // Head + hood
    this.head = new THREE.Group();
    this.head.position.set(0, 0.66, 0);
    torso.add(this.head);
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8), skin);
    face.position.set(0.03, 0.15, 0);
    face.castShadow = true;
    this.head.add(face);
    box(0.06, 0.05, 0.04, skin, this.head, 0.16, 0.14, 0);
    box(0.02, 0.025, 0.03, M('#1a1410'), this.head, 0.14, 0.19, 0.06);
    box(0.02, 0.025, 0.03, M('#1a1410'), this.head, 0.14, 0.19, -0.06);
    const hoodCap = new THREE.Mesh(new THREE.SphereGeometry(0.17, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55), hood);
    hoodCap.position.set(0.0, 0.17, 0);
    hoodCap.castShadow = true;
    this.head.add(hoodCap);
    box(0.12, 0.26, 0.3, hood, this.head, -0.1, 0.1, 0);
    const tip = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.3, 5), hood);
    tip.position.set(-0.2, 0.2, 0);
    tip.rotation.z = 1.9;
    this.head.add(tip);

    // Aim rig: both arms and the bow rotate around the shoulder.
    this.aimGroup = new THREE.Group();
    this.aimGroup.position.set(0, 0.55, 0);
    torso.add(this.aimGroup);
    box(0.5, 0.09, 0.09, cloth, this.aimGroup, 0.25, 0, 0.16);
    box(0.08, 0.08, 0.08, skin, this.aimGroup, HAND_X, 0, 0.16);
    this.drawArm = box(1, 0.09, 0.09, clothDark, this.aimGroup, 0, 0, 0.06);

    const bow = (this.bow = new THREE.Group());
    bow.position.set(HAND_X, 0, 0.16);
    this.aimGroup.add(bow);
    const limb = new THREE.Mesh(new THREE.TorusGeometry(BOW_R, 0.024, 5, 24, BOW_ARC), wood);
    limb.position.x = -BOW_R;
    limb.rotation.z = -BOW_ARC / 2;
    limb.castShadow = true;
    bow.add(limb);
    const sg = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(TIP_X, TIP_Y, 0), new THREE.Vector3(TIP_X, 0, 0), new THREE.Vector3(TIP_X, -TIP_Y, 0),
    ]);
    this.string = new THREE.Line(sg, new THREE.LineBasicMaterial({ color: '#e8e0c8' }));
    bow.add(this.string);
    this.nocked = makeArrowMesh();
    this.nocked.position.set(0, 0, 0.16);
    this.aimGroup.add(this.nocked);

    this.mats = [cloth, clothDark, leather, skin, wood, hood];
    this._updateBow();
  }

  reset(x) {
    this.x = x;
    this.vx = 0;
    this.state = 'alive';
    this.deathT = 0;
    this.aim = -0.04;
    this.pull = 0;
    this.body.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.root.position.set(x, 0, 0);
    this.root.visible = true;
  }

  die() {
    this.state = 'dead';
    this.deathT = 0;
  }

  get chest() {
    return new THREE.Vector3(this.x, 1.25, 0);
  }

  _updateBow() {
    const nockX = TIP_X - this.pull * 0.38;
    const p = this.string.geometry.attributes.position;
    p.setX(1, nockX);
    p.needsUpdate = true;
    const handX = HAND_X + nockX;
    this.drawArm.scale.x = Math.max(0.12, handX + 0.05);
    this.drawArm.position.x = this.drawArm.scale.x / 2;
    this.nocked.visible = this.pull > 0.15;
    this.nocked.position.x = handX;
  }

  // Returns {pos, dir} when an arrow is released.
  update(dt, input, canControl) {
    let shot = null;
    if (this.state === 'alive') {
      const mv = canControl ? (input.right ? 1 : 0) - (input.left ? 1 : 0) : 0;
      if (mv) this.facing = mv;
      this.vx = damp(this.vx, mv * 4.6, 12, dt);
      this.x += this.vx * dt;
      if (canControl) {
        if (input.up) this.aim += 1.7 * dt;
        if (input.down) this.aim -= 1.7 * dt;
      }
      this.aim = clamp(this.aim, -0.45, 1.3);

      const speed = Math.abs(this.vx);
      const k = speed / 4.6;
      this.walkPhase += speed * dt * 2.6;
      const ph = this.walkPhase;
      this.legs.forEach((L, i) => {
        const s = Math.sin(ph + i * Math.PI);
        L.hip.rotation.z = s * 0.6 * k;
        L.knee.rotation.z = -Math.max(0, Math.sin(ph + i * Math.PI - 1.2)) * 0.9 * k;
      });
      this.body.position.y = Math.abs(Math.sin(ph)) * 0.05 * k;
      this.torso.rotation.z = -0.06 * k;
      this.cloak.rotation.z = -0.08 - k * 0.25 + Math.sin(ph * 2) * 0.05 * k + Math.sin(performance.now() / 700) * 0.03;
      this.head.rotation.z = this.aim * 0.35;
      this.aimGroup.rotation.z = this.aim;

      this.cooldown -= dt;
      if (this.cooldown <= 0) this.pull = Math.min(1, this.pull + dt * 5);
      // A tap while the bow is still drawing fires as soon as it is ready.
      if (canControl && input.firePressed) this.fireBuffer = 0.3;
      this.fireBuffer -= dt;
      if (canControl && (input.fire || this.fireBuffer > 0) && this.pull >= 0.7) {
        this.fireBuffer = 0;
        const pos = new THREE.Vector3();
        this.nocked.getWorldPosition(pos);
        pos.z = 0;
        const dir = new THREE.Vector3(Math.cos(this.aim) * this.facing, Math.sin(this.aim), 0);
        pos.addScaledVector(dir, 0.3);
        shot = { pos, dir };
        this.pull = 0;
        this.cooldown = 0.24;
      }
      this._updateBow();
    } else {
      this.deathT += dt;
      const f = Math.min(1, this.deathT / 0.7);
      const e = f * f;
      this.body.rotation.z = e * 1.5 * this.facing;
      this.body.position.y = 0.08 * e;
      this.aimGroup.rotation.z = damp(this.aimGroup.rotation.z, -1.2, 4, dt);
    }
    this.root.position.x = this.x;
    this.body.scale.x = this.facing;
    return shot;
  }
}
