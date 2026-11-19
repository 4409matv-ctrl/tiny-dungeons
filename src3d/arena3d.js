/* 3D-слой боя: фигурки на подставках, анимации, физика падения.
   Собирается esbuild'ом в assets/arena3d.js (window.Arena3D). */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as skinnedClone } from 'three/examples/jsm/utils/SkeletonUtils.js';

const W = 1280, H = 720;
const GRAVITY = 2400;

const MODELS = {
  warrior: 'assets/models/barbarian.glb',
  paladin: 'assets/models/knight.glb',
  sorcerer: 'assets/models/mage.glb',
  wizard: 'assets/models/mage.glb',
  bard: 'assets/models/rogue_hooded.glb',
  rogue: 'assets/models/rogue.glb',
  goblin: 'assets/models/goblin.gltf',
  skeleton: 'assets/models/skeleton_warrior.glb'
};

const HERO_H = 140;
const ENEMY_H = { goblin: 116, skeleton: 140 };
const RANGED = { sorcerer: 1, wizard: 1, bard: 1 };

let renderer = null, scene = null, camera = null, loader = null;
let ready = false, failed = false;
const cache = new Map();     // url -> { scene, animations }
const figs = new Map();      // игровой объект -> визуал
const allFigs = [];
let shadowTex = null;

const worldX = x => x - W / 2;
const worldY = y => H / 2 - y;
const depthZ = y => 20 + (y - 452) * 0.45;

function shadowTexture() {
  if (shadowTex) return shadowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(64, 64, 6, 64, 64, 62);
  rad.addColorStop(0, 'rgba(0,0,0,.55)');
  rad.addColorStop(.6, 'rgba(0,0,0,.22)');
  rad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = rad;
  g.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(c);
  return shadowTex;
}

function findClip(anims, names) {
  for (const n of names) {
    const hit = anims.find(a => a.name === n);
    if (hit) return hit;
  }
  for (const n of names) {
    const low = n.toLowerCase();
    const hit = anims.find(a => a.name.toLowerCase().includes(low));
    if (hit) return hit;
  }
  return null;
}

async function loadModel(key, url) {
  if (cache.has(url)) return cache.get(url);
  const gltf = await loader.loadAsync(url);
  const entry = { scene: gltf.scene, anims: gltf.animations || [] };
  gltf.scene.traverse(o => {
    if (o.isMesh || o.isSkinnedMesh) {
      o.castShadow = false;
      o.frustumCulled = false;
      if (o.material) {
        o.material.roughness = Math.min(1, (o.material.roughness ?? 1) * 0.95 + 0.05);
        o.material.metalness = Math.max(0, (o.material.metalness ?? 0) * 0.6);
      }
    }
  });
  cache.set(url, entry);
  return entry;
}

function makeBlob() {
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(120, 54),
    new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: .9 })
  );
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

function makeBase(color, rim, sc) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(
    new THREE.CylinderGeometry(46, 48, 10, 40),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(rim || '#3a2b1b'), roughness: .8, metalness: .05 })
  );
  outer.position.y = 0;
  const top = new THREE.Mesh(
    new THREE.CylinderGeometry(43, 45, 6, 40),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color || '#888'), roughness: .55, metalness: .12 })
  );
  top.position.y = 7;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(41, 1.8, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: new THREE.Color(color || '#fff'), emissiveIntensity: .4, roughness: .5 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 10;
  const halo = new THREE.Mesh(
    new THREE.TorusGeometry(54, 4, 8, 48),
    new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0 })
  );
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = -2;
  g.add(outer, top, ring, halo);
  g.scale.setScalar(sc || 1);
  return { group: g, halo, ring };
}

