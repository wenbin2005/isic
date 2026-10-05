// 程序化像素美術：所有地形材質、樹木與角色都在瀏覽器即時繪製，不依賴外部圖檔。
import * as THREE from 'three';

// 可重現的亂數，讓每次載入的像素圖案都一樣。
export function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d', { willReadFrequently: true }); // 描邊需要反覆讀取像素
  return c;
}

function pick(r, list) { return list[Math.floor(r() * list.length) % list.length]; }

function speckle(ctx, w, h, colors, r) {
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { ctx.fillStyle = pick(r, colors); ctx.fillRect(x, y, 1, 1); }
}

function dot(ctx, x, y, c, w = 1, h = 1) { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); }

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  t.minFilter = THREE.NearestMipmapLinearFilter;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

// 透明像素若緊鄰不透明像素就塗上深色描邊，形成像素角色的輪廓。
function outline(ctx, x0, y0, w, h, color = [28, 20, 36]) {
  const img = ctx.getImageData(x0, y0, w, h);
  const d = img.data, src = new Uint8ClampedArray(d);
  const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a(x, y) > 0) continue;
    if (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1)) {
      const i = (y * w + x) * 4;
      d[i] = color[0]; d[i + 1] = color[1]; d[i + 2] = color[2]; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, x0, y0);
}

const GRASS = ['#4e7b3a', '#5a8a41', '#46703a', '#55833d', '#5f8f45'];
const DIRT = ['#6b4a33', '#5e412d', '#76533a', '#634530'];

function grassTop(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  speckle(g, 16, 16, GRASS, r);
  for (let i = 0; i < 7; i++) { const x = Math.floor(r() * 16), y = Math.floor(r() * 15); dot(g, x, y, '#79ad55', 1, 2); }
  for (let i = 0; i < 5; i++) dot(g, Math.floor(r() * 16), Math.floor(r() * 16), '#3b5f2e');
  return c;
}

function flowerTop(r) {
  const c = grassTop(r), g = c.getContext('2d');
  const petals = ['#f2d0e0', '#f6e27a', '#ffffff', '#e98fb0', '#b9a7f0'];
  for (let i = 0; i < 6; i++) {
    const x = 1 + Math.floor(r() * 14), y = 1 + Math.floor(r() * 14), p = pick(r, petals);
    dot(g, x - 1, y, p); dot(g, x + 1, y, p); dot(g, x, y - 1, p); dot(g, x, y + 1, p); dot(g, x, y, '#f4c542');
  }
  return c;
}

function grassSide(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  speckle(g, 16, 16, DIRT, r);
  for (let i = 0; i < 5; i++) dot(g, Math.floor(r() * 15), 4 + Math.floor(r() * 11), '#8a7a6a', 2, 1);
  speckle(g, 16, 3, GRASS, r);
  for (let x = 0; x < 16; x++) if (r() > 0.45) dot(g, x, 3, pick(r, GRASS));
  return c;
}

function pathTop(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  speckle(g, 16, 16, ['#9a7552', '#8c6a4a', '#a47f5b', '#93704e'], r);
  for (let i = 0; i < 6; i++) dot(g, Math.floor(r() * 16), Math.floor(r() * 16), '#b9a088');
  for (let i = 0; i < 4; i++) dot(g, Math.floor(r() * 16), Math.floor(r() * 16), '#6f5440');
  return c;
}

function plazaTop(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  g.fillStyle = '#5d5650'; g.fillRect(0, 0, 16, 16);
  for (let row = 0; row < 4; row++) {
    let x = row % 2 ? -3 : 0;
    while (x < 16) {
      const w = 5 + Math.floor(r() * 2), y = row * 4;
      g.fillStyle = pick(r, ['#a39a8c', '#958c80', '#ada496', '#9c9385']);
      g.fillRect(x + 1, y + 1, w - 1, 3);
      dot(g, x + 1, y + 1, '#c2b9aa', w - 2, 1);
      dot(g, x + w - 1, y + 2, '#7c7469', 1, 2);
      x += w;
    }
  }
  return c;
}

