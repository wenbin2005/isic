/* hd2d（星燈港）E2E（2026-10-24）：系統 Chrome 無頭模式＋真實顯示卡；不改任何網站檔，只用遊戲內建的 window.__hd2d 測試介面與測試端注入。
   用法：在 repo 根目錄起靜態伺服器（例：python -m http.server 4174 --bind 127.0.0.1），
         再執行 node hd2d/tools/E2E驗收.cjs <輸出資料夾>；輸出資料夾預設為系統暫存區的 hd2d-e2e。
   環境變數：PLAYWRIGHT_PATH、CHROME_PATH、HD2D_URL（遊戲網址，預設 http://127.0.0.1:4174/hd2d/）、
            ONLY（只跑名稱符合此正規式的項目；第一章的項目共用同一頁，要連同前面的項目一起跑）。
   名稱以「回歸：」開頭的項目對應 2026-10-24 修正的問題（見 ../修正紀錄_20261024.md）。 */
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const BASE = process.env.HD2D_URL || 'http://127.0.0.1:4174/hd2d/';
const OUT = process.argv[2] || path.join(require('os').tmpdir(), 'hd2d-e2e');
const SHOTS = path.join(OUT, '截圖');
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
fs.mkdirSync(SHOTS, { recursive: true });
const results = [], perf = [];
let browser, gpuInfo = null;

function assert(condition, message) { if (!condition) throw new Error(message); }
function save() { fs.writeFileSync(path.join(OUT, '結果.json'), JSON.stringify({ time: new Date().toISOString(), base: BASE, gpu: gpuInfo, perf, results }, null, 1)); }
async function check(name, action) {
  if (ONLY && !ONLY.test(name)) return;
  const started = Date.now();
  try {
    const detail = await action();
    results.push({ name, pass: true, seconds: (Date.now() - started) / 1000, detail: detail ?? null });
    console.log(`通過：${name}`);
  } catch (error) {
    results.push({ name, pass: false, seconds: (Date.now() - started) / 1000, error: String(error?.message || error).slice(0, 900) });
    console.log(`失敗：${name}：${String(error?.message || error).slice(0, 300)}`);
  }
  save();
}

/* 每個頁面都注入：WebGL 資源計數、記錄建立的 AudioContext。 */
const HOOKS = () => {
  const e2e = window.__e2e = { gl: { tex: 0, buf: 0, prog: 0, fb: 0 }, audio: [] };
  const wrap = (proto, name, after) => {
    const original = proto?.[name]; if (!original) return;
    proto[name] = function (...args) { const result = original.apply(this, args); after(result, args); return result; };
  };
  const G = window.WebGL2RenderingContext?.prototype;
  wrap(G, 'createTexture', r => { if (r) e2e.gl.tex++; }); wrap(G, 'deleteTexture', (r, a) => { if (a[0]) e2e.gl.tex--; });
  wrap(G, 'createBuffer', r => { if (r) e2e.gl.buf++; }); wrap(G, 'deleteBuffer', (r, a) => { if (a[0]) e2e.gl.buf--; });
  wrap(G, 'createProgram', r => { if (r) e2e.gl.prog++; }); wrap(G, 'deleteProgram', (r, a) => { if (a[0]) e2e.gl.prog--; });
  wrap(G, 'createFramebuffer', r => { if (r) e2e.gl.fb++; }); wrap(G, 'deleteFramebuffer', (r, a) => { if (a[0]) e2e.gl.fb--; });
  const AC = window.AudioContext;
  if (AC) window.AudioContext = class extends AC { constructor(...args) { super(...args); e2e.audio.push(this); } };
};
const THROTTLE = () => { const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = cb => setTimeout(() => raf(cb), 40); };
const NO_STORAGE = () => { for (const k of ['getItem', 'setItem', 'removeItem']) Storage.prototype[k] = () => { throw new DOMException('blocked', 'SecurityError'); }; };
const NO_WEBGL = () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (type, ...a) { return /webgl/i.test(type) ? null : g.call(this, type, ...a); }; };