function clipNames(kind) {
  if (kind === 'goblin') return { idle: ['Idle'], attack: ['Weapon', 'Punch'], hit: ['HitReact'], death: ['Death'] };
  if (kind === 'skeleton') return { idle: ['Idle'], attack: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop'], hit: ['Hit_A'], death: ['Death_A'] };
  return { idle: ['Idle'], attack: ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Chop'], hit: ['Hit_A'], death: ['Death_A'] };
}

function buildFigure({ obj, kind, key, color, rim, height, slot, enemy, yaw }) {
  const entry = cache.get(MODELS[key]);
  if (!entry) return null;

  const root = new THREE.Group();
  scene.add(root);
  const shadow = makeBlob();
  shadow.scale.setScalar(height / HERO_H * .92 + .16);
  root.add(shadow);

  const base = makeBase(color, rim, height / HERO_H * .92 + .16);
  root.add(base.group);

  const pivot = new THREE.Group();
  pivot.position.y = 10;
  root.add(pivot);

  const model = skinnedClone(entry.scene);
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const h = Math.max(0.001, box.max.y - box.min.y);
  const scl = height / h;
  model.scale.setScalar(scl);
  model.position.y = -box.min.y * scl;
  model.position.x = -(box.min.x + box.max.x) / 2 * scl;
  model.rotation.y = yaw ?? (enemy ? -Math.PI / 2 : Math.PI / 2);
  pivot.add(model);

  const mixer = new THREE.AnimationMixer(model);
  const names = clipNames(kind);
  const mk = list => {
    const clip = findClip(entry.anims, list);
    return clip ? mixer.clipAction(clip) : null;
  };
  const idle = mk(names.idle);
  const attack = mk(names.attack);
  const hit = mk(names.hit);
  const death = mk(names.death);
  if (idle) { idle.play(); idle.weight = 1; }
  if (attack) { attack.setLoop(THREE.LoopOnce, 1); attack.clampWhenFinished = false; }
  if (hit) { hit.setLoop(THREE.LoopOnce, 1); hit.clampWhenFinished = true; }
  if (death) { death.setLoop(THREE.LoopOnce, 1); death.clampWhenFinished = true; }

  const fig = {
    obj, enemy, kind, root, pivot, mixer, idle, attack, hit, death,
    slot, height, base,
    wob: { a: 0, v: 0 },
    phys: null,
    dead: false,
    attackT: 0,
    dash: 0,
    z: depthZ(obj.y),
    active: false
  };
  figs.set(obj, fig);
  allFigs.push(fig);
  fig.model = model;
  layout(fig, obj);

  const back = idle && attack ? attack : null;
  mixer.addEventListener('finished', e => {
    if (back && e.action === attack) fadeTo(fig, idle, .18);
  });
  return fig;
}

function layout(fig, obj) {
  fig.root.position.set(worldX(obj.x), worldY(obj.y), fig.z);
}

function fadeTo(fig, action, dur = .15) {
  if (!action) return;
  action.reset().setEffectiveWeight(1).fadeIn(dur).play();
  if (fig.idle && action !== fig.idle) fig.idle.fadeOut(dur);
}

function playAttack(fig) {
  if (!fig || fig.dead) return;
  fig.attackT = .55;
  if (fig.attack) {
    fig.attack.reset();
    fig.attack.setEffectiveWeight(1);
    fig.attack.play();
    if (fig.idle) fig.idle.crossFadeTo(fig.attack, .1, false);
  }
}

export async function init(canvas) {
  if (ready || failed) return ready;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(W, H, false);
    renderer.setClearAlpha(0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    camera = new THREE.OrthographicCamera(-W / 2, W / 2, H / 2, -H / 2, 0.1, 5000);
    camera.position.set(0, 300, 1400);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.HemisphereLight(0xfff3d8, 0x6b4a2a, 1.15));
    const key = new THREE.DirectionalLight(0xffffff, 2.0);
    key.position.set(-380, 900, 1100);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffc98a, .85);
    fill.position.set(700, 220, 500);
    scene.add(fill);
    const rim = new THREE.DirectionalLight(0x9fd8ff, .45);
    rim.position.set(200, 300, -600);
    scene.add(rim);

    loader = new GLTFLoader();
    await Promise.all(Object.entries(MODELS).map(([k, u]) => loadModel(k, u)));
    ready = true;
    return true;
  } catch (err) {
    failed = true;
    ready = false;
    console.warn('[arena3d] не удалось загрузить 3D:', err && err.message);
    return false;
  }
}

export function isReady() { return ready; }

export function clear() {
  for (const f of allFigs) scene.remove(f.root);
  allFigs.length = 0;
  figs.clear();
}

export function setup(S) {
  if (!ready) return;
  clear();
  const sc = [1, .88, .8];
  S.team.forEach((f, i) => buildFigure({
    obj: f, kind: f.cls.id, key: f.cls.id, color: f.cls.color, rim: f.cls.rim,
    height: HERO_H * (sc[i] || 1), slot: i, enemy: false
  }));
  S.enemies.forEach((e, i) => buildFigure({
    obj: e, kind: e.kind, key: e.kind, color: e.kind === 'goblin' ? '#7fbf4d' : '#cfc6ae',
    rim: e.kind === 'goblin' ? '#4f8a2c' : '#8f876f',
    height: (ENEMY_H[e.kind] || 140) * (sc[i] || 1), slot: i, enemy: true
  }));
}

export function attack(obj) {
  const f = figs.get(obj);
  if (f) { playAttack(f); f.dash = 1; }
}

export function hit(obj, dir, crit) {
  const f = figs.get(obj);
  if (!f || f.dead) return;
  const d = Math.sign(dir || 1) * (f.enemy ? -1 : 1);
  f.wob.v += (crit ? 4.6 : 2.6) * d;
  f.dash = Math.max(f.dash, .7);
  if (f.hit && !f.attackT) {
    f.hit.reset().setEffectiveWeight(1).play();
    if (f.idle) f.idle.fadeOut(.08);
    setTimeout(() => { if (!f.dead && f.idle) fadeTo(f, f.idle, .18); }, 260);
  }
}

