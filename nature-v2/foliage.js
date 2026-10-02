/* 程序化植被貼圖。
   以 Poly Haven 原始葉片／針葉貼圖為「筆刷」，在畫布上合成整簇的葉叢、松枝、草叢、蕨葉與落葉。
   一張葉叢卡片即代表上百片葉子：樹冠更飽滿，三角形數反而只有舊版的十分之一。
   本檔只產生 2D 畫布；轉成 GPU 貼圖統一經過 toTexture（補足透明區顏色，避免 mipmap 在葉緣產生黑邊）。 */
import * as THREE from './vendor/three.module.js';

const TAU = Math.PI * 2;
// 葉片圖集（1024 像素）中的單片葉裁切：[x, y, 寬, 高, 葉柄→葉尖方向角]
const LEAF_CROPS = [
  [706, 171, 149, 139, -0.88], [564, 156, 130, 92, Math.PI], [728, 358, 148, 90, 0], [731, 492, 124, 82, 0],
  [578, 438, 128, 86, Math.PI], [588, 542, 116, 74, Math.PI], [578, 292, 128, 88, Math.PI],
  [258, 418, 150, 96, Math.PI], [60, 600, 150, 100, Math.PI], [40, 322, 150, 96, Math.PI],
];
// 針葉圖集中的單根松枝（直立，葉柄在下）
const TWIG_CROP = [30, 40, 198, 415];

function makeCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  return canvas;
}
const read = canvas => canvas.getContext('2d', { willReadFrequently: true });

