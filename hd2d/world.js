// 星燈港的地圖、地形與場景物件。地圖以格子定義：1 格 = 1 公尺 = 16 像素。
import * as THREE from 'three';
import { makeTileTextures, makeSpriteTextures, rng } from './pixel.js';

// 地圖：x 0..W-1；z 從 ZMIN 到 H-1。z ≥ 0 是星燈港，z < 0 是北方的霧之森（-1..-21）與星之古塔（-22 以北）。
// 列以物件存放（T[z][x]），所以負的 z 也能直接當索引。
export const W = 40, H = 32, ZMIN = -36;
export const SPRITE_TILT = -0.35; // 精靈板向後傾，抵銷俯視造成的縮短感
const WATER_Y = -0.55;

const TOP = { grass: 'grassTop', flower: 'flowerTop', path: 'pathTop', plaza: 'plazaTop', sand: 'sandTop', rock: 'rockTop', plank: 'plankTop', stairs: 'plazaTop', high: 'grassTop', forest: 'forestTop', wood: 'forestTop', ruin: 'ruinTop', dais: 'ruinTop' };
const SIDE = { grass: 'grassSide', flower: 'grassSide', path: 'grassSide', plaza: 'stone', sand: 'sandSide', rock: 'rockSide', plank: 'plankSide', stairs: 'stone', high: 'grassSide', forest: 'grassSide', wood: 'grassSide', ruin: 'stone', dais: 'stone' };
const BASE_H = { grass: 0, flower: 0, path: 0, plaza: 0.08, sand: -0.22, rock: 0.5, plank: 0, stairs: 0.5, high: 1.0, forest: 0, wood: 0, ruin: 0.08, dais: 0.5 };

// 各區域的氣氛：霧色、霧距、天光與夕陽強度
const AREA = {
  town: { fog: '#2b2a45', near: 24, far: 52, bg: '#25243d', hemi: 1.15, sun: 1.9, sunColor: '#ffb27a' },
  forest: { fog: '#2a3a40', near: 13, far: 34, bg: '#1c282c', hemi: 1.3, sun: 1.35, sunColor: '#d8e0c0' },
  forestClear: { fog: '#2a3442', near: 18, far: 44, bg: '#1e2833', hemi: 1.35, sun: 1.6, sunColor: '#f0d8b0' },
  ruins: { fog: '#211c38', near: 17, far: 44, bg: '#151229', hemi: 0.95, sun: 1.15, sunColor: '#c0c4ff' }
};

// ---------- 地圖 ----------
function buildMap() {
  const T = {}, block = {};
  for (let z = ZMIN; z < H; z++) { T[z] = Array(W).fill('grass'); block[z] = Array(W).fill(false); }
  const rect = (x0, z0, x1, z1, t) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) T[z][x] = t; };
  const coastZ = x => 26 + Math.round(Math.sin(x * 0.7) * 0.8);
  const coastX = z => 36 + Math.round(Math.sin(z * 0.9) * 0.8);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    if (z >= coastZ(x) || x >= coastX(z)) T[z][x] = 'water';
    else if (z === coastZ(x) - 1 || x === coastX(z) - 1) T[z][x] = 'sand';
  }
  rect(26, 2, 33, 8, 'flower');
  rect(2, 2, 12, 8, 'high');
  T[9][7] = 'stairs';
  rect(16, 12, 23, 17, 'plaza');
  rect(7, 10, 7, 13, 'path'); rect(8, 13, 15, 13, 'path');
  rect(14, 8, 14, 13, 'path'); rect(21, 8, 21, 11, 'path'); rect(26, 14, 26, 15, 'path');
  rect(17, 18, 18, 24, 'path');
  rect(24, 16, 31, 16, 'path'); rect(29, 17, 30, 20, 'path'); rect(31, 10, 31, 15, 'path');
  rect(10, 19, 16, 19, 'path');
  rect(18, 0, 19, 11, 'path'); // 廣場往北門
  for (let z = 21; z < H; z++) for (let x = 29; x <= 35; x++) {
    const inside = z < 26 ? (x >= 29 && x <= 34) : (x >= 30 && x <= 34 && z <= 29);
    if (inside) T[z][x] = 'rock';
  }
  for (let z = coastZ(17) - 1; z < H; z++) { T[z][17] = 'plank'; T[z][18] = 'plank'; }

  // 北方：先全部種滿林木，再挖出步道、營地、溪流與遺跡
  rect(0, ZMIN, W - 1, -1, 'wood');
  rect(15, -5, 22, -1, 'forest');   // 森林入口
  rect(9, -9, 15, -6, 'forest');    // 往營地
  rect(7, -12, 14, -6, 'forest');   // 營地空地
  rect(18, -11, 22, -5, 'forest');  // 中段
  rect(22, -12, 29, -9, 'forest');  // 往東
  rect(29, -11, 35, -9, 'forest');  // 東側盡頭
  rect(24, -13, 29, -12, 'forest'); // 溪邊
  rect(1, -15, 38, -14, 'water');   // 溪流
  rect(26, -15, 27, -14, 'plank');  // 木橋
  rect(22, -19, 31, -16, 'forest'); // 北岸
  rect(14, -20, 23, -17, 'forest'); // 蘑菇林
  rect(16, -21, 21, -21, 'forest'); // 遺跡入口（霧牆）
  rect(18, -11, 19, -1, 'path'); rect(12, -8, 17, -7, 'path'); rect(20, -11, 26, -10, 'path');
  rect(26, -13, 27, -11, 'path'); rect(26, -18, 27, -16, 'path'); rect(18, -19, 25, -18, 'path'); rect(18, -21, 19, -19, 'path');
  rect(8, -33, 29, -22, 'ruin');
  rect(14, -32, 22, -29, 'dais');

  for (let z = ZMIN; z < H; z++) for (let x = 0; x < W; x++) {
    if (T[z][x] === 'water' || T[z][x] === 'wood' || x === 0 || z === ZMIN || (z === 0 && x !== 18 && x !== 19)) block[z][x] = true;
  }
  return { T, block, coastZ };
}

