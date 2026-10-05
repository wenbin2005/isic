// 星燈港：遊戲主程式（狀態、輸入、角色、對話、任務、鏡頭與畫質）。
import * as THREE from 'three';
import { createWorld, SPRITE_TILT } from './world.js';
import { PALETTES, makeCharacterTexture, setFrame } from './pixel.js';
import { HD2DPost } from './post.js';

const $ = id => document.getElementById(id);
const ui = {
  canvas: $('game'), loading: $('loading'), title: $('title'), hud: $('hud'), objective: $('objective-text'), gems: $('gems'),
  prompt: $('prompt'), promptKey: $('prompt-key'), promptText: $('prompt-text'), dialogue: $('dialogue'), speaker: $('speaker'),
  text: $('dialogue-text'), toast: $('toast'), touch: $('touch'), stickZone: $('stick-zone'), stick: $('stick'), act: $('act-btn'),
  menu: $('menu'), help: $('help'), ending: $('ending'), endTime: $('end-time'), error: $('error'), quality: $('quality-select')
};
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const log = (...a) => console.info('[星燈港]', ...a);

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
    this.x = x; this.z = z; this.y = world.groundAt(x, z); this.dir = dir; this.anim = 0; this.moving = false;
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
}

const player = new Actor(PALETTES.hero, 18, 20.5, 1);
const npcs = {
  keeper: Object.assign(new Actor(PALETTES.keeper, 30.5, 24.6, 0), { name: '守燈人・葛倫', home: 0 }),
  fisher: Object.assign(new Actor(PALETTES.fisher, 18.5, 28.5, 0), { name: '漁夫・巴特', home: 0 }),
  florist: Object.assign(new Actor(PALETTES.florist, 30.4, 10.6, 0), { name: '花店的米菈', home: 0 }),
  merchant: Object.assign(new Actor(PALETTES.merchant, 22.2, 15.6, 3), { name: '旅行商人・賽恩', home: 3 })
};
for (const n of Object.values(npcs)) n.home = n.dir;

// ---------- 星之碎片 ----------
const fragments = [
  { id: 'shrine', x: 7.0, z: 4.4 },
  { id: 'pier', x: 17.5, z: 31.0 },
  { id: 'field', x: 32.5, z: 4.5 }
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

// ---------- 遊戲狀態 ----------
const game = { mode: 'loading', quest: 0, found: 0, playTime: 0, ended: false };
// quest：0 尚未見守燈人、1 尋找碎片、2 燈塔已點亮

function objectiveText() {
  if (game.quest === 0) return '前往東南方的燈塔，和守燈人談談';
  if (game.quest === 1 && game.found < 3) return `尋找散落的星之碎片（${game.found} / 3）`;
  if (game.quest === 1) return '把三顆星之碎片交給守燈人';
  return '燈塔已點亮，在星燈港自由漫步';
}
function refreshHud() {
  ui.objective.textContent = objectiveText();
  [...ui.gems.children].forEach((g, i) => g.classList.toggle('on', i < game.found));
  ui.gems.setAttribute('aria-label', `星之碎片 ${game.found} / 3`);
}

let toastTimer;
function toast(msg) {
  ui.toast.textContent = msg; ui.toast.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => ui.toast.classList.remove('show'), 2600);
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
  dlg.i++; dlg.shown = 0;
  if (dlg.i < dlg.lines.length) { renderLine(); return; }
  ui.dialogue.hidden = true;
  game.mode = 'play';
  for (const n of Object.values(npcs)) n.dir = n.home;
  const cb = dlg.onEnd; dlg.onEnd = null;
  if (cb) cb();
}

