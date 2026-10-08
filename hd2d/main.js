// 星燈港：遊戲主程式（狀態、輸入、角色、對話、劇情、遭遇、存檔、鏡頭與畫質）。
import * as THREE from 'three';
import { createWorld, SPRITE_TILT } from './world.js';
import { PALETTES, makeCharacterTexture, setFrame } from './pixel.js';
import { HD2DPost } from './post.js';
import { createBattleView } from './battle.js';
import { memberStats, expToNext } from './battle-core.js';
import { ITEMS, MEMBERS } from './data.js';
import { monsterMaterial } from './monsters.js';
import { S, CHAPTERS } from './story.js';
import { createAudio } from './audio.js';

const $ = id => document.getElementById(id);
const ui = {
  canvas: $('game'), loading: $('loading'), title: $('title'), hud: $('hud'), objective: $('objective-text'), gems: $('gems'),
  chapterLabel: $('chapter-label'), partyHud: $('party-hud'), menuParty: $('menu-party'),
  prompt: $('prompt'), promptKey: $('prompt-key'), promptText: $('prompt-text'), dialogue: $('dialogue'), speaker: $('speaker'),
  text: $('dialogue-text'), toast: $('toast'), touch: $('touch'), stickZone: $('stick-zone'), stick: $('stick'), act: $('act-btn'),
  menu: $('menu'), help: $('help'), ending: $('ending'), endTime: $('end-time'), endLevel: $('end-level'), error: $('error'), quality: $('quality-select'), sound: $('sound-select'),
  battle: $('battle'), wipe: $('wipe'), chapter: $('chapter'), start: $('start'), cont: $('continue')
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const log = (...a) => console.info('[星燈港]', ...a);
const wait = ms => new Promise(r => setTimeout(r, ms));

// ---------- 畫質偏好（只存在這台裝置） ----------
function readPref() { try { return localStorage.getItem('hd2d-quality'); } catch { return null; } }
function savePref(v) { try { localStorage.setItem('hd2d-quality', v); } catch { /* 無法儲存時仍可遊玩 */ } }
let quality = readPref() || 'high';
let qualityLocked = !!readPref();

// ---------- 渲染器 ----------
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas: ui.canvas, antialias: false, powerPreference: 'high-performance' });
} catch (e) {
  ui.loading.hidden = true; ui.error.hidden = false;
  throw e;
}
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false; // 一幀含多個後製步驟，改為每幀手動歸零才看得到總繪製次數

const world = createWorld(quality);
const { scene } = world;
const camera = new THREE.PerspectiveCamera(32, 1, 0.5, 140);
const CAM_OFFSET = new THREE.Vector3(0, 11.5, 14);
const post = new HD2DPost(renderer);
// ---------- 聲音（瀏覽器要等第一次按鍵或點擊才允許發聲） ----------
const audio = createAudio();
for (const type of ['pointerdown', 'pointerup', 'keydown', 'click']) addEventListener(type, audio.unlock, { capture: true, passive: true });

const battleView = createBattleView({ renderer, post, root: ui.battle, reduceMotion, audio });

function resize() {
  const w = innerWidth, h = innerHeight;
  const maxDpr = quality === 'high' ? 1.5 : 1;
  const dpr = Math.min(devicePixelRatio || 1, maxDpr, Math.sqrt(2600000 / (w * h)));
  renderer.setPixelRatio(dpr);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w / h < 0.8 ? 44 : 32;
  camera.updateProjectionMatrix();
  post.setSize(Math.floor(w * dpr), Math.floor(h * dpr));
  world.setPixelScale(dpr);
}
function applyQuality(q, reason) {
  quality = q;
  renderer.shadowMap.enabled = q === 'high';
  world.setQuality(q);
  battleView.setShadows(q === 'high');
  scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
  ui.quality.value = q;
  resize();
  log('畫質', q, reason || '');
}
addEventListener('resize', resize);

// ---------- 角色 ----------
const spriteGeo = world.spriteGeo(1, 1.5);
const shadowGeo = new THREE.CircleGeometry(0.34, 16).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.32, depthWrite: false });

class Actor {
  constructor(palette, x, z, dir = 0) {
    this.tex = makeCharacterTexture(palette);
    const mat = new THREE.MeshLambertMaterial({ map: this.tex, alphaTest: 0.5, side: THREE.DoubleSide });
    this.mesh = new THREE.Mesh(spriteGeo, mat);
    this.mesh.castShadow = true;
    this.mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: this.tex, alphaTest: 0.5 });
    this.blob = new THREE.Mesh(shadowGeo, shadowMat);
    scene.add(this.mesh, this.blob);
    this.x = x; this.z = z; this.y = world.groundAt(x, z); this.dir = dir; this.anim = 0; this.moving = false; this.hidden = false;
    this.sync(0);
  }
  sync(dt) {
    const target = world.groundAt(this.x, this.z);
    this.y += (target - this.y) * Math.min(1, dt * 14 || 1);
    this.anim = this.moving ? this.anim + dt * 7.5 : 0;
    const frame = this.moving ? [1, 0, 2, 0][Math.floor(this.anim) % 4] : 0;
    setFrame(this.tex, this.dir, frame);
    this.mesh.position.set(this.x, this.y, this.z);
    this.blob.position.set(this.x, this.y + 0.02, this.z + 0.05);
  }
  face(x, z) {
    const dx = x - this.x, dz = z - this.z;
    this.dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 2 : 3) : (dz > 0 ? 0 : 1);
  }
  place(x, z, dir) { this.x = x; this.z = z; this.y = world.groundAt(x, z); this.dir = this.home = dir; this.sync(0); }
  show(v) { this.mesh.visible = this.blob.visible = v; this.hidden = !v; }
}

const player = new Actor(PALETTES.hero, 18, 20.5, 1);
const npcs = {
  keeper: Object.assign(new Actor(PALETTES.keeper, 30.5, 24.6, 0), { name: '守燈人・葛倫' }),
  fisher: Object.assign(new Actor(PALETTES.fisher, 18.5, 28.5, 0), { name: '漁夫・巴特' }),
  florist: Object.assign(new Actor(PALETTES.florist, 30.4, 10.6, 0), { name: '花店的米菈' }),
  merchant: Object.assign(new Actor(PALETTES.merchant, 22.2, 15.6, 3), { name: '旅行商人・賽恩' })
};
for (const n of Object.values(npcs)) n.home = n.dir;
const NPC_LIST = Object.values(npcs);