async function open({ viewport = { width: 1280, height: 720 }, mobile = false, init = [], reducedMotion = 'no-preference', storage = null, waitTitle = true } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, reducedMotion, locale: 'zh-TW' });
  await context.addInitScript(HOOKS);
  // 只在分頁第一次載入時寫入（重新整理不覆蓋），用來準備存檔或偏好
  if (storage) await context.addInitScript(s => { if (!sessionStorage.getItem('__seeded')) { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, storage);
  for (const script of init) await context.addInitScript(script);
  const page = await context.newPage();
  const errors = [], bad = [];
  page.on('pageerror', e => errors.push(`pageerror：${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console：${m.text().slice(0, 200)}`); });
  page.on('response', r => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', r => bad.push(`failed ${r.url()}`));
  const t0 = Date.now();
  await page.goto(BASE, { waitUntil: 'load' });
  if (waitTitle) await untilMode(page, ['title'], 60000);
  return { context, page, errors, bad, loadSeconds: (Date.now() - t0) / 1000 };
}

const st = page => page.evaluate(() => window.__hd2d.state());
const shot = (page, name) => page.screenshot({ path: path.join(SHOTS, `${name}.jpg`), type: 'jpeg', quality: 80 });
const dom = (page, fn, arg) => page.evaluate(fn, arg);
async function untilMode(page, modes, timeout = 60000) { await page.waitForFunction(m => m.includes(window.__hd2d?.state().mode), modes, { timeout }); }
// 依遊戲內時間按住按鍵，幀率不同時位移仍一致
async function hold(page, keys, seconds) {
  const t0 = (await st(page)).playTime;
  for (const k of [].concat(keys)) await page.keyboard.down(k);
  await page.waitForFunction(([t0, s]) => window.__hd2d.state().playTime >= t0 + s, [t0, seconds], { timeout: 60000 });
  for (const k of [].concat(keys)) await page.keyboard.up(k);
}
async function settle(page, n = 4) {
  const f0 = (await st(page)).frames;
  await page.waitForFunction(([f0, n]) => window.__hd2d.state().frames >= f0 + n, [f0, n], { timeout: 30000 });
}
// 推進劇情：對話中按空白鍵，直到條件成立
async function until(page, pred, label, timeout = 120000) {
  const t0 = Date.now();
  for (;;) {
    const s = await st(page);
    if (pred(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error(`等待逾時：${label}（mode ${s.mode}）`);
    if (s.mode === 'dialogue') await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
}
async function goNear(page, x, z, r = 1.0) {
  await page.evaluate(([x, z, r]) => {
    const h = window.__hd2d, g = h.ground(x, z);
    for (const rr of [r, r + 0.2, r - 0.15, r + 0.4]) for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, px = x + Math.cos(a) * rr, pz = z + Math.sin(a) * rr;
      const ok = [[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].every(([ox, oz]) => !h.blocked(px + ox, pz + oz) && Math.abs(h.ground(px + ox, pz + oz) - g) < 0.3);
      if (ok) return h.teleport(px, pz);
    }
    h.teleport(x, z);
  }, [x, z, r]);
  await settle(page);
}
async function talk(page, x, z, id) {
  await goNear(page, x, z);
  const s = await st(page);
  assert(s.nearest === id, `靠近 ${id} 時互動對象是 ${s.nearest}`);
  await page.keyboard.press('Space');
  await untilMode(page, ['dialogue']);
}
async function newGame(page) {
  await page.click('#start');
  await page.evaluate(() => window.__hd2d.battleSpeed(4));
  return until(page, s => s.mode === 'play', '開場對話與章節標題', 60000);
}
async function fresh(opts) { const o = await open(opts); await newGame(o.page); return o; }
async function battleMenu(page, timeout = 30000) { await page.waitForFunction(() => window.__hd2d.state().battle?.mode === 'menu', null, { timeout }); }
async function heroTurn(page, timeout = 30000) { await page.waitForFunction(() => { const b = window.__hd2d.state().battle; return b?.mode === 'menu' && b.actor === '旅人'; }, null, { timeout }); }
async function resultPanel(page, timeout = 90000) { await page.waitForFunction(() => { const r = document.querySelector('.b-result'); return r && !r.hidden; }, null, { timeout }); }
async function fps(page, ms = 2000) {
  return page.evaluate(ms => new Promise(res => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < ms) requestAnimationFrame(f); else res(Math.round(n * 1000 / (performance.now() - t0))); }; requestAnimationFrame(f); }), ms);
}
async function measure(page, label, quality) {
  await page.waitForTimeout(1500);
  const f = await fps(page);
  const s = await st(page);
  const row = { label, quality, fps: f, calls: s.calls, gl: await dom(page, () => ({ ...window.__e2e.gl })) };
  perf.push(row);
  return row;
}
async function watchModes(page) {
  await page.evaluate(() => { const log = window.__modes = []; let last = null; const f = () => { const m = window.__hd2d.state().mode; if (m !== last) { log.push([m, Math.round(performance.now())]); last = m; } requestAnimationFrame(f); }; f(); });
}
async function touch(page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
  return { start: (x, y) => send('touchStart', [{ x, y, id: 1 }]), move: (x, y) => send('touchMove', [{ x, y, id: 1 }]), end: () => send('touchEnd', []), cancel: () => send('touchCancel', []) };
}
const menuOpen = page => dom(page, () => ({ menu: document.getElementById('menu').open, help: document.getElementById('help').open, mode: window.__hd2d.state().mode }));
const readSave = page => dom(page, () => { try { return JSON.parse(localStorage.getItem('hd2d-save')); } catch { return 'unreadable'; } });

// 存檔樣板（格式同 main.js saveGame）；hp/sp 給大數字，讀檔時會被夾到上限
const ALL_W = ['w-beach', 'w-gate', 'w-f1', 'w-f2', 'w-f3', 'w-f4', 'w-f5', 'w-r1', 'w-r2', 'w-r3', 'w-r4'];
const GUARDS = ['g-shrine', 'g-pier', 'g-field'];
const CH2 = { metKeeper: true, miraJoined: true, merchantGift: true, lit: true, seinJoined: true, forestEntered: true, campTalk: true };
function saveJson({ flags = {}, found = 0, frags = [], lv = 1, members = ['hero'], items = { herb: 2, dew: 1, feather: 1 }, defeated = [], chests = [], pos = [18, 20.5], playTime = 60 } = {}) {
  return JSON.stringify({ v: 1, flags, found, frags, party: members.map(id => ({ id, lv, exp: 0, hp: 99999, sp: 99999 })), items, revealed: {}, defeated, chests, pos, playTime });
}
const LATE = (extra = {}) => saveJson({ flags: { ...CH2, ...extra.flags }, found: 3, frags: ['shrine', 'pier', 'field'], lv: 20, members: ['hero', 'mira', 'sein'], defeated: [...GUARDS, ...ALL_W, ...(extra.defeated || [])], pos: extra.pos || [26.5, -12.4] });

async function main() {
  browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });

  // ---------- 載入與開場（共用同一頁做第一章的連續流程） ----------
  const main = await open();
  const P = main.page;
  await check('載入：標題畫面、焦點在「開始冒險」、沒有存檔不顯示「繼續冒險」、互動前不建立聲音、資源全部成功', async () => {
    await P.waitForTimeout(800);
    const info = await dom(P, () => {
      const gl = document.getElementById('game').getContext('webgl2'), ext = gl.getExtension('WEBGL_debug_renderer_info');
      return { focus: document.activeElement?.id, cont: !document.getElementById('continue').hidden, loadingHidden: document.getElementById('loading').hidden, audio: window.__e2e.audio.length, renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER), resources: performance.getEntriesByType('resource').length };
    });
    gpuInfo = info.renderer;
    const s = await st(P);
    await shot(P, '01-標題');
    assert(s.mode === 'title' && info.loadingHidden, `mode ${s.mode}`);
    assert(info.focus === 'start', `焦點在 ${info.focus}`);
    assert(!info.cont, '沒有存檔卻顯示繼續冒險');
    assert(info.audio === 0 && s.audio.ctx === 'none', '互動前就建立了 AudioContext');
    assert(main.bad.length === 0, main.bad.join('；'));
    assert(main.errors.length === 0, main.errors.join('；'));
    const row = await measure(P, '標題', 'high');
    return { loadSeconds: main.loadSeconds, resources: info.resources, renderer: info.renderer, ...row };
  });

  await check('開場：打字中按空白鍵先顯示整句、再按換下一句；第一章標題後進入遊玩，配樂為小鎮', async () => {
    await watchModes(P);
    await P.click('#start');
    await P.evaluate(() => window.__hd2d.battleSpeed(4));
    await untilMode(P, ['dialogue']);
    await P.waitForTimeout(120);
    const typing = await dom(P, () => document.getElementById('dialogue-text').textContent);
    await P.keyboard.press('Space'); await P.waitForTimeout(60);
    const full = await dom(P, () => ({ text: document.getElementById('dialogue-text').textContent, complete: document.getElementById('dialogue').classList.contains('complete') }));
    await P.keyboard.press('Space'); await P.waitForTimeout(60);
    const next = await dom(P, () => document.getElementById('dialogue-text').textContent);
    await shot(P, '02-開場對話');
    assert(full.complete && full.text.length > typing.length, `打字中「${typing}」→ 按鍵後「${full.text}」`);
    assert(next !== full.text, '第二次按鍵沒有換句');
    const s = await until(P, s => s.mode === 'play', '開場');
    const modes = (await dom(P, () => window.__modes)).map(m => m[0]);
    assert(modes.includes('cutscene'), `沒有章節標題階段：${modes.join('→')}`);
    assert(s.chapter === 1 && s.party.length === 1, `章 ${s.chapter}`);
    assert(s.audio.ctx === 'running' && s.audio.track === 'town', JSON.stringify(s.audio));
    await shot(P, '03-小鎮遊玩');
    return { modes, audio: s.audio, ...(await measure(P, '小鎮', 'high')) };
  });

  await check('行走：四方向位移、放開即停、斜走不加速', async () => {
    const moves = {};
    for (const [k, dx, dz] of [['KeyW', 0, -1], ['KeyS', 0, 1], ['KeyA', -1, 0], ['KeyD', 1, 0], [['KeyW', 'KeyD'], 0.707, -0.707]]) {
      await P.evaluate(() => window.__hd2d.teleport(19.0, 16.5)); await settle(P);
      const a = (await st(P)).player;
      await hold(P, k, 0.35);
      const b = (await st(P)).player;
      await P.waitForTimeout(300);
      const c = (await st(P)).player;
      const mx = b.x - a.x, mz = b.z - a.z, len = Math.hypot(mx, mz);
      moves[[].concat(k).join('+')] = { dist: +len.toFixed(2), cos: +((mx * dx + mz * dz) / (len || 1)).toFixed(3), drift: +Math.hypot(c.x - b.x, c.z - b.z).toFixed(3) };
    }
    for (const [k, m] of Object.entries(moves)) {
      assert(m.cos > 0.95, `${k} 方向不對 ${JSON.stringify(m)}`);
      assert(m.dist > 0.9 && m.dist < 1.5, `${k} 位移 ${m.dist}（預期約 1.19）`);
      assert(m.drift < 0.02, `${k} 放開後仍移動 ${m.drift}`);
    }
    assert(moves['KeyW+KeyD'].dist <= moves.KeyW.dist * 1.08, '斜走比直走快');
    return moves;
  });

  await check('碰撞與地形：水井擋路、高台邊緣不能直接爬、石階可走上高台（落地後量高度）', async () => {
    await P.evaluate(() => window.__hd2d.teleport(19.5, 16.2)); await settle(P);
    await hold(P, 'KeyW', 1.5);
    const well = (await st(P)).player;
    await P.evaluate(() => window.__hd2d.teleport(5.5, 9.6)); await settle(P);
    await hold(P, 'KeyW', 1.2);
    const edge = (await st(P)).player;
    await P.evaluate(() => window.__hd2d.teleport(7.5, 11.5)); await settle(P);
    await hold(P, 'KeyW', 0.8);
    const right = (await st(P)).player;
    await P.waitForTimeout(600);
    const later = (await st(P)).player;
    const top = await dom(P, ([x, z]) => window.__hd2d.ground(x, z), [later.x, later.z]);
    assert(well.z > 15.2, `水井沒擋住 z ${well.z}`);
    assert(edge.z > 9.2 && edge.y < 0.3, `爬上高台邊緣 z ${edge.z} y ${edge.y}`);
    assert(later.y > 0.9 && Math.abs(later.y - top) < 0.05, `石階後高度 ${later.y}（地面 ${top}）`);
    return { well, edge, stairsRightAfterKeyUp: right, stairsSettled: later, plateau: top };
  });

  await check('視窗失焦時清除按住的方向鍵', async () => {
    await P.evaluate(() => window.__hd2d.teleport(20.5, 16.0)); await settle(P);
    await P.keyboard.down('KeyS');
    await P.waitForTimeout(250);
    await P.evaluate(() => window.dispatchEvent(new Event('blur')));
    await settle(P, 2);
    const a = (await st(P)).player;
    await P.waitForTimeout(500);
    const b = (await st(P)).player;
    await P.keyboard.up('KeyS');
    assert(Math.hypot(b.x - a.x, b.z - a.z) < 0.02, `失焦後仍在走 ${JSON.stringify([a, b])}`);
  });

  await check('守燈人接下委託：目標更新並寫入存檔', async () => {
    await talk(P, 30.5, 24.6, 'keeper');
    await P.waitForTimeout(500);
    await shot(P, '04-守燈人對話');
    const s = await until(P, s => s.mode === 'play', '守燈人');
    const obj = await dom(P, () => document.getElementById('objective-text').textContent);
    const sv = await readSave(P);
    assert(s.flags.metKeeper && sv?.flags?.metKeeper, '旗標或存檔沒更新');
    assert(obj.includes('尋找星之碎片'), `目標 ${obj}`);
    return { objective: obj };
  });

  await check('米菈加入、旅行商人送 2 個回復藥草', async () => {
    await talk(P, 30.4, 10.6, 'florist');
    let s = await until(P, s => s.mode === 'play', '米菈');
    assert(s.party.length === 2 && s.flags.miraJoined, '米菈沒加入');
    const herb0 = s.items.herb;
    await talk(P, 22.2, 15.6, 'merchant');
    s = await until(P, s => s.mode === 'play', '商人');
    assert(s.items.herb === herb0 + 2, `藥草 ${herb0} → ${s.items.herb}`);
    return { party: s.party.map(r => r.id), herb: s.items.herb };
  });

  await check('寶箱：取得道具、打開後不能再互動、寫入存檔', async () => {
    const before = (await st(P)).items;
    await goNear(P, 3.5, 19.5, 1.0);
    assert((await st(P)).nearest === 'chest', `互動對象 ${(await st(P)).nearest}`);
    await P.keyboard.press('Space');
    await P.waitForTimeout(700);
    const s = await st(P);
    await shot(P, '05-寶箱');
    assert(s.items.herb === before.herb + 1 && s.items.dew === before.dew + 1, `道具 ${JSON.stringify(before)} → ${JSON.stringify(s.items)}`);
    assert(s.chests.includes('c-town') && s.nearest !== 'chest', '寶箱仍可互動');
    assert((await readSave(P))?.chests?.includes('c-town'), '存檔沒有寶箱紀錄');
  });

  await check('暫停選單：Esc 開啟、焦點在選單內、遊戲時間停止；對話中按 Esc 不開選單', async () => {
    await P.evaluate(() => window.__hd2d.teleport(20.5, 16.0)); await settle(P);
    await P.keyboard.press('Escape');
    await P.waitForTimeout(300);
    const m = await menuOpen(P);
    const focusIn = await dom(P, () => document.getElementById('menu').contains(document.activeElement));
    const t0 = (await st(P)).playTime; await P.waitForTimeout(800); const t1 = (await st(P)).playTime;
    await shot(P, '06-暫停選單');
    await P.click('#resume'); await P.waitForTimeout(300);
    assert(m.menu && m.mode === 'paused', JSON.stringify(m));
    assert(focusIn, '焦點不在選單內');
    assert(t1 === t0, `暫停時遊戲時間仍增加 ${t0} → ${t1}`);
    await talk(P, 17.5, 12.6, 'sign');
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    const d = await menuOpen(P);
    await until(P, s => s.mode === 'play', '告示牌');
    assert(!d.menu && d.mode === 'dialogue', `對話中按 Esc：${JSON.stringify(d)}`);
  });

  await check('回歸：暫停選單開著時按 Esc 應關閉選單並回到遊戲', async () => {
    await P.evaluate(() => window.__hd2d.teleport(20.5, 16.0)); await settle(P);
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    const opened = await menuOpen(P);
    // 模擬真人按鍵：按住 80 毫秒才放開（keyboard.press 會在 1 毫秒內放開，剛好早於 dialog 的 close 事件，會假通過）
    await P.keyboard.down('Escape'); await P.waitForTimeout(80); await P.keyboard.up('Escape');
    await P.waitForTimeout(400);
    const after = await menuOpen(P);
    await shot(P, '07-選單按Esc後');
    if (after.menu) { await P.click('#resume'); await P.waitForTimeout(300); }
    assert(opened.menu, '第一次 Esc 沒開選單');
    assert(!after.menu && after.mode === 'play', `第二次 Esc（按住 80 毫秒）後：${JSON.stringify(after)}`);
  });

  await check('滑鼠點選單鈕、按「繼續遊戲」後，再按空白鍵不重開選單', async () => {
    await P.evaluate(() => window.__hd2d.teleport(20.5, 16.0)); await settle(P);
    await P.click('#menu-btn'); await P.waitForTimeout(300);
    await P.click('#resume'); await P.waitForTimeout(300);
    const focus = await dom(P, () => document.activeElement?.id || document.activeElement?.tagName);
    await P.keyboard.down('Space'); await P.waitForTimeout(80); await P.keyboard.up('Space'); await P.waitForTimeout(400);
    const m = await menuOpen(P);
    if (m.menu) { await P.click('#resume'); await P.waitForTimeout(300); }
    assert(!m.menu && m.mode === 'play', `空白鍵後：${JSON.stringify(m)}（按鍵前焦點 ${focus}）`);
    return { focus };
  });

  await check('聲音：只有音效、關閉、再開啟，偏好保存到 localStorage', async () => {
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    await P.selectOption('#sound-select', 'sfx'); await P.waitForTimeout(250); const a = (await st(P)).audio;
    await P.selectOption('#sound-select', 'off'); await P.waitForTimeout(250); const b = (await st(P)).audio;
    await P.selectOption('#sound-select', 'all'); await P.waitForTimeout(400); const c = (await st(P)).audio;
    await P.selectOption('#sound-select', 'sfx'); await P.waitForTimeout(100);
    const pref = await dom(P, () => localStorage.getItem('hd2d-sound'));
    await P.selectOption('#sound-select', 'all');
    await P.click('#resume'); await P.waitForTimeout(300);
    assert(a.track === null && a.ctx === 'running', `只有音效 ${JSON.stringify(a)}`);
    assert(b.ctx === 'suspended', `關閉 ${JSON.stringify(b)}`);
    assert(c.ctx === 'running' && c.track === 'town', `開啟 ${JSON.stringify(c)}`);
    assert(pref === 'sfx', `偏好 ${pref}`);
    return { sfx: a, off: b, all: c };
  });

  await check('分頁隱藏時聲音暫停、回來後恢復', async () => {
    const set = hidden => P.evaluate(h => { Object.defineProperty(document, 'hidden', { value: h, configurable: true }); Object.defineProperty(document, 'visibilityState', { value: h ? 'hidden' : 'visible', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
    await set(true); await P.waitForTimeout(300); const a = (await st(P)).audio.ctx;
    await set(false); await P.waitForTimeout(300); const b = (await st(P)).audio.ctx;
    assert(a === 'suspended' && b === 'running', `${a} → ${b}`);
  });

  await check('回到標題畫面：保留存檔並顯示「繼續冒險」，讀檔後位置、旗標、寶箱還原', async () => {
    const before = await st(P);
    await P.evaluate(() => window.__hd2d.teleport(20.5, 16.0)); await settle(P);
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    const sv = await readSave(P);
    await Promise.all([P.waitForEvent('load'), P.click('#restart')]);
    await untilMode(P, ['title']);
    await P.waitForTimeout(500);
    const t = await dom(P, () => ({ cont: !document.getElementById('continue').hidden, start: document.getElementById('start').textContent, focus: document.activeElement?.id }));
    await shot(P, '08-有存檔的標題');
    await P.click('#continue');
    await P.evaluate(() => window.__hd2d.battleSpeed(4));
    await untilMode(P, ['play']);
    const s = await st(P);
    assert(t.cont && t.start === '新的冒險' && t.focus === 'continue', JSON.stringify(t));
    assert(Math.abs(s.player.x - sv.pos[0]) < 0.05 && Math.abs(s.player.z - sv.pos[1]) < 0.05, `位置 ${JSON.stringify(s.player)} vs 存檔 ${sv.pos}`);
    assert(s.flags.miraJoined && s.party.length === 2 && s.chests.includes('c-town'), '旗標或寶箱沒還原');
    assert(s.items.herb === before.items.herb, '道具數不同');
    return { title: t, savedPos: sv.pos };
  });

  await check('「新的冒險」第一次只改文字、存檔仍在、4 秒後還原；連按兩次才清除存檔', async () => {
    await P.keyboard.press('Escape'); await P.waitForTimeout(300);
    await Promise.all([P.waitForEvent('load'), P.click('#restart')]);
    await untilMode(P, ['title']);
    await P.click('#start');
    const once = await dom(P, () => ({ text: document.getElementById('start').textContent, save: !!localStorage.getItem('hd2d-save'), mode: window.__hd2d.state().mode }));
    await P.waitForTimeout(4300);
    const reverted = await dom(P, () => document.getElementById('start').textContent);
    await P.click('#start'); await P.click('#start');
    const twice = await dom(P, () => ({ save: localStorage.getItem('hd2d-save'), mode: window.__hd2d.state().mode }));
    assert(once.text.includes('再按一次') && once.save && once.mode === 'title', JSON.stringify(once));
    assert(reverted === '新的冒險', `4 秒後文字 ${reverted}`);
    assert(twice.save === null && twice.mode === 'dialogue', JSON.stringify(twice));
    await P.evaluate(() => window.__hd2d.battleSpeed(4));
    await until(P, s => s.mode === 'play', '新的冒險');
    return { once, reverted };
  });

  await check('沒有頁面錯誤（第一章連續流程）', async () => { assert(main.errors.length === 0, main.errors.join('；')); assert(main.bad.length === 0, main.bad.join('；')); });
  await main.context.close();

  // ---------- 戰鬥 ----------
  await check('戰鬥（手動）：守衛不能逃跑、蓄力上限為持有 BP、選目標可用 Esc 返回、攻擊扣血、蓄力後下回合不加 BP', async () => {
    const { page, context, errors } = await fresh();
    await page.evaluate(() => { window.__hd2d.setLevel(3); window.__hd2d.teleport(7.0, 7.1); });
    await untilMode(page, ['battle']);
    await heroTurn(page);
    await page.waitForTimeout(400);
    await shot(page, '10-戰鬥選單');
    const row = await measure(page, '戰鬥（守衛）', 'high');
    const esc = await dom(page, () => document.querySelectorAll('.b-list .b-item')[4]?.getAttribute('aria-disabled'));
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space'); await page.waitForTimeout(200);
    const deny = await dom(page, () => ({ desc: document.querySelector('.b-desc').textContent, mode: window.__hd2d.state().battle.mode }));
    await page.keyboard.press('ArrowDown');
    const bp0 = (await st(page)).battle.party[0].bp;
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    const boost = await dom(page, () => document.querySelector('.b-bval').textContent);
    await page.keyboard.press('Space'); await page.waitForTimeout(200);
    const target = (await st(page)).battle.mode;
    await shot(page, '11-戰鬥選目標');
    await page.keyboard.press('Escape'); await page.waitForTimeout(200);
    const back = await menuOpen(page);
    const backMode = (await st(page)).battle.mode;
    const hp0 = (await st(page)).battle.enemies.reduce((a, e) => a + e.hp, 0);
    await page.keyboard.press('Space'); await page.waitForTimeout(150); await page.keyboard.press('Space');
    await page.waitForFunction(h => window.__hd2d.state().battle.enemies.reduce((a, e) => a + e.hp, 0) < h, hp0, { timeout: 20000 });
    const bpAfter = (await st(page)).battle.party[0].bp;
    await heroTurn(page);
    const bpNext = (await st(page)).battle.party[0].bp;
    await page.evaluate(() => window.__hd2d.battleAuto(true));
    const s = await until(page, s => s.mode === 'play', '守衛戰');
    await context.close();
    assert(esc === 'true', `逃跑 aria-disabled=${esc}`);
    assert(deny.desc.includes('無法逃跑') && deny.mode === 'menu', JSON.stringify(deny));
    assert(bp0 === 1 && boost === '蓄力 1', `第一回合 BP ${bp0}、按四次 → ${boost}`);
    assert(target === 'target' && backMode === 'menu' && !back.menu, `選目標 ${target} → Esc ${backMode}，暫停選單 ${back.menu}`);
    assert(bpAfter === 0 && bpNext === 0, `蓄力後 BP ${bpAfter}，下回合 ${bpNext}（應不加）`);
    assert(s.defeated.includes('g-shrine'), '沒打倒守衛');
    assert(errors.length === 0, errors.join('；'));
    return { bp0, boost, bpAfter, bpNext, ...row };
  });

  await check('戰鬥勝利面板：手動打完顯示經驗值，按空白鍵回到地圖並存檔', async () => {
    const { page, context, errors } = await fresh();
    await page.evaluate(() => { window.__hd2d.setLevel(20); window.__hd2d.teleport(31.6, 6.7); });
    await untilMode(page, ['battle']);
    for (let i = 0; i < 12; i++) {
      const done = await page.waitForFunction(() => { const b = window.__hd2d.state().battle; const r = document.querySelector('.b-result'); return (r && !r.hidden) || (b?.mode === 'menu' && b.actor === '旅人') ? (r && !r.hidden ? 'result' : 'menu') : false; }, null, { timeout: 30000 }).then(h => h.jsonValue());
      if (done === 'result') break;
      await page.keyboard.press('Space'); await page.waitForTimeout(120); await page.keyboard.press('Space');
      await page.waitForTimeout(300);
    }
    await page.waitForTimeout(500);
    const panel = await dom(page, () => ({ title: document.querySelector('.b-result h2').textContent, body: document.querySelector('.b-result-body').textContent, buttons: [...document.querySelectorAll('.b-result .actions button')].map(b => b.textContent) }));
    await shot(page, '12-勝利面板');
    await page.keyboard.press('Space');
    const s = await until(page, s => s.mode === 'play', '勝利後');
    const sv = await readSave(page);
    await context.close();
    assert(panel.title === '勝利' && panel.body.includes('獲得經驗值') && panel.buttons.join() === '繼續', JSON.stringify(panel));
    assert(s.defeated.includes('g-field') && sv.defeated.includes('g-field'), '勝利沒存檔');
    assert(errors.length === 0, errors.join('；'));
    return panel;
  });

  await check('一般遭遇可以逃跑；逃跑後同一隻影獸 4 秒內不會再撞上，之後會再次遭遇', async () => {
    const { page, context, errors } = await fresh();
    await page.evaluate(() => window.__hd2d.teleport(12.5, 23.4));
    await untilMode(page, ['battle']);
    await heroTurn(page);
    const esc = await dom(page, () => document.querySelectorAll('.b-list .b-item')[4]?.getAttribute('aria-disabled'));
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
    await untilMode(page, ['play']);
    const t0 = Date.now(); let modes = new Set();
    while (Date.now() - t0 < 3000) { modes.add((await st(page)).mode); await page.waitForTimeout(150); }
    await untilMode(page, ['battle'], 15000);
    const again = (Date.now() - t0) / 1000;
    await heroTurn(page);
    await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
    await untilMode(page, ['play']);
    await context.close();
    assert(esc === 'false', `逃跑 aria-disabled=${esc}`);
    assert(!modes.has('battle'), `逃跑後 3 秒內又進入戰鬥：${[...modes]}`);
    assert(errors.length === 0, errors.join('；'));
    return { secondEncounterAfter: again };
  });

  // 全滅：等級 1 的旅人獨自打古塔的暗影騎士（820 HP、攻擊 50，自動戰鬥），一定會輸（霧狼會被 1 級旅人打贏）
  const lose = await fresh();
  await check('全滅面板：「再試一次」讓全員完全回復後重打', async () => {
    const { page } = lose;
    await page.evaluate(() => { window.__hd2d.battleAuto(true); window.__hd2d.teleport(22.0, -24.2); });
    await untilMode(page, ['battle']);
    await resultPanel(page);
    await page.waitForTimeout(400);
    const panel = await dom(page, () => ({ title: document.querySelector('.b-result h2').textContent, buttons: [...document.querySelectorAll('.b-result .actions button')].map(b => b.textContent) }));
    await shot(page, '13-全滅面板');
    await page.click('.b-result .actions button:nth-child(1)');
    const retry = await page.waitForFunction(() => { const b = window.__hd2d.state().battle; const r = document.querySelector('.b-result'); return b && r.hidden && b.party[0].hp > 0 ? b.party[0] : false; }, null, { timeout: 20000 }).then(h => h.jsonValue());
    assert(panel.title.includes('全員倒下') && panel.buttons.join() === '再試一次,撤退', JSON.stringify(panel));
    assert(retry.hp === 150 && retry.sp === 30, `重打時 HP ${retry.hp} SP ${retry.sp}（應為 150／30）`);
    return { panel, retry };
  });

  await check('回歸：全滅後選「撤退」，隊伍應完全回復', async () => {
    const { page, errors } = lose;
    await resultPanel(page);
    await page.waitForTimeout(300);
    await page.click('.b-result .actions button:nth-child(2)');
    const s = await until(page, s => s.mode === 'play', '撤退');
    const hud = await dom(page, () => document.querySelector('#party-hud .bar')?.getAttribute('title'));
    await shot(page, '14-撤退後');
    assert(errors.length === 0, errors.join('；'));
    assert(s.party[0].hp === s.party[0].maxHp, `撤退後 HP ${s.party[0].hp}/${s.party[0].maxHp}、SP ${s.party[0].sp}（HUD ${hud}）`);
  });
  await lose.context.close();

  await check('水井休息：全員回復、被打倒的遊蕩影獸重新出現、寫入存檔', async () => {
    const { page, context, errors } = await fresh();
    await page.evaluate(() => { window.__hd2d.battleAuto(true); window.__hd2d.teleport(12.5, 23.4); });
    await untilMode(page, ['battle']);
    let s = await until(page, s => s.mode === 'play', '蝙蝠戰', 90000);
    assert(s.defeated.includes('w-beach'), '沒打倒蝙蝠');
    const hurt = s.party[0].hp;
    await goNear(page, 19.5, 14.5, 1.0);
    assert((await st(page)).nearest === 'rest-well', `互動對象 ${(await st(page)).nearest}`);
    await page.keyboard.press('Space');
    s = await until(page, s => s.mode === 'play', '休息');
    const toast = await dom(page, () => document.getElementById('toast').textContent);
    const sv = await readSave(page);
    await context.close();
    assert(s.party.every(r => r.hp === r.maxHp), `HP ${s.party.map(r => r.hp + '/' + r.maxHp)}`);
    assert(!s.defeated.includes('w-beach') && !sv.defeated.includes('w-beach'), '蝙蝠沒有重新出現');
    assert(toast.includes('又出現'), `提示 ${toast}`);
    assert(errors.length === 0, errors.join('；'));
    return { hpBeforeRest: hurt, toast };
  });

  // ---------- 頭目戰後的存檔時機 ----------
  for (const [label, flags, defeated, pos, spot, id, flag] of [
    ['霧狼王', {}, [], [26.5, -12.4], [27.0, -14.6], 'b-wolfKing', 'wolfKing'],
    ['熄星者', { wolfKing: true, ruinsEntered: true }, ['b-wolfKing'], [18.5, -25.5], [18.5, -28.3], 'b-starEater', 'finished']
  ]) {
    await check(`回歸：打倒${label}後在劇情對話中重新整理，讀檔後劇情應能繼續（不能卡關）`, async () => {
      const { page, context } = await open({ storage: { 'hd2d-save': LATE({ flags, defeated, pos }), 'hd2d-quality': 'high' } });
      await page.click('#continue');
      await page.evaluate(() => { window.__hd2d.battleSpeed(4); window.__hd2d.battleAuto(true); });
      await untilMode(page, ['play']);
      await page.evaluate(([x, z]) => window.__hd2d.teleport(x, z), spot);
      await until(page, s => s.defeated.includes(id) && s.mode === 'dialogue', `${label}戰`, 240000);
      const saved = await readSave(page);
      await shot(page, `15-${label}戰後對話`);
      await page.reload({ waitUntil: 'load' });
      await untilMode(page, ['title']);
      await page.click('#continue');
      // 修正後讀檔可能直接接上終章演出（不經過 play），所以等「離開標題」就好
      await untilMode(page, ['play', 'cinematic', 'cutscene', 'dialogue']);
      const firstMode = (await st(page)).mode;
      await page.waitForTimeout(500);
      await page.evaluate(([x, z]) => window.__hd2d.teleport(x, z), spot);
      await page.waitForTimeout(2500);
      const s = await st(page);
      const info = await dom(page, () => ({ objective: document.getElementById('objective-text').textContent, mistWall: window.__hd2d.blocked(18.5, -20.5) }));
      await shot(page, `16-${label}讀檔後`);
      await context.close();
      const detail = { savedDefeated: saved.defeated.includes(id), savedFlag: !!saved.flags[flag], afterReload: { firstMode, mode: s.mode, flag: !!s.flags[flag], defeated: s.defeated.includes(id), ...info } };
      // 霧狼王：勝利當下寫的存檔就要帶旗標（熄星者的終章由讀檔時接上，存檔裡還沒有 finished 是設計如此）
      if (flag === 'wolfKing') assert(detail.savedFlag, `勝利當下寫入的存檔 defeated=${detail.savedDefeated} 但 wolfKing=${detail.savedFlag}`);
      assert(s.flags[flag] || (!s.defeated.includes(id) && s.mode !== 'play'), `讀檔後頭目已不在（defeated=${detail.afterReload.defeated}）但 ${flag}=${detail.afterReload.flag}，站在頭目位置 2.5 秒沒有戰鬥；目標仍是「${info.objective}」${label === '霧狼王' ? `，霧牆仍擋路=${info.mistWall}` : ''}`);
      return detail;
    });
  }

  // 舊版留下的卡關存檔（已打倒頭目、旗標沒設），讀檔後要能自己修好
  for (const [label, flags, defeated, pos, fixedFlag] of [
    ['霧狼王', {}, ['b-wolfKing'], [26.5, -12.4], 'wolfKing'],
    ['熄星者', { wolfKing: true, ruinsEntered: true }, ['b-wolfKing', 'b-starEater'], [18.5, -28.3], 'finished']
  ]) {
    await check(`回歸：舊版在${label}戰後台詞中關頁留下的卡關存檔，讀檔後應自動接上劇情`, async () => {
      const { page, context, errors } = await open({ storage: { 'hd2d-save': LATE({ flags, defeated, pos }), 'hd2d-quality': 'high' } });
      await page.click('#continue');
      await untilMode(page, ['play', 'cinematic', 'cutscene', 'dialogue']);
      await page.waitForTimeout(1500);
      const s = await st(page);
      const info = await dom(page, () => ({ objective: document.getElementById('objective-text').textContent, mistWall: window.__hd2d.blocked(18.5, -20.5), saved: JSON.parse(localStorage.getItem('hd2d-save')).flags }));
      await shot(page, `16b-${label}卡關存檔讀檔後`);
      await context.close();
      const detail = { mode: s.mode, wolfKing: !!s.flags.wolfKing, finished: !!s.flags.finished, ...info };
      assert(s.flags[fixedFlag], `讀檔後仍卡關：${JSON.stringify(detail)}`);
      if (label === '霧狼王') assert(!info.mistWall, `旗標補上了但霧牆仍擋路：${JSON.stringify(detail)}`);
      assert(errors.length === 0, errors.join('；'));
      return detail;
    });
  }

  // ---------- 存檔健壯性 ----------
  await check('存檔 JSON 損壞時視為沒有存檔，可以正常開新遊戲', async () => {
    const { page, context, errors } = await open({ storage: { 'hd2d-save': '{壞掉' } });
    const t = await dom(page, () => ({ cont: !document.getElementById('continue').hidden, start: document.getElementById('start').textContent }));
    await newGame(page);
    await context.close();
    assert(!t.cont && t.start === '開始冒險', JSON.stringify(t));
    assert(errors.length === 0, errors.join('；'));
  });

  await check('回歸：存檔格式合法但缺欄位（{"v":1}）時，「繼續冒險」不應讓畫面卡在半初始化', async () => {
    const { page, context, errors } = await open({ storage: { 'hd2d-save': '{"v":1}' } });
    const cont = await dom(page, () => !document.getElementById('continue').hidden);
    // 修正後缺欄位的存檔會被當成沒有存檔，「繼續冒險」不出現；沒出現就改測能不能正常開新遊戲
    if (cont) { await page.click('#continue'); await page.waitForTimeout(1500); }
    const s = await dom(page, () => {
      let mode; try { mode = window.__hd2d.state().mode; } catch (e) { mode = `state() 也失敗：${e.message}`; }
      return { mode, title: !document.getElementById('title').hidden, hud: !document.getElementById('hud').hidden, partyHudEmpty: !document.getElementById('party-hud').innerHTML, save: localStorage.getItem('hd2d-save'), start: document.getElementById('start').textContent };
    });
    await shot(page, '17-缺欄位存檔');
    if (!cont) await newGame(page);
    const after = cont ? null : await st(page);
    await context.close();
    assert(errors.length === 0, `繼續冒險鈕顯示=${cont}，按下後 ${JSON.stringify(s)}，錯誤：${errors.join('；')}`);
    assert(!cont ? s.start === '開始冒險' && after.mode === 'play' && after.party.length === 1 : true, `沒有「繼續冒險」但新遊戲狀態不對：${JSON.stringify({ s, after })}`);
    return { continueShown: cont, ...s };
  });

  await check('回歸：存檔驗證，缺一個欄位或欄位壞掉的存檔不顯示「繼續冒險」，完整的存檔照常顯示', async () => {
    const good = JSON.parse(LATE({ flags: {}, defeated: [], pos: [20.5, 16] }));
    const variants = {
      完整: good,
      缺flags: { ...good, flags: undefined }, 缺found: { ...good, found: undefined },
      缺party: { ...good, party: undefined }, 空party: { ...good, party: [] },
      不明同伴: { ...good, party: [{ ...good.party[0], id: 'nobody' }] }, 等級超過上限: { ...good, party: [{ ...good.party[0], lv: 99 }] },
      缺exp: { ...good, party: [{ ...good.party[0], exp: undefined }] }, HP不是數字: { ...good, party: [{ ...good.party[0], hp: 'x' }] },
      SP不是數字: { ...good, party: [{ ...good.party[0], sp: null }] },
      缺items: { ...good, items: undefined }, 不明道具: { ...good, items: { ...good.items, ghost: 1 } }, 道具數量壞掉: { ...good, items: { herb: 'x' } },
      缺frags: { ...good, frags: undefined }, 缺defeated: { ...good, defeated: undefined }, 缺chests: { ...good, chests: undefined },
      pos長度錯: { ...good, pos: [1] }, pos不是數字: { ...good, pos: [1, 'x'] }, 版本不對: { ...good, v: 2 }
    };
    const { page, context, errors } = await open();
    const shown = {};
    for (const [label, save] of Object.entries(variants)) {
      await page.evaluate(v => localStorage.setItem('hd2d-save', v), JSON.stringify(save));
      await page.reload({ waitUntil: 'load' });
      await untilMode(page, ['title']);
      shown[label] = await dom(page, () => !document.getElementById('continue').hidden);
    }
    await context.close();
    const wrong = Object.entries(shown).filter(([label, v]) => v !== (label === '完整')).map(([label]) => label);
    assert(wrong.length === 0, `判斷錯誤的存檔：${wrong.join('、')}（${JSON.stringify(shown)}）`);
    assert(errors.length === 0, errors.join('；'));
    return shown;
  });

  await check('localStorage 無法使用時仍可開始遊玩與行走', async () => {
    const { page, context, errors } = await open({ init: [NO_STORAGE] });
    const s0 = await newGame(page);
    await hold(page, 'KeyW', 0.5);
    const s1 = await st(page);
    await context.close();
    assert(s1.player.z < s0.player.z - 0.5, '無法行走');
    assert(errors.length === 0, errors.join('；'));
  });

  // ---------- 例外 ----------
  await check('WebGL context lost：顯示中斷說明', async () => {
    const { page, context } = await open();
    await page.evaluate(() => document.getElementById('game').getContext('webgl2').getExtension('WEBGL_lose_context').loseContext());
    await page.waitForTimeout(500);
    const e = await dom(page, () => ({ shown: !document.getElementById('error').hidden, text: document.querySelector('#error p').textContent }));
    await shot(page, '18-context-lost');
    await context.close();
    assert(e.shown && e.text.includes('重新整理'), JSON.stringify(e));
    return e;
  });

  await check('沒有 WebGL：顯示無法啟動的說明，不停在空白或載入畫面', async () => {
    const { page, context, errors } = await open({ init: [NO_WEBGL], waitTitle: false });
    await page.waitForTimeout(1500);
    const e = await dom(page, () => ({ error: !document.getElementById('error').hidden, loading: !document.getElementById('loading').hidden, text: document.querySelector('#error h2').textContent }));
    await shot(page, '19-沒有WebGL');
    await context.close();
    assert(e.error && !e.loading, JSON.stringify(e));
    return { ...e, errors };
  });

  // ---------- 效能與資源 ----------
  await check('效能：小鎮、霧之森、古塔與戰鬥的幀率與每幀繪製次數（精緻與流暢）', async () => {
    const { page, context, errors } = await open({ storage: { 'hd2d-save': LATE({ flags: { wolfKing: true, ruinsEntered: true }, defeated: ['b-wolfKing'], pos: [18, 20.5] }), 'hd2d-quality': 'high' } });
    await page.click('#continue');
    await untilMode(page, ['play']);
    const rows = [];
    for (const q of ['high', 'balanced']) {
      if (q === 'balanced') { await page.keyboard.press('Escape'); await page.waitForTimeout(300); await page.selectOption('#quality-select', 'balanced'); await page.click('#resume'); }
      for (const [label, x, z] of [['小鎮', 18, 20.5], ['霧之森', 19.5, -6.5], ['星之古塔', 18.5, -25.5]]) {
        await page.evaluate(([x, z]) => window.__hd2d.teleport(x, z), [x, z]);
        rows.push(await measure(page, `${label}（第三章存檔）`, q));
        if (q === 'high') await shot(page, `20-${label}-精緻`);
      }
    }
    await shot(page, '21-古塔-流暢');
    const pref = await dom(page, () => localStorage.getItem('hd2d-quality'));
    await page.reload({ waitUntil: 'load' });
    await untilMode(page, ['title']);
    const q = (await st(page)).quality;
    await context.close();
    assert(rows.every(r => r.fps >= 55), `幀率 ${rows.map(r => r.label + r.quality + ':' + r.fps).join('、')}`);
    assert(pref === 'balanced' && q === 'balanced', `偏好 ${pref}，重新整理後 ${q}`);
    assert(errors.length === 0, errors.join('；'));
    return rows;
  });

  await check('回歸：連續 12 場戰鬥（逃跑），暖機後 WebGL 緩衝、貼圖、程式數量不隨場數增加', async () => {
    const { page, context, errors } = await fresh();
    const counts = [];
    for (let i = 0; i < 12; i++) {
      // 每場先補滿（setLevel 會重設 HP），避免 1 級旅人連續挨打後在戰鬥中倒下
      await page.evaluate(() => { window.__hd2d.setLevel(20); window.__hd2d.teleport(12.5, 23.4); });
      await untilMode(page, ['battle'], 15000);
      await heroTurn(page);
      await page.keyboard.press('ArrowUp'); await page.keyboard.press('Space');
      await untilMode(page, ['play']);
      await page.waitForTimeout(600);
      counts.push(await dom(page, () => ({ ...window.__e2e.gl })));
      await page.evaluate(() => window.__hd2d.teleport(20.5, 16));
      await page.waitForTimeout(4200); // 等影獸的暈眩時間結束
    }
    await context.close();
    // 前幾場與開始後約半分鐘，會第一次用到某些效果（不進戰鬥的對照組也有：緩衝 +4、貼圖 +1），
    // 所以比第 6 場和第 12 場，並容許一次這樣的暖機；每場都漏的話 6 場會多 24 個緩衝
    const d = k => counts[11][k] - counts[5][k];
    assert(errors.length === 0, errors.join('；'));
    assert(d('tex') <= 1 && d('prog') <= 1 && d('fb') <= 0, `第 6→12 場：${JSON.stringify(counts[5])} → ${JSON.stringify(counts[11])}`);
    assert(d('buf') <= 4, `第 6→12 場緩衝增加 ${d('buf')} 個：${counts.map(c => c.buf).join(' → ')}`);
    return counts;
  });

  await check('自動降畫質：持續低於 28 FPS 時改為流暢並提示，不保存偏好', async () => {
    const { page, context, errors } = await open({ init: [THROTTLE] });
    const t0 = Date.now();
    await newGame(page);
    await page.waitForFunction(() => window.__hd2d.state().quality === 'balanced', null, { timeout: 40000 });
    const after = (Date.now() - t0) / 1000;
    const info = await dom(page, () => ({ toast: document.getElementById('toast').textContent, pref: localStorage.getItem('hd2d-quality'), fps: window.__hd2d.state().fps }));
    await context.close();
    assert(info.toast.includes('流暢'), `提示 ${info.toast}`);
    assert(info.pref === null, `偏好被保存為 ${info.pref}`);
    assert(errors.length === 0, errors.join('；'));
    return { secondsFromStart: after, ...info };
  });

  await check('手動選過畫質後，低幀率也不自動切換', async () => {
    const { page, context } = await open({ init: [THROTTLE], storage: { 'hd2d-quality': 'high' } });
    await newGame(page);
    await page.waitForTimeout(12000);
    const q = (await st(page)).quality;
    await context.close();
    assert(q === 'high', `畫質 ${q}`);
  });

  // ---------- 手機 ----------
  await check('手機直向 390×844：觸控按鈕顯示、搖桿行走、「調查」鈕對話、沒有橫向溢出', async () => {
    const { page, context, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
    await page.tap('#start');
    await page.evaluate(() => window.__hd2d.battleSpeed(4));
    for (let i = 0; i < 80 && (await st(page)).mode !== 'play'; i++) { if ((await st(page)).mode === 'dialogue') await page.tap('#dialogue'); await page.waitForTimeout(150); }
    const ui = await dom(page, () => ({ touch: !document.getElementById('touch').hidden, act: !!document.getElementById('act-btn').offsetParent, overflow: document.documentElement.scrollWidth - innerWidth }));
    const t = await touch(page);
    const a = (await st(page)).player;
    await t.start(100, 650); await t.move(100, 590);
    await page.waitForTimeout(800);
    await shot(page, '22-手機直向遊玩');
    await t.end();
    await page.waitForTimeout(300);
    const b = (await st(page)).player;
    await page.waitForTimeout(400);
    const c = (await st(page)).player;
    await goNear(page, 30.5, 24.6);
    await page.tap('#act-btn');
    await page.waitForTimeout(400);
    const m = (await st(page)).mode;
    await shot(page, '23-手機對話');
    await context.close();
    assert(ui.touch && ui.act && ui.overflow <= 0, JSON.stringify(ui));
    assert(b.z < a.z - 0.8 && Math.abs(b.x - a.x) < 0.3, `搖桿 ${JSON.stringify([a, b])}`);
    assert(Math.hypot(c.x - b.x, c.z - b.z) < 0.02, '放開搖桿後仍在走');
    assert(m === 'dialogue', `調查鈕後 mode ${m}`);
    assert(errors.length === 0, errors.join('；'));
    return ui;
  });

  await check('手機：觸控被系統取消（touchcancel）時角色停下', async () => {
    const { page, context } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
    await newGame(page);
    const t = await touch(page);
    await t.start(100, 650); await t.move(100, 590);
    await page.waitForTimeout(400);
    await t.cancel();
    await page.waitForTimeout(200);
    const a = (await st(page)).player; await page.waitForTimeout(500); const b = (await st(page)).player;
    const active = await dom(page, () => document.getElementById('stick').classList.contains('active'));
    await context.close();
    assert(Math.hypot(b.x - a.x, b.z - a.z) < 0.02 && !active, `取消後仍移動或搖桿仍亮 ${JSON.stringify({ a, b, active })}`);
  });

  await check('按住搖桿時進入戰鬥、在戰鬥中放開，回到地圖後搖桿圖示不殘留、角色不自己走', async () => {
    const { page, context, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
    await newGame(page);
    await page.evaluate(() => { window.__hd2d.setLevel(20); window.__hd2d.battleAuto(true); });
    const t = await touch(page);
    await t.start(100, 650); await t.move(100, 590);
    await page.waitForTimeout(200);
    await page.evaluate(() => window.__hd2d.teleport(7.0, 7.1));
    await untilMode(page, ['battle']);
    await page.waitForTimeout(800);
    await t.end();
    await until(page, s => s.mode === 'play', '戰鬥', 90000);
    await page.waitForTimeout(600);
    const a = (await st(page)).player; await page.waitForTimeout(600); const b = (await st(page)).player;
    const stick = await dom(page, () => ({ active: document.getElementById('stick').classList.contains('active'), knob: document.querySelector('#stick i').style.transform }));
    await shot(page, '24-手機戰鬥後搖桿');
    await t.start(100, 650); await t.move(100, 590); await page.waitForTimeout(500); await t.end();
    const c = (await st(page)).player;
    await context.close();
    assert(errors.length === 0, errors.join('；'));
    assert(Math.hypot(b.x - a.x, b.z - a.z) < 0.02, '戰鬥後角色自己移動');
    assert(c.z < b.z - 0.5, '戰鬥後搖桿無法再操作');
    assert(!stick.active, `戰鬥後搖桿圖示仍顯示為按住 ${JSON.stringify(stick)}`);
  });

  await check('小手機 320×640：標題按鈕與戰鬥選單都在畫面內、沒有橫向溢出', async () => {
    const { page, context, errors } = await open({ viewport: { width: 320, height: 640 }, mobile: true });
    const title = await dom(page, () => ({ out: [...document.querySelectorAll('#title button:not([hidden])')].filter(b => { const r = b.getBoundingClientRect(); return r.left < 0 || r.right > innerWidth || r.bottom > innerHeight; }).length, overflow: document.documentElement.scrollWidth - innerWidth }));
    await shot(page, '25-320標題');
    await newGame(page);
    await page.evaluate(() => { window.__hd2d.setLevel(5); window.__hd2d.teleport(7.0, 7.1); });
    await untilMode(page, ['battle']);
    await heroTurn(page);
    await page.waitForTimeout(800);
    const b = await dom(page, () => {
      const out = [...document.querySelectorAll('.b-menu button, .b-mem')].filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.left < 0 || r.right > innerWidth + 0.5 || r.bottom > innerHeight + 0.5); }).length;
      const m = document.querySelector('.b-dock').getBoundingClientRect();
      const covered = [...document.querySelectorAll('.b-tag')].filter(t => { const r = t.getBoundingClientRect(); return r.width && r.bottom > m.top; }).length;
      return { out, covered, overflow: document.documentElement.scrollWidth - innerWidth };
    });
    await shot(page, '26-320戰鬥');
    await page.evaluate(() => window.__hd2d.battleAuto(true));
    await until(page, s => s.mode === 'play', '戰鬥', 90000);
    await context.close();
    assert(title.out === 0 && title.overflow <= 0, `標題 ${JSON.stringify(title)}`);
    assert(b.out === 0 && b.overflow <= 0, `戰鬥 ${JSON.stringify(b)}`);
    assert(b.covered === 0, `敵人名牌被選單區蓋住 ${b.covered} 個`);
    assert(errors.length === 0, errors.join('；'));
    return { title, battle: b };
  });

  // ---------- 可及性 ----------
  await check('鍵盤與可及性：Tab 走過標題三個按鈕、所有可見按鈕都有名稱、戰鬥名牌有說明', async () => {
    const { page, context } = await open();
    const order = [];
    for (let i = 0; i < 3; i++) { await page.keyboard.press('Tab'); order.push(await dom(page, () => document.activeElement?.id || document.activeElement?.tagName)); }
    await newGame(page);
    await page.evaluate(() => { window.__hd2d.setLevel(5); window.__hd2d.teleport(7.0, 7.1); });
    await untilMode(page, ['battle']);
    await heroTurn(page);
    const a = await dom(page, () => {
      const vis = e => e.offsetParent !== null || getComputedStyle(e).position === 'fixed';
      const unnamed = [...document.querySelectorAll('button')].filter(b => vis(b) && !(b.getAttribute('aria-label') || b.textContent.trim())).map(b => b.outerHTML.slice(0, 80));
      const tags = [...document.querySelectorAll('.b-tag')].map(t => t.getAttribute('aria-label'));
      return { unnamed, tags };
    });
    await page.evaluate(() => window.__hd2d.battleAuto(true));
    await until(page, s => s.mode === 'play', '戰鬥', 90000);
    await context.close();
    assert(order.includes('start') && order.includes('title-help'), `Tab 順序 ${order}`);
    assert(a.unnamed.length === 0, `沒有名稱的按鈕 ${a.unnamed.join('、')}`);
    assert(a.tags.every(t => t && t.includes('護盾')), `名牌 ${a.tags}`);
    return { tabOrder: order, tags: a.tags };
  });

  await check('減少動態：章節標題縮短（約 1.2 秒，一般約 3 秒）', async () => {
    const dur = async reducedMotion => {
      const { page, context } = await open({ reducedMotion });
      await watchModes(page);
      await newGame(page);
      const log = await dom(page, () => window.__modes);
      await context.close();
      const i = log.findIndex(m => m[0] === 'cutscene');
      return (log[i + 1][1] - log[i][1]) / 1000;
    };
    const normal = await dur('no-preference'), reduced = await dur('reduce');
    assert(reduced < 1.6 && normal > 2.6, `一般 ${normal} 秒、減少動態 ${reduced} 秒`);
    return { normal, reduced };
  });

  // ---------- 第二批修正（P6～P12，低嚴重度） ----------
  await check('回歸：休息只讓同一區被打倒的遊蕩影獸重新出現（水井只重生鎮上的、營火只重生霧之森的）', async () => {
    const { page, context, errors } = await open({ storage: { 'hd2d-save': LATE({ pos: [19.0, 16.5] }), 'hd2d-quality': 'balanced' } });
    await page.click('#continue');
    await untilMode(page, ['play']);
    const restAt = async (x, z, kind) => {
      await goNear(page, x, z, 1.0);
      const n = (await st(page)).nearest;
      assert(n === 'rest-' + kind, `靠近${kind}時互動對象是 ${n}`);
      await page.keyboard.press('Space');
      return until(page, s => s.mode === 'play', `${kind}休息`);
    };
    const town = ['w-beach', 'w-gate'], forest = ['w-f1', 'w-f2', 'w-f3', 'w-f4', 'w-f5'], ruins = ['w-r1', 'w-r2', 'w-r3', 'w-r4'];
    const afterWell = (await restAt(19.5, 14.5, 'well')).defeated;
    const afterCamp = (await restAt(10.5, -9.5, 'camp')).defeated;
    await context.close();
    const detail = { afterWell, afterCamp };
    assert(town.every(id => !afterWell.includes(id)), `水井休息後鎮上的影獸沒有全部重新出現：${JSON.stringify(detail)}`);
    assert([...forest, ...ruins].every(id => afterWell.includes(id)), `水井休息讓別區的影獸也重新出現：${JSON.stringify(detail)}`);
    assert(forest.every(id => !afterCamp.includes(id)) && ruins.every(id => afterCamp.includes(id)), `營火休息後的重生範圍不對：${JSON.stringify(detail)}`);
    assert(errors.length === 0, errors.join('；'));
    return detail;
  });

  await check('回歸：瀏覽器無法儲存時會提示，休息也不再說「進度已記錄」', async () => {
    const { page, context } = await open({ init: [NO_STORAGE] });
    // 同一個工作裡連著出兩則提示時，觀察器回呼只看得到最後一則，所以從每筆變動加入的文字節點收集
    await page.evaluate(() => { const seen = window.__toasts = []; new MutationObserver(list => { for (const m of list) for (const n of m.addedNodes) seen.push(n.textContent); }).observe(document.getElementById('toast'), { childList: true }); });
    await newGame(page);
    await goNear(page, 19.5, 14.5, 1.0);
    for (let i = 0; i < 2; i++) { // 休息兩次＝存檔失敗兩次，提示仍只能出現一次
      await page.keyboard.press('Space');
      await until(page, s => s.mode === 'play', '休息');
      await page.waitForTimeout(300);
    }
    const toasts = await dom(page, () => window.__toasts);
    await context.close();
    assert(toasts.filter(t => t.includes('關閉頁面後進度會消失')).length === 1, `沒有（或不只一次）提示無法儲存：${JSON.stringify(toasts)}`);
    assert(toasts.some(t => t.includes('但這個瀏覽器無法儲存進度')) && !toasts.some(t => t.includes('進度已記錄')), `休息的提示不對：${JSON.stringify(toasts)}`);
    return toasts;
  });

  await check('回歸：結局畫面「重新開始」清不掉存檔時提示並留在原頁，不讀回舊進度', async () => {
    const NO_REMOVE = () => { Storage.prototype.removeItem = () => { throw new DOMException('blocked', 'SecurityError'); }; };
    const { page, context } = await open({ init: [NO_REMOVE], storage: { 'hd2d-save': LATE({ flags: { wolfKing: true, ruinsEntered: true }, defeated: ['b-wolfKing', 'b-starEater'], pos: [18.5, -28.3] }) } });
    await page.click('#continue');
    await until(page, s => s.mode === 'ended', '終章到結局畫面', 120000);
    await page.evaluate(() => { window.__keep = 1; });
    await page.click('#end-restart'); await page.waitForTimeout(200); await page.click('#end-restart');
    await page.waitForTimeout(1500);
    let info;
    try { info = await dom(page, () => ({ kept: window.__keep === 1, toast: document.getElementById('toast').textContent, ending: !document.getElementById('ending').hidden })); } catch (e) { info = { kept: false, error: e.message }; }
    await context.close();
    assert(info.kept && info.toast.includes('無法清除進度'), `按兩次重新開始後：${JSON.stringify(info)}`);
    return info;
  });

  await check('回歸：手機搖桿按住時，第二根手指按到左半邊不會搶走搖桿', async () => {
    const { page, context, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true });
    await newGame(page);
    await page.evaluate(() => window.__hd2d.teleport(19.0, 16.5));
    await settle(page);
    const cdp = await page.context().newCDPSession(page);
    const send = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
    // 往東走（這一段是空地）；CDP 的 touchEnd 帶哪幾個點就放開哪幾個點
    const A = (x) => ({ x, y: 650, id: 1 }), B = (y) => ({ x: 150, y, id: 2 });
    await send('touchStart', [A(100)]); await send('touchMove', [A(160)]); // 第一指往右推
    await page.waitForTimeout(300);
    const a = (await st(page)).player;
    await send('touchStart', [A(160), B(700)]); await send('touchMove', [A(160), B(770)]); // 第二指按下後往下拖
    await page.waitForTimeout(500);
    const b = (await st(page)).player;
    await send('touchEnd', [B(770)]); await page.waitForTimeout(300); // 放開第二指，第一指還按著
    const c = (await st(page)).player;
    await send('touchEnd', []); await page.waitForTimeout(300);
    const d = (await st(page)).player; await page.waitForTimeout(300); const e = (await st(page)).player;
    const active = await dom(page, () => document.getElementById('stick').classList.contains('active'));
    await context.close();
    const detail = { a, b, c, d, e, active };
    assert(b.x > a.x + 0.3 && Math.abs(b.z - a.z) < 0.1, `第二指按下後角色沒有照第一指的方向往右走：${JSON.stringify(detail)}`);
    assert(c.x > b.x + 0.2, `放開第二指後第一指的搖桿失效：${JSON.stringify(detail)}`);
    assert(Math.hypot(e.x - d.x, e.z - d.z) < 0.02 && !active, `全部放開後仍移動或搖桿仍亮：${JSON.stringify(detail)}`);
    assert(errors.length === 0, errors.join('；'));
    return detail;
  });

  await check('回歸：拿不到 pointer capture 時，滑鼠拖出搖桿區才放開，搖桿之後仍可使用', async () => {
    const NO_CAPTURE = () => { Element.prototype.setPointerCapture = () => { throw new DOMException('no capture', 'NotFoundError'); }; };
    const { page, context, errors } = await open({ viewport: { width: 390, height: 844 }, mobile: true, init: [NO_CAPTURE] });
    await newGame(page);
    await page.evaluate(() => window.__hd2d.teleport(19.0, 16.5));
    await settle(page);
    // 觸控有瀏覽器內建的隱含 capture，放開事件一定回到搖桿區；會卡住的是滑鼠（觸控筆電上用滑鼠按搖桿區、拖出去才放開）
    await page.mouse.move(100, 650); await page.mouse.down(); await page.mouse.move(300, 650, { steps: 5 }); // 拖到右半邊（搖桿區外）才放開
    await page.waitForTimeout(200);
    await page.mouse.up(); await page.waitForTimeout(300);
    const t = await touch(page);
    const a = (await st(page)).player;
    await t.start(100, 650); await t.move(100, 590); // 再按一次往上推
    await page.waitForTimeout(500);
    const b = (await st(page)).player;
    await t.end();
    await context.close();
    assert(b.z < a.z - 0.3, `第二次按搖桿沒有反應：${JSON.stringify({ a, b })}`);
    assert(errors.length === 0, errors.join('；'));
    return { a, b };
  });

  await check('回歸：20 級時選單顯示「已達最高等級」，用完的道具不列出', async () => {
    const save = JSON.parse(LATE({ pos: [19.0, 16.5] }));
    save.items = { herb: 0, dew: 1, feather: 0 };
    const { page, context, errors } = await open({ storage: { 'hd2d-save': JSON.stringify(save) } });
    const readMenu = async () => {
      await page.click('#continue');
      await untilMode(page, ['play']);
      await settle(page);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      return dom(page, () => document.getElementById('menu-party').textContent);
    };
    const first = await readMenu();
    save.items = { herb: 0, dew: 0, feather: 0 };
    await page.evaluate(v => localStorage.setItem('hd2d-save', v), JSON.stringify(save));
    await page.reload({ waitUntil: 'load' });
    await untilMode(page, ['title']);
    const empty = await readMenu();
    await context.close();
    assert(first.includes('已達最高等級') && !first.includes('下一級還差'), `20 級的選單：${first}`);
    assert(first.includes('星露 ×1') && !first.includes('×0'), `道具欄：${first}`);
    assert(empty.includes('沒有道具') && !empty.includes('×0'), `道具全部用完時：${empty}`);
    assert(errors.length === 0, errors.join('；'));
    return { first, empty };
  });

  await check('回歸：Ctrl／Alt 組合鍵不會讓角色移動，也不會被遊戲攔下', async () => {
    const { page, context, errors } = await fresh();
    await page.evaluate(() => window.__hd2d.teleport(19.0, 16.5));
    await settle(page);
    await page.evaluate(() => { window.__prevented = []; addEventListener('keydown', e => { if (e.code === 'KeyD' || e.code === 'KeyE') window.__prevented.push(e.defaultPrevented); }); });
    const a = (await st(page)).player;
    for (const mod of ['Control', 'Alt']) {
      await page.keyboard.down(mod); await page.keyboard.down('KeyD'); await page.waitForTimeout(400); await page.keyboard.up('KeyD'); await page.keyboard.up(mod);
    }
    await page.waitForTimeout(200);
    const b = (await st(page)).player;
    const prevented = await dom(page, () => window.__prevented);
    await context.close();
    assert(Math.hypot(b.x - a.x, b.z - a.z) < 0.02, `按組合鍵時角色移動了：${JSON.stringify({ a, b })}`);
    assert(prevented.length > 0 && prevented.every(p => !p), `組合鍵被遊戲 preventDefault：${JSON.stringify(prevented)}`);
    assert(errors.length === 0, errors.join('；'));
    return { a, b, prevented };
  });

  await check('回歸：某一幀丟出例外時，遊戲繼續跑並提示一次', async () => {
    const { page, context } = await fresh();
    const f0 = (await st(page)).frames;
    await page.evaluate(() => {
      const g = WebGL2RenderingContext.prototype, original = g.drawElements;
      let armed = true;
      g.drawElements = function (...args) { if (armed) { armed = false; throw new Error('E2E 注入的單幀錯誤'); } return original.apply(this, args); };
    });
    await page.waitForTimeout(1500);
    const s = await st(page);
    const toast = await dom(page, () => document.getElementById('toast').textContent);
    await context.close();
    assert(s.frames > f0 + 30, `例外之後畫面停住：frames ${f0} → ${s.frames}`);
    assert(s.calls > 20, `例外之後沒有繼續繪製：每幀 ${s.calls} 次`);
    assert(toast.includes('發生錯誤'), `沒有提示：${toast}`);
    return { f0, frames: s.frames, calls: s.calls, toast };
  });

  await check('回歸：顯示卡中斷時遊戲暫停、按鍵無效；恢復後收起說明並接著跑', async () => {
    const { page, context } = await fresh();
    await goNear(page, 17.5, 12.6, 1.0);
    assert((await st(page)).nearest === 'sign', '沒有站到告示牌旁');
    await page.evaluate(() => { window.__lose = document.getElementById('game').getContext('webgl2').getExtension('WEBGL_lose_context'); window.__lose.loseContext(); });
    await page.waitForTimeout(500);
    const p1 = (await st(page)).playTime; await page.waitForTimeout(1000); const p2 = (await st(page)).playTime;
    await page.keyboard.press('Space'); await page.waitForTimeout(300);
    const lost = { ...(await st(page)), overlay: await dom(page, () => !document.getElementById('error').hidden) };
    await page.evaluate(() => window.__lose.restoreContext());
    await page.waitForTimeout(2000);
    const p3 = (await st(page)).playTime; await page.waitForTimeout(800);
    const back = { ...(await st(page)), overlay: await dom(page, () => !document.getElementById('error').hidden) };
    await shot(page, '28-顯示卡恢復後');
    await context.close();
    const detail = { p1, p2, lostMode: lost.mode, lostOverlay: lost.overlay, p3, p4: back.playTime, backOverlay: back.overlay, calls: back.calls };
    assert(lost.overlay && p2 === p1, `中斷期間遊戲時間仍在跑或沒有說明：${JSON.stringify(detail)}`);
    assert(lost.mode === 'play', `中斷期間按空白鍵仍觸發互動：${JSON.stringify(detail)}`);
    assert(!back.overlay && back.playTime > p3 && back.calls > 20, `恢復後沒有接著跑：${JSON.stringify(detail)}`);
    return detail;
  });

  await check('回歸：對話逐字顯示時，螢幕閱讀器的 aria-live 區域每句只更新一次整句', async () => {
    const { page, context, errors } = await fresh();
    await goNear(page, 17.5, 12.6, 1.0);
    await page.evaluate(() => {
      const counts = window.__liveCounts = {};
      for (const el of document.querySelectorAll('[aria-live]')) {
        if (el.id === 'toast') continue;
        counts[el.id] = 0;
        new MutationObserver(() => { counts[el.id]++; }).observe(el, { childList: true, characterData: true, subtree: true });
      }
    });
    await page.keyboard.press('Space');
    await untilMode(page, ['dialogue']);
    await page.waitForTimeout(700); // 打字途中
    const typing = await dom(page, () => ({ counts: { ...window.__liveCounts }, live: document.getElementById('dialogue-live')?.textContent ?? null, shown: document.getElementById('dialogue-text').textContent }));
    await page.keyboard.press('Space'); // 顯示整句
    await page.waitForTimeout(100);
    const full = await dom(page, () => ({ live: document.getElementById('dialogue-live')?.textContent ?? null, shown: document.getElementById('dialogue-text').textContent, sectionLive: document.getElementById('dialogue').getAttribute('aria-live') }));
    await context.close();
    const detail = { typing, full };
    assert(Object.values(typing.counts).every(n => n <= 3), `打字途中 aria-live 區域被改了太多次：${JSON.stringify(detail)}`);
    assert(full.live && full.live.endsWith(full.shown) && typing.live === full.live, `aria-live 區域沒有在一開始就放整句：${JSON.stringify(detail)}`);
    assert(errors.length === 0, errors.join('；'));
    return detail;
  });

  await check('回歸：遊戲開著時切換「減少動態」立即生效：路燈與火焰不閃、螢火蟲停住、戰鬥畫面同步', async () => {
    const { page, context, errors } = await fresh();
    await page.evaluate(() => window.__hd2d.teleport(19.0, 16.5));
    await settle(page);
    const sample = async () => { const out = []; for (let i = 0; i < 10; i++) { out.push((await st(page)).motion); await page.waitForTimeout(90); } return out; };
    const before = await sample();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(300);
    const after = await sample();
    // 一開始就是減少動態（重新整理後開新遊戲）也要生效
    await page.reload({ waitUntil: 'load' });
    await untilMode(page, ['title']);
    await newGame(page);
    const reloaded = await sample();
    await context.close();
    const spread = (list, k) => Math.max(...list.map(m => m[k])) - Math.min(...list.map(m => m[k]));
    const sum = list => ({ reduce: list[0].reduce, battle: list[0].battle, lantern: spread(list, 'lantern'), flame: spread(list, 'flame'), fly: spread(list, 'fly') });
    const detail = { before: sum(before), after: sum(after), reloaded: sum(reloaded) };
    assert(!before[0].reduce && detail.before.lantern > 0.01 && detail.before.fly > 0.3, `一般模式下燈火或螢火蟲沒有動（對照組）：${JSON.stringify(detail)}`);
    assert(after[0].reduce && after[0].battle, `切換後遊戲或戰鬥畫面沒有收到減少動態：${JSON.stringify(detail)}`);
    assert(detail.after.lantern === 0 && detail.after.flame === 0 && detail.after.fly === 0, `減少動態下燈火、火焰或螢火蟲仍在動：${JSON.stringify(detail)}`);
    assert(detail.reloaded.reduce && detail.reloaded.battle && detail.reloaded.lantern === 0 && detail.reloaded.flame === 0 && detail.reloaded.fly === 0, `一開始就是減少動態時燈火或螢火蟲仍在動：${JSON.stringify(detail)}`);
    assert(errors.length === 0, errors.join('；'));
    return detail;
  });

  // ---------- 說明視窗（放最後；修正前會在說明視窗後面進入戰鬥） ----------
  await check('回歸：從暫停選單開「操作說明」時遊戲應保持暫停（不應在說明視窗後面進入戰鬥）', async () => {
    const { page, context } = await fresh();
    await page.evaluate(() => window.__hd2d.teleport(20.5, 16));
    await settle(page);
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    await page.click('#menu-help'); await page.waitForTimeout(300);
    const t0 = (await st(page)).playTime; await page.waitForTimeout(1000);
    const a = { ...(await menuOpen(page)), playTimeDelta: +((await st(page)).playTime - t0).toFixed(2) };
    await page.click('#help [data-close]'); await page.waitForTimeout(300);
    // 第二段：靠近遊蕩的黃昏蝙蝠時開選單→說明，看說明視窗開著時會不會進入戰鬥
    // 傳送和開選單放在同一個 evaluate，免得蝙蝠先撞上來；按鍵要有 keydown 才算真的按了 Esc
    await page.evaluate(() => { window.__hd2d.teleport(12.5, 25.6); for (const type of ['keydown', 'keyup']) window.dispatchEvent(new KeyboardEvent(type, { code: 'Escape' })); });
    await page.waitForTimeout(300);
    const paused = await menuOpen(page);
    await page.click('#menu-help');
    await page.waitForTimeout(3500);
    const b = await menuOpen(page);
    await shot(page, '27-從選單開說明');
    await context.close();
    const msg = `說明開著 1 秒：mode ${a.mode}，遊戲時間增加 ${a.playTimeDelta} 秒；靠近影獸時：選單 ${paused.mode} → 說明開著 3.5 秒後 mode ${b.mode}（說明視窗 ${b.help}）`;
    assert(a.mode === 'paused' && a.playTimeDelta === 0, msg);
    assert(paused.mode === 'paused' && b.mode === 'paused' && b.help, msg);
    return { a, paused, b };
  });

  await browser.close();
  const failed = results.filter(r => !r.pass).length;
  console.log(`\n共 ${results.length} 項，通過 ${results.length - failed}，失敗 ${failed}`);
}

main().catch(async error => { console.error(error); results.push({ name: '流程中斷', pass: false, seconds: 0, error: String(error?.stack || error).slice(0, 900) }); save(); await browser?.close(); process.exit(1); });