function sandTop(r, dark = false) {
  const c = canvas(16, 16), g = c.getContext('2d');
  speckle(g, 16, 16, dark ? ['#b89c69', '#a88d5d', '#b09464'] : ['#d6bf8a', '#ccb47f', '#dcc796', '#d1ba85'], r);
  if (!dark) for (let i = 0; i < 3; i++) dot(g, Math.floor(r() * 16), Math.floor(r() * 16), '#f0e6d0');
  return c;
}

function rockTop(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  speckle(g, 16, 16, ['#77736f', '#6b6763', '#827e79', '#716d69'], r);
  for (let i = 0; i < 3; i++) { let x = Math.floor(r() * 16), y = Math.floor(r() * 16); for (let k = 0; k < 4; k++) { dot(g, x, y, '#55524f'); x += r() > 0.5 ? 1 : 0; y += 1; } }
  return c;
}

function rockSide(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  speckle(g, 16, 16, ['#625d58', '#57534e', '#6d6862', '#5c5752'], r);
  for (let y = 4; y < 16; y += 5) for (let x = 0; x < 16; x++) if (r() > 0.25) dot(g, x, y, '#423f3c');
  for (let i = 0; i < 6; i++) dot(g, Math.floor(r() * 16), Math.floor(r() * 16), '#86817a', 2, 1);
  return c;
}

function planks(r, vertical) {
  const c = canvas(16, 16), g = c.getContext('2d');
  const cols = ['#8a6440', '#7d5a39', '#946c46', '#86603d'];
  for (let p = 0; p < 4; p++) {
    const base = pick(r, cols);
    for (let a = 0; a < 4; a++) for (let b = 0; b < 16; b++) {
      const col = a === 3 ? '#3d2a1c' : (r() > 0.85 ? '#6b4a2e' : base);
      vertical ? dot(g, p * 4 + a, b, col) : dot(g, b, p * 4 + a, col);
    }
    vertical ? dot(g, p * 4 + 1, 2, '#c8b9a0') : dot(g, 2, p * 4 + 1, '#c8b9a0');
  }
  return c;
}

function plaster(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  speckle(g, 16, 16, ['#e6d8bd', '#ddcfb2', '#ecdfc6', '#e2d4b8'], r);
  dot(g, 0, 0, '#5a3d2a', 2, 16); dot(g, 0, 0, '#5a3d2a', 16, 2); dot(g, 2, 2, '#c9b998', 14, 1);
  return c;
}

function bricks(r, colors = ['#8f8a85', '#86817c', '#9a9590'], mortar = '#5b5752') {
  const c = canvas(16, 16), g = c.getContext('2d');
  g.fillStyle = mortar; g.fillRect(0, 0, 16, 16);
  for (let row = 0; row < 4; row++) for (let k = -1; k < 3; k++) {
    const x = k * 8 + (row % 2 ? 4 : 0), y = row * 4;
    g.fillStyle = pick(r, colors); g.fillRect(x + 1, y + 1, 7, 3);
    dot(g, x + 1, y + 1, 'rgba(255,255,255,0.12)', 6, 1);
  }
  return c;
}

function roof(r, base, shade, hi) {
  const c = canvas(16, 16), g = c.getContext('2d');
  for (let row = 0; row < 4; row++) for (let k = -1; k < 4; k++) {
    const x = k * 4 + (row % 2 ? 2 : 0), y = row * 4;
    g.fillStyle = r() > 0.8 ? hi : base; g.fillRect(x, y, 4, 4);
    dot(g, x, y + 3, shade, 4, 1); dot(g, x + 3, y, shade, 1, 4); dot(g, x, y, hi, 2, 1);
  }
  return c;
}

function water(r) {
  const c = canvas(32, 32), g = c.getContext('2d');
  speckle(g, 32, 32, ['#2a5877', '#2f6283', '#27536f', '#2c5d7c'], r);
  for (let i = 0; i < 14; i++) { const x = Math.floor(r() * 30), y = Math.floor(r() * 32); dot(g, x, y, '#5f97b5', 3, 1); if (r() > 0.6) dot(g, x + 1, y, '#a8d8ea'); }
  return c;
}