// ---------- 星之碎片 ----------
const fragments = [
  { id: 'shrine', x: 7.0, z: 4.4, guard: 'g-shrine' },
  { id: 'pier', x: 17.5, z: 31.0, guard: 'g-pier' },
  { id: 'field', x: 32.5, z: 4.5, guard: 'g-field' }
].map(f => {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshBasicMaterial({ color: new THREE.Color().setRGB(3.4, 3.0, 1.6) }));
  core.scale.y = 1.5;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 1.2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color().setRGB(1.6, 1.4, 0.8), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  halo.rotation.x = SPRITE_TILT;
  const light = new THREE.PointLight('#ffe6a0', 5, 4.5, 1.6);
  g.add(core, halo, light);
  const base = world.groundAt(f.x, f.z);
  g.position.set(f.x, base + 0.7, f.z);
  scene.add(g);
  return { ...f, g, core, base, got: false };
});

function glowTexture() {
  if (glowTexture.t) return glowTexture.t;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return (glowTexture.t = new THREE.CanvasTexture(c));
}

// 取得碎片時的光點爆散
const burst = (() => {
  const n = 48, pos = new Float32Array(n * 3), vel = [];
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ map: glowTexture(), size: 0.35, color: new THREE.Color().setRGB(3, 2.6, 1.2), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const pts = new THREE.Points(geo, mat); pts.visible = false; pts.frustumCulled = false; scene.add(pts);
  let life = 0;
  return {
    fire(x, y, z) {
      for (let i = 0; i < n; i++) {
        pos.set([x, y, z], i * 3);
        const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = 1.5 + Math.random() * 2.5;
        vel[i] = [Math.cos(a) * Math.sqrt(1 - u * u) * s, Math.abs(u) * s + 1, Math.sin(a) * Math.sqrt(1 - u * u) * s];
      }
      life = 1.2; pts.visible = true;
    },
    update(dt) {
      if (life <= 0) return;
      life -= dt; mat.opacity = Math.max(0, life / 1.2);
      for (let i = 0; i < n; i++) { vel[i][1] -= dt * 3; for (let k = 0; k < 3; k++) pos[i * 3 + k] += vel[i][k] * dt; }
      geo.attributes.position.needsUpdate = true;
      if (life <= 0) pts.visible = false;
    }
  };
})();

// ---------- 地圖上的影獸（碰到就進入戰鬥） ----------
// guard：守護碎片；roam：會遊蕩，玩家靠近時追過來；boss：先播對話再開戰。w- 開頭的在休息後會重新出現。
const auraMat = new THREE.MeshBasicMaterial({ color: '#2a1440', transparent: true, opacity: 0.45, depthWrite: false });
const SYMBOLS = [
  { id: 'g-shrine', enc: 'shrineGuard', art: 'thorn', x: 7.0, z: 6.6, intro: '荊棘精纏住了星之碎片！' },
  { id: 'g-pier', enc: 'pierGuard', art: 'crab', x: 17.9, z: 29.6, intro: '潮影蟹舉起了巨鉗！' },
  { id: 'g-field', enc: 'fieldGuard', art: 'fox', x: 31.6, z: 6.2, intro: '影狐在花田裡低吼！' },
  { id: 'w-beach', enc: 'beachBats', art: 'bat', x: 12.5, z: 23.4, roam: true },
  { id: 'w-gate', enc: 'meadowFox', art: 'fox', x: 18.8, z: 3.2, roam: true },
  { id: 'w-f1', enc: 'forestWolf', art: 'wolf', x: 19.5, z: -3.6, roam: true },
  { id: 'w-f2', enc: 'forestShrooms', art: 'shroom', x: 20.5, z: -8.5, roam: true },
  { id: 'w-f3', enc: 'forestPack', art: 'wolf', x: 24.5, z: -10.5, roam: true },
  { id: 'w-f4', enc: 'forestTreant', art: 'treant', x: 28.2, z: -12.4, roam: true },
  { id: 'w-f5', enc: 'forestDeep', art: 'treant', x: 32.0, z: -10.0, roam: true },
  { id: 'b-wolfKing', enc: 'wolfKing', art: 'wolfKing', x: 27.0, z: -16.6, boss: true, scale: 0.8, before: 'wolfKingBefore', intro: '霧狼王發出震耳的嚎叫！' },
  { id: 'w-r1', enc: 'ruinKnight', art: 'knight', x: 22.0, z: -24.2, roam: true },
  { id: 'w-r2', enc: 'ruinGolem', art: 'golem', x: 11.0, z: -26.5, roam: true },
  { id: 'w-r3', enc: 'ruinPair', art: 'golem', x: 25.5, z: -26.0, roam: true },
  { id: 'w-r4', enc: 'ruinKnights', art: 'knight', x: 18.5, z: -27.6, roam: true },
  { id: 'b-starEater', enc: 'starEater', art: 'starEater', x: 18.5, z: -30.7, boss: true, scale: 0.85, before: 'bossBefore', intro: '熄星者張開了黑色的羽翼！' }
].map(s => {
  const m = monsterMaterial(s.art), sc = s.scale || 1;
  const mesh = new THREE.Mesh(world.spriteGeo(m.w * sc, m.h * sc), m.mat);
  mesh.castShadow = true; mesh.customDepthMaterial = m.depth;
  const blob = new THREE.Mesh(shadowGeo, auraMat); blob.scale.setScalar(Math.max(1, m.w * sc * 0.55));
  scene.add(mesh, blob);
  return { ...s, mesh, blob, home: [s.x, s.z], r: Math.max(0.42, m.w * sc * 0.3), wx: s.x, wz: s.z, t: Math.random() * 2, stun: 0, face: 1 };
});
const symbolById = id => SYMBOLS.find(s => s.id === id);

