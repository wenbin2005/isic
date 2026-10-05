// 戰鬥畫面：獨立的小舞台場景＋戰鬥介面（行動順序、指令、蓄力、選目標、勝敗）。
// 規則與數值在 battle-core.js、data.js；這裡只負責演出與操作。
import * as THREE from 'three';
import { createBattle, autoCommand, gainExp, memberStats, MAX_BP, MAX_BOOST } from './battle-core.js';
import { SKILLS, ITEMS, TYPES, ENCOUNTERS, MEMBERS } from './data.js';
import { makeTileTextures, makeSpriteTextures, makeCharacterTexture, setFrame, PALETTES, rng } from './pixel.js';
import { monsterMaterial } from './monsters.js';

const TILT = -0.12;
const STAGES = {
  town: { bg: '#2a2742', fog: ['#2f2c48', 16, 34], ground: 'grassTop', tint: '#d8d4cc', hemi: ['#8a82c4', '#3a2c2a', 1.1], sun: ['#ffb27a', 1.7], lamp: ['#ffb366', 10], rim: ['#7a8cff', 5], decor: 'trees' },
  shore: { bg: '#2a2742', fog: ['#2f2c48', 16, 34], ground: 'sandTop', tint: '#e0d8cc', hemi: ['#8a8ccc', '#3a2c2a', 1.1], sun: ['#ffb27a', 1.7], lamp: ['#ffb366', 9], rim: ['#6ab0ff', 6], decor: 'sea' },
  forest: { bg: '#18222a', fog: ['#1d2a30', 13, 30], ground: 'grassTop', tint: '#8e9e8a', hemi: ['#6f8fa0', '#232a22', 1.0], sun: ['#c8d8c0', 1.15], lamp: ['#ff9a50', 9], rim: ['#7affc8', 4], decor: 'pines' },
  ruins: { bg: '#1c1a30', fog: ['#221f3a', 15, 32], ground: 'plazaTop', tint: '#aaa8c4', hemi: ['#7a78b8', '#2a2430', 1.0], sun: ['#b8c0ff', 1.2], lamp: ['#7ab8ff', 10], rim: ['#c08aff', 5], decor: 'pillars' },
  boss: { bg: '#110d20', fog: ['#161130', 14, 32], ground: 'plazaTop', tint: '#9088b8', hemi: ['#6a5ab0', '#1a1420', 0.95], sun: ['#d0b8ff', 1.05], lamp: ['#b48aff', 11], rim: ['#ffd27a', 6], decor: 'pillars', stars: true }
};
const PARTY_POS = [[2.4, -0.8], [3.15, 0.35], [3.9, 1.5]];
const ENEMY_POS = { 1: [[-2.7, 0]], 2: [[-2.0, -1.1], [-3.7, 0.9]], 3: [[-1.9, -1.4], [-3.8, -0.2], [-2.2, 1.3]] };
const TYPE_FX = { sword: '#ffffff', dagger: '#e8f0ff', staff: '#ffe9b0', fire: '#ff7a2a', wind: '#6affb0', light: '#ffe27a' };
const SHORT = { hero: '旅', mira: '米', sein: '賽' };