function plain(r, colors) { const c = canvas(16, 16); speckle(c.getContext('2d'), 16, 16, colors, r); return c; }

export function makeTileTextures() {
  const r = rng(20261005);
  const t = {
    grassTop: grassTop(r), grassSide: grassSide(r), flowerTop: flowerTop(r), pathTop: pathTop(r), plazaTop: plazaTop(r),
    sandTop: sandTop(r), sandSide: sandTop(r, true), rockTop: rockTop(r), rockSide: rockSide(r),
    plankTop: planks(r, true), plankSide: planks(r, false), plaster: plaster(r), stone: bricks(r),
    roofRed: roof(r, '#a8473a', '#7a2f27', '#c25e4d'), roofBlue: roof(r, '#3f5f8a', '#2b4466', '#5a7dab'),
    roofGreen: roof(r, '#4f7350', '#37543a', '#6a9168'),
    water: water(r), wood: plain(r, ['#6e4b30', '#5f402a', '#7a5537', '#684730']),
    white: plain(r, ['#ece8df', '#e2ddd2', '#e8e3d9']), red: plain(r, ['#b13b32', '#a3352d', '#b8423a']),
    shrine: plain(r, ['#c4402f', '#b83a2b', '#cc4a37']), dark: plain(r, ['#2e2b33', '#36323b'])
  };
  const out = {};
  for (const k in t) out[k] = toTexture(t[k]);
  return out;
}

// ---------- 樹木與擺設 ----------
function broadleaf(r) {
  const c = canvas(32, 48), g = c.getContext('2d');
  dot(g, 14, 30, '#5a3c28', 4, 18); dot(g, 14, 30, '#7a5538', 1, 18); dot(g, 17, 30, '#3e2a1c', 1, 18); dot(g, 12, 45, '#4a3221', 8, 3);
  const blobs = [[16, 17, 12], [8, 23, 8], [24, 23, 8], [16, 27, 8], [10, 11, 7], [22, 11, 7], [16, 7, 7]];
  const leaf = ['#24452a', '#2f5a2e', '#3d7036', '#4c8740', '#62a04c', '#7dbb5c'];
  for (let y = 0; y < 40; y++) for (let x = 0; x < 32; x++) {
    if (!blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 < br * br)) continue;
    const l = 0.55 - (x - 13) / 40 - (y - 12) / 34 + (r() - 0.5) * 0.35;
    dot(g, x, y, leaf[Math.max(0, Math.min(5, Math.floor(l * 5)))]);
  }
  outline(g, 0, 0, 32, 48);
  return c;
}

function pine(r) {
  const c = canvas(32, 48), g = c.getContext('2d');
  dot(g, 14, 38, '#4a3221', 4, 10); dot(g, 14, 38, '#64442c', 1, 10);
  const shades = ['#183a2b', '#1f4532', '#2a5a3f', '#37704c', '#4a8a5c'];
  for (let i = 0; i < 4; i++) {
    const top = 1 + i * 8, base = 14 + i * 8, half = 5 + i * 3.4;
    for (let y = top; y <= base; y++) {
      const w = (y - top) / (base - top) * half;
      for (let x = Math.ceil(16 - w); x < 16 + w; x++) {
        const l = 0.5 - (x - 14) / 30 - (y - base + 6) / 30 + (r() - 0.5) * 0.3;
        dot(g, x, y, shades[Math.max(0, Math.min(4, Math.floor(l * 4.2)))]);
      }
    }
  }
  outline(g, 0, 0, 32, 48);
  return c;
}