// ---------- 寶箱 ----------
const CHESTS = [
  { id: 'c-town', x: 3.5, z: 19.5, items: { herb: 1, dew: 1 } },
  { id: 'c-camp', x: 13.5, z: -11.5, items: { dew: 1 } },
  { id: 'c-deep', x: 34.5, z: -10.0, items: { feather: 1, herb: 1 } },
  { id: 'c-ruins', x: 9.5, z: -32.5, items: { herb: 2, feather: 1 } }
].map(c => {
  const wood = new THREE.MeshLambertMaterial({ color: '#7a4a28' }), gold = new THREE.MeshLambertMaterial({ color: '#d9b56a', emissive: '#3a2a08' });
  const g = new THREE.Group(), base = world.groundAt(c.x, c.z);
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.42, 0.5), wood); body.position.y = 0.21;
  const band = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.44, 0.52), gold); band.position.y = 0.21;
  const lid = new THREE.Group(); lid.position.set(0, 0.42, -0.25);
  const lidMesh = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 0.52), wood); lidMesh.position.set(0, 0.08, 0.25);
  const lock = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.04), gold); lock.position.set(0, 0.02, 0.52);
  lid.add(lidMesh, lock);
  for (const m of [body, band, lidMesh]) { m.castShadow = m.receiveShadow = true; }
  g.add(body, band, lid); g.position.set(c.x, base, c.z); scene.add(g);
  world.setBlocked(Math.floor(c.x), Math.floor(c.z), true);
  return { ...c, g, lid };
});
const REST = { well: [19.5, 14.5], camp: [10.5, -9.5], statue: [15.5, -23.5] };

// ---------- 遊戲狀態 ----------
const SAVE_KEY = 'hd2d-save';
const newRecord = (id, lv) => { const s = memberStats(id, lv); return { id, lv, exp: 0, hp: s.hp, sp: s.sp }; };
const game = {
  mode: 'loading', playTime: 0, flags: {}, found: 0,
  party: [newRecord('hero', 1)], items: { herb: 2, dew: 1, feather: 1 }, revealed: {},
  defeated: new Set(), chests: new Set(), grace: 0
};
// flags：metKeeper 接下委託、miraJoined、merchantGift、lit 燈塔點亮（第二章）、seinJoined、forestEntered、campTalk、
//        wolfKing 擊敗霧狼王、ruinsEntered（第三章）、finished 擊敗熄星者（終章）
const chapter = () => { const f = game.flags; return f.finished ? 4 : f.ruinsEntered ? 3 : f.lit ? 2 : 1; };
const got = id => fragments.find(f => f.id === id).got;

function objectiveText() {
  const f = game.flags;
  if (!f.metKeeper) return '前往東南方的燈塔，和守燈人談談';
  if (!f.lit) {
    if (game.found < 3) return `尋找星之碎片（${game.found} / 3）` + (f.miraJoined ? '' : '　花店的米菈或許能幫忙');
    return '把三顆星之碎片交給守燈人';
  }
  if (!f.seinJoined) return '到北門和旅行商人賽恩會合';
  if (!f.wolfKing) return f.forestEntered ? '穿過霧之森，找到渡過溪流的橋' : '穿過北門，進入霧之森';
  if (!f.finished) return f.ruinsEntered ? '登上古塔前的祭壇，打倒熄星者' : '前往森林北方的星之古塔';
  return '星祭開始了，在星燈港自由漫步';
}
function refreshHud() {
  const c = CHAPTERS[chapter()];
  ui.chapterLabel.textContent = `${c.no}　${c.title}`;
  ui.objective.textContent = objectiveText();
  ui.gems.hidden = !!game.flags.lit;
  [...ui.gems.children].forEach((g, i) => g.classList.toggle('on', i < game.found));
  ui.gems.setAttribute('aria-label', `星之碎片 ${game.found} / 3`);
  ui.partyHud.innerHTML = game.party.map(r => {
    const s = memberStats(r.id, r.lv), k = r.hp / s.hp;
    return `<div class="pm"><b>${MEMBERS[r.id].name}</b><small>Lv ${r.lv}</small><span class="bar${k < 0.3 ? ' low' : ''}" title="HP ${r.hp}/${s.hp}"><i style="width:${Math.max(0, k * 100)}%"></i></span></div>`;
  }).join('');
}
function renderMenuParty() {
  ui.menuParty.innerHTML = game.party.map(r => {
    const s = memberStats(r.id, r.lv);
    return `<div class="row"><b>${MEMBERS[r.id].name}　Lv ${r.lv}</b><span>下一級還差 ${expToNext(r.lv) - r.exp}</span><span>HP ${r.hp} / ${s.hp}</span><span>SP ${r.sp} / ${s.sp}</span></div>`;
  }).join('') + `<div class="items">道具：${Object.entries(game.items).map(([k, n]) => `${ITEMS[k].name} ×${n}`).join('、')}</div>`;
}

let toastTimer;
function toast(msg) {
  ui.toast.textContent = msg;
  // 窄螢幕上置中的提示會蓋住左上角的目標欄，這時改放到目標欄下方
  ui.toast.style.top = '';
  const hud = ui.hud.hidden ? null : ui.hud.querySelector('.hud-left').getBoundingClientRect();
  if (hud && (innerWidth - ui.toast.offsetWidth) / 2 < hud.right + 8) ui.toast.style.top = `${Math.round(hud.bottom + 12)}px`;
  ui.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2800);
}

// ---------- 存檔（只存在這台裝置的瀏覽器） ----------
function saveGame() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: 1, flags: game.flags, found: game.found, frags: fragments.filter(f => f.got).map(f => f.id), party: game.party, items: game.items,
      revealed: game.revealed, defeated: [...game.defeated], chests: [...game.chests], pos: [+player.x.toFixed(2), +player.z.toFixed(2)], playTime: Math.round(game.playTime)
    }));
  } catch { /* 無法儲存（例如私密瀏覽）時仍可遊玩 */ }
}
function readSave() {
  try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && d.v === 1 ? d : null; } catch { return null; }
}
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* 忽略 */ } }