export function die(obj, dir) {
  const f = figs.get(obj);
  if (!f || f.dead) return;
  f.dead = true;
  const d = Math.sign(dir || 1);
  f.phys = {
    x: 0, y: 0,
    vx: d * (f.enemy ? 240 : -260) * (Math.random() * .4 + .8),
    vy: 180 + Math.random() * 70,
    rot: 0,
    spin: d * (f.enemy ? -6.2 : 6.2)
  };
  f.mixer.stopAllAction();
  if (f.death) {
    f.death.reset().setEffectiveWeight(.35).play();
  }
}

function step(fig, dt) {
  const f = fig;
  if (f.attackT > 0) f.attackT = Math.max(0, f.attackT - dt);
  // покачивание от удара
  f.wob.v += (-f.wob.a * 150 - f.wob.v * 9) * dt;
  f.wob.a += f.wob.v * dt;
  const lean = clamp(f.wob.a * .055, -.5, .5);

  if (f.dash > 0) f.dash = Math.max(0, f.dash - dt * 3.4);
  const lunge = f.dash > 0 ? Math.sin(clamp(1 - f.dash, 0, 1) * Math.PI) * (f.enemy ? -26 : 26) : 0;

  if (!f.dead) {
    const o = f.obj;
    const bob = Math.sin((performance.now() / 1000) * 2.4 + f.slot * 1.7) * 1.6;
    const targetY = worldY(o.y + (o.hitT > 0 ? -6 : 0));
    f.root.position.x += (worldX(o.x) + lunge - f.root.position.x) * Math.min(1, dt * 14);
    f.root.position.y += (targetY + bob - f.root.position.y) * Math.min(1, dt * 12);
    f.pivot.rotation.z = -lean;
    f.pivot.rotation.x = Math.sin(lean * 2) * .12;
    if (f.mixer) f.mixer.update(dt);
    const t = performance.now();
    if (o.cast) {
      f.base.halo.material.opacity = .4 + Math.sin(t / 90) * .18;
      f.base.halo.scale.setScalar(1 + Math.sin(t / 140) * .05);
    } else if (f.active) {
      f.base.halo.material.opacity = .45 + Math.sin(t / 320) * .16;
      f.base.halo.scale.setScalar(1 + Math.sin(t / 420) * .03);
    } else {
      f.base.halo.material.opacity = 0;
      f.base.halo.scale.setScalar(1);
    }
    return;
  }

  // физика падения
  const p = f.phys;
  p.vy -= GRAVITY * dt;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rot += p.spin * dt;
  p.spin *= (1 - 2.1 * dt);
  if (p.y <= 0) {
    p.y = 0;
    if (p.vy < -60) p.vy *= -0.3; else p.vy = 0;
    p.vx *= (1 - 3.2 * dt);
    p.spin *= (1 - 4.5 * dt);
    if (Math.abs(p.rot) < Math.PI / 2) {
      // фигурка падает на бок, а не сквозь стол
      p.rot += (Math.sign(p.rot || 1) * Math.PI / 2 - p.rot) * Math.min(1, dt * 3.2);
    }
  }
  p.rot = clamp(p.rot, -Math.PI / 2 * 1.15, Math.PI / 2 * 1.15);
  f.root.position.x = worldX(f.obj.x) + p.x;
  f.root.position.y = worldY(f.obj.y) + Math.min(0, p.y);
  f.root.rotation.z = p.rot * .55;
  f.pivot.rotation.z = -Math.min(.9, Math.abs(p.rot) * .35) * Math.sign(p.rot || 1);
  if (f.mixer) f.mixer.update(dt * .6);
}

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

export function update(dt, S) {
  if (!ready) return;
  for (const f of allFigs) {
    if (!f.obj) continue;
    if (!f.dead && (f.obj.alive === false || f.obj.hp <= 0)) {
      const dir = f.enemy ? -1 : 1;
      die(f.obj, dir);
    }
    f.active = !f.enemy && S.team[S.activeIdx] === f.obj;
    step(f, dt);
  }
}

export function render() {
  if (!ready) return;
  renderer.render(scene, camera);
}

export function setYaw(v, who) {
  for (const f of allFigs) {
    if (who === 'hero' && f.enemy) continue;
    if (who === 'enemy' && !f.enemy) continue;
    f.model.rotation.y = v;
  }
}

export function debug() {
  return {
    ready, failed,
    figs: allFigs.length,
    children: scene ? scene.children.length : -1,
    cam: camera ? camera.position.toArray() : null,
    first: allFigs[0] ? {
      pos: allFigs[0].root.position.toArray(),
      scale: allFigs[0].root.scale.toArray(),
      children: allFigs[0].root.children.length,
      modelVisible: !!allFigs[0].pivot.children[0]?.visible
    } : null
  };
}