// ---------- 幾何工具 ----------
class GeoBuilder {
  constructor() { this.groups = new Map(); }
  get(key) {
    if (!this.groups.has(key)) this.groups.set(key, { p: [], n: [], uv: [], i: [] });
    return this.groups.get(key);
  }
  quad(key, a, b, c, d, n, uvs) {
    const g = this.get(key), base = g.p.length / 3;
    for (const v of [a, b, c, d]) g.p.push(...v);
    for (let k = 0; k < 4; k++) g.n.push(...n);
    g.uv.push(...uvs);
    g.i.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  meshes(mats) {
    const out = [];
    for (const [key, g] of this.groups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(g.p, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.n, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(g.uv, 2));
      geo.setIndex(g.i);
      const m = new THREE.Mesh(geo, mats[key]);
      m.receiveShadow = true; m.castShadow = true;
      out.push(m);
    }
    return out;
  }
}

// 每一面 UV 以公尺計，貼圖就會以一致的像素密度重複。
function worldBox(w, h, d) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0], uv.getY(i) * dims[f][1]);
  }
  return g;
}

// 山牆屋頂：沿 x 軸延伸的三角柱，前後兩片斜面＋兩側山牆。
function gableRoof(w, d, rise, roofMat, gableMat) {
  const hw = w / 2, hd = d / 2, slope = Math.hypot(hd, rise);
  const roofGeo = new THREE.BufferGeometry();
  const p = [-hw, 0, hd, hw, 0, hd, hw, rise, 0, -hw, rise, 0, hw, 0, -hd, -hw, 0, -hd, -hw, rise, 0, hw, rise, 0];
  const uv = [0, 0, w, 0, w, slope, 0, slope, 0, 0, w, 0, w, slope, 0, slope];
  roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  roofGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  roofGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  roofGeo.computeVertexNormals();
  const gableGeo = new THREE.BufferGeometry();
  const gw = hw - 0.2, gd = hd - 0.25, gr = rise * gd / hd;
  gableGeo.setAttribute('position', new THREE.Float32BufferAttribute([gw, 0, gd, gw, 0, -gd, gw, gr, 0, -gw, 0, -gd, -gw, 0, gd, -gw, gr, 0], 3));
  gableGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, d, 0, d / 2, rise, 0, 0, d, 0, d / 2, rise], 2));
  gableGeo.computeVertexNormals();
  const g = new THREE.Group();
  const r = new THREE.Mesh(roofGeo, roofMat), gb = new THREE.Mesh(gableGeo, gableMat);
  r.castShadow = r.receiveShadow = gb.castShadow = gb.receiveShadow = true;
  g.add(r, gb);
  return g;
}

function hdr(r, g, b) { return new THREE.Color().setRGB(r, g, b); }