/** 由原圖與遮罩裁出筆刷。mode=largest 只留最大連通塊；mode=interior 去除貼著裁切邊的圖集延展區。 */
function cutSprite(image, mask, [x, y, width, height], mode) {
  const canvas = makeCanvas(width, height), context = read(canvas);
  context.drawImage(image, x, y, width, height, 0, 0, width, height);
  const color = context.getImageData(0, 0, width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(mask, x, y, width, height, 0, 0, width, height);
  const alpha = context.getImageData(0, 0, width, height).data;
  const count = width * height, label = new Int32Array(count).fill(-1), sizes = [], border = [];
  for (let start = 0; start < count; start++) {
    if (label[start] !== -1 || alpha[start * 4] <= 100) continue;
    const id = sizes.length, stack = [start];
    let size = 0, touches = false;
    label[start] = id;
    while (stack.length) {
      const index = stack.pop(), px = index % width, py = (index / width) | 0;
      size++;
      if (px === 0 || py === 0 || px === width - 1 || py === height - 1) touches = true;
      const around = [px > 0 ? index - 1 : -1, px < width - 1 ? index + 1 : -1, py > 0 ? index - width : -1, py < height - 1 ? index + width : -1];
      for (const next of around) if (next >= 0 && label[next] === -1 && alpha[next * 4] > 100) { label[next] = id; stack.push(next); }
    }
    sizes.push(size); border.push(touches);
  }
  const keepIds = new Set(mode === 'largest' ? [sizes.indexOf(Math.max(...sizes))] : sizes.map((_, id) => id).filter(id => !border[id]));
  let keep = new Uint8Array(count);
  for (let i = 0; i < count; i++) if (label[i] >= 0 && keepIds.has(label[i])) keep[i] = 1;
  // 外擴兩像素，保留葉緣原有的柔和半透明。
  for (let pass = 0; pass < 2; pass++) {
    const grown = keep.slice();
    for (let i = 0; i < count; i++) {
      if (keep[i]) continue;
      const px = i % width;
      if ((px > 0 && keep[i - 1]) || (px < width - 1 && keep[i + 1]) || keep[i - width] || keep[i + width]) grown[i] = 1;
    }
    keep = grown;
  }
  for (let i = 0; i < count; i++) color.data[i * 4 + 3] = keep[i] ? alpha[i * 4] : 0;
  context.putImageData(color, 0, 0);
  return canvas;
}

/** 從原始圖集裁出全部筆刷（載入時執行一次）。 */
export function cutBrushes({ leaf, leafAlpha, twig, twigAlpha }) {
  return {
    leaves: LEAF_CROPS.map(([x, y, width, height, axis]) => ({ canvas: cutSprite(leaf, leafAlpha, [x, y, width, height], 'largest'), axis })),
    twig: cutSprite(twig, twigAlpha, TWIG_CROP, 'interior'),
  };
}

/** 重新上色：tint 以「顏色」混合保留葉脈明暗；lift 提亮；shade 以 shadeColor 壓暗（0–1）。 */
function recolor(source, { tint = null, amount = 1, lift = 0, shade = 0, shadeColor = '#1d2412' } = {}) {
  const canvas = makeCanvas(source.width, source.height), context = canvas.getContext('2d', { willReadFrequently: true });
  const { width, height } = canvas;
  context.drawImage(source, 0, 0);
  if (tint) {
    context.globalCompositeOperation = 'color';
    context.globalAlpha = amount; context.fillStyle = tint; context.fillRect(0, 0, width, height);
  }
  if (lift > 0) {
    context.globalCompositeOperation = 'soft-light';
    context.globalAlpha = lift; context.fillStyle = tint || '#ffffff'; context.fillRect(0, 0, width, height);
  }
  if (shade > 0) {
    context.globalCompositeOperation = 'multiply';
    context.globalAlpha = shade; context.fillStyle = shadeColor; context.fillRect(0, 0, width, height);
  }
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'destination-in';
  context.drawImage(source, 0, 0);
  return canvas;
}

/** 依調色盤產生多組葉片筆刷；palette 為 [{ tint, amount, lift }]，每組再分明暗兩階。 */
export function leafBrushes(leaves, palette) {
  const brushes = [];
  for (const tone of palette) {
    for (const { canvas, axis } of leaves) {
      brushes.push({ canvas: recolor(canvas, tone), axis, dark: false });
      brushes.push({ canvas: recolor(canvas, { ...tone, shade: 0.38 }), axis, dark: true });
    }
  }
  return brushes;
}

/** 葉叢：上百片葉子以葉柄朝內、葉尖朝外的方式排成不規則團塊，內層較暗。 */
export function drawLeafCluster(brushes, rand, { size = 512, count = 120, radius = 0.4, leafSize = [0.13, 0.2], twigs = 7, lumps = 3, twigColor = [76, 61, 42] } = {}) {
  const canvas = makeCanvas(size, size), context = canvas.getContext('2d', { willReadFrequently: true });
  const center = size / 2, phase = [rand() * TAU, rand() * TAU, rand() * TAU];
  const outline = a => 0.8 + 0.12 * Math.sin(a * lumps + phase[0]) + 0.08 * Math.sin(a * (lumps + 2) + phase[1]);
  context.lineCap = 'round';
  for (let i = 0; i < twigs; i++) {
    const a = rand() * TAU, length = size * radius * outline(a) * (0.75 + rand() * 0.3);
    const [r, g, b] = twigColor;
    context.strokeStyle = `rgb(${r + rand() * 18},${g + rand() * 14},${b + rand() * 10})`;
    context.lineWidth = size * (0.006 + rand() * 0.006);
    context.beginPath(); context.moveTo(center, center);
    context.quadraticCurveTo(center + Math.cos(a + 0.35) * length * 0.5, center + Math.sin(a + 0.35) * length * 0.5, center + Math.cos(a) * length, center + Math.sin(a) * length);
    context.stroke();
  }
  const leaves = [];
  for (let i = 0; i < count; i++) {
    const a = rand() * TAU, r = Math.pow(rand(), 0.55) * size * radius * outline(a);
    const inner = r < size * radius * 0.45;
    const pool = brushes.filter(brush => brush.dark === (inner ? rand() < 0.7 : rand() < 0.18));
    leaves.push({ a, r, brush: pool[Math.floor(rand() * pool.length)], length: size * (leafSize[0] + rand() * (leafSize[1] - leafSize[0])), jitter: (rand() - 0.5) * 1.3, flip: rand() < 0.5 });
  }
  leaves.sort((p, q) => p.r - q.r);
  for (const leaf of leaves) {
    const { canvas: image, axis } = leaf.brush;
    const scale = leaf.length / Math.max(image.width, image.height);
    const direction = leaf.a + leaf.jitter;
    const x = center + Math.cos(leaf.a) * leaf.r + Math.cos(direction) * leaf.length * 0.32;
    const y = center + Math.sin(leaf.a) * leaf.r + Math.sin(direction) * leaf.length * 0.32;
    context.save();
    context.translate(x, y);
    context.rotate(leaf.flip ? direction + axis : direction - axis);
    context.scale(scale, leaf.flip ? -scale : scale);
    context.drawImage(image, -image.width / 2, -image.height / 2);
    context.restore();
  }
  return canvas;
}

/** 松枝：中央枝條兩側交錯排列針葉小枝，越往枝端越短，形成扁平而濃密的枝葉。 */
export function drawPineBranch(twig, rand, { width = 512, height = 256 } = {}) {
  const canvas = makeCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
  const middle = height / 2;
  const variants = [recolor(twig, { tint: '#24452a', amount: 0.55, shade: 0.3 }), recolor(twig, { tint: '#2f5530', amount: 0.5 }), recolor(twig, { tint: '#3d6436', amount: 0.45, lift: 0.12 })];
  context.fillStyle = '#3e3022';
  context.beginPath(); context.moveTo(0, middle - 3.5); context.quadraticCurveTo(width * 0.5, middle - 2.5, width * 0.97, middle - 0.8);
  context.lineTo(width * 0.97, middle + 0.8); context.quadraticCurveTo(width * 0.5, middle + 2.5, 0, middle + 3.5); context.fill();
  const twigs = [];
  for (let i = 0; i < 96; i++) {
    const t = Math.pow(rand(), 0.85), side = rand() < 0.5 ? -1 : 1;
    twigs.push({ t, side, angle: side * (0.5 + rand() * 0.75), scale: (1.05 - t * 0.55) * (0.75 + rand() * 0.35), variant: variants[Math.floor(rand() * variants.length)], lift: rand() });
  }
  twigs.push({ t: 0.94, side: 0, angle: 0, scale: 0.55, variant: variants[1], lift: 1 });
  twigs.sort((p, q) => p.lift - q.lift);
  for (const item of twigs) {
    const length = height * 0.5 * item.scale, scale = length / twig.height;
    const baseX = width * (0.03 + item.t * 0.9), baseY = middle + (rand() - 0.5) * 6;
    const x = baseX + Math.cos(item.angle) * length * 0.5, y = baseY + Math.sin(item.angle) * length * 0.5;
    context.save();
    context.translate(x, y);
    context.rotate(item.angle + Math.PI / 2);
    context.scale(scale, scale);
    context.drawImage(item.variant, -twig.width / 2, -twig.height / 2);
    context.restore();
  }
  return canvas;
}

/** 松枝上的積雪：沿枝條堆疊的柔和雪團，與 drawPineBranch 使用相同版面。 */
export function drawPineSnow(rand, { width = 512, height = 256 } = {}) {
  const canvas = makeCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
  const middle = height / 2;
  for (let i = 0; i < 78; i++) {
    const t = Math.pow(rand(), 0.8), spread = height * (0.34 - t * 0.2);
    const x = width * (0.05 + t * 0.86), y = middle + (rand() - 0.5) * spread;
    const rx = (8 + rand() * 20) * (1 - t * 0.45), ry = rx * (0.45 + rand() * 0.35), rotation = (rand() - 0.5) * 0.7;
    context.fillStyle = '#c3d1d9';
    context.beginPath(); context.ellipse(x, y + ry * 0.25, rx, ry, rotation, 0, TAU); context.fill();
    context.fillStyle = '#f7fbfc';
    context.beginPath(); context.ellipse(x, y - ry * 0.12, rx * 0.9, ry * 0.8, rotation, 0, TAU); context.fill();
    for (let k = 0; k < 5; k++) {
      const a = rand() * TAU;
      context.beginPath(); context.arc(x + Math.cos(a) * rx * 1.05, y + Math.sin(a) * ry * 1.05, 1.2 + rand() * 2.2, 0, TAU); context.fill();
    }
  }
  return canvas;
}

/** 遠景用松樹剪影（直立圓錐、層層下垂的枝），可加積雪。 */
export function drawPineSilhouette(rand, { width = 128, height = 256, snowy = false } = {}) {
  const canvas = makeCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
  const center = width / 2, unit = width / 128;
  context.fillStyle = '#3a2c21'; context.fillRect(center - 2.5 * unit, height * 0.8, 5 * unit, height * 0.2);
  context.lineCap = 'round';
  for (let tier = 0; tier < 17; tier++) {
    const t = tier / 16, y = height * (0.88 - t * 0.83), reach = width * 0.44 * Math.pow(1 - t, 0.95) + 3 * unit;
    for (let i = 0; i < 34; i++) {
      const side = i % 2 ? 1 : -1, along = Math.sqrt(rand()) * reach, droop = along * (0.3 + rand() * 0.25);
      context.strokeStyle = `hsl(${128 + rand() * 22} ${12 + rand() * 12}% ${15 + rand() * 13}%)`;
      context.lineWidth = (1.4 + rand() * 2) * unit;
      context.beginPath(); context.moveTo(center + side * along * 0.15, y - 3 * unit); context.lineTo(center + side * along, y + droop); context.stroke();
      if (snowy && rand() < 0.6) {
        context.strokeStyle = `rgba(232,239,243,${0.55 + rand() * 0.35})`;
        context.lineWidth = (1 + rand() * 1.3) * unit;
        context.beginPath(); context.moveTo(center + side * along * 0.3, y - 4 * unit); context.lineTo(center + side * along * 0.85, y + droop - 2.5 * unit); context.stroke();
      }
    }
  }
  return canvas;
}

/** 草叢：由下而上漸亮的彎曲草葉；flowers 在草尖加上小野花。 */
export function drawGrass(rand, { width = 512, height = 256, blades = 90, hue = [78, 104], saturation = [30, 46], base = 14, tip = 58, flowers = 0, flowerColors = ['#f5f1e6', '#f2d35c', '#c8a8e6'] } = {}) {
  const canvas = makeCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
  const tips = [];
  for (let i = 0; i < blades; i++) {
    const x = width * (0.05 + rand() * 0.9), tall = height * (0.38 + Math.pow(rand(), 0.7) * 0.6), lean = (rand() - 0.5) * width * 0.2;
    const w = 3 + rand() * 5, h = hue[0] + rand() * (hue[1] - hue[0]), s = saturation[0] + rand() * (saturation[1] - saturation[0]);
    const light = rand() * 10;
    const gradient = context.createLinearGradient(0, height, 0, height - tall);
    gradient.addColorStop(0, `hsl(${h} ${s}% ${base + light * 0.4}%)`);
    gradient.addColorStop(0.55, `hsl(${h - 4} ${s + 6}% ${(base + tip) * 0.5 + light}%)`);
    gradient.addColorStop(1, `hsl(${h - 10} ${s}% ${tip + light}%)`);
    context.fillStyle = gradient;
    context.beginPath();
    context.moveTo(x - w / 2, height);
    context.quadraticCurveTo(x - w * 0.3 + lean * 0.35, height - tall * 0.55, x + lean, height - tall);
    context.quadraticCurveTo(x + w * 0.35 + lean * 0.3, height - tall * 0.5, x + w / 2, height);
    context.fill();
    tips.push([x + lean, height - tall]);
  }
  for (let i = 0; i < flowers; i++) {
    const [x, y] = tips[Math.floor(rand() * tips.length)], radius = 6 + rand() * 5, color = flowerColors[Math.floor(rand() * flowerColors.length)];
    context.fillStyle = color;
    for (let petal = 0; petal < 5; petal++) {
      const a = petal / 5 * TAU + rand() * 0.3;
      context.beginPath(); context.ellipse(x + Math.cos(a) * radius * 0.6, y + Math.sin(a) * radius * 0.6, radius * 0.55, radius * 0.32, a, 0, TAU); context.fill();
    }
    context.fillStyle = '#d99a2b';
    context.beginPath(); context.arc(x, y, radius * 0.32, 0, TAU); context.fill();
  }
  return canvas;
}

/** 蕨類羽狀複葉：葉軸兩側交錯小羽片，中段最寬。 */
export function drawFern(rand, { width = 256, height = 512, hue = 96, saturation = 38 } = {}) {
  const canvas = makeCanvas(width, height), context = canvas.getContext('2d', { willReadFrequently: true });
  const bend = (rand() - 0.5) * 0.18;
  const spine = t => [width / 2 + Math.sin(t * 2.2) * width * bend, height * (0.985 - t * 0.96)];
  context.lineCap = 'round';
  const pinnae = 30;
  for (let i = 2; i < pinnae; i++) {
    const t = i / pinnae, [x, y] = spine(t), reach = width * 0.46 * Math.sin(Math.PI * Math.min(1, 0.12 + t * 0.95)) * (0.9 + rand() * 0.15);
    for (const side of [-1, 1]) {
      const a = -Math.PI / 2 + side * (1.15 - t * 0.45), lobes = Math.max(3, Math.round(reach / 7));
      for (let k = 0; k < lobes; k++) {
        const u = (k + 0.5) / lobes, px = x + Math.cos(a) * reach * u, py = y + Math.sin(a) * reach * u + u * u * 10;
        const radius = Math.max(1.6, (1 - u * 0.75) * reach * 0.085 + 1.5);
        context.fillStyle = `hsl(${hue + rand() * 10 - 5} ${saturation + rand() * 10}% ${20 + t * 14 + u * 10 + rand() * 6}%)`;
        context.beginPath(); context.ellipse(px, py, radius * 1.5, radius, a + 0.5 * side, 0, TAU); context.fill();
      }
    }
  }
  context.strokeStyle = `hsl(${hue - 12} 34% 20%)`;
  context.lineWidth = 3;
  context.beginPath();
  for (let i = 0; i <= 40; i++) { const [x, y] = spine(i / 40); if (i) context.lineTo(x, y); else context.moveTo(x, y); }
  context.stroke();
  return canvas;
}

/** 地面落葉：秋色葉片隨機散落，作為貼地薄片使用。 */
export function drawLitter(brushes, rand, { size = 512, count = 120 } = {}) {
  const canvas = makeCanvas(size, size), context = canvas.getContext('2d', { willReadFrequently: true });
  for (let i = 0; i < count; i++) {
    const { canvas: image } = brushes[Math.floor(rand() * brushes.length)];
    const x = size * (0.08 + rand() * 0.84), y = size * (0.08 + rand() * 0.84);
    const edge = Math.hypot(x / size - 0.5, y / size - 0.5) / 0.5 + (rand() - 0.5) * 0.45;
    if (edge > 0.82) continue;
    const scale = size * (0.08 + rand() * 0.07) / Math.max(image.width, image.height);
    context.save();
    context.translate(x, y);
    context.rotate(rand() * TAU);
    context.scale(scale, scale * (0.75 + rand() * 0.25));
    context.drawImage(image, -image.width / 2, -image.height / 2);
    context.restore();
  }
  return canvas;
}

/** 轉成 GPU 貼圖：上下翻轉（與 CanvasTexture 相同方向）並把顏色向透明區外擴，避免縮圖時葉緣發黑。 */
export function toTexture(canvas, anisotropy = 4) {
  const { width, height } = canvas;
  const source = read(canvas).getImageData(0, 0, width, height).data;
  const data = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) data.set(source.subarray((height - 1 - y) * width * 4, (height - y) * width * 4), y * width * 4);
  bleed(data, width, height);
  const texture = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

function bleed(data, width, height) {
  const count = width * height;
  let known = new Uint8Array(count), r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < count; i++) if (data[i * 4 + 3] > 16) { known[i] = 1; r += data[i * 4]; g += data[i * 4 + 1]; b += data[i * 4 + 2]; n++; }
  for (let pass = 0; pass < 3; pass++) {
    const next = known.slice();
    for (let i = 0; i < count; i++) {
      if (known[i]) continue;
      const x = i % width;
      let sr = 0, sg = 0, sb = 0, c = 0, j = i - 1;
      if (x > 0 && known[j]) { sr += data[j * 4]; sg += data[j * 4 + 1]; sb += data[j * 4 + 2]; c++; }
      j = i + 1;
      if (x < width - 1 && known[j]) { sr += data[j * 4]; sg += data[j * 4 + 1]; sb += data[j * 4 + 2]; c++; }
      j = i - width;
      if (j >= 0 && known[j]) { sr += data[j * 4]; sg += data[j * 4 + 1]; sb += data[j * 4 + 2]; c++; }
      j = i + width;
      if (j < count && known[j]) { sr += data[j * 4]; sg += data[j * 4 + 1]; sb += data[j * 4 + 2]; c++; }
      if (c) { data[i * 4] = sr / c; data[i * 4 + 1] = sg / c; data[i * 4 + 2] = sb / c; next[i] = 1; }
    }
    known = next;
  }
  if (!n) return;
  for (let i = 0; i < count; i++) if (!known[i]) { data[i * 4] = r / n; data[i * 4 + 1] = g / n; data[i * 4 + 2] = b / n; }
}
