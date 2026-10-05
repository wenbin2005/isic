// 怪物像素圖：用橢圓、多邊形等形狀組合，依左上方光源分階上色後描邊。
// 每隻怪物另有一張「發光圖」（眼睛、符文、星點），在場景中當自發光貼圖，搭配光暈會亮起來。
// 全部朝右繪製（戰鬥中敵人站在左側、面向右邊的同伴）。
import * as THREE from 'three';
import { rng, canvas, outline } from './pixel.js';

const ell = (cx, cy, rx, ry) => (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
const rect = (x0, y0, w, h) => (x, y) => x >= x0 && x < x0 + w && y >= y0 && y < y0 + h;
const poly = pts => (x, y) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
const or = (...fs) => (x, y) => fs.some(f => f(x, y));
const minus = (a, b) => (x, y) => a(x, y) && !b(x, y);
const flipX = (w, f) => (x, y) => f(w - x, y);

function sprite(w, h, seed, draw) {
  const c = canvas(w, h), e = canvas(w, h);
  const g = c.getContext('2d'), ge = e.getContext('2d');
  const r = rng(seed);
  const api = {
    r,
    // 以形狀中心與尺寸估算受光程度，對應到由暗到亮的色票
    fill(shape, pal, cx, cy, size, jitter = 0.22) {
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const px = x + 0.5, py = y + 0.5;
        if (!shape(px, py)) continue;
        const l = 0.55 - (px - cx) / (size * 2.2) - (py - cy) / (size * 2) + (r() - 0.5) * jitter;
        g.fillStyle = pal[Math.max(0, Math.min(pal.length - 1, Math.floor(l * pal.length)))];
        g.fillRect(x, y, 1, 1);
      }
    },
    dot(x, y, col, dw = 1, dh = 1) { g.fillStyle = col; g.fillRect(x, y, dw, dh); },
    glow(x, y, col, dw = 1, dh = 1) { g.fillStyle = col; g.fillRect(x, y, dw, dh); ge.fillStyle = col; ge.fillRect(x, y, dw, dh); },
    clear(shape) { for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (shape(x + 0.5, y + 0.5)) g.clearRect(x, y, 1, 1); }
  };
  draw(api, r);
  outline(g, 0, 0, w, h);
  const tex = cv => {
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.magFilter = t.minFilter = THREE.NearestFilter;
    t.generateMipmaps = false;
    return t;
  };
  return { map: tex(c), glow: tex(e), w, h };
}

const VIOLET = ['#1b1430', '#2a2046', '#3b2f61', '#504283', '#6c5aa8'];
const MIST = ['#1d2330', '#2c3646', '#435168', '#62728d', '#8d9db6'];

function wolfLike(a, s, body, mane, eye, ox = 0, oy = 0) {
  const P = (x, y) => [ox + x * s, oy + y * s];
  const E = (cx, cy, rx, ry) => ell(ox + cx * s, oy + cy * s, rx * s, ry * s);
  const R = (x, y, w, h) => rect(ox + x * s, oy + y * s, w * s, h * s);
  a.fill(or(E(5, 10, 5.5, 2.6), E(2.5, 7.5, 2.5, 2.2)), mane, ox + 4 * s, oy + 8 * s, 5 * s);
  a.fill(or(R(9, 17, 2.2, 7), R(12.5, 18, 2.2, 6), R(19, 17, 2.2, 7), R(22.5, 16, 2.2, 8)), body.slice(0, 3), ox + 16 * s, oy + 20 * s, 6 * s);
  a.fill(E(16, 15, 9, 5), body, ox + 15 * s, oy + 13 * s, 8 * s);
  a.fill(E(23, 11, 5, 5.5), mane, ox + 22 * s, oy + 9 * s, 5 * s);
  a.fill(or(E(27, 9, 4.5, 3.8), poly([P(29, 8.5), P(33.5, 10.5), P(29, 12.5)]), poly([P(24, 7), P(25, 1.5), P(27.5, 6)]), poly([P(27, 6), P(29.5, 1.8), P(30, 7.5)])), body, ox + 26 * s, oy + 6 * s, 5 * s);
  a.dot(Math.round(ox + 33 * s), Math.round(oy + 10 * s), '#120c14', Math.max(1, Math.round(s)), Math.max(1, Math.round(s)));
  a.glow(Math.round(ox + 28.5 * s), Math.round(oy + 8 * s), eye, Math.max(2, Math.round(1.5 * s)), Math.max(1, Math.round(s)));
}