// 依劇情旗標擺好世界：北門、濃霧、古塔、燈塔、同伴與 NPC 位置
function syncWorld() {
  const f = game.flags;
  world.setGate(!!f.lit);
  world.setMist(!!f.wolfKing, true);
  world.setTower(!!f.finished);
  world.lighthouse.setLit(f.finished ? 1.3 : f.lit ? 1 : 0);
  npcs.florist.show(!f.miraJoined || !!f.finished);
  npcs.merchant.show(!f.seinJoined || !!f.finished);
  if (f.lit && !f.seinJoined) npcs.merchant.place(19.4, 2.4, 0);
  if (f.finished) { npcs.florist.place(27.7, 25.2, 2); npcs.merchant.place(26.6, 23.9, 2); } // 終章：兩位同伴陪在燈塔旁
  for (const c of CHESTS) if (game.chests.has(c.id)) c.lid.rotation.x = -1.9;
}
function applySave(d) {
  Object.assign(game.flags, d.flags);
  game.found = d.found; game.party = d.party; game.items = d.items; game.revealed = d.revealed || {};
  // 數值調整過的舊存檔，HP／SP 可能超過新的上限
  for (const r of game.party) { const s = memberStats(r.id, r.lv); r.hp = Math.min(r.hp, s.hp); r.sp = Math.min(r.sp, s.sp); }
  game.defeated = new Set(d.defeated); game.chests = new Set(d.chests); game.playTime = d.playTime || 0;
  for (const f of fragments) if (d.frags.includes(f.id)) { f.got = true; f.g.visible = false; }
  syncWorld();
  player.place(d.pos[0], d.pos[1], 0);
}

// ---------- 對話 ----------
const dlg = { lines: [], i: 0, shown: 0, onEnd: null };
function say(lines, onEnd) {
  dlg.lines = lines; dlg.i = 0; dlg.shown = 0; dlg.onEnd = onEnd || null;
  game.mode = 'dialogue';
  ui.dialogue.hidden = false; ui.prompt.hidden = true;
  renderLine();
}
function renderLine() {
  const l = dlg.lines[dlg.i];
  ui.speaker.textContent = l.n || '';
  ui.speaker.hidden = !l.n;
  ui.text.textContent = l.t.slice(0, Math.floor(dlg.shown));
  ui.dialogue.classList.toggle('complete', dlg.shown >= l.t.length);
}
function advance() {
  const l = dlg.lines[dlg.i];
  if (dlg.shown < l.t.length) { dlg.shown = l.t.length; renderLine(); return; }
  audio.sfx('next');
  dlg.i++; dlg.shown = 0;
  if (dlg.i < dlg.lines.length) { renderLine(); return; }
  ui.dialogue.hidden = true;
  game.mode = 'play';
  for (const n of NPC_LIST) n.dir = n.home;
  const cb = dlg.onEnd; dlg.onEnd = null;
  if (cb) cb();
}

function joinParty(id) {
  if (game.party.some(r => r.id === id)) return;
  game.party.push(newRecord(id, game.party[0].lv));
  (id === 'mira' ? npcs.florist : npcs.merchant).show(false);
  toast(`${MEMBERS[id].name}加入了隊伍`);
  audio.sfx('join');
  refreshHud();
}

const talks = {
  keeper() {
    const f = game.flags;
    if (f.finished) return say(S.keeperEnd);
    if (f.lit) return say(S.keeperCh2);
    if (!f.metKeeper) return say(S.keeperQuest, () => { f.metKeeper = true; refreshHud(); toast('新的目標：尋找星之碎片'); saveGame(); });
    if (game.found < 3) return say(S.keeperWaiting(3 - game.found));
    return say(S.keeperReturn, lightTheLighthouse);
  },
  fisher() {
    const f = game.flags;
    if (f.finished) return say(S.fisherEnd);
    if (f.lit) return say(S.fisherCh2);
    if (!f.metKeeper) return say(S.fisherBefore);
    return say(got('pier') ? S.fisherGot : S.fisherPier);
  },
  florist() {
    const f = game.flags;
    if (f.finished) return say(S.miraEnd);
    if (!f.metKeeper) return say(S.floristBefore);
    return say(S.floristJoin, () => { f.miraJoined = true; joinParty('mira'); saveGame(); });
  },
  merchant() {
    const f = game.flags;
    if (f.finished) return say(S.seinEnd);
    if (f.lit) return say(S.seinGate, () => { f.seinJoined = true; joinParty('sein'); refreshHud(); saveGame(); });
    if (!f.metKeeper) return say(S.merchantBefore);
    if (!f.merchantGift) return say(S.merchantGift, () => { f.merchantGift = true; game.items.herb += 2; toast('獲得 回復藥草 ×2'); saveGame(); });
    return say(got('field') ? S.merchantDone : S.merchantField);
  }
};

function rest(kind) {
  say({ well: S.restWell, camp: S.restCamp, statue: S.restStatue }[kind], () => {
    for (const r of game.party) { const s = memberStats(r.id, r.lv); r.hp = s.hp; r.sp = s.sp; }
    let back = 0;
    for (const id of [...game.defeated]) if (id.startsWith('w-')) { game.defeated.delete(id); back++; const s = symbolById(id); s.x = s.home[0]; s.z = s.home[1]; }
    game.grace = 2;
    refreshHud(); saveGame();
    audio.sfx('rest');
    toast(back ? '全員完全回復。附近的影獸又出現了' : '全員完全回復，進度已記錄');
  });
}
function openChest(c) {
  game.chests.add(c.id);
  for (const [k, n] of Object.entries(c.items)) game.items[k] = (game.items[k] || 0) + n;
  chestAnim.push({ c, t: 0 });
  audio.sfx('chest');
  toast('獲得 ' + Object.entries(c.items).map(([k, n]) => `${ITEMS[k].name} ×${n}`).join('、'));
  saveGame();
}
const chestAnim = [];

function interactables() {
  const list = [];
  for (const [id, a] of Object.entries(npcs)) if (!a.hidden) list.push({ id, x: a.x, z: a.z, actor: a, label: '對話' });
  list.push({ id: 'sign', x: 17.5, z: 12.6, label: '閱讀' });
  if (!game.flags.lit) list.push({ id: 'gate', x: 18.9, z: 0.9, label: '調查' });
  for (const [k, [x, z]] of Object.entries(REST)) list.push({ id: 'rest', kind: k, x, z, label: '休息' });
  for (const c of CHESTS) if (!game.chests.has(c.id)) list.push({ id: 'chest', chest: c, x: c.x, z: c.z, label: '打開' });
  return list;
}
function interact(it) {
  if (it.actor) { it.actor.face(player.x, player.z); player.face(it.x, it.z); }
  if (it.id === 'sign') return say(S.sign);
  if (it.id === 'gate') return say(S.gateClosed);
  if (it.id === 'rest') return rest(it.kind);
  if (it.id === 'chest') { player.face(it.x, it.z); return openChest(it.chest); }
  talks[it.id]();
}

