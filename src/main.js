import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Forest, CAM_Z } from './world.js';
import { Archer } from './archer.js';
import { createMonster } from './monsters.js';
import { Arrow } from './arrows.js';
import { Effects } from './effects.js';
import { Sound } from './audio.js';
import { Input } from './input.js';
import { setupTouch, goFullscreen } from './touch.js';
import { LEVELS } from './levels.js';
import { damp, rand } from './util.js';
import './style.css';

const $ = (id) => document.getElementById(id);
const HI_KEY = 'forest-of-dread-hi';

function loadHi() {
  try { return +localStorage.getItem(HI_KEY) || 0; } catch { return 0; }
}
function saveHi(v) {
  try { localStorage.setItem(HI_KEY, String(v)); } catch { /* private mode */ }
}
// ?level=N starts at level N (practice / testing).
const START_LEVEL = Math.max(0, Math.min(LEVELS.length - 1, (+new URLSearchParams(location.search).get('level') || 1) - 1));
const pad = (n) => String(n).padStart(6, '0');

const fireGeo = new THREE.SphereGeometry(0.28, 10, 8);
const fireMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 2, 0.4) });

class Game {
  constructor() {
    const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }));
    this.input = new Input();
    this.touch = setupTouch(this.input);
    // Phones: fewer pixels and a smaller shadow map keep the frame rate up.
    r.setPixelRatio(Math.min(devicePixelRatio, this.touch ? 1.25 : 1.5));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    $('game').appendChild(r.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 700);
    this.camX = 0;
    this.shake = 0;

    this.composer = new EffectComposer(r);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.6, 0.55, 0.88);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    this.audio = new Sound();
    this.world = new Forest(this.scene);
    if (this.touch) this.world.dir.shadow.mapSize.set(1024, 1024);
    this.world.onStrike = (delay, vol) => {
      this.audio.sfx('thunder', { delay, vol });
      this.shake = Math.max(this.shake, 0.15 * vol);
    };
    this.player = new Archer(this.scene);
    this.player.root.visible = false;
    this.fx = new Effects(this.scene);

    this.monsters = [];
    this.arrows = [];
    this.projectiles = [];
    this.lightPool = [0, 1, 2].map(() => {
      const l = new THREE.PointLight(0xff8a3a, 0, 9, 2);
      this.scene.add(l);
      return l;
    });

    this.state = 'title';
    this.stateT = 0;
    this.score = 0;
    this.hi = loadHi();
    this.lives = 3;
    this.levelIdx = 0;
    this.loop = 0;
    this.hpMul = 1;
    this.spdMul = 1;
    this.tod = 0.62;
    this.todTarget = 0.62;
    this.storm = 0.15;
    this.rain = 0;
    this.paused = false;

    $('title').addEventListener('pointerdown', () => this.input.pressed.add('Pointer'));
    $('title-hi').textContent = this.hi ? `HI SCORE ${pad(this.hi)}` : '';
    addEventListener('resize', () => this.resize());
    this.resize();

    this.last = performance.now();
    requestAnimationFrame((t) => this.frame(t));
  }

  resize() {
    const w = innerWidth, h = innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const pr = this.renderer.getPixelRatio();
    this.fx.setScale((h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))));
  }

  // ---- flow -----------------------------------------------------------------------
  startGame() {
    this.audio.init();
    if (this.touch && this.state === 'title') goFullscreen();
    document.body.classList.add('playing');
    this.clearActors();
    this.score = 0;
    this.lives = 3;
    this.levelIdx = START_LEVEL;
    this.loop = 0;
    this.hpMul = 1;
    this.spdMul = 1;
    this.player.reset(this.camX);
    $('title').classList.add('hidden');
    $('hud').classList.remove('hidden');
    this.startLevel();
  }

  startLevel() {
    const L = (this.level = LEVELS[this.levelIdx]);
    this.kills = 0;
    this.spawned = 0;
    this.spawnTimer = 2.5;
    this.todTarget = L.tod;
    this.storm = L.storm;
    this.rain = L.rain;
    const prefix = this.loop ? `Night ${this.loop + 1} · ` : '';
    this.banner(`${prefix}Level ${this.levelIdx + 1}`, `${L.name}<br><br>${L.sub}`);
    this.setState('intro');
    this.audio.jingle('start', () => this.audio.startMusic(L.intensity));
    this.updateHud();
  }

  setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  banner(title, sub = '') {
    const b = $('banner');
    b.querySelector('h2').innerHTML = title;
    b.querySelector('p').innerHTML = sub;
    b.classList.remove('hidden');
    b.style.animation = 'none';
    void b.offsetWidth;
    b.style.animation = '';
  }
  hideBanner() {
    $('banner').classList.add('hidden');
  }

  clearActors() {
    for (const m of this.monsters) m.dispose();
    this.monsters = [];
    for (const a of this.arrows) a.remove();
    this.arrows = [];
    for (const p of this.projectiles) this.removeProjectile(p);
    this.projectiles = [];
  }

  onKill(m) {
    this.kills++;
    this.score += m.score * (1 + this.loop);
    if (this.score > this.hi) {
      this.hi = this.score;
      saveHi(this.hi);
    }
    this.updateHud();
  }

  killPlayer() {
    if (this.god) return; // test switch: window.game.god = true
    if (this.player.state !== 'alive' || (this.state !== 'play' && this.state !== 'intro')) return;
    this.player.die();
    this.fx.blood(this.player.chest, '#a01010', 70, 5.5);
    this.audio.sfx('die');
    this.audio.jingle('death');
    this.shake = 0.6;
    this.lives--;
    this.updateHud();
    this.setState('dying');
  }

  respawn() {
    // Creatures that were still alive come back later.
    for (const m of this.monsters) {
      if (m.alive) this.spawned--;
      m.dispose();
    }
    this.monsters = [];
    for (const p of this.projectiles) this.removeProjectile(p);
    this.projectiles = [];
    this.player.reset(this.player.x);
    this.spawnTimer = 2.5;
    this.banner('Ready', `${this.lives} ${this.lives === 1 ? 'life' : 'lives'} left`);
    this.setState('intro');
    this.audio.startMusic(this.level.intensity);
  }

  levelClear() {
    this.setState('clear');
    this.banner('The forest falls silent', '... for now');
    this.audio.jingle('clear');
    this.score += 500 * (this.levelIdx + 1) * (1 + this.loop);
    this.updateHud();
  }

  nextLevel() {
    this.levelIdx++;
    if (this.levelIdx >= LEVELS.length) {
      this.levelIdx = 0;
      this.loop++;
      this.hpMul = 1 + this.loop * 0.5;
      this.spdMul = 1 + this.loop * 0.15;
      this.lives = Math.min(5, this.lives + 1);
    }
    this.startLevel();
  }

  gameOver() {
    this.setState('over');
    this.banner('Game Over', `Score ${pad(this.score)}<br><br>Press space to try again`);
    this.audio.jingle('gameover');
    if (this.score >= this.hi) saveHi(this.hi);
  }

  updateHud() {
    $('score').textContent = `SCORE ${pad(this.score)}`;
    $('hi').textContent = `HI ${pad(this.hi)}`;
    $('level').textContent = this.level ? `${this.levelIdx + 1}. ${this.level.name.toUpperCase()}` : '';
    $('lives').textContent = '♥'.repeat(Math.max(0, this.lives));
  }

  // ---- actors ---------------------------------------------------------------------
  spawnLogic(dt) {
    const L = this.level;
    this.spawnTimer -= dt;
    const alive = this.monsters.reduce((n, m) => n + (m.alive ? 1 : 0), 0);
    if (this.spawned < L.kills && alive < L.maxAlive && this.spawnTimer <= 0) {
      const n = L.group ? Math.min(L.group, L.kills - this.spawned, L.maxAlive - alive) : 1;
      const side = Math.random() < 0.65 ? this.player.facing : -this.player.facing;
      for (let i = 0; i < n; i++) {
        this.monsters.push(createMonster(L.type, this, i, side));
        this.spawned++;
      }
      this.spawnTimer = L.interval / this.spdMul;
    }
    if (this.kills >= L.kills && alive === 0) this.levelClear();
  }

  spawnFireball(pos, vel) {
    const mesh = new THREE.Mesh(fireGeo, fireMat);
    mesh.position.copy(pos);
    this.scene.add(mesh);
    const light = this.lightPool.find((l) => !l.userData.busy) || null;
    if (light) {
      light.userData.busy = true;
      light.intensity = 8;
    }
    this.projectiles.push({ mesh, vel, light, t: 0 });
    this.audio.sfx('fire');
  }

  removeProjectile(p) {
    this.scene.remove(p.mesh);
    if (p.light) {
      p.light.intensity = 0;
      p.light.userData.busy = false;
    }
  }

  updateProjectiles(dt) {
    const pl = this.player;
    this.projectiles = this.projectiles.filter((p) => {
      p.t += dt;
      p.vel.y -= 3 * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      const pos = p.mesh.position;
      p.mesh.scale.setScalar(1 + Math.sin(p.t * 30) * 0.15);
      if (p.light) p.light.position.copy(pos);
      this.fx.fire(pos, 3);
      const hitPlayer = pl.state === 'alive' && Math.abs(pos.x - pl.x) < 0.5 && pos.y > 0 && pos.y < 1.9;
      if (hitPlayer || pos.y < 0.25 || p.t > 5) {
        this.fx.sparks(pos, 30);
        this.fx.smoke(pos, 6);
        this.audio.sfx('boom');
        this.removeProjectile(p);
        if (hitPlayer) this.killPlayer();
        return false;
      }
      return true;
    });
  }

  // ---- main loop ------------------------------------------------------------------
  frame(t) {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const inp = this.input;
    inp.poll();
    if (inp.tapped('KeyM')) this.audio.toggleMute();
    if (inp.tapped('KeyP', 'Escape') && this.state !== 'title') {
      this.paused = !this.paused;
      $('pause').classList.toggle('hidden', !this.paused);
      if (this.audio.ctx) this.paused ? this.audio.ctx.suspend() : this.audio.ctx.resume();
    }
    if (!this.paused) this.update(dt);
    inp.endFrame();
    this.composer.render();
    requestAnimationFrame((tt) => this.frame(tt));
  }

  update(dt) {
    const inp = this.input;
    this.stateT += dt;

    switch (this.state) {
      case 'title':
        this.camX += dt * 1.4;
        if (inp.start) this.startGame();
        break;
      case 'intro':
        if (this.stateT > 2.6) {
          this.hideBanner();
          this.setState('play');
        }
        break;
      case 'play':
        this.spawnLogic(dt);
        break;
      case 'dying':
        if (this.stateT > 3) this.lives > 0 ? this.respawn() : this.gameOver();
        break;
      case 'clear':
        if (this.stateT > 4) this.nextLevel();
        break;
      case 'over':
        if (this.stateT > 2 && inp.start) this.startGame();
        break;
    }

    if (this.state !== 'title') {
      const canControl = this.state === 'intro' || this.state === 'play' || this.state === 'clear';
      const shot = this.player.update(dt, inp, canControl);
      if (shot) {
        this.arrows.push(new Arrow(this.scene, shot.pos, shot.dir, 30));
        this.audio.sfx('shoot');
      }
    }

    this.arrows = this.arrows.filter((a) => {
      const r = a.update(dt, this);
      if (r === 'remove') a.remove();
      return r === 'keep';
    });
    // Too many arrows stuck in the ground: drop the oldest.
    while (this.arrows.length > 40) this.arrows.shift().remove();

    for (const m of this.monsters) m.update(dt);
    this.monsters = this.monsters.filter((m) => {
      if (m.dead) m.dispose();
      return !m.dead;
    });
    this.updateProjectiles(dt);

    // Camera: follow the archer with a little look-ahead, plus shake.
    if (this.state !== 'title') this.camX = damp(this.camX, this.player.x + this.player.facing * 1.6, 3, dt);
    this.shake = Math.max(0, this.shake - dt * 1.5);
    const sx = (Math.random() - 0.5) * this.shake, sy = (Math.random() - 0.5) * this.shake;
    this.camera.position.set(this.camX + sx, 2.9 + sy, CAM_Z);
    this.camera.lookAt(this.camX + sx * 0.5, 2.35, 0);

    this.tod = damp(this.tod, this.todTarget, 0.5, dt);
    this.world.update(dt, this.camera, this.tod, this.storm, this.rain, this.state === 'title' ? this.camX : this.player.x);
    this.fx.update(dt);
    this.audio.setMood(this.world.night);
    this.audio.setRain(this.rain);
  }
}

window.game = new Game();