export function createBattleView({ renderer, post, root, reduceMotion }) {
  const tex = makeTileTextures(), spr = makeSpriteTextures();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 140);
  const look = new THREE.Vector3(0, 1.1, 0);
  const R = rng(99);

  // ---------- 舞台 ----------
  const hemi = new THREE.HemisphereLight();
  const sun = new THREE.DirectionalLight();
  sun.position.set(-5, 9, 7); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 7, bottom: -7, near: 1, far: 30 });
  sun.shadow.bias = -0.0008; sun.shadow.normalBias = 0.03;
  const lamp = new THREE.PointLight('#fff', 1, 14, 1.6); lamp.position.set(0.6, 2.8, 2.4);
  const rim = new THREE.PointLight('#fff', 1, 14, 1.6); rim.position.set(-4, 2.4, -2.5);
  scene.add(hemi, sun, sun.target, lamp, rim);

  const groundMaps = {};
  for (const k of ['grassTop', 'sandTop', 'plazaTop']) { const t = tex[k].clone(); t.repeat.set(44, 26); t.needsUpdate = true; groundMaps[k] = t; }
  const groundMat = new THREE.MeshLambertMaterial();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(44, 26), groundMat);
  ground.rotation.x = -Math.PI / 2; ground.position.set(0, 0, -3); ground.receiveShadow = true; scene.add(ground);

  const spriteGeo = (w, h) => { const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0); g.rotateX(TILT); return g; };
  const sprMats = {};
  for (const k of ['tree', 'tree2', 'pine', 'bush']) {
    sprMats[k] = new THREE.MeshLambertMaterial({ map: spr[k], alphaTest: 0.5, side: THREE.DoubleSide });
    sprMats[k].userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: spr[k], alphaTest: 0.5 });
  }
  const SIZE = { tree: [2, 3], tree2: [2, 3], pine: [2, 3], bush: [1, 1] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  function instanced(kind, list) {
    const im = new THREE.InstancedMesh(spriteGeo(...SIZE[kind]), sprMats[kind], list.length);
    list.forEach(([x, z, s], i) => im.setMatrixAt(i, m4.compose(pv.set(x, 0, z), q, sv.set(s, s, s))));
    im.castShadow = true; im.receiveShadow = true; im.customDepthMaterial = sprMats[kind].userData.depth;
    return im;
  }
  const decor = {};
  {
    const g = new THREE.Group(), a = [], b = [], bushes = [];
    for (let i = 0; i < 16; i++) (i % 2 ? a : b).push([-12 + i * 1.6 + R() * 0.6, -5 - R() * 2.8, 1 + R() * 0.3]);
    for (let i = 0; i < 6; i++) bushes.push([(i < 3 ? -7.5 : 6.5) + R() * 2, -2.8 - R() * 1.5, 1]);
    g.add(instanced('tree', a), instanced('tree2', b), instanced('bush', bushes));
    decor.trees = g;
  }
  {
    const g = new THREE.Group();
    const wt = tex.water.clone(); wt.repeat.set(40, 12); wt.needsUpdate = true;
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(80, 24), new THREE.MeshStandardMaterial({ map: wt, roughness: 0.3, metalness: 0.05, color: '#b8d4e8' }));
    sea.rotation.x = -Math.PI / 2; sea.position.set(0, 0.02, -16.5); sea.receiveShadow = true;
    const pines = [];
    for (let i = 0; i < 5; i++) pines.push([-11 + R() * 3, -3.5 - R() * 1.5, 1], [9 + R() * 3, -3.5 - R() * 1.5, 1]);
    const rockMat = new THREE.MeshLambertMaterial({ map: tex.rockTop, flatShading: true });
    for (const [x, z, s] of [[-5.5, -4, 0.6], [5, -4.4, 0.5], [-1, -4.8, 0.35]]) {
      const r = new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat); r.position.set(x, s * 0.5, z); r.rotation.set(R(), R() * 3, R()); r.castShadow = true; g.add(r);
    }
    g.add(sea, instanced('pine', pines));
    g.userData.water = wt;
    decor.sea = g;
  }
  {
    const g = new THREE.Group(), pines = [];
    for (let i = 0; i < 26; i++) pines.push([-13 + i * 1.05 + R() * 0.5, -4.2 - R() * 3.8, 1 + R() * 0.35]);
    for (let i = 0; i < 8; i++) pines.push([(i < 4 ? -9 : 8) + R() * 3, -1 - R() * 3, 1 + R() * 0.2]);
    g.add(instanced('pine', pines));
    decor.pines = g;
  }
  {
    const g = new THREE.Group();
    const stone = new THREE.MeshLambertMaterial({ map: tex.stone });
    for (let i = 0; i < 7; i++) {
      const h = [3.2, 1.4, 3.6, 2.2, 3.4, 0.9, 3.0][i], x = -9 + i * 3;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.8, h, 0.8), stone); p.position.set(x, h / 2, -4.6 - (i % 2) * 0.8); p.castShadow = p.receiveShadow = true; g.add(p);
    }
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(0.9, 1.8, 3.2) });
    for (const x of [-5.5, 5.5]) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.36, 0.9, 8), stone); base.position.set(x, 0.45, -2.8); base.castShadow = true;
      const fire = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, 0.34), glow); fire.position.set(x, 1.05, -2.8);
      g.add(base, fire);
    }
    const pines = [];
    for (let i = 0; i < 14; i++) pines.push([-14 + i * 2.1 + R(), -9 - R() * 3, 1.2]);
    g.add(instanced('pine', pines));
    decor.pillars = g;
  }
  {
    const n = 220, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([-34 + R() * 68, 3 + R() * 18, -26 - R() * 6], i * 3);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    decor.stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: new THREE.Color().setRGB(1.6, 1.5, 2.2), size: 0.16, sizeAttenuation: true, fog: false }));
  }
  for (const k in decor) { decor[k].visible = false; scene.add(decor[k]); }

  // 特效：光點與斬擊貼圖
  const glowTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.4)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  })();
  const slashTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d');
    g.strokeStyle = 'rgba(255,255,255,1)'; g.lineCap = 'round';
    for (const [w, a] of [[7, 0.35], [3, 1]]) { g.lineWidth = w; g.globalAlpha = a; g.beginPath(); g.arc(14, 50, 44, -Math.PI * 0.48, -Math.PI * 0.02); g.stroke(); }
    return new THREE.CanvasTexture(c);
  })();
  const fxPool = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, fog: false }));
    m.visible = false; m.renderOrder = 10; scene.add(m); return { m, life: 0, dur: 1, grow: 1, spin: 0 };
  });
  function fx(x, y, z, color, { size = 1.4, dur = 0.35, slash = false, grow = 1.8, spin = 0, intensity = 2.2 } = {}) {
    const f = fxPool.find(p => p.life <= 0) || fxPool[0];
    f.m.material.map = slash ? slashTex : glowTex;
    f.m.material.color.set(color).multiplyScalar(intensity);
    f.m.position.set(x, y, z + 0.4); f.m.scale.setScalar(size); f.m.rotation.set(0, 0, slash ? R() * 6 : 0);
    Object.assign(f, { life: dur, dur, grow, spin, size }); f.m.visible = true;
  }
  const sparks = (() => {
    const n = 60, pos = new Float32Array(n * 3), vel = [];
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({ map: glowTex, size: 0.32, color: new THREE.Color().setRGB(3, 2.5, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
    const pts = new THREE.Points(geo, mat); pts.visible = false; pts.frustumCulled = false; scene.add(pts);
    let life = 0;
    return {
      fire(x, y, z, color = '#ffd27a') {
        mat.color.set(color).multiplyScalar(3);
        for (let i = 0; i < n; i++) {
          pos.set([x, y, z], i * 3);
          const a = R() * Math.PI * 2, u = R() * 2 - 1, s = 2 + R() * 3;
          vel[i] = [Math.cos(a) * Math.sqrt(1 - u * u) * s, Math.abs(u) * s + 1, Math.sin(a) * Math.sqrt(1 - u * u) * s * 0.5];
        }
        life = 0.9; pts.visible = true;
      },
      update(dt) {
        if (life <= 0) return;
        life -= dt; mat.opacity = Math.max(0, life / 0.9);
        for (let i = 0; i < n; i++) { vel[i][1] -= dt * 5; for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i][k] * dt; }
        geo.attributes.position.needsUpdate = true;
        if (life <= 0) pts.visible = false;
      }
    };
  })();

  // ---------- 介面 ----------
  root.innerHTML = `
    <div class="b-order" aria-label="行動順序"><span class="lbl">本回合</span><div class="chips now"></div><span class="lbl next-lbl">下回合</span><div class="chips next"></div></div>
    <p class="b-caption" aria-live="polite"></p>
    <div class="b-tags"></div>
    <div class="b-pops" aria-hidden="true"></div>
    <div class="b-dock">
      <div class="b-menu" hidden>
        <div class="b-menu-head"><strong class="b-actor"></strong>
          <div class="b-boost"><button class="b-bminus" type="button" aria-label="減少蓄力">−</button><span class="b-bval">蓄力 0</span><button class="b-bplus" type="button" aria-label="增加蓄力">+</button></div>
        </div>
        <div class="b-list" role="menu"></div>
        <p class="b-desc"></p>
        <p class="b-hint"><kbd>↑↓</kbd> 選擇　<kbd>←→</kbd> 蓄力　<kbd>空白鍵</kbd> 決定　<kbd>Esc</kbd> 返回</p>
      </div>
      <div class="b-party"></div>
    </div>
    <div class="b-result" hidden><div class="b-result-inner"><p class="eyebrow"><span></span><em></em><span></span></p><h2></h2><div class="b-result-body"></div><div class="actions"></div></div></div>
    <div class="b-flash"></div>`;
  const q$ = s => root.querySelector(s);
  const el = {
    now: q$('.chips.now'), next: q$('.chips.next'), caption: q$('.b-caption'), tags: q$('.b-tags'), pops: q$('.b-pops'),
    menu: q$('.b-menu'), actor: q$('.b-actor'), bval: q$('.b-bval'), list: q$('.b-list'), desc: q$('.b-desc'), party: q$('.b-party'),
    result: q$('.b-result'), rEyebrow: q$('.b-result .eyebrow em'), rTitle: q$('.b-result h2'), rBody: q$('.b-result-body'), rActions: q$('.b-result .actions'), flash: q$('.b-flash')
  };
  root.addEventListener('mousedown', e => { if (e.target.closest('button')) e.preventDefault(); }); // 點擊不搶焦點，避免之後按空白鍵重複觸發

  // ---------- 狀態 ----------
  const view = { active: false, auto: false, timeScale: 1, battle: null };
  let b = null, enc = null, recs = null, items = null, vis = new Map(), stage = null;
  let time = 0, shake = 0, tagMinY = null, layoutK = 1;
  const waits = [], tweens = [];
  const sleep = s => new Promise(res => waits.push({ t: s, res }));
  const tween = (d, fn) => new Promise(res => tweens.push({ t: 0, d, fn, res }));

  const ui = { mode: 'none', items: [], index: 0, onBack: null, boost: 0, actor: null, targets: [], tIndex: 0, tResolve: null, resultButtons: [] };

  // ---------- 單位 ----------
  const charTex = {};
  function buildUnits() {
    for (const v of vis.values()) { scene.remove(v.mesh, v.blob); v.mesh.geometry.dispose(); if (v.own) v.mat.dispose(); }
    vis = new Map();
    el.tags.innerHTML = '';
    const blobGeo = new THREE.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2);
    const blobMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.35, depthWrite: false });
    b.party.forEach((u, i) => {
      const t = (charTex[u.id] ??= makeCharacterTexture(PALETTES[MEMBERS[u.id].palette]));
      setFrame(t, 3, 0);
      const mat = new THREE.MeshLambertMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide });
      const s = 1.25, mesh = new THREE.Mesh(spriteGeo(s, 1.5 * s), mat);
      mesh.castShadow = true; mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: t, alphaTest: 0.5 });
      const x = PARTY_POS[i][0] * layoutK, z = PARTY_POS[i][1];
      mesh.position.set(x, 0, z);
      const blob = new THREE.Mesh(blobGeo, blobMat); blob.position.set(x, 0.02, z + 0.05);
      scene.add(mesh, blob);
      vis.set(u, { mesh, mat, blob, home: new THREE.Vector3(x, 0, z), h: 1.5 * s, tex: t, own: true });
    });
    const enemies = b.enemies, slots = ENEMY_POS[enemies.length] || ENEMY_POS[3];
    enemies.forEach((u, i) => {
      const m = monsterMaterial(u.art), s = u.boss ? 1.05 : 1.25;
      const mesh = new THREE.Mesh(spriteGeo(m.w * s, m.h * s), m.mat);
      mesh.castShadow = true; mesh.customDepthMaterial = m.depth;
      const [sx, z] = u.boss ? [-3.1, -0.3] : slots[i], x = sx * layoutK;
      mesh.position.set(x, 0, z);
      const blob = new THREE.Mesh(blobGeo, blobMat); blob.position.set(x, 0.02, z + 0.05); blob.scale.setScalar(Math.max(1, m.w * s * 0.45));
      scene.add(mesh, blob);
      const tag = document.createElement('button');
      tag.type = 'button'; tag.className = 'b-tag';
      tag.innerHTML = `<span class="b-tag-top"><span class="b-shield" title="護盾"><i></i></span><span class="b-name"></span></span><span class="b-weak"></span><span class="b-hp"><i></i></span>`;
      tag.addEventListener('click', () => clickTarget(u));
      el.tags.append(tag);
      vis.set(u, { mesh, mat: m.mat, blob, home: new THREE.Vector3(x, 0, z), h: m.h * s, w: m.w * s, tag, own: true, seed: R() * 6 });
    });
  }

  // ---------- 介面更新 ----------
  const pct = (a, b2) => `${Math.max(0, Math.min(100, a / b2 * 100))}%`;
  function renderParty(active, preview = 0) {
    el.party.innerHTML = '';
    b.party.forEach(u => {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'b-mem' + (u === active ? ' active' : '') + (u.hp <= 0 ? ' ko' : '') + (ui.mode === 'target' && ui.targets.includes(u) ? ' targetable' : '') + (ui.mode === 'target' && (ui.targets[ui.tIndex] === u || ui.allTargets) && ui.targets.includes(u) ? ' targeted' : '');
      const used = u === active ? preview : 0;
      row.innerHTML = `<span class="nm">${u.name}<small>Lv ${u.rec.lv}</small></span>
        <span class="hpline"><span class="bar"><i style="width:${pct(u.hp, u.maxHp)}"></i></span><span class="num">HP <b>${u.hp}</b>/${u.maxHp}</span></span>
        <span class="spline"><span class="num">SP <b>${u.sp}</b>/${u.maxSp}</span><span class="bp" aria-label="BP ${u.bp}">${Array.from({ length: MAX_BP }, (_, k) => `<i class="${k < u.bp - used ? 'on' : k < u.bp ? 'use' : ''}"></i>`).join('')}</span></span>
        ${u.defending ? '<span class="guard">防禦中</span>' : ''}`;
      row.addEventListener('click', () => clickTarget(u));
      el.party.append(row);
    });
  }
  function renderTags() {
    for (const u of b.enemies) {
      const v = vis.get(u), t = v.tag;
      t.hidden = u.hp <= 0;
      t.classList.toggle('broken', u.broken);
      t.classList.toggle('targetable', ui.mode === 'target' && ui.targets.includes(u));
      t.classList.toggle('targeted', ui.mode === 'target' && ui.targets.includes(u) && (ui.allTargets || ui.targets[ui.tIndex] === u));
      t.querySelector('.b-shield i').textContent = u.broken ? '破' : u.shield;
      t.querySelector('.b-name').textContent = u.name;
      t.querySelector('.b-weak').innerHTML = u.weak.map((w, k) => {
        const known = u.known.includes(w);
        return `<span class="w ${known ? 'known t-' + w : ''}" title="${known ? TYPES[w] + '屬性弱點' : '尚未知道的弱點'}">${known ? TYPES[w] : '?'}</span>`;
      }).join('');
      t.querySelector('.b-hp i').style.width = pct(u.hp, u.maxHp);
      t.setAttribute('aria-label', `${u.name}，護盾 ${u.broken ? '已破防' : u.shield}，弱點 ${u.weak.map(w => u.known.includes(w) ? TYPES[w] : '未知').join('、')}`);
    }
  }
  function renderOrder(current) {
    const p = b.preview();
    const chip = (u, cur) => `<span class="chip ${u.side}${cur ? ' cur' : ''}${u.broken ? ' broken' : ''}" title="${u.name}">${u.side === 'party' ? SHORT[u.id] : u.name.replace(/\s.*/, '').slice(0, 1) + (u.name.match(/\s(\w)$/)?.[1] || '')}</span>`;
    el.now.innerHTML = (current ? chip(current, true) : '') + p.now.map(u => chip(u)).join('');
    el.next.innerHTML = p.next.map(u => chip(u)).join('');
  }
  function refresh(active = ui.actor) {
    renderParty(active, active && ui.mode !== 'none' ? ui.boost : 0);
    renderTags();
  }
  let captionTimer = 0;
  function caption(text, hold = 1.6) { el.caption.textContent = text; el.caption.classList.add('show'); captionTimer = hold; }

  const tmpV = new THREE.Vector3();
  function screenOf(u, dy = 0) {
    const v = vis.get(u);
    tmpV.set(v.mesh.position.x, v.mesh.position.y + v.h * (u.side === 'enemy' ? 0.62 : 0.6) + dy, v.mesh.position.z).project(camera);
    return [(tmpV.x * 0.5 + 0.5) * innerWidth, (-tmpV.y * 0.5 + 0.5) * innerHeight];
  }
  function pop(u, text, cls = '', dy = 0) {
    const [x, y0] = screenOf(u), y = y0 + dy;
    const s = document.createElement('span');
    s.className = 'b-pop ' + cls; s.textContent = text;
    s.style.left = `${x + (Math.random() - 0.5) * 30}px`; s.style.top = `${y}px`;
    el.pops.append(s);
    setTimeout(() => s.remove(), 1400);
  }
  function flashScreen(color = 'rgba(255,240,200,0.55)') {
    if (reduceMotion) return;
    el.flash.style.background = color;
    el.flash.classList.remove('go'); void el.flash.offsetWidth; el.flash.classList.add('go');
  }

  // ---------- 指令選單 ----------
  function showList(items, onBack = null, keepIndex = false) {
    ui.mode = 'menu'; ui.items = items; ui.onBack = onBack; if (!keepIndex) ui.index = Math.max(0, items.findIndex(i => !i.disabled));
    el.menu.hidden = false;
    el.list.innerHTML = '';
    items.forEach((it, i) => {
      const btn = document.createElement('button');
      btn.type = 'button'; btn.className = 'b-item'; btn.setAttribute('role', 'menuitem');
      btn.disabled = false; btn.setAttribute('aria-disabled', it.disabled ? 'true' : 'false');
      btn.innerHTML = `<span class="l">${it.tag ? `<em class="tag t-${it.tagType || ''}">${it.tag}</em>` : ''}${it.label}</span>${it.sub ? `<span class="s">${it.sub}</span>` : ''}`;
      btn.addEventListener('click', () => { ui.index = i; pickCurrent(); });
      btn.addEventListener('mouseenter', () => { ui.index = i; highlight(); });
      el.list.append(btn);
    });
    highlight();
  }
  function highlight() {
    [...el.list.children].forEach((c, i) => { c.classList.toggle('sel', i === ui.index); c.classList.toggle('off', !!ui.items[i]?.disabled); });
    const it = ui.items[ui.index];
    el.desc.textContent = it ? (it.disabled && it.why ? it.why : it.desc || '') : '';
    const boostable = it?.boostable;
    root.querySelector('.b-boost').classList.toggle('dim', !boostable);
    el.bval.textContent = `蓄力 ${ui.boost}`;
    refresh();
  }
  function pickCurrent() {
    const it = ui.items[ui.index];
    if (!it) return;
    if (it.disabled) { el.desc.textContent = it.why || it.desc || ''; el.desc.classList.remove('shake'); void el.desc.offsetWidth; el.desc.classList.add('shake'); return; }
    it.pick();
  }
  function setBoost(d) {
    const u = ui.actor; if (!u) return;
    ui.boost = Math.max(0, Math.min(ui.boost + d, MAX_BOOST, u.bp));
    el.bval.textContent = `蓄力 ${ui.boost}`;
    refresh();
  }
  q$('.b-bminus').addEventListener('click', () => setBoost(-1));
  q$('.b-bplus').addEventListener('click', () => setBoost(1));

  function pickTarget(kind, back) {
    return new Promise(resolve => {
      const party = b.party, foes = b.enemies.filter(u => u.hp > 0);
      ui.targets = kind === 'enemy' || kind === 'enemies' ? foes : kind === 'fallen' ? party.filter(u => u.hp <= 0) : party.filter(u => u.hp > 0);
      ui.allTargets = kind === 'enemies' || kind === 'allies';
      ui.tIndex = 0; ui.mode = 'target'; ui.tResolve = resolve; ui.tBack = back;
      el.list.querySelectorAll('.b-item').forEach(c => c.classList.add('dim'));
      el.desc.textContent = ui.allTargets ? '對全體使用。按空白鍵確定。' : '選擇目標：方向鍵切換，空白鍵確定，或直接點選。';
      refresh();
    });
  }
  function clickTarget(u) {
    if (ui.mode !== 'target' || !ui.targets.includes(u)) return;
    if (!ui.allTargets) ui.tIndex = ui.targets.indexOf(u);
    confirmTarget();
  }
  function confirmTarget() {
    const r = ui.tResolve; ui.tResolve = null;
    const t = ui.allTargets ? null : ui.targets[ui.tIndex];
    ui.mode = 'busy'; ui.targets = [];
    r({ ok: true, target: t });
  }
  function cancelTarget() {
    const r = ui.tResolve; ui.tResolve = null; ui.targets = []; ui.mode = 'menu';
    r({ ok: false });
  }

  function chooseCommand(u) {
    return new Promise(resolve => {
      ui.actor = u; ui.boost = 0;
      el.actor.textContent = u.name;
      const done = cmd => { ui.mode = 'busy'; ui.pending = null; el.menu.hidden = true; resolve(cmd); };
      ui.pending = done; // 測試途中切換成自動作戰時，用它直接交出指令
      const withTarget = async (kind, make, reopen) => {
        const r = await pickTarget(kind);
        if (r.ok) done(make(r.target)); else reopen();
      };
      const rootMenu = (index = 0) => {
        showList([
          { label: '攻擊', tag: TYPES[u.weapon], tagType: u.weapon, boostable: true, desc: `以${TYPES[u.weapon]}攻擊一名敵人。蓄力時每點 BP 多打一下，每下都能削減護盾。`, pick: () => withTarget('enemy', t => ({ type: 'attack', target: t, bp: ui.boost }), () => rootMenu(0)) },
          { label: '技能', desc: '消耗 SP 使用技能。蓄力可提高威力或回復量。', pick: () => skillMenu() },
          { label: '道具', disabled: !Object.values(items).some(n => n > 0), why: '沒有可以使用的道具。', desc: '使用隊伍共用的道具。', pick: () => itemMenu() },
          { label: '防禦', desc: '受到的傷害減半，下一回合優先行動。', pick: () => done({ type: 'defend' }) },
          { label: '逃跑', disabled: !b.canEscape, why: '這場戰鬥無法逃跑。', desc: '離開戰鬥。', pick: () => done({ type: 'escape' }) }
        ]);
        ui.index = index; highlight();
      };
      const skillMenu = (index = 0) => {
        showList(u.skills.map((id, i) => {
          const s = SKILLS[id];
          const kind = s.target === 'enemy' ? 'enemy' : s.target === 'enemies' ? 'enemies' : s.target === 'ally' ? 'ally' : 'allies';
          return {
            label: s.name, sub: `SP ${s.sp}`, tag: s.type ? TYPES[s.type] : s.kind === 'heal' ? '癒' : '識', tagType: s.type || s.kind, boostable: s.kind !== 'reveal',
            disabled: u.sp < s.sp, why: `SP 不足（需要 ${s.sp}）。`, desc: s.desc,
            pick: () => withTarget(kind, t => ({ type: 'skill', skill: id, target: t, bp: s.kind === 'reveal' ? 0 : ui.boost }), () => skillMenu(i))
          };
        }), () => rootMenu(1));
        ui.index = index; highlight();
      };
      const itemMenu = (index = 0) => {
        const list = Object.entries(items).filter(([, n]) => n > 0);
        showList(list.map(([id, n], i) => {
          const it = ITEMS[id];
          return {
            label: it.name, sub: `×${n}`, desc: it.desc, disabled: it.target === 'fallen' && !b.party.some(x => x.hp <= 0), why: '目前沒有倒下的同伴。',
            pick: () => withTarget(it.target, t => ({ type: 'item', item: id, target: t }), () => itemMenu(i))
          };
        }), () => rootMenu(2));
        ui.index = index; highlight();
      };
      rootMenu();
    });
  }

  addEventListener('keydown', e => {
    if (!view.active) return;
    const k = e.code;
    const confirm = ['Space', 'Enter', 'KeyE', 'KeyZ'].includes(k), back = ['Escape', 'KeyX', 'Backspace'].includes(k);
    if (!confirm && !back && !k.startsWith('Arrow') && !['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ'].includes(k)) return;
    e.preventDefault();
    if (e.repeat && confirm) return;
    const up = k === 'ArrowUp' || k === 'KeyW', down = k === 'ArrowDown' || k === 'KeyS', left = k === 'ArrowLeft' || k === 'KeyA' || k === 'KeyQ', right = k === 'ArrowRight' || k === 'KeyD';
    if (ui.mode === 'result') {
      if (confirm) ui.resultButtons[ui.rIndex]?.click();
      if (left || up) { ui.rIndex = Math.max(0, ui.rIndex - 1); focusResult(); }
      if (right || down) { ui.rIndex = Math.min(ui.resultButtons.length - 1, ui.rIndex + 1); focusResult(); }
      return;
    }
    if (ui.mode === 'menu') {
      if (up) { ui.index = (ui.index + ui.items.length - 1) % ui.items.length; highlight(); }
      if (down) { ui.index = (ui.index + 1) % ui.items.length; highlight(); }
      if (left) setBoost(-1);
      if (right) setBoost(1);
      if (confirm) pickCurrent();
      if (back && ui.onBack) ui.onBack();
    } else if (ui.mode === 'target') {
      const n = ui.targets.length;
      if (!ui.allTargets && n) {
        if (up || left) { ui.tIndex = (ui.tIndex + n - 1) % n; refresh(); }
        if (down || right) { ui.tIndex = (ui.tIndex + 1) % n; refresh(); }
      }
      if (confirm) confirmTarget();
      if (back) cancelTarget();
    }
  });

  // ---------- 演出 ----------
  async function stepTo(u, dir) {
    const v = vis.get(u), from = v.home.x, to = from + dir;
    await tween(0.16, k => { v.mesh.position.x = from + (to - from) * k; if (v.tex) setFrame(v.tex, 3, k < 0.5 ? 1 : 2); });
  }
  async function stepBack(u) {
    const v = vis.get(u), from = v.mesh.position.x, to = v.home.x;
    if (Math.abs(from - to) < 0.01) return;
    await tween(0.18, k => { v.mesh.position.x = from + (to - from) * k; });
    if (v.tex) setFrame(v.tex, 3, 0);
  }
  function hitFlash(u) {
    const v = vis.get(u);
    v.flash = 0.28;
    if (v.mesh.position.x === v.home.x) tween(0.28, k => { v.mesh.position.x = v.home.x + (u.side === 'party' ? 1 : -1) * Math.sin(k * 30) * 0.08 * (1 - k); }).then(() => { v.mesh.position.x = v.home.x; });
  }
  function fxAt(u, type, slash) {
    const v = vis.get(u), p = v.mesh.position;
    const color = TYPE_FX[type] || '#c08aff';
    fx(p.x, p.y + v.h * 0.5, p.z, color, { size: Math.max(1.4, v.h * 0.8), slash, dur: 0.32, grow: slash ? 1.2 : 1.9 });
  }

  async function play(events) {
    let mover = null;
    for (const ev of events) {
      if (ev.t === 'act') {
        const u = ev.unit;
        caption(`${u.name}：${ev.label}`);
        if (u.side === 'party' && (ev.kind === 'attack' || ev.kind === 'skill')) { mover = u; await stepTo(u, -0.7); }
        else if (u.side === 'enemy') { mover = u; await stepTo(u, 0.6); }
        else if (ev.kind === 'heal' || ev.kind === 'item') { const v = vis.get(u); fx(v.mesh.position.x, v.h * 0.55, v.mesh.position.z, '#9affc0', { size: 1.6, dur: 0.4 }); await sleep(0.2); }
        else if (ev.kind === 'defend') { const v = vis.get(u); fx(v.mesh.position.x, v.h * 0.5, v.mesh.position.z, '#8ab8ff', { size: 2, dur: 0.5 }); pop(u, '防禦', 'info'); await sleep(0.3); }
        else if (ev.kind === 'escape') { for (const p of b.party) if (p.hp > 0) stepTo(p, 2.5); await sleep(0.35); }
        if (ev.kind === 'enemyAll') { flashScreen('rgba(120,80,200,0.35)'); shake = 0.25; }
        if (ev.bp) { const v = vis.get(u); fx(v.mesh.position.x, v.h * 0.5, v.mesh.position.z, '#ffd27a', { size: 1.2 + ev.bp * 0.25, dur: 0.4, intensity: 1.3 }); }
      } else if (ev.t === 'hit') {
        fxAt(ev.target, ev.type, ev.type === 'sword' || ev.type === 'dagger' || ev.type === 'staff' || !ev.type);
        hitFlash(ev.target);
        pop(ev.target, ev.dmg, ev.weak ? 'weak' : ev.target.side === 'party' ? 'hurt' : '');
        if (ev.weak) pop(ev.target, '弱點', 'tag', -36);
        if (ev.target.side === 'party' && !reduceMotion) shake = Math.max(shake, 0.12);
        refresh();
        await sleep(ev.src?.side === 'party' ? 0.2 : 0.16);
      } else if (ev.t === 'reveal') {
        refresh();
      } else if (ev.t === 'shield') {
        const t = vis.get(ev.target).tag.querySelector('.b-shield');
        t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump');
        refresh();
      } else if (ev.t === 'break') {
        const v = vis.get(ev.target);
        sparks.fire(v.mesh.position.x, v.h * 0.55, v.mesh.position.z + 0.3);
        flashScreen(); pop(ev.target, '破防！', 'break'); caption(`${ev.target.name} 破防了！`, 1.4);
        refresh();
        await sleep(0.45);
      } else if (ev.t === 'heal' || ev.t === 'revive') {
        const v = vis.get(ev.target);
        if (ev.t === 'revive') { v.mesh.rotation.z = 0; v.mesh.position.y = 0; v.mat.color.setScalar(1); }
        fx(v.mesh.position.x, v.h * 0.5, v.mesh.position.z, '#7affb0', { size: 1.6, dur: 0.45 });
        pop(ev.target, `+${ev.amount}`, 'heal');
        refresh(); await sleep(0.18);
      } else if (ev.t === 'sp') {
        pop(ev.target, `SP +${ev.amount}`, 'heal'); refresh(); await sleep(0.18);
      } else if (ev.t === 'ko') {
        const u = ev.target, v = vis.get(u);
        if (u.side === 'enemy') {
          sparks.fire(v.mesh.position.x, v.h * 0.4, v.mesh.position.z + 0.2, '#b48aff');
          tween(0.55, k => { v.mesh.scale.set(1 - k * 0.3, 1 - k, 1); v.mat.color.setRGB(1 - k * 0.6, 1 - k * 0.8, 1 - k * 0.4); v.blob.scale.setScalar((1 - k) * Math.max(1, (v.w || 1) * 0.45)); }).then(() => { v.mesh.visible = false; v.blob.visible = false; });
        } else {
          tween(0.3, k => { v.mesh.rotation.z = k * Math.PI / 2 * 0.95; v.mat.color.setScalar(1 - k * 0.45); });
          pop(u, '倒下', 'info');
        }
        refresh(); await sleep(0.25);
      } else if (ev.t === 'phase') {
        flashScreen('rgba(150,90,255,0.5)'); shake = 0.5;
        caption(ev.text, 2.4); refresh(); await sleep(1.3);
      } else if (ev.t === 'note') {
        caption(ev.text, 1.4); await sleep(0.4);
      }
    }
    if (mover) await stepBack(mover);
    await sleep(0.18);
  }

  // ---------- 鏡頭與尺寸 ----------
  function resize() {
    const aspect = innerWidth / innerHeight;
    camera.aspect = aspect;
    const portrait = aspect < 0.9;
    camera.fov = portrait ? 46 : 30;
    // 寬度不足時把鏡頭拉遠，確保兩邊的隊伍都在畫面內
    const half = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const need = portrait ? (layoutK < 1 ? 4.4 : 5.2) : 5.6, dist = Math.max(18, need / (half * aspect));
    if (stage) { scene.fog.near = stage.fog[1] + dist - 18; scene.fog.far = stage.fog[2] + dist - 18; } // 鏡頭拉遠時霧也跟著退後
    camera.position.set(0, 1.1 + dist * 0.27, dist);
    look.set(0, portrait ? 0.2 - dist * 0.04 : 1.0, 0);
    camera.lookAt(look);
    // 直向畫面的下半部會被選單與隊伍欄蓋住，把整個舞台往上移
    if (portrait) camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * 0.12, innerWidth, innerHeight);
    else camera.clearViewOffset();
    camera.updateProjectionMatrix(); camera.updateMatrixWorld();
    view.focusY = tmpV.set(0, 0.8, 0).project(camera).y * 0.5 + 0.5; // 景深清晰帶對準舞台中央
    tagMinY = null;
  }
  addEventListener('resize', () => { if (view.active) resize(); });

  // ---------- 流程 ----------
  function setStage(name) {
    stage = STAGES[name] || STAGES.town;
    scene.background = new THREE.Color(stage.bg);
    scene.fog = new THREE.Fog(stage.fog[0], stage.fog[1], stage.fog[2]);
    hemi.color.set(stage.hemi[0]); hemi.groundColor.set(stage.hemi[1]); hemi.intensity = stage.hemi[2];
    sun.color.set(stage.sun[0]); sun.intensity = stage.sun[1];
    lamp.color.set(stage.lamp[0]); lamp.intensity = stage.lamp[1];
    rim.color.set(stage.rim[0]); rim.intensity = stage.rim[1];
    groundMat.map = groundMaps[stage.ground]; groundMat.color.set(stage.tint); groundMat.needsUpdate = true;
    for (const k in decor) decor[k].visible = k === stage.decor || (k === 'stars' && !!stage.stars);
  }

  function fullRestore() { for (const r of recs) { const s = memberStats(r.id, r.lv); r.hp = s.hp; r.sp = s.sp; } }

  async function showResult({ eyebrow, title, lines, buttons, tone }) {
    el.rEyebrow.textContent = eyebrow;
    el.rTitle.textContent = title;
    el.rBody.innerHTML = lines.map(l => `<p class="${l.cls || ''}">${l.text}</p>`).join('');
    el.rActions.innerHTML = '';
    el.result.className = 'b-result ' + (tone || '');
    return new Promise(resolve => {
      ui.resultButtons = buttons.map((bt, i) => {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'btn ' + (i === 0 ? 'primary' : 'ghost'); btn.textContent = bt.label;
        btn.addEventListener('click', () => { el.result.hidden = true; ui.mode = 'busy'; resolve(bt.value); });
        el.rActions.append(btn);
        return btn;
      });
      ui.rIndex = 0; ui.mode = 'result';
      el.result.hidden = false;
      focusResult();
    });
  }
  function focusResult() { ui.resultButtons.forEach((bt, i) => bt.classList.toggle('sel', i === ui.rIndex)); }

  async function fight(intro) {
    b = createBattle({ party: recs, enemies: enc.enemies, items, revealed: view.revealed, canEscape: enc.escape !== false });
    view.battle = b;
    buildUnits();
    ui.mode = 'busy'; ui.actor = null;
    el.menu.hidden = true; el.result.hidden = true;
    refresh(); renderOrder(null);
    renderer.compile(scene, camera);
    for (const u of b.enemies) { const v = vis.get(u); v.mesh.scale.set(1, 0.01, 1); }
    caption(intro, 2);
    await tween(0.45, k => { for (const u of b.enemies) vis.get(u).mesh.scale.set(1, Math.max(0.01, 1 - Math.pow(1 - k, 3)), 1); });
    await sleep(0.5);
    while (!b.result) {
      const u = b.nextActor();
      renderOrder(u);
      ui.actor = u.side === 'party' ? u : null;
      refresh(u);
      let cmd;
      if (u.side === 'party') {
        if (view.auto) { await sleep(0.15); cmd = autoCommand(b, u); }
        else { caption(`${u.name} 的回合`, 99); cmd = await chooseCommand(u); }
      } else {
        await sleep(0.3);
        cmd = b.enemyCommand(u);
      }
      ui.actor = null;
      const ev = b.act(u, cmd);
      await play(ev);
      refresh(null);
    }
    return b.result;
  }

  view.start = async ({ encounter, party, inventory, revealed, intro }) => {
    enc = ENCOUNTERS[encounter]; recs = party; items = inventory; view.revealed = revealed;
    setStage(enc.stage);
    layoutK = innerWidth / innerHeight < 0.9 ? 0.72 : 1; // 直向畫面把兩隊靠近一點，角色才不會太小
    resize();
    view.active = true; root.hidden = false; time = 0;
    let result;
    for (;;) {
      result = await fight(intro || (enc.escape === false ? '影獸擋住了去路！' : '遭遇敵人！'));
      if (result !== 'lose') break;
      const choice = await showResult({
        eyebrow: '戰鬥結果', title: '全員倒下了……', tone: 'lose',
        lines: [{ text: '別灰心。換個屬性試試看，或是先削掉護盾再全力進攻。' }, { text: '再試一次時，隊伍會完全回復。', cls: 'dim' }],
        buttons: enc.escape === false ? [{ label: '再試一次', value: 'retry' }] : [{ label: '再試一次', value: 'retry' }, { label: '撤退', value: 'retreat' }]
      });
      fullRestore();
      if (choice === 'retreat') { result = 'escape'; break; }
      intro = '再次挑戰！';
    }
    // 把戰鬥中的血量寫回隊伍；倒下的同伴在戰鬥後以 1 HP 起身
    if (result !== 'lose') for (const u of b.party) { u.rec.hp = Math.max(1, u.hp); u.rec.sp = u.sp; }
    let summary = null;
    if (result === 'win') {
      for (const u of b.party) if (u.hp > 0) tween(0.4, k => { vis.get(u).mesh.position.y = Math.sin(k * Math.PI) * 0.35; });
      caption('勝利！', 2);
      await sleep(0.6);
      const exp = b.rewards(), lines = [{ text: `獲得經驗值 <b>${exp}</b>` }], ups = [];
      for (const r of recs) {
        for (const up of gainExp(r, exp)) {
          ups.push(r.id);
          lines.push({ text: `${MEMBERS[r.id].name} 升到 <b>Lv ${up.lv}</b>`, cls: 'up' });
          for (const s of up.skills) lines.push({ text: `${MEMBERS[r.id].name} 學會了「${SKILLS[s].name}」`, cls: 'skill' });
        }
      }
      for (const [k, n] of Object.entries(enc.drops || {})) { items[k] = (items[k] || 0) + n; lines.push({ text: `獲得 ${ITEMS[k].name} ×${n}`, cls: 'item' }); }
      summary = { exp, ups };
      if (!view.auto) await showResult({ eyebrow: '戰鬥結果', title: '勝利', lines, buttons: [{ label: '繼續', value: 'ok' }], tone: 'win' });
      else await sleep(0.3);
    } else if (result === 'escape') {
      caption('順利脫離了戰鬥。', 1.5);
      await sleep(0.6);
    }
    ui.mode = 'none';
    return { result, summary };
  };
  // 結束戰鬥畫面（由主程式在轉場遮住畫面後呼叫，避免閃一下地圖）
  view.close = () => { view.active = false; root.hidden = true; ui.mode = 'none'; el.pops.innerHTML = ''; el.caption.classList.remove('show'); };

  view.update = dt => {
    if (!view.active) return;
    dt *= view.timeScale;
    time += dt;
    for (let i = tweens.length - 1; i >= 0; i--) {
      const t = tweens[i]; t.t += dt;
      const k = Math.min(1, t.t / t.d); t.fn(k);
      if (k >= 1) { tweens.splice(i, 1); t.res(); }
    }
    for (let i = waits.length - 1; i >= 0; i--) { waits[i].t -= dt; if (waits[i].t <= 0) { const w = waits.splice(i, 1)[0]; w.res(); } }
    for (const f of fxPool) {
      if (f.life <= 0) continue;
      f.life -= dt; const k = 1 - f.life / f.dur;
      f.m.scale.setScalar(f.size * (1 + k * (f.grow - 1)));
      f.m.material.opacity = Math.max(0, 1 - k * k);
      if (f.life <= 0) f.m.visible = false;
    }
    sparks.update(dt);
    if (view.auto && ui.pending && ui.actor) { ui.tResolve = null; ui.targets = []; ui.pending(autoCommand(b, ui.actor)); }
    if (b) for (const u of b.enemies) {
      const v = vis.get(u);
      if (u.hp > 0) { v.mesh.position.y = (u.boss ? 0.25 + Math.sin(time * 1.6) * 0.12 : Math.abs(Math.sin(time * 2.4 + v.seed)) * 0.05); v.blob.scale.setScalar(Math.max(1, (v.w || 1) * 0.45) * (u.boss ? 0.85 + Math.sin(time * 1.6) * 0.05 : 1)); }
    }
    // 受擊閃白；破防中的敵人帶一點冷色
    if (b) for (const u of b.units) {
      const v = vis.get(u);
      if (u.hp <= 0) continue;
      v.flash = Math.max(0, (v.flash || 0) - dt);
      const f = 1 + (v.flash / 0.28) * 2.6;
      if (u.broken) v.mat.color.setRGB(0.72 * f, 0.72 * f, 0.95 * f); else v.mat.color.setScalar(f);
    }
    if (stage?.decor === 'sea') decor.sea.userData.water.offset.set(time * 0.012, Math.sin(time * 0.3) * 0.01);
    if (captionTimer > 0) { captionTimer -= dt; if (captionTimer <= 0) el.caption.classList.remove('show'); }
    // 敵人頭上的標籤跟著畫面位置走；頭目太高時往下壓，避免蓋住上方的行動順序列
    if (b && tagMinY === null) { const r = root.querySelector('.b-order').getBoundingClientRect(); if (r.height) tagMinY = r.bottom + 8; }
    // 名牌互相重疊時，把後排的往上推（推不上去就放到前排下方）
    if (b) {
      const placed = [];
      for (const u of b.enemies) {
        const v = vis.get(u);
        tmpV.set(v.mesh.position.x, v.h + 0.25 + (u.boss ? 0.3 : 0), v.mesh.position.z).project(camera);
        v.tagH ||= v.tag.offsetHeight; v.tagW ||= v.tag.offsetWidth;
        placed.push({ v, x: (tmpV.x * 0.5 + 0.5) * innerWidth, y: Math.max((-tmpV.y * 0.5 + 0.5) * innerHeight, (tagMinY ?? 0) + v.tagH) });
      }
      placed.sort((a, c) => c.y - a.y);
      placed.forEach((t, i) => {
        for (let j = 0; j < i; j++) {
          const o = placed[j];
          if (Math.abs(t.x - o.x) > (t.v.tagW + o.v.tagW) / 2 + 4 || t.y - t.v.tagH > o.y + 4 || t.y < o.y - o.v.tagH - 4) continue;
          const up = o.y - o.v.tagH - 6;
          t.y = up - t.v.tagH >= (tagMinY ?? 0) ? up : o.y + t.v.tagH + 6;
        }
        t.v.tag.style.transform = `translate(${t.x}px, ${t.y}px) translate(-50%, -100%)`;
      });
    }
    const s = shake > 0 ? (shake -= dt, shake * 0.25) : 0;
    camera.position.x = Math.sin(time * 0.25) * 0.3 + (s ? (Math.random() - 0.5) * s : 0);
    camera.lookAt(look);
  };

  view.render = (high, elapsed) => {
    if (high) post.render(scene, camera, { focusY: view.focusY, blur: Math.min(10, Math.max(3, post.h / 170)), band: 0.2, bloom: 1.0, exposure: 1.05, time: elapsed, fade: 1 });
    else { renderer.setRenderTarget(null); renderer.render(scene, camera); }
  };
  view.setShadows = on => { sun.castShadow = on; };
  view.state = () => b && view.active ? {
    round: b.round, mode: ui.mode, actor: ui.actor?.name ?? null,
    party: b.party.map(u => ({ id: u.id, hp: u.hp, sp: u.sp, bp: u.bp })),
    enemies: b.enemies.map(u => ({ name: u.name, hp: u.hp, maxHp: u.maxHp, phase: u.phase, shield: u.shield, broken: u.broken, known: [...u.known] }))
  } : null;
  return view;
}
