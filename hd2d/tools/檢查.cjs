// 星燈港自動檢查：啟動靜態伺服器 → 以 Chromium 實際遊玩一輪 → 輸出狀態與截圖。
// 用法：node tools/檢查.cjs <截圖輸出資料夾>
// Playwright 位置可用 PLAYWRIGHT_PATH 指定；預設以 SwiftShader 軟體繪圖，雲端機器沒有 GPU 也能跑。
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require(process.env.PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const out = path.resolve(process.argv[2] || path.join(root, 'tools', '截圖'));
fs.mkdirSync(out, { recursive: true });
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
  if (!p.startsWith(root) || !fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});

const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? '通過' : '失敗'}  ${name}${detail ? '　' + detail : ''}`); };

async function untilMode(page, modes, timeout = 60000) {
  await page.waitForFunction(m => m.includes(window.__hd2d?.state().mode), modes, { timeout });
}
// 依「遊戲內經過時間」按住按鍵，軟體繪圖幀率很低時也能得到一致的位移。
async function hold(page, key, seconds) {
  const t0 = await page.evaluate(() => window.__hd2d.state().playTime);
  await page.keyboard.down(key);
  await page.waitForFunction(([t0, s]) => window.__hd2d.state().playTime >= t0 + s, [t0, seconds], { timeout: 60000 });
  await page.keyboard.up(key);
}
async function settle(page, n = 3) {
  const f0 = await page.evaluate(() => window.__hd2d.state().frames);
  await page.waitForFunction(([f0, n]) => window.__hd2d.state().frames >= f0 + n, [f0, n], { timeout: 30000 });
}
async function finishDialogue(page) {
  for (let i = 0; i < 30; i++) {
    const m = await page.evaluate(() => window.__hd2d.state().mode);
    if (m !== 'dialogue') return m;
    await page.keyboard.press('Space'); await page.waitForTimeout(120);
  }
  return page.evaluate(() => window.__hd2d.state().mode);
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];

  // ---------- 桌面：完整一輪 ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('hd2d-quality', 'high'));
  await page.goto(url, { waitUntil: 'load' });
  await untilMode(page, ['title']);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/01-標題.jpg`, type: 'jpeg', quality: 82 });
  const calls = (await page.evaluate(() => window.__hd2d.state())).calls;
  check('標題畫面與 3D 場景載入', calls > 20, `draw calls ${calls}`);

  await page.click('#start');
  await untilMode(page, ['dialogue']);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${out}/02-開場對話.jpg`, type: 'jpeg', quality: 82 });
  check('開場對話結束後可操作', (await finishDialogue(page)) === 'play');

  const s0 = await page.evaluate(() => window.__hd2d.state());
  await hold(page, 'KeyW', 1.2);
  const s1 = await page.evaluate(() => window.__hd2d.state());
  check('按 W 向北行走', s1.player.z < s0.player.z - 0.5 && s1.player.dir === 1, `z ${s0.player.z} → ${s1.player.z}`);
  await hold(page, 'KeyA', 0.6);
  const s2 = await page.evaluate(() => window.__hd2d.state());
  check('按 A 向西行走並轉向', s2.player.x < s1.player.x - 0.3 && s2.player.dir === 3, `x ${s1.player.x} → ${s2.player.x}`);

  // 碰撞：朝水井走，應停在井外
  await page.evaluate(() => window.__hd2d.teleport(19.5, 16.2));
  await hold(page, 'KeyW', 1.5);
  const s3 = await page.evaluate(() => window.__hd2d.state());
  check('水井會擋住去路', s3.player.z > 15.2, `停在 z ${s3.player.z}`);

  // 高台：沒有石階不能直接爬上去
  await page.evaluate(() => window.__hd2d.teleport(5.5, 9.6));
  await hold(page, 'KeyW', 1.2);
  const s4 = await page.evaluate(() => window.__hd2d.state());
  check('高台邊緣無法直接爬上', s4.player.z > 9.2 && s4.player.y < 0.3, `z ${s4.player.z} y ${s4.player.y}`);
  await page.evaluate(() => window.__hd2d.teleport(7.5, 11.5));
  await hold(page, 'KeyW', 1.5);
  const s5 = await page.evaluate(() => window.__hd2d.state());
  check('從石階走上高台', s5.player.y > 0.9, `y ${s5.player.y}`);

  // 任務流程
  await page.evaluate(() => window.__hd2d.teleport(29.4, 24.6));
  await settle(page);
  check('靠近守燈人出現對話提示', (await page.evaluate(() => window.__hd2d.state().nearest)) === 'keeper' && await page.isVisible('#prompt'));
  await page.keyboard.press('Space');
  await untilMode(page, ['dialogue']);
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${out}/03-守燈人.jpg`, type: 'jpeg', quality: 82 });
  await finishDialogue(page);
  check('接下任務', (await page.evaluate(() => window.__hd2d.state().quest)) === 1);

  const spots = [['shrine', 7.0, 5.6, 'KeyW'], ['pier', 17.5, 29.8, 'KeyS'], ['field', 32.5, 5.6, 'KeyW']];
  for (const [id, x, z, key] of spots) {
    const before = (await page.evaluate(() => window.__hd2d.state())).found;
    await page.evaluate(([x, z]) => window.__hd2d.teleport(x, z), [x, z]);
    await settle(page, 6);
    if (id !== 'field') await page.screenshot({ path: `${out}/04-碎片-${id}.jpg`, type: 'jpeg', quality: 82 });
    await hold(page, key, 0.9);
    await settle(page);
    const after = (await page.evaluate(() => window.__hd2d.state())).found;
    check(`走過去拾取碎片：${id}`, after === before + 1, `${before} → ${after}`);
  }

  await page.evaluate(() => window.__hd2d.teleport(29.4, 24.6));
  await settle(page);
  await page.keyboard.press('Space');
  await untilMode(page, ['dialogue']);
  await finishDialogue(page);
  await untilMode(page, ['ended'], 90000);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/05-結局.jpg`, type: 'jpeg', quality: 82 });
  check('點亮燈塔並顯示結局', (await page.evaluate(() => window.__hd2d.state().lit)) > 0.99 && await page.isVisible('#ending'));
  await page.click('#end-continue');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${out}/06-燈塔亮起後.jpg`, type: 'jpeg', quality: 82 });

  // 暫停選單
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => ({ mode: window.__hd2d.state().mode, open: document.getElementById('menu').open }));
  check('Esc 開啟暫停選單', paused.mode === 'paused' && paused.open);
  await page.selectOption('#quality-select', 'balanced');
  await page.click('#resume');
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${out}/07-流暢畫質.jpg`, type: 'jpeg', quality: 82 });
  check('切換流暢畫質後繼續遊戲', (await page.evaluate(() => window.__hd2d.state())).quality === 'balanced');

  // ---------- 手機直向 ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  m.on('pageerror', e => errors.push('手機：' + e.message));
  await m.addInitScript(() => localStorage.setItem('hd2d-quality', 'high'));
  await m.goto(url, { waitUntil: 'load' });
  await untilMode(m, ['title']);
  await m.waitForTimeout(1000);
  await m.screenshot({ path: `${out}/08-手機標題.jpg`, type: 'jpeg', quality: 82 });
  await m.tap('#start');
  await untilMode(m, ['dialogue']);
  for (let i = 0; i < 14 && (await m.evaluate(() => window.__hd2d.state().mode)) === 'dialogue'; i++) { await m.tap('#dialogue'); await m.waitForTimeout(150); }
  check('手機顯示觸控按鈕', await m.isVisible('#act-btn'));
  const t0 = await m.evaluate(() => window.__hd2d.state());
  await m.evaluate(() => {
    const z = document.getElementById('stick-zone');
    const ev = (type, x, y) => z.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', 100, 650); ev('pointermove', 100, 590);
  });
  await m.waitForFunction(t => window.__hd2d.state().playTime >= t + 0.9, t0.playTime, { timeout: 60000 });
  await m.screenshot({ path: `${out}/09-手機遊玩.jpg`, type: 'jpeg', quality: 82 });
  await m.evaluate(() => document.getElementById('stick-zone').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })));
  const t1 = await m.evaluate(() => window.__hd2d.state());
  check('手機搖桿可以行走', t1.player.z < t0.player.z - 0.4, `z ${t0.player.z} → ${t1.player.z}`);

  check('沒有頁面錯誤', errors.length === 0, errors.slice(0, 5).join(' | '));
  fs.writeFileSync(`${out}/結果.json`, JSON.stringify({ time: new Date().toISOString(), results, errors }, null, 2));
  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n共 ${results.length} 項，失敗 ${failed} 項`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); server.close(); process.exit(1); });