// ---------- 轉場、章節標題 ----------
async function wipe(cover) {
  if (cover) { ui.wipe.classList.remove('out'); void ui.wipe.offsetWidth; ui.wipe.classList.add('in'); }
  else { ui.wipe.classList.add('out'); ui.wipe.classList.remove('in'); }
  await wait(reduceMotion ? 40 : 470);
  if (!cover) { ui.wipe.style.transition = 'none'; ui.wipe.classList.remove('out'); void ui.wipe.offsetWidth; ui.wipe.style.transition = ''; }
}
let chapterTimer;
async function chapterCard(n) {
  const c = CHAPTERS[n];
  $('chapter-no').textContent = c.no; $('chapter-title').textContent = c.title; $('chapter-sub').textContent = c.sub;
  ui.chapter.hidden = false; ui.chapter.style.animation = 'none'; void ui.chapter.offsetWidth; ui.chapter.style.animation = '';
  clearTimeout(chapterTimer); chapterTimer = setTimeout(() => { ui.chapter.hidden = true; }, 3400);
  audio.sfx('chapter');
  game.mode = 'cutscene';
  await wait(reduceMotion ? 1200 : 3000);
  game.mode = 'play';
  refreshHud();
}

// ---------- 遭遇與戰鬥 ----------
function contact(s) {
  if (s.before && !s.talked) { s.talked = true; return say(S[s.before], () => encounter(s)); }
  encounter(s);
}
async function encounter(s) {
  game.mode = 'battle'; keys.clear(); stick.x = stick.z = 0;
  ui.prompt.hidden = true;
  log('戰鬥開始', s.enc);
  audio.sfx('encounter');
  await wipe(true);
  ui.hud.hidden = true; ui.touch.hidden = true;
  const run = battleView.start({ encounter: s.enc, party: game.party, inventory: game.items, revealed: game.revealed, intro: s.intro });
  await wipe(false);
  const { result } = await run;
  log('戰鬥結束', s.enc, result);
  await wipe(true);
  battleView.close();
  ui.hud.hidden = false;
  if (document.body.classList.contains('touching')) ui.touch.hidden = false;
  game.grace = 1.6;
  if (result === 'win') game.defeated.add(s.id); else { s.stun = 4; s.talked = false; }
  refreshHud();
  await wipe(false);
  game.mode = 'play';
  if (result !== 'win') return;
  saveGame();
  if (s.id.startsWith('g-')) toast('影獸消散了，星之碎片就在前方');
  if (s.id === 'b-wolfKing') {
    world.setMist(true);
    say(S.wolfKingAfter, () => { game.flags.wolfKing = true; refreshHud(); toast('新的目標：前往星之古塔'); saveGame(); });
  }
  if (s.id === 'b-starEater') say(S.bossAfter, epilogue);
}