// ---------- 建立世界 ----------
export function createWorld(quality) {
  const scene = new THREE.Scene();
  const tex = makeTileTextures();
  const spr = makeSpriteTextures();
  const map = buildMap();
  const { T, block } = map;
  const R = rng(4242);
  const heightOf = (x, z) => {
    if (x < 0 || z < ZMIN || x >= W || z >= H) return 0;
    const t = T[z][x];
    return t === 'water' ? WATER_Y - 0.35 : BASE_H[t];
  };

  scene.background = new THREE.Color('#25243d');
  scene.fog = new THREE.Fog('#2b2a45', 24, 52);

  // 光線：黃昏的冷色天光＋低角度暖色夕陽
  const hemi = new THREE.HemisphereLight('#8a82c4', '#3a2c2a', 1.15);
  const sun = new THREE.DirectionalLight('#ffb27a', 1.9);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -17, right: 17, top: 17, bottom: -17, near: 1, far: 60 });
  sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.03; sun.shadow.radius = 2;
  scene.add(hemi, sun, sun.target);

  // 地形：每格一個頂面；鄰格較低時補上側面，形成立體透視模型般的斷面。
  const gb = new GeoBuilder();
  for (let z = ZMIN; z < H; z++) for (let x = 0; x < W; x++) {
    const t = T[z][x];
    if (t === 'water') continue;
    const h = BASE_H[t];
    gb.quad(TOP[t], [x, h, z + 1], [x + 1, h, z + 1], [x + 1, h, z], [x, h, z], [0, 1, 0], [x, -z - 1, x + 1, -z - 1, x + 1, -z, x, -z]);
    const sides = [[0, 1, [x, z + 1], [x + 1, z + 1], [0, 0, 1]], [0, -1, [x + 1, z], [x, z], [0, 0, -1]], [1, 0, [x + 1, z + 1], [x + 1, z], [1, 0, 0]], [-1, 0, [x, z], [x, z + 1], [-1, 0, 0]]];
    for (const [dx, dz, a, b, n] of sides) {
      let nh = heightOf(x + dx, z + dz);
      if (t === 'plank') nh = Math.max(nh, -0.25);
      if (nh >= h - 0.001) continue;
      if (t === 'plank' && T[z + dz]?.[x + dx] === 'plank') continue;
      gb.quad(SIDE[t], [a[0], nh, a[1]], [b[0], nh, b[1]], [b[0], h, b[1]], [a[0], h, a[1]], n, [0, 1 - (h - nh), 1, 1 - (h - nh), 1, 1, 0, 1]);
    }
  }
  const terrainMats = {};
  for (const k of new Set([...Object.values(TOP), ...Object.values(SIDE)])) terrainMats[k] = new THREE.MeshLambertMaterial({ map: tex[k] });
  const terrain = new THREE.Group();
  terrain.add(...gb.meshes(terrainMats));
  scene.add(terrain);

  // 地圖外的林地與海面：三片地面圍住地圖（西側、北方、東北），地圖範圍內不鋪，溪流才看得到水面。
  const outerMat = new THREE.MeshLambertMaterial({ color: '#8a9a80' });
  for (const [w, d, cx, cz] of [[70, 150, -35, -15], [100, 55, 45, -63.5], [50, 36, 65, -18]]) {
    const t = tex.grassTop.clone(); t.repeat.set(w, d); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), outerMat.clone()); m.material.map = t;
    m.rotation.x = -Math.PI / 2; m.position.set(cx, -0.005, cz); m.receiveShadow = true;
    scene.add(m);
  }
  const waterTex = tex.water; waterTex.repeat.set(90, 90);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), new THREE.MeshStandardMaterial({ map: waterTex, roughness: 0.28, metalness: 0.05, color: '#b8d4e8' }));
  water.rotation.x = -Math.PI / 2; water.position.set(20, WATER_Y, 16); water.receiveShadow = true;
  scene.add(water);

  // ---------- 精靈板（樹、灌木、草） ----------
  const spriteGeo = (w, h) => { const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0); g.rotateX(SPRITE_TILT); return g; };
  const spriteMats = {};
  for (const k in spr) {
    spriteMats[k] = new THREE.MeshLambertMaterial({ map: spr[k], alphaTest: 0.5, side: THREE.DoubleSide });
    spriteMats[k].userData.depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: spr[k], alphaTest: 0.5 });
  }
  const placed = { tree: [], tree2: [], pine: [], bush: [], tuft: [], mushroom: [] };
  const plant = (kind, x, z, blocking = true, s = 1) => {
    placed[kind].push([x, z, s]);
    if (blocking) block[Math.floor(z)][Math.floor(x)] = true;
  };
  const gate = x => x >= 17 && x <= 20;
  // 北側與西側林帶（北門前留出通道）
  for (let x = 0; x < 36; x++) {
    const s1 = 1 + R() * 0.25; if (!gate(x)) plant('pine', x + 0.5, 0.6, false, s1);
    if (R() > 0.45) { const s2 = 0.9 + R() * 0.2; if (!(x >= 16 && x <= 21)) plant('pine', x + 0.5, 1.5, true, s2); }
  }
  for (let z = 2; z < 25; z++) { plant('pine', 0.6, z + 0.5, false, 1 + R() * 0.25); if (R() > 0.5 && T[z][1] === 'grass') plant('pine', 1.5, z + 0.5, true, 0.95); }
  for (let i = 0; i < 40; i++) { const x = -16 + R() * 15.5, z = R() * 26; plant('pine', x, z, false, 1 + R() * 0.4); }
  // 北方的林木：每個 wood 格一棵，另在地圖外圍種上遠景林
  // 步道南側（鏡頭這一側）的林木改成灌木與矮樹，免得整片松樹擋住視線
  const walk = (x, z) => T[z]?.[x] && T[z][x] !== 'wood' && T[z][x] !== 'water';
  for (let z = ZMIN; z < 0; z++) for (let x = 0; x < W; x++) {
    if (T[z][x] !== 'wood') continue;
    const open = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => walk(x + dx, z + dz));
    const front = walk(x, z - 1) || walk(x, z - 2) || walk(x - 1, z - 1) || walk(x + 1, z - 1);
    if (front) {
      plant('bush', x + 0.5, z + 0.6, true, 1.1 + R() * 0.3);
      if (R() > 0.75) plant('pine', x + 0.3 + R() * 0.4, z + 0.5 + R() * 0.3, false, 0.6 + R() * 0.15);
    } else if (open || R() > 0.25) plant('pine', x + 0.3 + R() * 0.4, z + 0.3 + R() * 0.4, true, 0.95 + R() * 0.35);
  }
  for (let i = 0; i < 70; i++) plant('pine', -16 + R() * 15.5, -38 + R() * 38, false, 1 + R() * 0.4);
  for (let i = 0; i < 60; i++) plant('pine', 40.5 + R() * 14, -36 + R() * 35, false, 1 + R() * 0.4);
  for (let i = 0; i < 90; i++) plant('pine', -16 + R() * 72, -48 + R() * 11.5, false, 1.1 + R() * 0.4);
  const trees = [[3, 12], [4, 18], [2, 22], [9, 22], [13, 24], [24, 21], [22, 23], [33, 12], [26, 19], [11, 20], [3, 15], [6, 23], [34, 15], [31, 10], [24, 3], [3.5, 3.5], [10.5, 3], [11, 7], [3, 7.5], [5, 20.5], [14.5, 20.5]];
  trees.forEach(([x, z], i) => plant(i % 2 ? 'tree2' : 'tree', x + 0.5, z + 0.5, true, 0.95 + R() * 0.15));
  const bushes = [[31, 3], [33, 4], [31, 5], [27, 5], [33, 7], [12, 17], [8, 14], [27, 15], [15, 4], [24, 9]];
  bushes.forEach(([x, z]) => plant('bush', x + 0.5, z + 0.6, true, 1));
  // 霧之森的發光蘑菇：沿著步道邊緣
  for (let z = -20; z < 0; z++) for (let x = 1; x < W - 1; x++) {
    if (T[z][x] !== 'forest' || block[z][x]) continue;
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => T[z + dz]?.[x + dx] === 'wood');
    if (edge && R() > 0.72) plant('mushroom', x + 0.2 + R() * 0.6, z + 0.2 + R() * 0.6, false, 0.7 + R() * 0.5);
  }
  // ---------- 建築 ----------
  const M = {
    plaster: new THREE.MeshLambertMaterial({ map: tex.plaster }), stone: new THREE.MeshLambertMaterial({ map: tex.stone }),
    wood: new THREE.MeshLambertMaterial({ map: tex.wood }), plank: new THREE.MeshLambertMaterial({ map: tex.plankSide }),
    roofRed: new THREE.MeshLambertMaterial({ map: tex.roofRed, side: THREE.DoubleSide }), roofBlue: new THREE.MeshLambertMaterial({ map: tex.roofBlue, side: THREE.DoubleSide }),
    roofGreen: new THREE.MeshLambertMaterial({ map: tex.roofGreen, side: THREE.DoubleSide }), dark: new THREE.MeshLambertMaterial({ map: tex.dark }),
    white: new THREE.MeshLambertMaterial({ map: tex.white }), red: new THREE.MeshLambertMaterial({ map: tex.red }), shrine: new THREE.MeshLambertMaterial({ map: tex.shrine }),
    window: new THREE.MeshBasicMaterial({ color: hdr(2.6, 1.6, 0.6) }), door: new THREE.MeshLambertMaterial({ color: '#4a3020' }),
    glow: new THREE.MeshBasicMaterial({ color: hdr(3.0, 1.45, 0.45) })
  };
  const add = (mesh, x, y, z, parent = scene) => { mesh.position.set(x, y, z); mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh; };
  const blockRect = (x0, z0, x1, z1) => { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) block[z][x] = true; };

  function house(x0, z0, w, d, roofMat, wallH = 1.7) {
    blockRect(x0, z0, x0 + w - 1, z0 + d - 1);
    const cx = x0 + w / 2, cz = z0 + d / 2, base = BASE_H[T[z0][x0]] ?? 0;
    const g = new THREE.Group(); g.position.set(cx, base, cz); scene.add(g);
    add(new THREE.Mesh(worldBox(w - 0.2, wallH, d - 0.3), M.plaster), 0, wallH / 2, 0, g);
    add(new THREE.Mesh(worldBox(w - 0.1, 0.25, d - 0.2), M.stone), 0, 0.12, 0, g);
    const roof = gableRoof(w + 0.4, d + 0.5, 1.1, roofMat, M.plaster); roof.position.y = wallH; g.add(roof);
    add(new THREE.Mesh(worldBox(0.4, 1.2, 0.4), M.stone), w / 2 - 0.8, wallH + 0.9, -0.3, g);
    const front = d / 2 - 0.15 + 0.01;
    add(new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.95), M.door), -w / 2 + 1.2, 0.48, front, g);
    for (let k = 0; k < w - 2; k++) add(new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), M.window), -w / 2 + 2.1 + k, 1.0, front, g);
    const side = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.42), M.window); side.rotation.y = -Math.PI / 2; add(side, -w / 2 + 0.09, 1.0, 0, g);
    return g;
  }
  house(13, 5, 4, 3, M.roofRed);
  house(20, 5, 4, 3, M.roofBlue);
  house(25, 11, 5, 3, M.roofGreen, 2.0);
  house(9, 16, 3, 3, M.roofRed);

  // 路燈：暖色點光源，閃爍由主迴圈控制
  const lanterns = [];
  function lantern(x, z) {
    block[z][x] = true;
    const cx = x + 0.5, cz = z + 0.5, base = BASE_H[T[z][x]] ?? 0;
    add(new THREE.Mesh(worldBox(0.12, 1.5, 0.12), M.dark), cx, base + 0.75, cz);
    add(new THREE.Mesh(worldBox(0.3, 0.32, 0.3), M.glow), cx, base + 1.6, cz).castShadow = false;
    const cap = add(new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.22, 4), M.dark), cx, base + 1.87, cz); cap.rotation.y = Math.PI / 4;
    const light = new THREE.PointLight('#ffb366', 9, 7.5, 1.6);
    light.position.set(cx, base + 1.6, cz);
    scene.add(light);
    lanterns.push({ light, seed: R() * 10 });
  }
  [[15, 11], [24, 11], [15, 18], [24, 18], [16, 22], [28, 18], [8, 12], [31, 22], [19, 25]].forEach(([x, z]) => lantern(x, z));

  // 水井
  block[14][19] = true;
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.5, 0.6, 10), M.stone), 19.5, 0.38, 14.5);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 10), new THREE.MeshBasicMaterial({ color: '#0d1420' })), 19.5, 0.69, 14.5);
  add(new THREE.Mesh(worldBox(0.08, 1.2, 0.08), M.wood), 19.1, 0.9, 14.5); add(new THREE.Mesh(worldBox(0.08, 1.2, 0.08), M.wood), 19.9, 0.9, 14.5);
  const wellRoof = gableRoof(1.1, 1.0, 0.4, M.roofRed, M.wood); wellRoof.position.set(19.5, 1.45, 14.5); scene.add(wellRoof);

  // 告示牌
  const sign = new THREE.Mesh(spriteGeo(1, 1), spriteMats.sign); sign.customDepthMaterial = spriteMats.sign.userData.depth;
  add(sign, 17.5, 0.08, 12.6); block[12][17] = true;

  // 柵欄
  const fenceRail = (x0, x1, z, gap) => {
    for (let x = x0; x <= x1; x++) { if (x === gap) continue; block[z][x] = true; add(new THREE.Mesh(worldBox(0.12, 0.7, 0.12), M.wood), x + 0.5, 0.35, z + 0.5); }
    for (const [a, b] of [[x0, gap - 1], [gap + 1, x1]]) {
      const len = b - a + 0.1;
      for (const y of [0.25, 0.55]) add(new THREE.Mesh(worldBox(len, 0.08, 0.06), M.wood), (a + b + 1) / 2, y, z + 0.5);
    }
  };
  fenceRail(26, 33, 9, 31);

  // 木箱與木桶
  for (const [x, z] of [[16, 24], [19, 23], [30, 13], [12, 10]]) { block[z][x] = true; add(new THREE.Mesh(worldBox(0.7, 0.7, 0.7), M.plank), x + 0.5, 0.35 + Math.max(-0.22, heightOf(x, z)), z + 0.5); }
  for (const [x, z] of [[16, 23], [30, 14]]) { block[z][x] = true; add(new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.75, 8), M.wood), x + 0.5, 0.38, z + 0.5); }

  // 岩石
  const rockMat = new THREE.MeshLambertMaterial({ map: tex.rockTop, flatShading: true });
  for (const [x, z, s] of [[5, 13, 0.5], [27, 22, 0.6], [34, 21, 0.55], [12, 26, 0.45], [33, 27, 0.5], [2, 10, 0.5]]) {
    block[z][x] = true;
    const r = add(new THREE.Mesh(new THREE.DodecahedronGeometry(s, 0), rockMat), x + 0.5, Math.max(-0.22, heightOf(x, z)) + s * 0.55, z + 0.5);
    r.rotation.set(R(), R() * 3, R());
  }

  // 棧橋木樁
  for (let z = map.coastZ(17); z < H; z += 2) for (const x of [17.1, 18.9]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 6), M.wood), x, -0.6, z + 0.5);

  // 高台神社與鳥居
  blockRect(6, 2, 7, 3);
  add(new THREE.Mesh(worldBox(1.6, 1.0, 1.3), M.shrine), 7, 1.5, 2.9);
  const shrineRoof = gableRoof(2.2, 1.9, 0.6, M.roofGreen, M.shrine); shrineRoof.position.set(7, 2.0, 2.9); scene.add(shrineRoof);
  add(new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), M.window), 7, 1.4, 3.56);
  block[5][5] = block[5][8] = true;
  for (const x of [5.6, 8.4]) add(new THREE.Mesh(worldBox(0.18, 1.7, 0.18), M.shrine), x, 1.85, 5.5);
  add(new THREE.Mesh(worldBox(3.6, 0.16, 0.24), M.dark), 7, 2.75, 5.5);
  add(new THREE.Mesh(worldBox(3.0, 0.12, 0.16), M.shrine), 7, 2.45, 5.5);
  for (const x of [4, 9]) {
    block[3][x] = true;
    add(new THREE.Mesh(worldBox(0.3, 0.6, 0.3), M.stone), x + 0.5, 1.3, 3.5);
    add(new THREE.Mesh(worldBox(0.24, 0.2, 0.24), M.glow), x + 0.5, 1.7, 3.5).castShadow = false;
    add(new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.2, 4), M.stone), x + 0.5, 1.9, 3.5).rotation.y = Math.PI / 4;
  }
  const shrineLight = new THREE.PointLight('#ffb366', 6, 6, 1.6); shrineLight.position.set(7, 2, 3.8); scene.add(shrineLight);
  lanterns.push({ light: shrineLight, seed: 3.3 });

  // ---------- 北門的黑色荊棘：燈塔點亮前擋住去路 ----------
  const brambleMat = new THREE.MeshLambertMaterial({ map: spr.bramble, alphaTest: 0.5, side: THREE.DoubleSide });
  const brambleDepth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: spr.bramble, alphaTest: 0.5 });
  const brambles = new THREE.Group();
  for (const [x, s] of [[17.6, 1.1], [18.4, 1.3], [19.2, 1.15], [20.1, 0.95]]) {
    const m = new THREE.Mesh(spriteGeo(2 * s, 1.5 * s), brambleMat);
    m.position.set(x, 0, 0.5); m.castShadow = true; m.customDepthMaterial = brambleDepth;
    brambles.add(m);
  }
  scene.add(brambles);
  const setGate = open => { brambles.visible = !open; block[0][18] = block[0][19] = !open; };
  setGate(false);

  // ---------- 霧之森的營地：營火、帳篷、圍坐的原木 ----------
  block[-10][10] = true;
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; add(new THREE.Mesh(new THREE.DodecahedronGeometry(0.15, 0), rockMat), 10.5 + Math.cos(a) * 0.36, 0.07, -9.5 + Math.sin(a) * 0.36).rotation.set(R(), R(), R()); }
  for (const r of [0.7, -0.7]) add(new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.65, 6), M.wood), 10.5, 0.1, -9.5).rotation.set(Math.PI / 2, 0, r);
  const flame = add(new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.55, 6), new THREE.MeshBasicMaterial({ color: hdr(3.4, 1.4, 0.35) })), 10.5, 0.38, -9.5);
  flame.castShadow = false;
  const fireLight = new THREE.PointLight('#ff9a4a', 12, 9, 1.5); fireLight.position.set(10.5, 0.9, -9.5); scene.add(fireLight);
  lanterns.push({ light: fireLight, seed: 7.7, fire: flame });
  for (const [x, z] of [[9.4, -9.6], [11.6, -9.6]]) {
    block[Math.floor(z)][Math.floor(x)] = true;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.85, 7), M.wood), x, 0.17, z).rotation.set(Math.PI / 2, 0, 0);
  }
  blockRect(7, -12, 8, -11);
  const clothMat = new THREE.MeshLambertMaterial({ map: tex.cloth, side: THREE.DoubleSide });
  const tent = gableRoof(2.2, 2.0, 1.35, clothMat, clothMat); tent.position.set(8, 0, -11); tent.rotation.y = Math.PI / 2; scene.add(tent);

  // ---------- 遺跡入口的濃霧：擊敗霧狼王後散去 ----------
  const mistTex = (() => {
    const c = document.createElement('canvas'); c.width = 128; c.height = 64;
    const g = c.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = R() * 128, y = 24 + R() * 32, r = 10 + R() * 16; // 霧貼著地面，越往上越淡
      for (const ox of [-128, 0, 128]) { // 左右各畫一次，橫向捲動時才不會出現接縫
        const grd = g.createRadialGradient(x + ox, y, 0, x + ox, y, r);
        grd.addColorStop(0, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 128, 64);
      }
    }
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; return t;
  })();
  // 固定不動的透明度遮罩：四邊淡出，霧牆才不會有方方正正的邊
  const mistEdge = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d'), img = g.createImageData(64, 64);
    const ramp = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
      const u = x / 63, v = 1 - y / 63; // v：0 在底部
      const k = ramp(u, 0, 0.25) * ramp(1 - u, 0, 0.25) * ramp(v, 0, 0.15) * ramp(1 - v, 0, 0.5);
      const i = (y * 64 + x) * 4; img.data[i] = img.data[i + 1] = img.data[i + 2] = k * k * (3 - 2 * k) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return new THREE.CanvasTexture(c);
  })();
  const mist = new THREE.Group(), mistMats = [];
  for (let k = 0; k < 3; k++) {
    const map = mistTex.clone(); map.needsUpdate = true;
    const mat = new THREE.MeshBasicMaterial({ map, alphaMap: mistEdge, color: hdr(0.8, 0.9, 0.95), transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(10, 3.6), mat); m.position.set(19, 1.6, -20.4 - k * 0.45);
    mist.add(m); mistMats.push(mat);
  }
  scene.add(mist);
  let mistK = 0, mistTarget = 0; // 0 濃霧、1 散去；散去時慢慢過渡
  const setMist = (cleared, instant) => {
    mistTarget = cleared ? 1 : 0; if (instant) mistK = mistTarget;
    for (let x = 16; x <= 21; x++) block[-21][x] = !cleared;
  };
  setMist(false, true);

  // ---------- 星之古塔遺跡 ----------
  const ruinStone = new THREE.MeshLambertMaterial({ map: tex.stone, color: '#b4b4cc' });
  for (const [x, z, h] of [[9, -23, 2.6], [12, -23, 1.2], [24, -23, 2.8], [27, -23, 0.8], [9, -27, 3.0], [28, -27, 2.2], [10, -31, 2.8], [27, -31, 3.1], [13, -26, 0.6], [23, -25, 0.7]]) {
    block[z][x] = true;
    add(new THREE.Mesh(worldBox(0.7, h, 0.7), ruinStone), x + 0.5, 0.08 + h / 2, z + 0.5);
    if (h > 2) add(new THREE.Mesh(worldBox(0.95, 0.22, 0.95), ruinStone), x + 0.5, 0.08 + h + 0.11, z + 0.5);
  }
  const blueGlow = new THREE.MeshBasicMaterial({ color: hdr(0.9, 1.8, 3.4) });
  for (const x of [12, 24]) {
    block[-28][x] = true;
    add(new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, 1.0, 8), ruinStone), x + 0.5, 0.58, -27.5);
    const f = add(new THREE.Mesh(worldBox(0.34, 0.32, 0.34), blueGlow), x + 0.5, 1.24, -27.5); f.castShadow = false;
    const l = new THREE.PointLight('#7ab8ff', 6, 7, 1.6); l.position.set(x + 0.5, 1.6, -27.5); scene.add(l);
    lanterns.push({ light: l, seed: x * 0.7, fire: f });
  }
  // 星之石像（休息點）
  block[-24][15] = true;
  add(new THREE.Mesh(worldBox(0.8, 0.9, 0.8), ruinStone), 15.5, 0.53, -23.5);
  const starMat = new THREE.MeshBasicMaterial({ color: hdr(3.2, 2.7, 1.3) });
  const statueStar = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.26, 0), starMat), 15.5, 1.35, -23.5); statueStar.castShadow = false; statueStar.scale.y = 1.4;
  // 古塔：基座、塔身、塔頂水晶（被熄星者染成紫黑色，打倒後恢復金色）
  blockRect(15, -35, 21, -33);
  const tower = new THREE.Group(); tower.position.set(18.5, 0.08, -34.2); scene.add(tower);
  add(new THREE.Mesh(new THREE.CylinderGeometry(3.0, 3.2, 1.2, 10), ruinStone), 0, 0.6, 0, tower);
  add(new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.6, 7, 10), ruinStone), 0, 4.7, 0, tower);
  add(new THREE.Mesh(new THREE.CylinderGeometry(2.75, 2.75, 0.4, 10), M.dark), 0, 8.4, 0, tower);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.7, 2.1, 1.6, 10), ruinStone), 0, 9.4, 0, tower);
  add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.6), M.door), 0, 2.0, 2.56, tower).rotation.x = -0.05;
  for (let k = 0; k < 3; k++) add(new THREE.Mesh(new THREE.PlaneGeometry(0.32, 0.5), new THREE.MeshBasicMaterial({ color: '#1a1530' })), 0, 4 + k * 1.6, 2.33 - k * 0.04, tower);
  const crystalMat = new THREE.MeshBasicMaterial({ color: hdr(1.3, 0.5, 2.8) });
  const crystal = add(new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 0), crystalMat), 0, 11.4, 0, tower); crystal.scale.y = 1.7; crystal.castShadow = false;
  const towerLight = new THREE.PointLight('#b07aff', 22, 18, 1.4); towerLight.position.set(0, 11, 1.5); tower.add(towerLight);
  const setTower = freed => {
    crystalMat.color.copy(freed ? hdr(3.4, 2.8, 1.3) : hdr(1.3, 0.5, 2.8));
    towerLight.color.set(freed ? '#ffd27a' : '#b07aff');
  };

  // 精靈板一次建成 InstancedMesh；草叢放在所有建物定位之後，避免長進牆裡。
  for (let z = ZMIN + 1; z < H; z++) for (let x = 1; x < W; x++) {
    if ((T[z][x] === 'grass' || T[z][x] === 'high' || T[z][x] === 'forest') && !block[z][x] && R() > 0.8) plant('tuft', x + R(), z + R(), false, 0.7 + R() * 0.5);
  }
  const SIZE = { tree: [2, 3], tree2: [2, 3], pine: [2, 3], bush: [1, 1], tuft: [0.9, 0.45], mushroom: [0.6, 0.6] };
  // 蘑菇自己發光；樹木與灌木擋在角色前方時，挖出一個網點狀的透明圓（cutout），角色才不會被樹遮住。
  spriteMats.mushroom.emissive = hdr(1.6, 1.6, 1.6); spriteMats.mushroom.emissiveMap = spr.mushroom;
  const cutout = { uCutPx: { value: new THREE.Vector2(-9999, -9999) }, uCutDist: { value: 0 }, uCutR: { value: 0 } };
  for (const k of ['tree', 'tree2', 'pine', 'bush']) {
    spriteMats[k].onBeforeCompile = sh => {
      Object.assign(sh.uniforms, cutout);
      sh.fragmentShader = sh.fragmentShader
        .replace('void main() {', 'uniform vec2 uCutPx; uniform float uCutDist; uniform float uCutR;\nvoid main() {')
        .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
          float cutD = length(gl_FragCoord.xy - uCutPx);
          if (vViewPosition.z < uCutDist - 0.9 && cutD < uCutR) {
            vec2 cell = mod(floor(gl_FragCoord.xy), 2.0);
            float bayer = cell.x * 0.5 + abs(cell.x - cell.y) * 0.25 + 0.125;
            if (smoothstep(0.55, 1.0, cutD / uCutR) < bayer) discard;
          }`);
    };
    spriteMats[k].customProgramCacheKey = () => 'cutout';
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  for (const k in placed) {
    const list = placed[k];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(spriteGeo(...SIZE[k]), spriteMats[k], list.length);
    list.forEach(([x, z, s], i) => {
      const y = heightOf(Math.floor(x), Math.floor(z)) * (x >= 0 && z >= ZMIN && x < W && z < H ? 1 : 0);
      im.setMatrixAt(i, m4.compose(pv.set(x, Math.max(0, y), z), q, sv.set(s, s, s)));
    });
    im.castShadow = k !== 'tuft' && k !== 'mushroom'; im.receiveShadow = true;
    im.customDepthMaterial = spriteMats[k].userData.depth;
    scene.add(im);
  }

  // ---------- 燈塔 ----------
  blockRect(31, 26, 32, 27);
  const lh = new THREE.Group(); lh.position.set(32, 0.5, 27); scene.add(lh);
  add(new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.8, 8), M.stone), 0, 0.4, 0, lh);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.92, 1.6, 8), M.white), 0, 1.6, 0, lh);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.66, 0.72, 0.6, 8), M.red), 0, 2.7, 0, lh);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.66, 1.2, 8), M.white), 0, 3.6, 0, lh);
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.14, 8), M.dark), 0, 4.27, 0, lh);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#283048' });
  add(new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.75, 8), lampMat), 0, 4.72, 0, lh);
  add(new THREE.Mesh(new THREE.ConeGeometry(0.78, 0.6, 8), M.red), 0, 5.4, 0, lh);
  add(new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), M.dark), 0, 5.75, 0, lh);
  add(new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.85), M.door), 0, 0.85, 0.99, lh).rotation.x = -0.12;
  for (let k = 0; k < 2; k++) add(new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.3), new THREE.MeshBasicMaterial({ color: '#1a1f30' })), 0, 1.7 + k * 1.9, 0.93 - k * 0.27, lh);
  const beamGeo = new THREE.ConeGeometry(2.4, 18, 16, 1, true); beamGeo.translate(0, -9, 0); beamGeo.rotateZ(Math.PI / 2);
  const beamMat = new THREE.MeshBasicMaterial({ color: hdr(1.4, 1.2, 0.7), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const beam = new THREE.Mesh(beamGeo, beamMat); beam.position.y = 4.72; lh.add(beam);
  const lhLight = new THREE.PointLight('#ffd27a', 0, 16, 1.5); lhLight.position.set(0, 4.72, 0); lh.add(lhLight);
  const lighthouse = {
    lit: 0,
    setLit(v) {
      this.lit = v;
      lampMat.color.copy(new THREE.Color('#283048').lerp(hdr(4.5, 3.4, 1.4), v));
      beamMat.opacity = 0.14 * v; lhLight.intensity = 26 * v;
    },
    update(dt) { beam.rotation.y += dt * 0.6; }
  };

  // ---------- 螢火蟲 ----------
  const flyCount = quality === 'high' ? 140 : 70;
  const fp = new Float32Array(flyCount * 3), fs = new Float32Array(flyCount);
  for (let i = 0; i < flyCount; i++) {
    // 約三分之二在港口，其餘散在霧之森的步道上
    let x, z; do { x = 2 + R() * 34; z = i % 3 ? 2 + R() * 22 : -20 + R() * 19; } while (['water', 'wood'].includes(T[Math.floor(z)][Math.floor(x)]));
    fp.set([x, 0.4 + R() * 1.8 + (T[Math.floor(z)][Math.floor(x)] === 'high' ? 1 : 0), z], i * 3); fs[i] = R() * 100;
  }
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
  flyGeo.setAttribute('seed', new THREE.BufferAttribute(fs, 1));
  const flyMat = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 }, scale: { value: 1 }, boost: { value: 1 } },
    vertexShader: `attribute float seed; uniform float time; uniform float scale; varying float vA;
      void main(){ vec3 p = position + vec3(sin(time*0.4+seed)*0.9, sin(time*0.7+seed*1.7)*0.3, cos(time*0.33+seed*0.6)*0.9);
      vec4 mv = modelViewMatrix * vec4(p,1.0); gl_Position = projectionMatrix * mv;
      vA = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(time * 2.1 + seed * 3.0), 3.0);
      gl_PointSize = scale * 90.0 / -mv.z; }`,
    fragmentShader: `uniform float boost; varying float vA; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
      gl_FragColor = vec4(vec3(2.2, 2.6, 1.0) * a * vA * boost, 1.0); }`,
    transparent: true, blending: THREE.AdditiveBlending, depthWrite: false
  });
  const flies = new THREE.Points(flyGeo, flyMat); flies.frustumCulled = false; scene.add(flies);

  const isBlocked = (x, z) => {
    const ix = Math.floor(x), iz = Math.floor(z);
    if (ix < 0 || iz < ZMIN || ix >= W || iz >= H) return true;
    return block[iz][ix];
  };
  const groundAt = (x, z) => Math.max(-0.22, heightOf(Math.floor(x), Math.floor(z)));

  // 依鏡頭位置在港口、霧之森、遺跡三種氣氛之間平滑切換
  const cA = new THREE.Color(), cB = new THREE.Color();
  const blend = (a, b, k) => {
    const o = {};
    for (const key in a) o[key] = typeof a[key] === 'number' ? a[key] + (b[key] - a[key]) * k : '#' + cA.set(a[key]).lerp(cB.set(b[key]), k).getHexString();
    return o;
  };
  function atmosphere(z) {
    const wf = THREE.MathUtils.smoothstep(-z, 0.5, 4.5), wr = THREE.MathUtils.smoothstep(-z, 19.5, 23.5);
    const a = blend(blend(AREA.town, blend(AREA.forest, AREA.forestClear, mistK), wf), AREA.ruins, wr);
    scene.fog.color.set(a.fog); scene.fog.near = a.near; scene.fog.far = a.far;
    scene.background.set(a.bg);
    hemi.intensity = a.hemi; sun.intensity = a.sun; sun.color.set(a.sunColor);
  }

  let time = 0;
  return {
    scene, sun, hemi, lighthouse, flies, spriteGeo, isBlocked, groundAt, tiles: T,
    setGate, setMist, setTower,
    setBlocked(x, z, v) { block[z][x] = v; },
    // 角色在畫面上的位置（繪圖緩衝區像素）與到鏡頭的距離，給樹木挖透明圓用
    setCutout(px, py, dist, radius) { cutout.uCutPx.value.set(px, py); cutout.uCutDist.value = dist; cutout.uCutR.value = radius; },
    setQuality(q) {
      sun.castShadow = q === 'high';
      flyMat.uniforms.boost.value = q === 'high' ? 1 : 0.8;
    },
    setPixelScale(s) { flyMat.uniforms.scale.value = s; },
    update(dt, focus) {
      time += dt;
      waterTex.offset.set(time * 0.012, Math.sin(time * 0.3) * 0.01);
      for (const l of lanterns) {
        const k = 0.88 + 0.12 * Math.sin(time * 9 + l.seed) * Math.sin(time * 5.3 + l.seed * 2);
        l.light.intensity = (l.base ??= l.light.intensity) * k;
        if (l.fire) l.fire.scale.y = 0.75 + 0.5 * k * (0.8 + 0.2 * Math.sin(time * 13 + l.seed));
      }
      flyMat.uniforms.time.value = time;
      lighthouse.update(dt);
      mistK += Math.sign(mistTarget - mistK) * Math.min(Math.abs(mistTarget - mistK), dt * 0.4);
      mistMats.forEach((m, k) => { m.map.offset.x = time * (0.015 + k * 0.008) + k * 0.37; m.opacity = (1 - mistK) * 0.9; });
      mist.visible = mistK < 1;
      statueStar.rotation.y = time * 0.8;
      crystal.rotation.y = time * 0.3;
      atmosphere(focus.z);
      // 陰影相機跟著鏡頭走，但以半格為單位移動，減少陰影邊緣閃動。
      const fx = Math.round(focus.x * 2) / 2, fz = Math.round(focus.z * 2) / 2;
      sun.position.set(fx - 16, 11, fz + 7);
      sun.target.position.set(fx, 0, fz);
    }
  };
}