const got = id => fragments.find(f => f.id === id).got;
const talks = {
  keeper() {
    const k = npcs.keeper.name;
    if (game.quest === 0) return say([
      { n: k, t: '旅人啊，你也注意到了吧。燈塔的星燈熄了。' },
      { n: k, t: '昨夜一陣怪風，把燈芯裡的三顆星之碎片吹散到鎮上。' },
      { n: k, t: '我這把老骨頭走不遠了。能請你替我找回來嗎？' },
      { n: k, t: '鎮上的人或許看見碎片落在哪裡，去問問他們吧。' }
    ], () => { game.quest = 1; refreshHud(); toast('新的目標：尋找星之碎片'); });
    if (game.quest === 1 && game.found < 3) return say([{ n: k, t: `還差 ${3 - game.found} 顆。別急，星光會等你的。` }]);
    if (game.quest === 1) return say([
      { n: k, t: '這光芒……沒錯，是星之碎片！三顆都在。' },
      { n: k, t: '讓我把它們放回燈芯。退後一點，旅人。' }
    ], lightTheLighthouse);
    return say([{ n: k, t: '今晚的海面，因為你而明亮。謝謝你，旅人。' }]);
  },
  fisher() {
    const n = npcs.fisher.name;
    if (game.quest === 2) return say([{ n, t: '燈塔亮了！明天一早就能出海了。' }]);
    if (game.quest === 0) return say([{ n, t: '燈塔不亮，船都不敢靠岸。去燈塔下找守燈人聊聊吧。' }]);
    if (!got('pier')) return say([{ n, t: '昨晚我看見一道光，咻地掉在棧橋最前端。' }, { n, t: '我……其實怕水。你能去看看嗎？' }]);
    return say([{ n, t: '就是它！哈，看來我的眼睛還沒老花。' }]);
  },
  florist() {
    const n = npcs.florist.name;
    if (game.quest === 2) return say([{ n, t: '燈光照著花田，好漂亮。今晚會做好夢吧。' }]);
    if (game.quest === 0) return say([{ n, t: '晚安！燈塔不亮，連花兒都有點不安呢。' }]);
    if (!got('shrine')) return say([{ n, t: '北邊高台上的老神社，昨晚有東西在發光喔。' }, { n, t: '從廣場往西走，有一段石階可以上去。' }]);
    return say([{ n, t: '你上去神社啦？那裡的螢火蟲最多了。' }]);
  },
  merchant() {
    const n = npcs.merchant.name;
    if (game.quest === 2) return say([{ n, t: '好一座燈塔。這一趟沒有白來。' }]);
    if (game.quest === 0) return say([{ n, t: '嗨，旅人。我是四處流浪的商人。燈塔沒亮，生意也冷清。' }]);
    if (!got('field')) return say([{ n, t: '我穿過花田時，看見灌木叢之間有東西一閃一閃。' }, { n, t: '花田的入口在柵欄東側的缺口。' }]);
    return say([{ n, t: '找到了？了不起。哪天你也想流浪，記得來找我。' }]);
  },
  sign() {
    return say([{ n: '告示牌', t: '星燈港。北：老神社（西側石階）。東北：花田。南：棧橋。東南：燈塔。' }]);
  }
};
const interactables = [
  ...Object.entries(npcs).map(([id, a]) => ({ id, get x() { return a.x; }, get z() { return a.z; }, actor: a, label: '對話' })),
  { id: 'sign', x: 17.5, z: 12.6, label: '閱讀' }
];

// ---------- 結局 ----------
const cine = { t: 0, active: false };
function lightTheLighthouse() {
  game.quest = 2; refreshHud();
  game.mode = 'cinematic'; cine.t = 0; cine.active = true;
  ui.hud.hidden = true;
}
function showEnding() {
  const s = Math.round(game.playTime), m = Math.floor(s / 60);
  ui.endTime.textContent = m ? `${m} 分 ${s % 60} 秒` : `${s} 秒`;
  ui.ending.hidden = false;
  game.mode = 'ended';
  $('end-continue').focus();
}

