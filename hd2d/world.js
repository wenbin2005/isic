// 星燈港的地圖、地形與場景物件。地圖以格子定義：1 格 = 1 公尺 = 16 像素。
import * as THREE from 'three';
import { makeTileTextures, makeSpriteTextures, rng } from './pixel.js';

export const W = 40, H = 32;
export const SPRITE_TILT = -0.35; // 精靈板向後傾，抵銷俯視造成的縮短感
const WATER_Y = -0.55;

const TOP = { grass: 'grassTop', flower: 'flowerTop', path: 'pathTop', plaza: 'plazaTop', sand: 'sandTop', rock: 'rockTop', plank: 'plankTop', stairs: 'plazaTop', high: 'grassTop' };
const SIDE = { grass: 'grassSide', flower: 'grassSide', path: 'grassSide', plaza: 'stone', sand: 'sandSide', rock: 'rockSide', plank: 'plankSide', stairs: 'stone', high: 'grassSide' };
const BASE_H = { grass: 0, flower: 0, path: 0, plaza: 0.08, sand: -0.22, rock: 0.5, plank: 0, stairs: 0.5, high: 1.0 };

// ---------- 地圖 ----------
function buildMap() {
  const T = Array.from({ length: H }, () => Array(W).fill('grass'));
  const block = Array.from({ length: H }, () => Array(W).fill(false));
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
  for (let z = 21; z < H; z++) for (let x = 29; x <= 35; x++) {
    const inside = z < 26 ? (x >= 29 && x <= 34) : (x >= 30 && x <= 34 && z <= 29);
    if (inside) T[z][x] = 'rock';
  }
  for (let z = coastZ(17) - 1; z < H; z++) { T[z][17] = 'plank'; T[z][18] = 'plank'; }
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) if (T[z][x] === 'water' || x === 0 || z === 0) block[z][x] = true;
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
    if (x < 0 || z < 0 || x >= W || z >= H) return 0;
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
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
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

  // 地圖外的林地與海面
  const outerTex = tex.grassTop.clone(); outerTex.repeat.set(70, 70); outerTex.needsUpdate = true;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(70, 70), new THREE.MeshLambertMaterial({ map: outerTex, color: '#8a9a80' }));
  outer.rotation.x = -Math.PI / 2; outer.position.set(-35 + 0.001, -0.005, -35 + 0.001); outer.receiveShadow = true;
  const outer2 = outer.clone(); outer2.position.set(35, -0.005, -35); outer2.scale.set(1, 1, 1);
  const outer3 = outer.clone(); outer3.position.set(-35, -0.005, 25);
  scene.add(outer, outer2, outer3);
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
  const placed = { tree: [], tree2: [], pine: [], bush: [], tuft: [] };
  const plant = (kind, x, z, blocking = true, s = 1) => {
    placed[kind].push([x, z, s]);
    if (blocking) block[Math.floor(z)][Math.floor(x)] = true;
  };
  // 北側與西側林帶
  for (let x = 0; x < 36; x++) { plant('pine', x + 0.5, 0.6, false, 1 + R() * 0.25); if (R() > 0.45) plant('pine', x + 0.5, 1.5, true, 0.9 + R() * 0.2); }
  for (let z = 2; z < 25; z++) { plant('pine', 0.6, z + 0.5, false, 1 + R() * 0.25); if (R() > 0.5 && T[z][1] === 'grass') plant('pine', 1.5, z + 0.5, true, 0.95); }
  for (let i = 0; i < 90; i++) { const x = -18 + R() * 54, z = -14 + R() * 13.5; plant('pine', x, z, false, 1 + R() * 0.4); }
  for (let i = 0; i < 40; i++) { const x = -16 + R() * 15.5, z = R() * 26; plant('pine', x, z, false, 1 + R() * 0.4); }
  const trees = [[3, 12], [4, 18], [2, 22], [9, 22], [13, 24], [24, 21], [22, 23], [33, 12], [26, 19], [11, 20], [3, 15], [6, 23], [34, 15], [31, 10], [24, 3], [18, 3], [3.5, 3.5], [10.5, 3], [11, 7], [3, 7.5], [5, 20.5], [14.5, 20.5]];
  trees.forEach(([x, z], i) => plant(i % 2 ? 'tree2' : 'tree', x + 0.5, z + 0.5, true, 0.95 + R() * 0.15));
  const bushes = [[31, 3], [33, 4], [31, 5], [27, 5], [33, 7], [12, 17], [8, 14], [27, 15], [15, 4], [19, 9], [24, 9]];
  bushes.forEach(([x, z]) => plant('bush', x + 0.5, z + 0.6, true, 1));
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

  // 精靈板一次建成 InstancedMesh；草叢放在所有建物定位之後，避免長進牆裡。
  for (let z = 1; z < H; z++) for (let x = 1; x < W; x++) {
    if ((T[z][x] === 'grass' || T[z][x] === 'high') && !block[z][x] && R() > 0.8) plant('tuft', x + R(), z + R(), false, 0.7 + R() * 0.5);
  }
  const SIZE = { tree: [2, 3], tree2: [2, 3], pine: [2, 3], bush: [1, 1], tuft: [0.9, 0.45] };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sv = new THREE.Vector3(), pv = new THREE.Vector3();
  for (const k in placed) {
    const list = placed[k];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(spriteGeo(...SIZE[k]), spriteMats[k], list.length);
    list.forEach(([x, z, s], i) => {
      const y = heightOf(Math.floor(x), Math.floor(z)) * (x >= 0 && z >= 0 && x < W && z < H ? 1 : 0);
      im.setMatrixAt(i, m4.compose(pv.set(x, Math.max(0, y), z), q, sv.set(s, s, s)));
    });
    im.castShadow = k !== 'tuft'; im.receiveShadow = true;
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
  const flyCount = quality === 'high' ? 90 : 45;
  const fp = new Float32Array(flyCount * 3), fs = new Float32Array(flyCount);
  for (let i = 0; i < flyCount; i++) {
    let x, z; do { x = 2 + R() * 32; z = 2 + R() * 22; } while (T[Math.floor(z)][Math.floor(x)] === 'water');
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
    if (ix < 0 || iz < 0 || ix >= W || iz >= H) return true;
    return block[iz][ix];
  };
  const groundAt = (x, z) => Math.max(-0.22, heightOf(Math.floor(x), Math.floor(z)));

  let time = 0;
  return {
    scene, sun, hemi, lighthouse, flies, spriteGeo, isBlocked, groundAt, tiles: T,
    setQuality(q) {
      sun.castShadow = q === 'high';
      flyMat.uniforms.boost.value = q === 'high' ? 1 : 0.8;
    },
    setPixelScale(s) { flyMat.uniforms.scale.value = s; },
    update(dt, focus) {
      time += dt;
      waterTex.offset.set(time * 0.012, Math.sin(time * 0.3) * 0.01);
      for (const l of lanterns) l.light.intensity = (l.base ??= l.light.intensity) * (0.88 + 0.12 * Math.sin(time * 9 + l.seed) * Math.sin(time * 5.3 + l.seed * 2));
      flyMat.uniforms.time.value = time;
      lighthouse.update(dt);
      // 陰影相機跟著鏡頭走，但以半格為單位移動，減少陰影邊緣閃動。
      const fx = Math.round(focus.x * 2) / 2, fz = Math.round(focus.z * 2) / 2;
      sun.position.set(fx - 16, 11, fz + 7);
      sun.target.position.set(fx, 0, fz);
    }
  };
}
