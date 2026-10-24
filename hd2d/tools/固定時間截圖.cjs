// 固定時間截圖：接管 requestAnimationFrame 與 performance.now（每幀固定 1/60 秒）並固定 Math.random 的種子，
// 讓同一個版本在同一個場景、同一個幀數拍出的畫面可以逐像素比對（同一台機器、同一個瀏覽器時，同版本拍兩次完全相同）。
// 用來確認只改寫法、不該改畫面的修改（例如 shader 改成等價寫法）真的沒有改到畫面；比對用 tools/截圖比對.py。
// 用法：node hd2d/tools/固定時間截圖.cjs <遊戲網址> <輸出資料夾>
// 和 E2E驗收.cjs 一樣，可用 PLAYWRIGHT_PATH、CHROME_PATH 指定 Playwright 與 Chrome 的位置。
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');
const fs = require('fs');
const path = require('path');
const [BASE, OUT] = process.argv.slice(2);
const TARGET = 3000; // 截圖時的總幀數（遊戲時間 50 秒）；讀檔、傳送後至少再跑 600 幀讓鏡頭跟上

// 在頁面腳本之前注入：自動模式下照真實畫面更新節奏跑，但傳給遊戲的時間戳記每幀固定加 1/60 秒；
// 切到手動模式後只有 __pump 會推進畫面
const DETERMINISM = () => {
  let s = 20261024;
  Math.random = () => { s |= 0; s = s + 0x6D2B79F5 | 0; let t = Math.imul(s ^ s >>> 15, 1 | s); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const real = window.requestAnimationFrame.bind(window);
  let queue = [], manual = false, scheduled = false, now = 0;
  // three.js 的 Timer 在建立時記下 performance.now()，第一幀的 dt 會跟載入花的真實時間有關，所以時鐘也一併接管
  performance.now = () => now;
  const run = () => { const q = queue; queue = []; now += 1000 / 60; for (const cb of q) cb(now); };
  const schedule = () => { if (!manual && !scheduled) { scheduled = true; real(() => { scheduled = false; if (!manual) run(); }); } };
  window.requestAnimationFrame = cb => { queue.push(cb); schedule(); return queue.length; };
  window.cancelAnimationFrame = () => {};
  window.__det = { manual: () => { manual = true; }, pump: n => { for (let i = 0; i < n; i++) run(); } };
};

const ALL_W = ['w-beach', 'w-gate', 'w-f1', 'w-f2', 'w-f3', 'w-f4', 'w-f5', 'w-r1', 'w-r2', 'w-r3', 'w-r4'];
const SAVE = JSON.stringify({ v: 1, flags: { metKeeper: true, miraJoined: true, merchantGift: true, lit: true, seinJoined: true, forestEntered: true, campTalk: true, wolfKing: true, ruinsEntered: true },
  found: 3, frags: ['shrine', 'pier', 'field'], party: ['hero', 'mira', 'sein'].map(id => ({ id, lv: 20, exp: 0, hp: 99999, sp: 99999 })), items: { herb: 2, dew: 1, feather: 1 },
  revealed: {}, defeated: ['g-shrine', 'g-pier', 'g-field', 'b-wolfKing', ...ALL_W], chests: [], pos: [18, 20.5], playTime: 60 });

const SCENES = [
  { id: '01-標題-精緻', quality: 'high' },
  { id: '02-小鎮-精緻', quality: 'high', at: [18, 20.5] },
  { id: '03-霧之森-精緻', quality: 'high', at: [19.5, -6.5] },
  { id: '04-小鎮-流暢', quality: 'balanced', at: [18, 20.5] },
  { id: '05-霧之森-流暢', quality: 'balanced', at: [19.5, -6.5] }
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true, args: ['--enable-gpu', '--ignore-gpu-blocklist'] });
  const report = [];
  for (const sc of SCENES) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'zh-TW' });
    await context.addInitScript(DETERMINISM);
    await context.addInitScript(([q, save, withSave]) => { localStorage.setItem('hd2d-quality', q); if (withSave) localStorage.setItem('hd2d-save', save); }, [sc.quality, SAVE, !!sc.at]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' || /shader|WebGL|GL_/i.test(m.text())) errors.push(m.text().slice(0, 300)); });
    await page.goto(BASE, { waitUntil: 'load' });
    // 預設的 raf 輪詢會用到被接管的 requestAnimationFrame，這裡一律改用固定間隔輪詢
    const until = (fn, arg) => page.waitForFunction(fn, arg, { polling: 100, timeout: 60000 });
    await until(() => window.__hd2d?.state().mode === 'title');
    if (sc.at) {
      await page.click('#continue');
      await until(() => window.__hd2d.state().mode === 'play');
      await page.waitForTimeout(1500); // 等轉場的 DOM 動畫結束（不影響畫布，只是保險）
    }
    await page.evaluate(() => window.__det.manual());
    const f0 = (await page.evaluate(() => window.__hd2d.state())).frames;
    if (sc.at) await page.evaluate(([x, z]) => window.__hd2d.teleport(x, z), sc.at);
    if (TARGET - f0 < 600) throw new Error(`${sc.id}：進入手動模式時已經 ${f0} 幀，來不及在 ${TARGET} 幀前讓鏡頭跟上`);
    for (let f = f0; f < TARGET - 1; f += 100) await page.evaluate(n => window.__det.pump(n), Math.min(100, TARGET - 1 - f));
    // 最後一幀和讀畫布放在同一個工作裡，畫布內容還在
    const shot = await page.evaluate(() => { window.__det.pump(1); return { url: document.getElementById('game').toDataURL('image/png'), s: window.__hd2d.state() }; });
    fs.writeFileSync(path.join(OUT, `${sc.id}.png`), Buffer.from(shot.url.split(',')[1], 'base64'));
    report.push({ id: sc.id, frames: shot.s.frames, enteredManualAt: f0, mode: shot.s.mode, quality: shot.s.quality, player: shot.s.player, motion: shot.s.motion, errors });
    console.log(`${sc.id}：第 ${shot.s.frames} 幀（手動模式從第 ${f0} 幀開始），mode ${shot.s.mode}，畫質 ${shot.s.quality}，錯誤 ${errors.length}`);
    await context.close();
  }
  fs.writeFileSync(path.join(OUT, '截圖紀錄.json'), JSON.stringify(report, null, 1));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