const DESIGNS = {
  fox: () => sprite(28, 20, 11, a => {
    a.fill(or(ell(6, 9.5, 5, 3.2), ell(3, 6, 3, 2.4)), VIOLET, 5, 7, 5);
    a.fill(ell(2.6, 4.8, 1.9, 1.7), ['#8f7fd0', '#b7a8f0', '#d8cff8'], 2, 4, 2);
    a.fill(or(rect(8, 14, 2, 5), rect(11, 15, 2, 4), rect(16, 14, 2, 5), rect(19, 13, 2, 6)), VIOLET.slice(0, 3), 14, 16, 5);
    a.fill(ell(13, 12, 7, 4.2), VIOLET, 12, 10, 7);
    a.fill(or(ell(21, 9, 4.2, 3.6), poly([[23, 8.5], [27.5, 10.5], [23, 12.5]]), poly([[18, 7], [19, 1.5], [21.5, 6]]), poly([[21, 6], [23.5, 1.5], [24, 7.5]])), VIOLET, 21, 6, 5);
    a.dot(27, 10, '#120c14');
    a.glow(22, 8, '#ffd36b', 2, 1);
    for (const [x, y] of [[1, 3], [4, 2], [0, 6]]) a.glow(x, y, '#c9b8ff');
  }),
  bat: () => sprite(26, 18, 12, a => {
    const memb = ['#2a1528', '#45213c', '#6a2f48', '#94424f', '#b8584f'];
    a.fill(poly([[12, 8], [1, 3], [2, 8], [0, 12], [4, 10], [6, 13], [9, 10], [12, 12]]), memb, 6, 6, 6);
    a.fill(poly([[14, 8], [25, 3], [24, 8], [26, 12], [22, 10], [20, 13], [17, 10], [14, 12]]), memb, 20, 6, 6);
    a.fill(or(ell(13, 9.5, 3.4, 4), poly([[10.5, 6.5], [10.8, 2], [12.6, 5.5]]), poly([[13.4, 5.5], [15.2, 2], [15.5, 6.5]])), ['#1d1222', '#2f1c35', '#45284a', '#5f3a5f'], 12, 7, 4);
    a.glow(11, 8, '#ff8a4a'); a.glow(14, 8, '#ff8a4a');
    a.dot(12, 12, '#f2e8e0'); a.dot(14, 12, '#f2e8e0');
  }),
  thorn: () => sprite(22, 27, 13, a => {
    const green = ['#16301b', '#21452a', '#2f5f38', '#43804a', '#5fa05b'];
    a.fill(or(ell(7, 25, 3, 1.6), ell(15, 25, 3, 1.6)), green.slice(0, 3), 11, 24, 4);
    a.fill(or(poly([[5, 14], [0, 9], [1, 8], [6, 12]]), poly([[17, 14], [22, 9], [21, 8], [16, 12]])), green, 11, 11, 6);
    const spikes = [];
    for (let k = 0; k < 9; k++) {
      const ang = -Math.PI * 0.9 + k * Math.PI * 1.8 / 8, x0 = 11 + Math.cos(ang) * 6.5, y0 = 16 + Math.sin(ang) * 7;
      const nx = Math.cos(ang), ny = Math.sin(ang);
      spikes.push(poly([[x0 - ny * 1.2, y0 + nx * 1.2], [x0 + nx * 3, y0 + ny * 3], [x0 + ny * 1.2, y0 - nx * 1.2]]));
    }
    a.fill(or(...spikes), ['#3a2a18', '#5a4426', '#7d6438'], 11, 14, 8);
    a.fill(ell(11, 16, 7, 7.5), green, 10, 13, 7);
    a.fill(or(ell(6, 9, 3, 1.4), ell(16, 9, 3, 1.4)), green.slice(2), 11, 8, 4);
    a.fill(or(ell(11, 6, 4.5, 4), poly([[7, 5], [8, 0.5], [10, 3]]), poly([[15, 5], [14, 0.5], [12, 3]])), ['#5a1626', '#86203a', '#b0384a', '#d2586a', '#ee8a92'], 10, 4, 4);
    a.glow(8, 15, '#ffe36a', 1, 2); a.glow(13, 15, '#ffe36a', 1, 2);
    a.dot(9, 19, '#0f1a10', 4, 1);
  }),
  crab: () => sprite(34, 24, 14, a => {
    const shell = ['#0f1c29', '#173047', '#224663', '#326184', '#4b84a8'];
    const legs = [];
    for (let k = 0; k < 3; k++) {
      legs.push(poly([[10 - k * 2, 14 + k], [3 - k, 19 + k * 1.2], [4 - k, 21 + k], [11 - k * 2, 16 + k]]));
      legs.push(poly([[24 + k * 2, 14 + k], [31 + k, 19 + k * 1.2], [30 + k, 21 + k], [23 + k * 2, 16 + k]]));
    }
    a.fill(or(...legs), shell.slice(0, 3), 17, 18, 8);
    a.fill(or(rect(6, 10, 5, 2), rect(23, 10, 5, 2)), shell, 17, 10, 6);
    a.fill(minus(ell(5, 8, 4.6, 3.9), poly([[5, 7.5], [0, 4], [0, 7.6]])), shell, 4, 6, 4);
    a.fill(minus(ell(29, 8, 4.6, 3.9), poly([[29, 7.5], [34, 4], [34, 7.6]])), shell, 28, 6, 4);
    a.fill(or(rect(13, 4, 1, 6), rect(20, 4, 1, 6)), shell.slice(1, 3), 17, 6, 3);
    a.fill(ell(17, 14, 10, 6), shell, 15, 11, 9);
    a.fill(ell(17, 12, 6, 2.5), ['#5d93b0', '#7fb2c9', '#a6d0e0'], 15, 11, 5);
    a.glow(12, 2, '#7af0ff', 2, 2); a.glow(20, 2, '#7af0ff', 2, 2);
    a.dot(14, 17, '#0a121a', 6, 1);
  }),
  wolf: () => sprite(34, 26, 15, a => wolfLike(a, 1, MIST, ['#56627a', '#7a88a3', '#a9b6cc', '#d0d9e6'], '#ff5a4a')),
  wolfKing: () => sprite(56, 42, 16, a => {
    wolfLike(a, 1.55, ['#1a1b2e', '#2a2c48', '#3f4268', '#5e6290', '#8a8fbb'], ['#6c6aa0', '#9a96c8', '#c8c4ec', '#eeeaff'], '#ff6a5a', 1, 1);
    a.fill(or(poly([[40, 6], [37, 0.5], [42, 4]]), poly([[46, 5], [47, 0.5], [48.5, 6]])), ['#c9b07a', '#e8d6a0', '#fff2c8'], 43, 3, 3);
    for (let k = 0; k < 10; k++) a.glow(Math.floor(a.r() * 50), 30 + Math.floor(a.r() * 11), ['#b9c8ff', '#dfe6ff'][k % 2]);
  }),
  shroom: () => sprite(26, 30, 17, a => {
    a.fill(or(ell(9, 27.5, 2.6, 1.5), ell(17, 27.5, 2.6, 1.5)), ['#6e604f', '#8a7a68', '#b3a28a'], 13, 27, 3);
    a.fill(ell(13, 20, 5.2, 7), ['#8a7a68', '#b3a28a', '#d6c7ad', '#efe4cc'], 12, 18, 5);
    a.fill(minus(ell(13, 11, 12.5, 8.2), rect(0, 13.5, 26, 20)), ['#2c1235', '#46204f', '#64306c', '#86478a', '#a965a8'], 11, 7, 10);
    a.fill(ell(13, 13.6, 10, 1.6), ['#2a1a26', '#3c2636'], 13, 13, 6);
    for (const [x, y, r] of [[8, 7, 1.8], [15, 5, 1.5], [19, 9, 1.6], [11, 10.5, 1.2], [4, 11, 1]]) a.fill(ell(x, y, r, r * 0.8), ['#d9b8e8', '#f0e0f6'], x, y, 2);
    a.glow(10, 18, '#e8ff7a', 2, 2); a.glow(15, 18, '#e8ff7a', 2, 2);
    a.dot(12, 22, '#4a3a2e', 3, 1);
  }),
  treant: () => sprite(36, 44, 18, a => {
    const bark = ['#24170f', '#3a2617', '#553a22', '#72502f', '#8f6a40'];
    const leaf = ['#122617', '#1b3620', '#26492b', '#356138', '#4a7d48'];
    a.fill(or(poly([[11, 38], [5, 43.5], [12, 43.5], [14, 40]]), poly([[25, 38], [31, 43.5], [24, 43.5], [22, 40]]), rect(15, 40, 6, 3.5)), bark.slice(0, 3), 18, 41, 6);
    a.fill(or(poly([[12, 22], [3, 15], [1, 17], [5, 19], [2, 22], [11, 26]]), poly([[24, 22], [33, 15], [35, 17], [31, 19], [34, 22], [25, 26]])), bark, 18, 18, 9);
    a.fill(poly([[12, 17], [24, 17], [26, 41], [10, 41]]), bark, 16, 26, 9);
    a.fill(or(ell(18, 10, 13, 8), ell(8, 14, 7, 5), ell(28, 14, 7, 5), ell(18, 4, 8, 4)), leaf, 15, 6, 12);
    a.dot(14, 24, '#0b0705', 4, 3); a.dot(19, 24, '#0b0705', 4, 3);
    a.glow(15, 25, '#c8ff6a', 2, 1); a.glow(20, 25, '#c8ff6a', 2, 1);
    a.dot(15, 31, '#0b0705', 6, 2); a.dot(16, 33, '#0b0705', 4, 1);
    for (let k = 0; k < 6; k++) a.glow(4 + Math.floor(a.r() * 28), 3 + Math.floor(a.r() * 14), '#d6ff8a');
  }),
  golem: () => sprite(34, 40, 19, a => {
    const stone = ['#2a2a33', '#3d3e48', '#55576a', '#727489', '#9496aa'];
    a.fill(or(rect(10, 30, 6, 9), rect(19, 30, 6, 9)), stone, 17, 33, 7);
    a.fill(or(rect(2, 15, 6, 15), ell(5, 31, 4, 3.5), rect(27, 15, 6, 15), ell(30, 31, 4, 3.5)), stone, 17, 20, 14);
    a.fill(poly([[7, 14], [28, 14], [26, 31], [9, 31]]), stone, 15, 18, 10);
    a.fill(or(ell(7, 15, 4.2, 3.2), ell(28, 15, 4.2, 3.2)), stone, 17, 13, 10);
    a.fill(rect(13, 4, 9, 10), stone, 16, 7, 5);
    for (const [x, y] of [[4, 18], [26, 22], [12, 28], [21, 16], [15, 5]]) a.dot(x, y, '#4f6a3e', 2, 1);
    a.glow(14, 8, '#7ad8ff', 2, 1); a.glow(19, 8, '#7ad8ff', 2, 1);
    a.glow(17, 17, '#7ad8ff', 1, 9); a.glow(13, 21, '#7ad8ff', 9, 1); a.glow(14, 25, '#7ad8ff', 1, 3); a.glow(20, 25, '#7ad8ff', 1, 3);
  }),
  knight: () => sprite(30, 42, 20, a => {
    const armor = ['#14121c', '#211e2e', '#322d45', '#4a4363', '#6a6088'];
    a.fill(poly([[8, 14], [3, 37], [9, 33], [12, 36], [12, 14]]), ['#2a0f1c', '#401629', '#5c1f38', '#7a2a48'], 8, 22, 8);
    a.fill(or(rect(11, 29, 3, 11), rect(16, 29, 3, 11)), armor, 15, 33, 6);
    a.fill(poly([[9, 14], [21, 14], [20, 30], [10, 30]]), armor, 14, 19, 7);
    a.fill(rect(23, 4, 2, 23), ['#6a6a80', '#9a9ab4', '#cfd0e6'], 23, 12, 6);
    a.fill(or(rect(21, 26, 6, 2), rect(23, 28, 2, 3)), ['#4a3a20', '#7a6030', '#b08a40'], 23, 27, 3);
    a.fill(ell(15, 9, 4.6, 5), armor, 14, 7, 5);
    a.fill(poly([[13, 5], [8, 1], [6, 3], [11, 7]]), ['#401629', '#6a2040', '#94305a'], 10, 3, 4);
    a.fill(ell(8, 22, 4.6, 6.2), ['#1d1a2a', '#2e2942', '#463e60', '#615680'], 7, 19, 6);
    a.fill(poly([[8, 18], [10, 22], [8, 26], [6, 22]]), ['#8a6a30', '#c9a24a'], 8, 21, 3);
    a.glow(15, 9, '#ff4a5a', 4, 1);
    for (let y = 6; y < 25; y += 4) a.glow(24, y, '#c8b8ff');
  }),
  starEater: () => sprite(64, 64, 21, a => {
    const voidPal = ['#07050f', '#100b21', '#1b1435', '#2a1f4e', '#3d2e6b'];
    for (let k = 0; k < 80; k++) {
      const ang = Math.PI * (1.08 + k / 80 * 0.84) + (a.r() - 0.5) * 0.02, rr = 25 + (k % 3) * 0.6;
      a.glow(Math.round(32 + Math.cos(ang) * rr), Math.round(26 + Math.sin(ang) * rr), k % 4 ? '#6a58b8' : '#ffe08a');
    }
    a.fill(or(poly([[17, 28], [5, 36], [2, 44], [6, 41], [7, 46], [10, 40], [13, 43], [14, 37], [20, 33]]), flipX(64, poly([[17, 28], [5, 36], [2, 44], [6, 41], [7, 46], [10, 40], [13, 43], [14, 37], [20, 33]]))), voidPal, 32, 34, 18);
    const cloak = poly([[32, 6], [46, 18], [50, 36], [45, 57], [39, 51], [32, 61], [25, 51], [19, 57], [14, 36], [18, 18]]);
    a.fill(cloak, voidPal, 28, 22, 18, 0.16);
    a.fill(ell(32, 21, 8.5, 7.5), ['#020106', '#06040c'], 32, 21, 8, 0);
    for (let k = 0; k < 46; k++) {
      const x = 18 + Math.floor(a.r() * 30), y = 30 + Math.floor(a.r() * 28);
      if (cloak(x + 0.5, y + 0.5) && !ell(32, 21, 9, 8)(x + 0.5, y + 0.5)) a.glow(x, y, ['#fff3c4', '#a9b8ff', '#ffd27a', '#e6dcff'][k % 4]);
    }
    a.glow(28, 20, '#fff0b0', 3, 1); a.glow(34, 20, '#fff0b0', 3, 1);
    a.glow(29, 21, '#ffcf6a', 1, 1); a.glow(35, 21, '#ffcf6a', 1, 1);
    for (const [x0, h] of [[24, 6], [28, 9], [32, 11], [36, 9], [40, 6]]) {
      for (let y = 0; y < h; y++) a.glow(x0, 11 - y - (x0 === 32 ? 2 : 0), y > h - 3 ? '#fff6d8' : '#e8b860');
    }
  })
};

const cache = {};
export function monsterArt(kind) { return (cache[kind] ??= DESIGNS[kind]()); }

// 怪物材質：主貼圖受光，發光圖當自發光（眼睛、符文會在暗處亮起）。
export function monsterMaterial(kind) {
  const art = monsterArt(kind);
  const mat = new THREE.MeshLambertMaterial({ map: art.map, emissive: new THREE.Color().setRGB(2.2, 2.2, 2.2), emissiveMap: art.glow, alphaTest: 0.5, side: THREE.DoubleSide, transparent: false });
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: art.map, alphaTest: 0.5 });
  return { mat, depth, w: art.w / 16, h: art.h / 16 };
}
