import * as THREE from 'three';

// Shared arrow geometry, pointing along +x with the tip at x = 0.36.
const shaftGeo = new THREE.CylinderGeometry(0.016, 0.016, 0.95, 5);
shaftGeo.rotateZ(-Math.PI / 2);
shaftGeo.translate(-0.275, 0, 0);
const headGeo = new THREE.ConeGeometry(0.045, 0.16, 4);
headGeo.rotateZ(-Math.PI / 2);
headGeo.translate(0.28, 0, 0);
const fletchGeo = new THREE.PlaneGeometry(0.22, 0.07);
fletchGeo.translate(-0.64, 0.035, 0);
const fletchGeo2 = fletchGeo.clone().rotateX(Math.PI / 2);

const shaftMat = new THREE.MeshStandardMaterial({ color: '#b88a50', roughness: 0.8 });
const headMat = new THREE.MeshStandardMaterial({ color: '#c8ccd0', metalness: 0.7, roughness: 0.35 });
const fletchMat = new THREE.MeshStandardMaterial({ color: '#c02828', side: THREE.DoubleSide, roughness: 0.9 });

export function makeArrowMesh() {
  const g = new THREE.Group();
  for (const [geo, mat] of [[shaftGeo, shaftMat], [headGeo, headMat], [fletchGeo, fletchMat], [fletchGeo2, fletchMat]]) {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true;
    m.userData.shared = true; // never dispose these with a monster
    g.add(m);
  }
  g.userData.shared = true;
  return g;
}

const GRAVITY = 7;
const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), s = new THREE.Vector3();

export class Arrow {
  constructor(scene, pos, dir, speed) {
    this.scene = scene;
    this.mesh = makeArrowMesh();
    this.mesh.position.copy(pos);
    this.vel = dir.clone().multiplyScalar(speed);
    this.state = 'fly';
    this.t = 0;
    this.orient();
    scene.add(this.mesh);
  }

  orient() {
    this.mesh.rotation.z = Math.atan2(this.vel.y, this.vel.x);
  }

  tip(out) {
    const a = this.mesh.rotation.z;
    return out.set(Math.cos(a) * 0.36, Math.sin(a) * 0.36, 0).add(this.mesh.position);
  }

  // Returns 'keep', 'drop' (forget it, mesh lives on elsewhere) or 'remove'.
  update(dt, game) {
    this.t += dt;
    if (this.state === 'ground') return this.t > 8 ? 'remove' : 'keep';

    this.tip(p0);
    this.vel.y -= GRAVITY * dt;
    this.mesh.position.addScaledVector(this.vel, dt);
    this.orient();
    this.tip(p1);

    for (const m of game.monsters) {
      if (!m.alive || Math.abs(m.x - p1.x) > 9) continue;
      for (let k = 1; k <= 3; k++) {
        s.lerpVectors(p0, p1, k / 3);
        if (m.testPoint(s)) {
          m.damage(1, s);
          // Leave the arrow stuck in the creature.
          this.mesh.position.add(s.clone().sub(p1));
          m.group.attach(this.mesh);
          return 'drop';
        }
      }
    }

    if (p1.y <= 0) {
      this.mesh.position.y -= p1.y - 0.02;
      this.state = 'ground';
      this.t = 0;
      game.fx.dirt(p1, 4, 1.2);
      game.audio.sfx('thunk');
      return 'keep';
    }
    if (Math.abs(p1.x - game.player.x) > 45 || p1.y > 40) return 'remove';
    return 'keep';
  }

  remove() {
    this.scene.remove(this.mesh);
  }
}
