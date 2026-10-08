// 戰鬥平衡模擬：用 battle-core 的自動作戰跑完整條劇情的戰鬥順序，統計勝率、回合數、剩餘血量與等級。
// 執行：node tools/平衡模擬.mjs [每種情境的模擬次數，預設 300]
import { createBattle, autoCommand, gainExp, memberStats, expToNext } from '../battle-core.js';
import { ENCOUNTERS } from '../data.js';

const RUNS = Number(process.argv[2]) || 300;

function rng(seed) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 主線路線：rest 表示在休息點完全回復；join 表示同伴加入（等級與主角相同）。
const ROUTE = [
  'beachBats', 'join:mira', 'shrineGuard', 'pierGuard', 'rest', 'fieldGuard', 'meadowFox', 'rest',
  'join:sein', 'forestWolf', 'forestShrooms', 'rest', 'forestPack', 'forestTreant', 'forestDeep', 'rest', 'wolfKing',
  'rest', 'ruinKnight', 'ruinGolem', 'rest', 'ruinPair', 'ruinKnights', 'rest', 'starEater'
];

function fight(name, party, items, revealed, R) {
  const enc = ENCOUNTERS[name];
  const b = createBattle({ party, enemies: enc.enemies, items, revealed, canEscape: false, rng: R });
  let turns = 0;
  while (!b.result && turns < 400) {
    const u = b.nextActor();
    const cmd = u.side === 'party' ? autoCommand(b, u) : b.enemyCommand(u);
    b.act(u, cmd);
    turns++;
  }
  for (const u of b.party) { u.rec.hp = u.hp; u.rec.sp = u.sp; }
  const hpPct = b.party.reduce((a, u) => a + u.hp, 0) / b.party.reduce((a, u) => a + u.maxHp, 0);
  return { win: b.result === 'win', rounds: b.round, hpPct, exp: b.rewards(), drops: enc.drops };
}

const stats = {};
for (let run = 0; run < RUNS; run++) {
  const R = rng(1000 + run);
  const party = [{ id: 'hero', lv: 1, exp: 0, ...full('hero', 1) }];
  const items = { herb: 3, dew: 1, feather: 1 };
  const revealed = {};
  let i = 0;
  for (const step of ROUTE) {
    i++;
    if (step === 'rest') { for (const p of party) Object.assign(p, full(p.id, p.lv)); continue; }
    if (step.startsWith('join:')) { const id = step.slice(5); party.push({ id, lv: party[0].lv, exp: 0, ...full(id, party[0].lv) }); continue; }
    const r = fight(step, party, items, revealed, R);
    const key = `${String(i).padStart(2, '0')} ${step}`;
    const s = (stats[key] ??= { wins: 0, rounds: 0, hp: 0, lv: 0, n: 0 });
    s.n++; s.lv += party[0].lv;
    if (r.win) { s.wins++; s.rounds += r.rounds; s.hp += r.hpPct; }
    if (!r.win) { for (const p of party) Object.assign(p, full(p.id, p.lv)); continue; } // 遊戲中失敗會以全滿狀態重試
    for (const p of party) { if (p.hp <= 0) p.hp = 1; gainExp(p, r.exp); }
    for (const k in r.drops) items[k] += r.drops[k];
  }
}
function full(id, lv) { const s = memberStats(id, lv); return { hp: s.hp, sp: s.sp }; }

console.log('戰鬥                勝率   平均回合  勝利時剩餘HP  戰前等級');
for (const [k, s] of Object.entries(stats)) {
  console.log(`${k.padEnd(20)} ${(s.wins / s.n * 100).toFixed(0).padStart(4)}%  ${(s.rounds / Math.max(1, s.wins)).toFixed(1).padStart(6)}  ${(s.hp / Math.max(1, s.wins) * 100).toFixed(0).padStart(8)}%  ${(s.lv / s.n).toFixed(1).padStart(8)}`);
}
console.log('升級所需經驗：', Array.from({ length: 12 }, (_, i) => `${i + 1}→${i + 2}:${expToNext(i + 1)}`).join(' '));
