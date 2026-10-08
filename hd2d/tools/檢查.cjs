// 星燈港自動檢查：啟動靜態伺服器 → 以 Chromium 從頭玩到結局 → 輸出檢查結果與截圖。
// 用法：node tools/檢查.cjs <截圖輸出資料夾>
// Playwright 位置可用 PLAYWRIGHT_PATH 指定；預設以 SwiftShader 軟體繪圖，雲端機器沒有 GPU 也能跑。
// 軟體繪圖很慢，整輪約需 10～20 分鐘。這支腳本只驗證流程能走通；難度請用 tools/平衡模擬.mjs 檢查，
// 所以進入各章頭目戰前會用測試介面直接把等級調高，省下練功時間。
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
const st = page => page.evaluate(() => window.__hd2d.state());
const shot = (page, name) => page.screenshot({ path: `${out}/${name}.jpg`, type: 'jpeg', quality: 82 });

async function untilMode(page, modes, timeout = 60000) {
  await page.waitForFunction(m => m.includes(window.__hd2d?.state().mode), modes, { timeout });
}
// 依「遊戲內經過時間」按住按鍵，軟體繪圖幀率很低時也能得到一致的位移。
async function hold(page, key, seconds) {
  const t0 = (await st(page)).playTime;
  await page.keyboard.down(key);
  await page.waitForFunction(([t0, s]) => window.__hd2d.state().playTime >= t0 + s, [t0, seconds], { timeout: 60000 });
  await page.keyboard.up(key);
}
async function settle(page, n = 3) {
  const f0 = (await st(page)).frames;
  await page.waitForFunction(([f0, n]) => window.__hd2d.state().frames >= f0 + n, [f0, n], { timeout: 30000 });
}
// 一路推進劇情：遇到對話就按空白鍵，戰鬥交給自動戰鬥，直到條件成立。
async function until(page, pred, label, timeout = 240000) {
  const t0 = Date.now();
  for (;;) {
    const s = await st(page);
    if (pred(s)) return s;
    if (Date.now() - t0 > timeout) throw new Error(`等待逾時：${label}（mode ${s.mode}）`);
    if (s.mode === 'dialogue') await page.keyboard.press('Space');
    await page.waitForTimeout(150);
  }
}
// 在目標附近找一個能站的位置（四角都不擋路、高度相同），再瞬間移動過去。
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
  if (s.nearest !== id) return false;
  await page.keyboard.press('Space');
  await untilMode(page, ['dialogue']);
  return true;
}

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];

  // ---------- 桌面：從頭玩到結局 ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(() => localStorage.setItem('hd2d-quality', 'high'));
  await page.goto(url, { waitUntil: 'load' });
  await untilMode(page, ['title'], 90000);
  await page.waitForTimeout(1500);
  await shot(page, '01-標題');
  const calls = (await st(page)).calls;
  check('標題畫面與 3D 場景載入', calls > 20, `draw calls ${calls}`);
  check('沒有存檔時不顯示「繼續冒險」', !(await page.isVisible('#continue')));

  await page.click('#start');
  await page.evaluate(() => window.__hd2d.battleSpeed(4));
  await untilMode(page, ['dialogue']);
  await page.waitForTimeout(1200);
  await shot(page, '02-開場對話');
  let s = await until(page, s => s.mode === 'play', '開場對話與第一章標題');
  check('開場後進入第一章', s.chapter === 1 && s.party.length === 1);
  check('點擊後啟用聲音並播放小鎮配樂', s.audio.ctx === 'running' && s.audio.track === 'town', JSON.stringify(s.audio));

  // 移動與地形
  const s0 = await st(page);
  await hold(page, 'KeyW', 1.2);
  const s1 = await st(page);
  check('按 W 向北行走', s1.player.z < s0.player.z - 0.5 && s1.player.dir === 1, `z ${s0.player.z} → ${s1.player.z}`);
  await hold(page, 'KeyA', 0.6);
  const s2 = await st(page);
  check('按 A 向西行走並轉向', s2.player.x < s1.player.x - 0.3 && s2.player.dir === 3, `x ${s1.player.x} → ${s2.player.x}`);
  await page.evaluate(() => window.__hd2d.teleport(19.5, 16.2));
  await hold(page, 'KeyW', 1.5);
  const s3 = await st(page);
  check('水井會擋住去路', s3.player.z > 15.2, `停在 z ${s3.player.z}`);
  await page.evaluate(() => window.__hd2d.teleport(5.5, 9.6));
  await hold(page, 'KeyW', 1.2);
  const s4 = await st(page);
  check('高台邊緣無法直接爬上', s4.player.z > 9.2 && s4.player.y < 0.3, `z ${s4.player.z} y ${s4.player.y}`);
  await page.evaluate(() => window.__hd2d.teleport(7.5, 11.5));
  await hold(page, 'KeyW', 0.8);
  const s5 = await st(page);
  check('從石階走上高台', s5.player.y > 0.9, `y ${s5.player.y}`);

  // ---------- 第一章 ----------
  check('靠近守燈人出現對話提示', await talk(page, 30.5, 24.6, 'keeper'));
  await page.waitForTimeout(900);
  await shot(page, '03-守燈人');
  s = await until(page, s => s.mode === 'play', '守燈人委託');
  check('接下尋找碎片的委託', s.flags.metKeeper === true);
  await talk(page, 30.4, 10.6, 'florist');
  s = await until(page, s => s.mode === 'play', '米菈加入');
  check('米菈加入隊伍', s.party.length === 2 && s.flags.miraJoined, s.party.map(r => r.id).join('、'));
  const herb0 = s.items.herb;
  await talk(page, 22.2, 15.6, 'merchant');
  s = await until(page, s => s.mode === 'play', '商人贈禮');
  check('旅行商人送回復藥草', s.items.herb === herb0 + 2, `${herb0} → ${s.items.herb}`);
  await page.evaluate(() => window.__hd2d.setLevel(3));

  // 第一場戰鬥手動操作：蓄力一點後攻擊第一個敵人
  await page.evaluate(() => window.__hd2d.teleport(7.0, 7.1));
  await untilMode(page, ['battle'], 30000);
  await page.waitForFunction(() => window.__hd2d.state().battle?.mode === 'menu', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await shot(page, '04-戰鬥選單');
  const b0 = (await st(page)).battle;
  check('守護碎片的影獸發動戰鬥', b0.enemies.length === 2 && b0.party.length === 2, b0.enemies.map(e => e.name).join('、'));
  check('戰鬥中換成戰鬥配樂', (await st(page)).audio.track === 'battle', (await st(page)).audio.track);
  const hp0 = b0.enemies.reduce((a, e) => a + e.hp, 0);
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(200);
  const boosted = await page.evaluate(() => document.querySelector('.b-bval').textContent);
  await page.keyboard.press('Space'); await page.waitForTimeout(300);
  check('選單可蓄力並進入選擇目標', boosted.includes('1') && (await st(page)).battle.mode === 'target', boosted);
  await page.keyboard.press('Space');
  await page.waitForFunction(h => { const b = window.__hd2d.state().battle; return b && b.enemies.reduce((a, e) => a + e.hp, 0) < h; }, hp0, { timeout: 30000 });
  await page.waitForTimeout(300);
  await shot(page, '05-戰鬥中');
  check('手動攻擊造成傷害', true);
  await page.evaluate(() => window.__hd2d.battleAuto(true));
  const exp0 = (await st(page)).party[0].exp;
  s = await until(page, s => s.mode === 'play', '神社守衛戰');
  check('打倒神社守衛並獲得經驗值', s.defeated.includes('g-shrine') && (s.party[0].exp > exp0 || s.party[0].lv > 3), `Lv ${s.party[0].lv}，EXP ${exp0} → ${s.party[0].exp}`);
  await page.evaluate(() => window.__hd2d.teleport(7.0, 4.4));
  s = await until(page, s => s.found === 1, '拾取神社碎片', 30000);
  await page.waitForTimeout(600);
  await shot(page, '06-碎片');
  check('打倒守衛後拾取碎片', s.found === 1);

  for (const [id, gx, gz, fx, fz] of [['pier', 17.9, 28.9, 17.5, 31.0], ['field', 31.6, 6.7, 32.5, 4.5]]) {
    await page.evaluate(([x, z]) => window.__hd2d.teleport(x, z), [gx, gz]);
    s = await until(page, s => s.mode === 'play' && s.defeated.includes('g-' + id), `${id} 守衛戰`);
    const before = s.found;
    await page.evaluate(([x, z]) => window.__hd2d.teleport(x, z), [fx, fz]);
    s = await until(page, s => s.found === before + 1, `拾取 ${id} 碎片`, 30000);
    check(`打倒守衛並拾取碎片：${id}`, s.found === before + 1, `${before} → ${s.found}`);
  }

  await talk(page, 30.5, 24.6, 'keeper');
  s = await until(page, s => s.mode === 'play' && s.flags.lit && s.chapter === 2, '點亮燈塔與第二章');
  await page.waitForTimeout(800);
  await shot(page, '07-燈塔亮起');
  check('點亮燈塔進入第二章', s.lit > 0.99 && s.chapter === 2, `lit ${s.lit}`);
  check('賽恩出現在北門', await talk(page, 19.4, 2.4, 'merchant'));
  s = await until(page, s => s.mode === 'play', '賽恩加入');
  check('賽恩加入隊伍', s.party.length === 3 && s.flags.seinJoined);

  // 存檔與繼續
  await page.reload({ waitUntil: 'load' });
  await untilMode(page, ['title'], 90000);
  check('有存檔時顯示「繼續冒險」', await page.isVisible('#continue'));
  await page.click('#continue');
  await page.evaluate(() => { window.__hd2d.battleSpeed(4); window.__hd2d.battleAuto(true); });
  s = await until(page, s => s.mode === 'play', '讀取存檔');
  check('讀取存檔後進度相同', s.flags.lit && s.party.length === 3 && s.found === 3, `章節 ${s.chapter}，隊伍 ${s.party.length} 人`);

  // ---------- 第二章 ----------
  await page.evaluate(() => window.__hd2d.teleport(18.5, -2.2));
  s = await until(page, s => s.mode === 'play' && s.flags.forestEntered, '進入霧之森');
  await page.waitForTimeout(800);
  await shot(page, '08-霧之森');
  check('進入霧之森觸發劇情', s.flags.forestEntered);
  check('霧之森換成森林配樂', (await st(page)).audio.track === 'forest', (await st(page)).audio.track);
  await page.evaluate(() => window.__hd2d.teleport(11.6, -9.6));
  s = await until(page, s => s.mode === 'play' && s.flags.campTalk, '營地對話與休息');
  check('營地對話後全員回復', s.party.every(r => r.hp === r.maxHp), s.party.map(r => `${r.hp}/${r.maxHp}`).join('、'));
  await page.evaluate(() => { window.__hd2d.setLevel(9); window.__hd2d.teleport(27.0, -14.6); });
  await until(page, s => s.battle?.enemies[0]?.name === '霧狼王', '霧狼王登場', 600000); // 途中碰到遊蕩影獸也會自動打完
  await page.waitForTimeout(2500);
  await shot(page, '09-霧狼王');
  check('頭目戰換成頭目配樂', (await st(page)).audio.track === 'boss', (await st(page)).audio.track);
  s = await until(page, s => s.mode === 'play' && s.flags.wolfKing, '霧狼王戰', 600000);
  check('打倒霧狼王，霧氣散去', s.defeated.includes('b-wolfKing') && !(await page.evaluate(() => window.__hd2d.blocked(18.5, -20.5))));

  // ---------- 第三章 ----------
  await page.evaluate(() => window.__hd2d.teleport(18.5, -22.4));
  s = await until(page, s => s.mode === 'play' && s.flags.ruinsEntered, '進入星之古塔');
  await page.waitForTimeout(800);
  await shot(page, '10-星之古塔');
  check('進入星之古塔並換到第三章', s.chapter === 3);
  check('星之古塔換成古塔配樂', (await st(page)).audio.track === 'ruins', (await st(page)).audio.track);
  const statue = (await page.evaluate(() => window.__hd2d.places().rest.statue));
  await goNear(page, statue[0], statue[1], 1.1);
  check('星之石像可以休息', (await st(page)).nearest === 'rest-statue', (await st(page)).nearest);
  await page.evaluate(() => { window.__hd2d.setLevel(12); window.__hd2d.teleport(18.5, -28.3); });
  await until(page, s => s.battle?.enemies[0]?.name === '熄星者', '熄星者登場', 600000);
  await page.waitForTimeout(2500);
  await shot(page, '11-熄星者');
  let phase2 = false;
  s = await until(page, s => { if (s.battle?.enemies[0].phase === 2) phase2 = true; return s.mode === 'ended'; }, '熄星者戰與終章', 900000);
  await page.waitForTimeout(3000);
  await shot(page, '12-結局');
  check('打倒熄星者並看到結局', s.flags.finished && s.lit > 1.2 && await page.isVisible('#ending'), `lit ${s.lit}`);
  check('熄星者血量過半後進入第二階段', phase2);
  check('結局播放主題曲', (await st(page)).audio.track === 'title', (await st(page)).audio.track);

  await page.click('#end-continue');
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const paused = await page.evaluate(() => ({ mode: window.__hd2d.state().mode, open: document.getElementById('menu').open }));
  check('Esc 開啟暫停選單', paused.mode === 'paused' && paused.open);
  await page.selectOption('#sound-select', 'sfx'); await page.waitForTimeout(200);
  const a1 = (await st(page)).audio;
  await page.selectOption('#sound-select', 'off'); await page.waitForTimeout(300);
  const a2 = (await st(page)).audio;
  await page.selectOption('#sound-select', 'all'); await page.waitForTimeout(300);
  const a3 = (await st(page)).audio;
  check('選單可以只留音效、關閉聲音再打開', a1.track === null && a2.ctx === 'suspended' && a3.ctx === 'running' && a3.track !== null, [a1, a2, a3].map(a => `${a.mode}/${a.ctx}/${a.track}`).join(' → '));
  await page.selectOption('#quality-select', 'balanced');
  await page.click('#resume');
  await page.waitForTimeout(1200);
  await shot(page, '13-流暢畫質');
  check('切換流暢畫質後繼續遊戲', (await st(page)).quality === 'balanced');

  // ---------- 手機直向 ----------
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await ctx.newPage();
  m.on('pageerror', e => errors.push('手機：' + e.message));
  await m.addInitScript(() => localStorage.setItem('hd2d-quality', 'high'));
  await m.goto(url, { waitUntil: 'load' });
  await untilMode(m, ['title'], 90000);
  await m.waitForTimeout(1000);
  await shot(m, '14-手機標題');
  await m.tap('#start');
  await m.evaluate(() => window.__hd2d.battleSpeed(4));
  for (let i = 0; i < 60 && (await st(m)).mode !== 'play'; i++) { if ((await st(m)).mode === 'dialogue') await m.tap('#dialogue'); await m.waitForTimeout(200); }
  check('手機顯示觸控按鈕', await m.isVisible('#act-btn'));
  const t0 = await st(m);
  await m.evaluate(() => {
    const z = document.getElementById('stick-zone');
    const ev = (type, x, y) => z.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: x, clientY: y, bubbles: true }));
    ev('pointerdown', 100, 650); ev('pointermove', 100, 590);
  });
  await m.waitForFunction(t => window.__hd2d.state().playTime >= t + 0.9, t0.playTime, { timeout: 60000 });
  await shot(m, '15-手機遊玩');
  await m.evaluate(() => document.getElementById('stick-zone').dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, bubbles: true })));
  const t1 = await st(m);
  check('手機搖桿可以行走', t1.player.z < t0.player.z - 0.4, `z ${t0.player.z} → ${t1.player.z}`);

  // 手機戰鬥：點選單、再點敵人頭上的名牌
  await m.evaluate(() => { window.__hd2d.setLevel(5); window.__hd2d.teleport(7.0, 7.1); });
  await untilMode(m, ['battle'], 30000);
  await m.waitForFunction(() => window.__hd2d.state().battle?.mode === 'menu', null, { timeout: 60000 });
  await m.waitForTimeout(500);
  await shot(m, '16-手機戰鬥');
  const mh0 = (await st(m)).battle.enemies.reduce((a, e) => a + e.hp, 0);
  await m.tap('.b-list .b-item:nth-child(2)'); await m.waitForTimeout(300);
  const backShown = await m.isVisible('.b-back');
  if (backShown) await m.tap('.b-back');
  await m.waitForTimeout(300);
  check('手機技能選單可以點「返回」回到主選單', backShown && (await st(m)).battle.mode === 'menu' && !(await m.isVisible('.b-back')));
  await m.tap('.b-list button');
  await m.waitForFunction(() => window.__hd2d.state().battle?.mode === 'target', null, { timeout: 10000 });
  await m.tap('.b-tag.targetable', { force: true }); // 名牌跟著鏡頭緩慢晃動，Playwright 會一直判定「不穩定」，所以略過這項等待
  await m.waitForFunction(h => { const b = window.__hd2d.state().battle; return b && b.enemies.reduce((a, e) => a + e.hp, 0) < h; }, mh0, { timeout: 30000 });
  check('手機點選單與敵人名牌可以攻擊', true);
  await m.evaluate(() => window.__hd2d.battleAuto(true));
  const ms = await until(m, s => s.mode === 'play', '手機戰鬥結束');
  check('手機戰鬥結束回到地圖', ms.defeated.includes('g-shrine'));
  await ctx.close();

  // ---------- 手機橫向：戰鬥選單不能蓋住敵人，暫停選單不用捲動 ----------
  const lctx = await browser.newContext({ viewport: { width: 844, height: 390 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const l = await lctx.newPage();
  l.on('pageerror', e => errors.push('橫向：' + e.message));
  await l.addInitScript(() => localStorage.setItem('hd2d-quality', 'high'));
  await l.goto(url, { waitUntil: 'load' });
  await untilMode(l, ['title'], 90000);
  await l.tap('#start');
  await l.evaluate(() => window.__hd2d.battleSpeed(4));
  for (let i = 0; i < 60 && (await st(l)).mode !== 'play'; i++) { if ((await st(l)).mode === 'dialogue') await l.tap('#dialogue'); await l.waitForTimeout(200); }
  await l.tap('#menu-btn'); await l.waitForTimeout(500);
  const lm = await l.evaluate(() => { const d = document.getElementById('menu'); return { scroll: d.scrollHeight > d.clientHeight + 2, out: [...d.querySelectorAll('button, select')].filter(e => e.getBoundingClientRect().bottom > innerHeight).length }; });
  await shot(l, '17-橫向選單');
  check('手機橫向的暫停選單不用捲動', !lm.scroll && lm.out === 0, JSON.stringify(lm));
  await l.tap('#resume'); await l.waitForTimeout(300);
  await l.evaluate(() => { window.__hd2d.setLevel(5); window.__hd2d.teleport(7.0, 7.1); });
  await untilMode(l, ['battle'], 30000);
  await l.waitForFunction(() => window.__hd2d.state().battle?.mode === 'menu', null, { timeout: 60000 });
  await l.waitForTimeout(800);
  await shot(l, '18-橫向戰鬥');
  const covered = await l.evaluate(() => {
    const m = document.querySelector('.b-menu').getBoundingClientRect();
    return [...document.querySelectorAll('.b-tag')].filter(t => { const r = t.getBoundingClientRect(); return r.width && r.right > m.left && r.left < m.right && r.bottom > m.top && r.top < m.bottom; }).length;
  });
  check('手機橫向的戰鬥選單沒有蓋住敵人名牌', covered === 0, `被蓋住 ${covered} 個`);
  await l.evaluate(() => window.__hd2d.battleAuto(true));
  await until(l, s => s.mode === 'play', '橫向戰鬥結束');
  await lctx.close();

  check('沒有頁面錯誤', errors.length === 0, errors.slice(0, 5).join(' | '));
  fs.writeFileSync(`${out}/結果.json`, JSON.stringify({ time: new Date().toISOString(), results, errors }, null, 2));
  await browser.close(); server.close();
  const failed = results.filter(r => !r.ok).length;
  console.log(`\n共 ${results.length} 項，失敗 ${failed} 項`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); check('流程中斷', false, e.message); fs.writeFileSync(`${out}/結果.json`, JSON.stringify({ time: new Date().toISOString(), results }, null, 2)); server.close(); process.exit(1); });