// ---------- 輸入 ----------
const keys = new Set();
const stick = { x: 0, z: 0, id: null, ox: 0, oy: 0 };
const MOVE = { KeyW: [0, -1], ArrowUp: [0, -1], KeyS: [0, 1], ArrowDown: [0, 1], KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0] };
addEventListener('keydown', e => {
  if (ui.menu.open || ui.help.open) return;
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
  if (game.mode === 'play' && nearest) {
    if (nearest.actor) { nearest.actor.face(player.x, player.z); player.face(nearest.x, nearest.z); }
    talks[nearest.id]();
  }
}
ui.dialogue.addEventListener('click', () => { if (game.mode === 'dialogue') advance(); });
ui.act.addEventListener('click', e => { e.preventDefault(); action(); });

// 虛擬搖桿：左半邊任意位置按下即為中心
function showTouch() { if (game.mode !== 'title' && game.mode !== 'loading') ui.touch.hidden = false; document.body.classList.add('touching'); }
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
$('end-continue').addEventListener('click', () => { ui.ending.hidden = true; ui.hud.hidden = false; game.mode = 'play'; refreshHud(); });
$('end-restart').addEventListener('click', () => location.reload());
$('start').addEventListener('click', startGame);

function startGame() {
  ui.title.hidden = true;
  ui.hud.hidden = false;
  if (document.body.classList.contains('touching')) ui.touch.hidden = false;
  game.mode = 'play';
  refreshHud();
  camTarget.set(player.x, player.y + 0.6, player.z);
  say([
    { t: '黃昏時分，你抵達海邊的小鎮「星燈港」。' },
    { t: '傳說這座港口的燈塔，是用天上落下的星光點亮的。' },
    { t: '可是今晚，燈塔一片漆黑。去東南方的燈塔看看吧。' }
  ]);
}

// ---------- 主迴圈 ----------
const camTarget = new THREE.Vector3(20, 0.6, 16);
const tmp = new THREE.Vector3();
let nearest = null;
const R = 0.28;
const NPC_LIST = Object.values(npcs);

function canStand(x, z) {
  const here = world.groundAt(player.x, player.z);
  for (const [ox, oz] of [[-R, -R], [R, -R], [-R, R], [R, R]]) {
    if (world.isBlocked(x + ox, z + oz)) return false;
    if (Math.abs(world.groundAt(x + ox, z + oz) - here) > 0.56) return false;
  }
  return !NPC_LIST.some(n => Math.hypot(n.x - x, n.z - z) < 0.62);
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

  for (const f of fragments) {
    if (f.got) continue;
    if (Math.hypot(f.x - player.x, f.z - player.z) < 0.75 && Math.abs(f.base - player.y) < 0.6) {
      f.got = true; f.g.visible = false; game.found++;
      burst.fire(f.x, f.base + 0.8, f.z);
      refreshHud();
      toast(game.found < 3 ? `取得星之碎片（${game.found} / 3）` : '三顆星之碎片都找齊了！回去找守燈人吧');
      log('取得碎片', f.id, game.found);
    }
  }

  nearest = null;
  if (game.mode === 'play') {
    let best = 1.45;
    for (const it of interactables) {
      const d = Math.hypot(it.x - player.x, it.z - player.z);
      if (d < best) { best = d; nearest = it; }
    }
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
  } else if (game.mode === 'cinematic' || game.mode === 'ended') {
    tmp.set(31, 2.4, 25);
    camTarget.lerp(tmp, Math.min(1, dt * 1.5));
  } else {
    tmp.set(Math.min(33, Math.max(7, player.x)), player.y + 0.6, Math.min(28.5, Math.max(5, player.z)));
    camTarget.lerp(tmp, Math.min(1, dt * 5));
  }
  camera.position.copy(camTarget).add(CAM_OFFSET);
  camera.lookAt(camTarget);
}

function updateCinematic(dt) {
  if (!cine.active) return;
  cine.t += dt;
  const v = Math.min(1, Math.max(0, (cine.t - 1.2) / 2.5));
  world.lighthouse.setLit(v * v * (3 - 2 * v));
  if (cine.t > (reduceMotion ? 3.5 : 6)) { cine.active = false; showEnding(); }
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

const timer = new THREE.Timer();
let elapsed = 0, firstFrame = true, frames = 0;
function frame(now) {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.1);
  renderer.info.reset();
  frames++;
  elapsed += dt;
  if (game.mode !== 'paused') {
    if (game.mode === 'play') game.playTime += dt;
    updatePlayer(dt);
    for (const n of NPC_LIST) { n.moving = false; n.sync(dt); }
    for (const f of fragments) { if (f.got) continue; f.g.position.y = f.base + 0.7 + Math.sin(elapsed * 2 + f.x) * 0.12; f.core.rotation.y += dt * 1.6; }
    if (game.mode === 'dialogue') {
      const l = dlg.lines[dlg.i];
      if (dlg.shown < l.t.length) { dlg.shown = Math.min(l.t.length, dlg.shown + dt * 38); renderLine(); }
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
    const focusY = ['title', 'loading', 'cinematic', 'ended'].includes(game.mode) ? 0.5 : Math.min(0.75, Math.max(0.25, tmp.y * 0.5 + 0.5));
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
    $('start').focus();
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
refreshHud();
requestAnimationFrame(frame);

// 自動化測試用：讀取狀態與瞬間移動（不影響一般遊玩）。
window.__hd2d = {
  state: () => ({ mode: game.mode, quest: game.quest, found: game.found, quality, fps: game.fps ?? null, player: { x: +player.x.toFixed(2), z: +player.z.toFixed(2), y: +player.y.toFixed(2), dir: player.dir }, nearest: nearest?.id ?? null, lit: world.lighthouse.lit, calls: renderer.info.render.calls, frames, playTime: +game.playTime.toFixed(2) }),
  teleport(x, z) { player.x = x; player.z = z; player.y = world.groundAt(x, z); }
};
