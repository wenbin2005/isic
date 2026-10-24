// 星燈港戰鬥規則測試：直接載入 battle-core.js，用固定亂數（vary = 1、行動順序不擾動）逐條核對 使用說明.md 的「戰鬥規則」。
// 用法：node hd2d/tools/規則測試.mjs [hd2d 資料夾，預設為本檔的上一層] [輸出 JSON 路徑]（不需要伺服器）
import { pathToFileURL, fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const core = await import(pathToFileURL(path.join(dir, 'battle-core.js')).href);
const { ITEMS } = await import(pathToFileURL(path.join(dir, 'data.js')).href);
const { createBattle, gainExp, memberStats, expToNext, MAX_BP, MAX_BOOST, MAX_LV } = core;
const R = () => 0.5;
const rec = (id, lv) => { const s = memberStats(id, lv); return { id, lv, exp: 0, hp: s.hp, sp: s.sp }; };
const results = [];
function check(name, fn) {
  try { const detail = fn(); results.push({ name, pass: true, detail: detail ?? null }); console.log('通過：' + name); }
  catch (e) { results.push({ name, pass: false, error: e.message }); console.log('失敗：' + name + '：' + e.message); }
}
const assert = (c, m) => { if (!c) throw new Error(m); };
// 取下一個同伴行動者；敵人的回合直接跳過（不出招）
const nextParty = b => { for (;;) { const u = b.nextActor(); if (u.side === 'party') return u; } };
const hits = ev => ev.filter(e => e.t === 'hit');

check('常數：BP 上限 5、一次最多投入 3、最高 20 級', () => { assert(MAX_BP === 5 && MAX_BOOST === 3 && MAX_LV === 20, `${MAX_BP}/${MAX_BOOST}/${MAX_LV}`); });

check('BP：開戰 1 點、第一次行動不加、之後每回合 +1、存到 5 點為止', () => {
  const b = createBattle({ party: [rec('hero', 20)], enemies: ['treant'], items: {}, rng: R });
  const seq = [];
  for (let i = 0; i < 7; i++) { const u = nextParty(b); seq.push(u.bp); b.act(u, { type: 'defend' }); }
  assert(seq.join() === '1,2,3,4,5,5,5', seq.join());
  return seq;
});

check('蓄力：一次最多 3 點且不超過持有量；蓄力的那一回合結束後下一回合不加 BP', () => {
  const b = createBattle({ party: [rec('hero', 20)], enemies: ['treant'], items: {}, rng: R });
  let u;
  for (let i = 0; i < 5; i++) { u = nextParty(b); if (i < 4) b.act(u, { type: 'defend' }); }
  assert(u.bp === 5, `第 5 回合 BP ${u.bp}`);
  const ev = b.act(u, { type: 'attack', bp: 9 });
  const used = 5 - u.bp;
  const u2 = nextParty(b), afterBoost = u2.bp;
  b.act(u2, { type: 'defend' });
  const u3 = nextParty(b);
  assert(used === 3, `要求 9 點實際用 ${used}`);
  assert(hits(ev).length === 4, `蓄力 3 的普通攻擊打 ${hits(ev).length} 下（應 4 下）`);
  assert(afterBoost === 2 && u3.bp === 3, `蓄力後下一回合 BP ${afterBoost}（應維持 2）、再下一回合 ${u3.bp}`);
  return { used, hitsCount: hits(ev).length, afterBoost, next: u3.bp };
});

check('護盾與破防：打中弱點每下削 1 點，歸零破防；破防期間跳過本回合與下一回合、傷害 ×1.5，之後護盾回滿', () => {
  const b = createBattle({ party: [rec('hero', 1)], enemies: ['fox'], items: {}, rng: R });
  const fox = b.enemies[0];
  fox.hp = fox.maxHp = 99999; // 只看護盾與傷害，避免被打倒
  let u = nextParty(b);
  const normal = hits(b.act(u, { type: 'attack', target: fox, bp: 0 }))[0].dmg;
  assert(fox.shield === 1 && !fox.broken, `一下後護盾 ${fox.shield}`);
  u = nextParty(b);
  b.act(u, { type: 'attack', target: fox, bp: 0 });
  const brokenAt = b.round;
  assert(fox.broken && fox.shield === 0 && fox.breakUntil === brokenAt + 1, `第二下後 broken=${fox.broken} breakUntil=${fox.breakUntil} round=${brokenAt}`);
  const acted = [];
  for (let guard = 0; guard < 20; guard++) {
    const a = b.nextActor();
    if (b.round > brokenAt + 1) break;
    acted.push(`${b.round}:${a.side}`);
    if (a.side === 'party') b.act(a, { type: 'defend' });
  }
  assert(!acted.some(x => x.endsWith('enemy')), `破防期間影狐仍行動：${acted}`);
  assert(!fox.broken && fox.shield === fox.maxShield, `第 ${b.round} 回合 broken=${fox.broken} 護盾 ${fox.shield}`);
  const b2 = createBattle({ party: [rec('hero', 1)], enemies: ['fox'], items: {}, rng: R });
  const f2 = b2.enemies[0]; f2.hp = f2.maxHp = 99999; f2.broken = true; f2.breakUntil = 99; f2.shield = 0;
  const brokenDmg = hits(b2.act(nextParty(b2), { type: 'attack', target: f2, bp: 0 }))[0].dmg;
  assert(Math.abs(brokenDmg / normal - 1.5) < 0.02, `破防前 ${normal}、破防中 ${brokenDmg}`);
  return { brokenAt, actedWhileBroken: acted, recoveredAtRound: b.round, normal, broken: brokenDmg };
});

check('防禦：受到的傷害減半，下一回合排在最前面', () => {
  const mk = () => { const b = createBattle({ party: [rec('hero', 5)], enemies: ['wolf'], items: {}, rng: R }); return b; };
  const b1 = mk(), wolf1 = b1.enemies[0], hero1 = b1.party[0];
  const normal = hits(b1.act(wolf1, { type: 'enemy', skill: { name: '撕咬', power: 1 }, target: hero1 }))[0].dmg;
  const b2 = mk(), wolf2 = b2.enemies[0];
  const u = nextParty(b2);
  b2.act(u, { type: 'defend' });
  const guarded = hits(b2.act(wolf2, { type: 'enemy', skill: { name: '撕咬', power: 1 }, target: u }))[0].dmg;
  while (b2.queue.length) b2.nextActor(); // 用完本回合
  const first = b2.nextActor(); // 新回合第一位
  assert(Math.abs(guarded / normal - 0.5) < 0.02, `一般 ${normal}、防禦 ${guarded}`);
  assert(first.side === 'party', `防禦後新回合第一位是 ${first.name}（霧狼速度 19 高於旅人）`);
  return { normal, guarded, first: first.name };
});

check('頭目一回合行動兩次', () => {
  for (const k of ['wolfKing', 'starEater']) {
    const b = createBattle({ party: [rec('hero', 10)], enemies: [k], items: {}, rng: R });
    const first = b.nextActor();
    const n = b.queue.filter(u => u.side === 'enemy').length + (first.side === 'enemy' ? 1 : 0);
    assert(n === 2, `${k} 第一回合佇列有 ${n} 次`);
  }
});

check('熄星者血量降到一半時進入第二階段：護盾 10、招式換成第二階段', () => {
  const b = createBattle({ party: [rec('hero', 20)], enemies: ['starEater'], items: {}, rng: R });
  const boss = b.enemies[0];
  boss.hp = Math.floor(boss.maxHp * 0.5) + 5;
  const u = nextParty(b);
  const ev = b.act(u, { type: 'attack', target: boss, bp: 0 });
  assert(boss.phase === 2 && boss.shield === 10 && boss.skills.some(s => s.name === '星之吞噬'), `phase ${boss.phase} 護盾 ${boss.shield}`);
  assert(ev.some(e => e.t === 'phase'), '沒有第二階段事件');
});

check('經驗值：升級時活著的同伴補上 HP 上限差，倒下的維持 0；20 級後不再升級', () => {
  const a = rec('hero', 1), d = { ...rec('hero', 1), hp: 0 };
  gainExp(a, expToNext(1)); gainExp(d, expToNext(1));
  const top = rec('hero', 20); const ups = gainExp(top, 99999);
  assert(a.lv === 2 && a.hp === memberStats('hero', 2).hp, `活著 lv${a.lv} hp ${a.hp}`);
  assert(d.lv === 2 && d.hp === 0, `倒下 lv${d.lv} hp ${d.hp}`);
  assert(top.lv === 20 && ups.length === 0, `20 級 → ${top.lv}`);
  return { maxLevelExp: top.exp, nextShownInMenu: expToNext(20) - top.exp };
});

check('觀察：回復藥草可以用在 HP 全滿的同伴身上（道具照扣、回復 0）', () => {
  const items = { herb: 1 };
  const b = createBattle({ party: [rec('hero', 5)], enemies: ['bat'], items, rng: R });
  const u = nextParty(b);
  const ev = b.act(u, { type: 'item', item: 'herb', target: u });
  const heal = ev.find(e => e.t === 'heal');
  return { herbLeft: items.herb, healed: heal?.amount, itemTarget: ITEMS.herb.target };
});

const out = process.argv[3];
if (out) writeFileSync(out, JSON.stringify({ time: new Date().toISOString(), results }, null, 1));
const failed = results.filter(r => !r.pass).length;
console.log(`\n共 ${results.length} 項，失敗 ${failed}`);
process.exit(failed ? 1 : 0);