function bush(r) {
  const c = canvas(16, 16), g = c.getContext('2d');
  const blobs = [[8, 9, 6], [4, 11, 4], [12, 11, 4]];
  const leaf = ['#2f5a2e', '#3d7036', '#4c8740', '#62a04c'];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!blobs.some(([bx, by, br]) => (x - bx) ** 2 + (y - by) ** 2 < br * br)) continue;
    const l = 0.6 - (x - 6) / 18 - (y - 6) / 14 + (r() - 0.5) * 0.3;
    dot(g, x, y, leaf[Math.max(0, Math.min(3, Math.floor(l * 3.5)))]);
  }
  for (let i = 0; i < 4; i++) dot(g, 3 + Math.floor(r() * 10), 6 + Math.floor(r() * 7), pick(r, ['#f2d0e0', '#ffffff', '#f6e27a']));
  outline(g, 0, 0, 16, 16);
  return c;
}

function signboard() {
  const c = canvas(16, 16), g = c.getContext('2d');
  dot(g, 7, 8, '#5a3c28', 2, 8);
  dot(g, 1, 2, '#9a7046', 14, 7); dot(g, 1, 8, '#6b4a2e', 14, 1);
  dot(g, 3, 4, '#3d2a1c', 6, 1); dot(g, 3, 6, '#3d2a1c', 9, 1);
  outline(g, 0, 0, 16, 16);
  return c;
}

function grassTuft(r) {
  const c = canvas(16, 8), g = c.getContext('2d');
  for (let i = 0; i < 9; i++) { const x = 1 + Math.floor(r() * 14), h = 3 + Math.floor(r() * 5); dot(g, x, 8 - h, pick(r, ['#5f8f45', '#79ad55', '#4e7b3a']), 1, h); }
  return c;
}

export function makeSpriteTextures() {
  const r = rng(77);
  const s = { tree: broadleaf(r), tree2: broadleaf(r), pine: pine(r), bush: bush(r), sign: signboard(), tuft: grassTuft(r) };
  const out = {};
  for (const k in s) { out[k] = toTexture(s[k], false); out[k].minFilter = THREE.NearestFilter; out[k].generateMipmaps = false; }
  return out;
}

// ---------- 角色 ----------
export const PALETTES = {
  hero: { skin: '#f1c9a0', skinShade: '#d9a67c', hair: '#5b3424', hairHi: '#86553a', eye: '#2a1d2e', top: '#e9e0c9', topShade: '#cfc3a6', sleeve: '#2d4b6e', cloak: '#2d4b6e', cloakShade: '#22385a', scarf: '#c0473b', pants: '#4a3a33', pantsShade: '#382b26', shoes: '#2c221f', belt: '#7b532f' },
  keeper: { skin: '#e8bf98', skinShade: '#cf9f78', hair: '#d8d8dc', hairHi: '#f2f2f4', eye: '#2a1d2e', top: '#2f3f62', topShade: '#24314d', sleeve: '#2f3f62', pants: '#3a3a44', pantsShade: '#2b2b33', shoes: '#211d1f', belt: '#c9a24a', beard: '#e4e4e8', hat: '#2a3554', hatBrim: '#1f2840', hatBand: '#c9a24a' },
  fisher: { skin: '#d9a77a', skinShade: '#bd8a5f', hair: '#3a2a20', hairHi: '#54402f', eye: '#2a1d2e', top: '#6d8a4a', topShade: '#56703a', sleeve: '#d8cfb8', pants: '#3f5168', pantsShade: '#304054', shoes: '#2c221f', belt: '#5a3d2a', hat: '#d9b860', hatBrim: '#c4a24c', hatBand: '#8a6a3a' },
  florist: { skin: '#f4d1b0', skinShade: '#ddb08a', hair: '#b4562f', hairHi: '#d07548', eye: '#2a1d2e', top: '#5d8a5a', topShade: '#4a7048', sleeve: '#f2ead8', pants: '#f4d1b0', pantsShade: '#ddb08a', shoes: '#6b3a2a', belt: '#f2ead8', longHair: true, skirt: '#5d8a5a', skirtShade: '#4a7048', apron: '#f4eee2', blush: '#ec9a8a' },
  merchant: { skin: '#e3b58d', skinShade: '#c99a70', hair: '#2b2230', hairHi: '#3f3346', eye: '#2a1d2e', top: '#6a4a7a', topShade: '#553a63', sleeve: '#6a4a7a', pants: '#4b3b2e', pantsShade: '#3a2e24', shoes: '#2c221f', belt: '#c9a24a', hood: '#7d5a8c', hoodShade: '#5f4370', pack: '#8a5e36', packHi: '#a87545' }
};