// ---------- 劇情演出 ----------
const cine = { t: 0, active: false };
let camOverride = null;
const LIGHTHOUSE_VIEW = new THREE.Vector3(31, 2.4, 25);
function lightTheLighthouse() {
  game.mode = 'cinematic'; cine.t = 0; cine.active = true;
  audio.sfx('lighthouse');
  camOverride = LIGHTHOUSE_VIEW;
  ui.hud.hidden = true;
}
function afterLit() {
  ui.hud.hidden = false;
  say(S.afterLit(!!game.flags.miraJoined), async () => {
    const f = game.flags;
    if (!f.miraJoined) { f.miraJoined = true; joinParty('mira'); }
    f.lit = true;
    camOverride = null;
    syncWorld();
    saveGame();
    await chapterCard(2);
    toast('新的目標：到北門和賽恩會合');
  });
}
async function epilogue() {
  game.mode = 'cinematic';
  await wipe(true);
  game.flags.finished = true;
  syncWorld();
  player.place(28.6, 24.2, 2);
  camOverride = LIGHTHOUSE_VIEW; camTarget.copy(LIGHTHOUSE_VIEW);
  ui.hud.hidden = true;
  saveGame();
  await wipe(false);
  await chapterCard(4);
  say(S.epilogue, () => { camOverride = null; showEnding(); });
}
function showEnding() {
  const s = Math.round(game.playTime), m = Math.floor(s / 60);
  ui.endTime.textContent = m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`;
  ui.endLevel.textContent = `Lv ${game.party[0].lv}`;
  ui.ending.hidden = false; ui.hud.hidden = true;
  game.mode = 'ended';
  $('end-continue').focus();
}

// 進入新區域時的劇情
function storyTriggers() {
  const f = game.flags;
  if (f.lit && !f.forestEntered && player.z < -1.6) { f.forestEntered = true; refreshHud(); return say(S.forest, saveGame); }
  if (f.forestEntered && !f.campTalk && Math.hypot(player.x - REST.camp[0], player.z - REST.camp[1]) < 2.8) { f.campTalk = true; return say(S.camp, () => rest('camp')); }
  if (f.wolfKing && !f.ruinsEntered && player.z < -21.7) {
    f.ruinsEntered = true;
    chapterCard(3).then(() => say(S.ruins, saveGame));
  }
}

// ---------- 輸入 ----------
const keys = new Set();
const stick = { x: 0, z: 0, id: null, ox: 0, oy: 0 };
const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
addEventListener('keydown', e => {
  if (ui.menu.open || ui.help.open || game.mode === 'battle') return;
  if (MOVE[e.code]) { keys.add(e.code); e.preventDefault(); }
  if (['Space', 'Enter', 'KeyE', 'KeyZ'].includes(e.code) && !e.repeat) {
    if (game.mode === 'dialogue' || game.mode === 'play') { e.preventDefault(); action(); }
  }
});
addEventListener('keyup', e => {
  keys.delete(e.code);
  // Esc 在放開時才開選單，避免同一個按鍵事件又把剛開的對話框關掉。
  if (e.code === 'Escape' && game.mode === 'play' && !ui.menu.open && !ui.help.open) openMenu();
});
addEventListener('blur', () => { keys.clear(); stick.x = stick.z = 0; });

function action() {
  if (game.mode === 'dialogue') return advance();
  if (game.mode === 'play' && nearest) interact(nearest);
}
ui.dialogue.addEventListener('click', () => { if (game.mode === 'dialogue') advance(); });
ui.act.addEventListener('click', e => { e.preventDefault(); action(); });

// 虛擬搖桿：左半邊任意位置按下即為中心
function showTouch() { if (!['title', 'loading', 'battle'].includes(game.mode)) ui.touch.hidden = false; document.body.classList.add('touching'); }
ui.stickZone.addEventListener('pointerdown', e => {
  stick.id = e.pointerId; stick.ox = e.clientX; stick.oy = e.clientY;
  try { ui.stickZone.setPointerCapture(e.pointerId); } catch { /* 少數瀏覽器不支援時，仍可靠 pointermove 操作 */ }
  ui.stick.style.transform = `translate(${e.clientX - 60}px, ${e.clientY - 60}px)`;
  ui.stick.classList.add('active');
});
ui.stickZone.addEventListener('pointermove', e => {
  if (e.pointerId !== stick.id) return;
  let dx = e.clientX - stick.ox, dy = e.clientY - stick.oy;
  const len = Math.hypot(dx, dy), max = 46;
  if (len > max) { dx *= max / len; dy *= max / len; }
  stick.x = Math.abs(dx) > 8 ? dx / max : 0; stick.z = Math.abs(dy) > 8 ? dy / max : 0;
  ui.stick.firstElementChild.style.transform = `translate(${dx}px, ${dy}px)`;
});
const endStick = e => {
  if (e.pointerId !== stick.id) return;
  stick.id = null; stick.x = stick.z = 0;
  ui.stick.classList.remove('active'); ui.stick.firstElementChild.style.transform = '';
};
ui.stickZone.addEventListener('pointerup', endStick);
ui.stickZone.addEventListener('pointercancel', endStick);
addEventListener('touchstart', showTouch, { once: true, passive: true });
if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touching');

// ---------- 選單 ----------
function openMenu() {
  if (game.mode !== 'play') return;
  game.mode = 'paused'; keys.clear();
  audio.sfx('open');
  renderMenuParty();
  ui.menu.showModal();
}
ui.menu.addEventListener('close', () => { if (game.mode === 'paused') game.mode = 'play'; });
$('menu-btn').addEventListener('click', openMenu);
$('resume').addEventListener('click', () => ui.menu.close());
$('menu-help').addEventListener('click', () => { ui.menu.close(); game.mode = 'paused'; ui.help.showModal(); });
ui.help.addEventListener('close', () => { if (game.mode === 'paused') game.mode = 'play'; });
$('title-help').addEventListener('click', () => ui.help.showModal());
document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
$('restart').addEventListener('click', () => location.reload());
ui.quality.addEventListener('change', () => { qualityLocked = true; savePref(ui.quality.value); applyQuality(ui.quality.value, '手動選擇'); });
ui.sound.value = audio.mode;
ui.sound.addEventListener('change', () => { audio.setMode(ui.sound.value); audio.sfx('confirm'); log('聲音', ui.sound.value); });
$('end-continue').addEventListener('click', () => { ui.ending.hidden = true; ui.hud.hidden = false; game.mode = 'play'; refreshHud(); });
// 會清掉存檔的按鈕要按兩次：第一次只改成確認文字
function confirmTwice(btn, text, run) {
  let armed = 0;
  const label = btn.textContent;
  btn.addEventListener('click', () => {
    if (Date.now() - armed < 4000) return run();
    armed = Date.now(); btn.textContent = text;
    setTimeout(() => { btn.textContent = label; armed = 0; }, 4000);
  });
}
confirmTwice($('end-restart'), '再按一次，清除進度並重新開始', () => { clearSave(); location.reload(); });

const saved = readSave();
if (saved) {
  ui.cont.hidden = false;
  ui.start.textContent = '新的冒險'; ui.start.classList.replace('primary', 'ghost');
  ui.cont.addEventListener('click', () => startGame(saved));
  confirmTwice(ui.start, '再按一次，清除進度', () => { clearSave(); startGame(null); });
} else ui.start.addEventListener('click', () => startGame(null));

function startGame(save) {
  audio.sfx('confirm');
  ui.title.hidden = true;
  ui.hud.hidden = false;
  if (document.body.classList.contains('touching')) ui.touch.hidden = false;
  game.mode = 'play';
  if (save) {
    applySave(save);
    game.grace = 2;
    refreshHud();
    camTarget.set(player.x, player.y + 0.6, player.z);
    toast(`歡迎回來。${CHAPTERS[chapter()].no}「${CHAPTERS[chapter()].title}」`);
    return;
  }
  syncWorld();
  refreshHud();
  camTarget.set(player.x, player.y + 0.6, player.z);
  say(S.intro, () => chapterCard(1));
}

// ---------- 主迴圈 ----------
const camTarget = new THREE.Vector3(20, 0.6, 16);
const tmp = new THREE.Vector3(), bufSize = new THREE.Vector2();
let nearest = null, elapsed = 0;
const R = 0.28;

function canStand(x, z) {
  const here = world.groundAt(player.x, player.z);
  for (const [ox, oz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
    if (world.isBlocked(x + ox, z + oz)) return false;
    if (Math.abs(world.groundAt(x + ox, z + oz) - here) > 0.56) return false;
  }
  return !NPC_LIST.some(n => !n.hidden && Math.hypot(n.x - x, n.z - z) < 0.62);
}

function updatePlayer(dt) {
  let ix = stick.x, iz = stick.z;
  for (const k of keys) { ix += MOVE[k][0]; iz += MOVE[k][1]; }
  const len = Math.hypot(ix, iz);
  player.moving = len > 0.1 && game.mode === 'play';
  if (player.moving) {
    ix /= Math.max(1, len); iz /= Math.max(1, len);
    const sp = 3.4 * dt;
    const nx = player.x + ix * sp, nz = player.z + iz * sp;
    if (canStand(nx, player.z)) player.x = nx;
    if (canStand(player.x, nz)) player.z = nz;
    player.dir = Math.abs(ix) > Math.abs(iz) ? (ix > 0 ? 2 : 3) : (iz > 0 ? 0 : 1);
  }
  player.sync(dt);
  if (game.mode !== 'play') { nearest = null; return; }
  game.grace = Math.max(0, game.grace - dt);

  for (const f of fragments) {
    if (f.got || Math.hypot(f.x - player.x, f.z - player.z) > 0.75 || Math.abs(f.base - player.y) > 0.6) continue;
    if (!game.defeated.has(f.guard)) { contact(symbolById(f.guard)); return; }
    f.got = true; f.g.visible = false; game.found++;
    burst.fire(f.x, f.base + 0.8, f.z);
    audio.sfx('fragment');
    refreshHud();
    toast(game.found < 3 ? `取得星之碎片（${game.found} / 3）` : '三顆星之碎片都找齊了！回去找守燈人吧');
    log('取得碎片', f.id, game.found);
    saveGame();
  }

  storyTriggers();
  if (game.mode !== 'play') return;

  nearest = null;
  let best = 1.45;
  for (const it of interactables()) {
    const d = Math.hypot(it.x - player.x, it.z - player.z);
    if (d < best) { best = d; nearest = it; }
  }
}

function symbolCanStand(s, x, z) {
  const here = world.groundAt(s.x, s.z);
  for (const [ox, oz] of [[-0.25, -0.25], [0.25, -0.25], [-0.25, 0.25], [0.25, 0.25]]) {
    if (world.isBlocked(x + ox, z + oz) || Math.abs(world.groundAt(x + ox, z + oz) - here) > 0.3) return false;
  }
  return true;
}
function updateSymbols(dt) {
  for (const s of SYMBOLS) {
    const alive = !game.defeated.has(s.id);
    s.mesh.visible = s.blob.visible = alive;
    if (!alive) continue;
    s.stun = Math.max(0, s.stun - dt);
    const d = Math.hypot(player.x - s.x, player.z - s.z);
    if (game.mode === 'play' && s.roam) {
      const homeD = Math.hypot(s.x - s.home[0], s.z - s.home[1]);
      let tx = s.wx, tz = s.wz, sp = 0.7;
      if (!s.stun && game.grace <= 0 && d < 3.6 && homeD < 5 && Math.abs(player.y - world.groundAt(s.x, s.z)) < 0.6) { tx = player.x; tz = player.z; sp = 1.9; }
      else if ((s.t -= dt) <= 0) {
        s.t = 1.5 + Math.random() * 2;
        const a = Math.random() * Math.PI * 2, r = Math.random() * 1.3;
        s.wx = s.home[0] + Math.cos(a) * r; s.wz = s.home[1] + Math.sin(a) * r;
      }
      const mx = tx - s.x, mz = tz - s.z, ml = Math.hypot(mx, mz);
      if (ml > 0.05) {
        const step = Math.min(ml, sp * dt), nx = s.x + mx / ml * step, nz = s.z + mz / ml * step;
        if (symbolCanStand(s, nx, s.z)) s.x = nx;
        if (symbolCanStand(s, s.x, nz)) s.z = nz;
        if (Math.abs(mx) > 0.05) s.face = mx > 0 ? 1 : -1;
      }
    }
    const y = world.groundAt(s.x, s.z);
    s.mesh.position.set(s.x, y + (s.boss ? 0.12 + Math.sin(elapsed * 1.6) * 0.1 : Math.abs(Math.sin(elapsed * 3 + s.home[0])) * 0.06), s.z);
    s.mesh.scale.x = s.face;
    s.blob.position.set(s.x, y + 0.02, s.z + 0.05);
    const reach = s.boss ? 2.8 : s.r + 0.3;
    if (game.mode === 'play' && game.grace <= 0 && !s.stun && d < reach && Math.abs(player.y - y) < 0.6) { contact(s); return; }
  }
}

function updatePrompt() {
  if (!nearest || game.mode !== 'play') { ui.prompt.hidden = true; ui.act.classList.remove('ready'); return; }
  tmp.set(nearest.x, world.groundAt(nearest.x, nearest.z) + 2.35, nearest.z).project(camera);
  ui.prompt.hidden = false;
  ui.prompt.style.transform = `translate(${(tmp.x * 0.5 + 0.5) * innerWidth}px, ${(-tmp.y * 0.5 + 0.5) * innerHeight}px) translate(-50%, -100%)`;
  ui.promptText.textContent = nearest.label;
  ui.promptKey.textContent = document.body.classList.contains('touching') ? '點「調查」' : '空白鍵';
  ui.act.classList.add('ready');
}

function updateCamera(dt, t) {
  if (game.mode === 'title' || game.mode === 'loading') {
    const s = reduceMotion ? 0 : t;
    camTarget.set(21 + Math.sin(s * 0.06) * 7, 0.6, 16 + Math.cos(s * 0.045) * 5);
  } else if (camOverride || game.mode === 'ended') {
    camTarget.lerp(camOverride || LIGHTHOUSE_VIEW, Math.min(1, dt * 1.5));
  } else {
    const zMin = game.flags.lit ? -30.5 : 5;
    tmp.set(Math.min(33, Math.max(7, player.x)), player.y + 0.6, Math.min(28.5, Math.max(zMin, player.z)));
    camTarget.lerp(tmp, Math.min(1, dt * 5));
  }
  camera.position.copy(camTarget).add(CAM_OFFSET);
  camera.lookAt(camTarget);
  camera.updateMatrixWorld();
  // 角色前方的樹木挖出透明圓，避免被林木遮住
  renderer.getDrawingBufferSize(bufSize);
  tmp.set(player.x, player.y + 0.75, player.z);
  const depth = -tmp.clone().applyMatrix4(camera.matrixWorldInverse).z;
  tmp.project(camera);
  const playing = !['title', 'loading', 'ended'].includes(game.mode) && !camOverride;
  world.setCutout((tmp.x * 0.5 + 0.5) * bufSize.x, (tmp.y * 0.5 + 0.5) * bufSize.y, depth, playing ? bufSize.y * 0.09 : 0);
}

function updateCinematic(dt) {
  if (!cine.active) return;
  cine.t += dt;
  const v = Math.min(1, Math.max(0, (cine.t - 1.2) / 2.5));
  world.lighthouse.setLit(v * v * (3 - 2 * v));
  if (cine.t > (reduceMotion ? 3.5 : 5.5)) { cine.active = false; game.mode = 'play'; afterLit(); }
}

// 自動畫質：遊玩中連續兩個 3 秒窗平均低於 28 FPS，改用流暢畫質。
const perf = { t: 0, frames: 0, slow: 0, warm: 0 };
function watchPerf(dt) {
  if (qualityLocked || quality !== 'high' || game.mode !== 'play' || document.hidden) return;
  perf.warm += dt; if (perf.warm < 3) return;
  perf.t += dt; perf.frames++;
  if (perf.t < 3) return;
  const fps = perf.frames / perf.t; perf.t = 0; perf.frames = 0;
  perf.slow = fps < 28 ? perf.slow + 1 : 0;
  game.fps = Math.round(fps);
  if (perf.slow >= 2) { applyQuality('balanced', `平均 ${Math.round(fps)} FPS`); toast('畫面較慢，已切換為流暢畫質'); }
}

// 依所在位置與遊戲狀態選配樂；戰鬥中由戰鬥畫面自己切換
function areaTrack() {
  const m = game.mode;
  if (m === 'loading') return null;
  if (m === 'title' || m === 'ended') return 'title';
  if (cine.active) return null; // 點燈演出時讓位給點燈的音效
  if (player.z < -21.5) return 'ruins';
  if (player.z < -1) return 'forest';
  return game.flags.finished ? 'title' : 'town';
}

const timer = new THREE.Timer();
let firstFrame = true, frames = 0;
function frame(now) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  renderer.info.reset();
  frames++;
  elapsed += dt;
  if (battleView.active) {
    battleView.update(dt);
    battleView.render(quality === 'high', elapsed);
    requestAnimationFrame(frame);
    return;
  }
  audio.music(areaTrack());
  if (game.mode !== 'paused') {
    if (['play', 'dialogue', 'cutscene'].includes(game.mode)) game.playTime += dt;
    updatePlayer(dt);
    for (const n of NPC_LIST) { n.moving = false; n.sync(dt); }
    updateSymbols(dt);
    for (const f of fragments) { if (f.got) continue; f.g.position.y = f.base + 0.7 + Math.sin(elapsed * 2 + f.x) * 0.12; f.core.rotation.y += dt * 1.6; }
    for (let i = chestAnim.length - 1; i >= 0; i--) { const a = chestAnim[i]; a.t = Math.min(1, a.t + dt * 2.5); a.c.lid.rotation.x = -1.9 * (1 - Math.pow(1 - a.t, 3)); if (a.t >= 1) chestAnim.splice(i, 1); }
    if (game.mode === 'dialogue') {
      const l = dlg.lines[dlg.i];
      if (dlg.shown < l.t.length) {
        const before = Math.floor(dlg.shown);
        dlg.shown = Math.min(l.t.length, dlg.shown + dt * 38); renderLine();
        if (Math.floor(dlg.shown) > before && l.t[before].trim()) audio.sfx('text');
      }
    }
    updateCinematic(dt);
    burst.update(dt);
    world.update(dt, camTarget);
    watchPerf(dt);
  }
  updateCamera(dt, elapsed);
  updatePrompt();
  if (quality === 'high') {
    tmp.set(player.x, player.y + 0.7, player.z).project(camera);
    const focusY = ['title', 'loading', 'cinematic', 'ended'].includes(game.mode) || camOverride ? 0.5 : Math.min(0.75, Math.max(0.25, tmp.y * 0.5 + 0.5));
    post.render(scene, camera, { focusY, blur: Math.min(14, Math.max(4, post.h / 110)), bloom: 0.9, exposure: 1.05, time: elapsed, fade: 1 });
  } else {
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);
  }
  if (firstFrame) {
    firstFrame = false;
    ui.loading.classList.add('done');
    setTimeout(() => { ui.loading.hidden = true; }, 600);
    game.mode = 'title'; ui.title.hidden = false;
    (saved ? ui.cont : ui.start).focus();
    log('第一幀完成', renderer.info.render);
  }
  requestAnimationFrame(frame);
}

renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  ui.error.hidden = false;
  ui.error.querySelector('p').textContent = '顯示卡暫時中斷了畫面。請重新整理頁面再試一次。';
});

applyQuality(quality, qualityLocked ? '已儲存的偏好' : '預設');
syncWorld();
refreshHud();
requestAnimationFrame(frame);

// 自動化測試用：讀取狀態、瞬間移動、自動戰鬥（不影響一般遊玩）。
window.__hd2d = {
  state: () => ({
    mode: game.mode, chapter: chapter(), flags: { ...game.flags }, found: game.found, quality, fps: game.fps ?? null,
    player: { x: +player.x.toFixed(2), z: +player.z.toFixed(2), y: +player.y.toFixed(2), dir: player.dir }, nearest: nearest?.id === 'rest' ? 'rest-' + nearest.kind : nearest?.id ?? null,
    lit: world.lighthouse.lit, calls: renderer.info.render.calls, frames, playTime: +game.playTime.toFixed(2),
    party: game.party.map(r => ({ id: r.id, lv: r.lv, exp: r.exp, hp: r.hp, sp: r.sp, maxHp: memberStats(r.id, r.lv).hp })), items: { ...game.items }, defeated: [...game.defeated], chests: [...game.chests],
    battle: battleView.state(), audio: audio.state()
  }),
  teleport(x, z) { player.x = x; player.z = z; player.y = world.groundAt(x, z); },
  battleAuto(v = true) { battleView.auto = v; },
  battleSpeed(v = 1) { battleView.timeScale = v; },
  setLevel(lv) { for (const r of game.party) { const s = memberStats(r.id, lv); Object.assign(r, { lv, exp: 0, hp: s.hp, sp: s.sp }); } refreshHud(); },
  blocked: (x, z) => world.isBlocked(x, z),
  ground: (x, z) => world.groundAt(x, z),
  places: () => ({ symbols: SYMBOLS.map(s => ({ id: s.id, x: s.home[0], z: s.home[1] })), chests: CHESTS.map(c => ({ id: c.id, x: c.x, z: c.z })), rest: REST })
};