function drawCharacter(g, ox, oy, dir, f, p) {
  const R = (x, y, w, h, c) => { if (!c || w <= 0 || h <= 0) return; g.fillStyle = c; g.fillRect(ox + x, oy + y, w, h); };
  const sleeve = p.sleeve || p.top;
  if (dir === 2) {
    // 側面（朝右）：前後腳交錯、手臂擺動
    const sw = f === 1 ? 1 : f === 2 ? -1 : 0;
    if (p.pack) { R(2, 10, 4, 8, p.pack); R(2, 10, 4, 1, p.packHi); }
    if (p.cloak) { R(3, 11, 2, 8, p.cloak); R(3, 18, 2, 1, p.cloakShade); }
    R(6 - sw, 18, 2, 4, p.pantsShade); R(6 - sw, 22, 3, 2, p.shoes);
    R(8 + sw, 18, 2, 4, p.pants); R(8 + sw, 22, 3, 2, p.shoes);
    R(5, 12, 6, 6, p.top); R(5, 17, 6, 1, p.topShade); R(5, 15, 6, 1, p.belt);
    if (p.skirt) { R(4, 15, 8, 5, p.skirt); R(4, 19, 8, 1, p.skirtShade); R(9, 13, 2, 6, p.apron); }
    if (p.scarf) { R(5, 11, 6, 1, p.scarf); R(3, 11 + (f ? 1 : 0), 2, 1, p.scarf); }
    R(7 + sw, 12, 2, 4, sleeve); R(7 + sw, 16, 2, 1, p.skin);
    R(4, 4, 8, 7, p.skin); R(12, 7, 1, 1, p.skin); R(5, 10, 6, 1, p.skinShade);
    R(9, 7, 1, 2, p.eye);
    if (p.blush) R(10, 9, 1, 1, p.blush);
    if (p.hood) { R(3, 1, 9, 4, p.hood); R(3, 4, 4, 7, p.hood); R(4, 4, 7, 1, p.hoodShade); }
    else {
      R(4, 1, 7, 1, p.hair); R(3, 2, 9, 3, p.hair); R(3, 5, 4, 5, p.hair); R(4, 4, 8, 1, p.hair); R(10, 5, 1, 1, p.hair);
      R(5, 2, 4, 1, p.hairHi);
      if (p.longHair) R(3, 9, 3, 5, p.hair);
    }
    if (p.beard) { R(8, 9, 4, 3, p.beard); R(7, 10, 1, 2, p.beard); }
    if (p.hat) { R(5, 0, 6, 2, p.hat); R(2, 2, 12, 1, p.hatBrim); R(5, 1, 6, 1, p.hatBand); }
    return;
  }
  // 正面與背面：腳步交替抬起
  const lUp = f === 1 ? 1 : 0, rUp = f === 2 ? 1 : 0;
  R(5, 18, 2, 4 - lUp, p.pants); R(5, 22 - lUp, 2, 2, p.shoes);
  R(9, 18, 2, 4 - rUp, p.pants); R(9, 22 - rUp, 2, 2, p.shoes);
  const lh = 16 + (f === 1 ? 1 : f === 2 ? -1 : 0), rh = 16 + (f === 2 ? 1 : f === 1 ? -1 : 0);
  if (dir === 0) {
    if (p.cloak) { R(3, 12, 1, 7, p.cloak); R(12, 12, 1, 7, p.cloak); }
    R(4, 12, 8, 6, p.top); R(4, 17, 8, 1, p.topShade); R(4, 15, 8, 1, p.belt);
    if (p.skirt) { R(3, 15, 10, 5, p.skirt); R(3, 19, 10, 1, p.skirtShade); R(6, 13, 4, 6, p.apron); }
    if (p.pack) { R(4, 12, 1, 4, p.pack); R(11, 12, 1, 4, p.pack); }
    R(3, 12, 1, lh - 12, sleeve); R(3, lh, 1, 1, p.skin);
    R(12, 12, 1, rh - 12, sleeve); R(12, rh, 1, 1, p.skin);
    if (p.scarf) R(5, 11, 6, 1, p.scarf);
    R(4, 4, 8, 6, p.skin); R(5, 10, 6, 1, p.skinShade);
    R(6, 7, 1, 2, p.eye); R(9, 7, 1, 2, p.eye);
    if (p.blush) { R(5, 9, 1, 1, p.blush); R(10, 9, 1, 1, p.blush); }
    if (p.hood) { R(3, 1, 10, 4, p.hood); R(3, 4, 1, 7, p.hood); R(12, 4, 1, 7, p.hood); R(4, 4, 8, 1, p.hoodShade); }
    else {
      R(4, 1, 8, 1, p.hair); R(3, 2, 10, 3, p.hair); R(4, 4, 8, 1, p.hair);
      R(4, 5, 2, 1, p.hair); R(8, 5, 1, 1, p.hair); R(11, 5, 1, 1, p.hair);
      R(3, 5, 1, 4, p.hair); R(12, 5, 1, 4, p.hair); R(5, 2, 3, 1, p.hairHi);
      if (p.longHair) { R(3, 9, 1, 5, p.hair); R(12, 9, 1, 5, p.hair); }
    }
    if (p.beard) { R(5, 9, 6, 3, p.beard); R(6, 12, 4, 1, p.beard); R(7, 9, 2, 1, p.skinShade); }
  } else {
    R(4, 12, 8, 6, p.top); R(4, 15, 8, 1, p.belt);
    if (p.skirt) { R(3, 15, 10, 5, p.skirt); R(3, 19, 10, 1, p.skirtShade); R(5, 15, 6, 1, p.apron); }
    R(3, 12, 1, lh - 12, sleeve); R(3, lh, 1, 1, p.skin);
    R(12, 12, 1, rh - 12, sleeve); R(12, rh, 1, 1, p.skin);
    if (p.cloak) { R(4, 11, 8, 8, p.cloak); R(4, 18, 8, 1, p.cloakShade); }
    if (p.pack) { R(3, 10, 10, 8, p.pack); R(3, 10, 10, 1, p.packHi); R(4, 13, 8, 1, p.belt); }
    if (p.scarf) R(5, 11, 6, 1, p.scarf);
    if (p.hood) { R(3, 1, 10, 10, p.hood); R(4, 1, 8, 1, p.hoodShade); }
    else {
      R(4, 1, 8, 1, p.hair); R(3, 2, 10, 8, p.hair); R(5, 2, 4, 1, p.hairHi);
      if (p.longHair) R(4, 10, 8, 4, p.hair);
    }
  }
  if (p.hat) { R(5, 0, 6, 2, p.hat); R(2, 2, 12, 1, p.hatBrim); R(5, 1, 6, 1, p.hatBand); }
}

// 角色貼圖：3 欄（站立、左腳、右腳）× 4 列（下、上、右、左）。
export function makeCharacterTexture(p) {
  const c = canvas(48, 96), g = c.getContext('2d');
  for (let dir = 0; dir < 3; dir++) for (let f = 0; f < 3; f++) drawCharacter(g, f * 16, dir * 24, dir, f, p);
  for (let f = 0; f < 3; f++) {
    g.save(); g.translate(f * 16 + 16, 72); g.scale(-1, 1);
    g.drawImage(c, f * 16, 48, 16, 24, 0, 0, 16, 24); g.restore();
  }
  for (let row = 0; row < 4; row++) for (let f = 0; f < 3; f++) outline(g, f * 16, row * 24, 16, 24);
  const t = toTexture(c, false);
  t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
  t.repeat.set(1 / 3, 1 / 4);
  return t;
}

export function setFrame(tex, dir, frame) {
  tex.offset.set(frame / 3, 1 - (dir + 1) / 4);
}
