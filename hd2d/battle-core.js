// 回合制戰鬥的純邏輯（不碰畫面），方便在瀏覽器與 Node 平衡模擬共用。
// 規則：依速度排定每回合行動順序；打中弱點削減護盾，護盾歸零即「破防」，
// 該敵人跳過本回合剩餘與下一回合的行動，且受到的傷害提高。同伴每回合 +1 BP，
// 最多存 5 點，一次最多投入 3 點強化攻擊或技能。
import { MEMBERS, SKILLS, ITEMS, ENEMIES } from './data.js';

export const MAX_BP = 5, MAX_BOOST = 3, MAX_LV = 20;
const WEAK_MULT = 1.3, BREAK_MULT = 1.5, DEFEND_MULT = 0.5;

export function memberStats(id, lv) {
  const m = MEMBERS[id], s = {};
  for (const k in m.base) s[k] = Math.round(m.base[k] + m.grow[k] * (lv - 1));
  return s;
}
// 從 lv 升到 lv + 1 需要的經驗值
export const expToNext = lv => Math.round(12 * Math.pow(lv, 1.8));
export const learnedSkills = (id, lv) => MEMBERS[id].skills.filter(([, l]) => l <= lv).map(([s]) => s);

// 把經驗值加進同伴紀錄，回傳升級資訊。升級時 HP、SP 上限提高的部分會直接補上。
export function gainExp(rec, exp) {
  const ups = [];
  rec.exp += exp;
  while (rec.lv < MAX_LV && rec.exp >= expToNext(rec.lv)) {
    const before = memberStats(rec.id, rec.lv), oldSkills = learnedSkills(rec.id, rec.lv);
    rec.exp -= expToNext(rec.lv); rec.lv++;
    const after = memberStats(rec.id, rec.lv);
    if (rec.hp > 0) rec.hp += after.hp - before.hp;
    rec.sp += after.sp - before.sp;
    ups.push({ lv: rec.lv, skills: learnedSkills(rec.id, rec.lv).filter(s => !oldSkills.includes(s)) });
  }
  return ups;
}

export function createBattle({ party, enemies, items, revealed = {}, canEscape = true, rng = Math.random }) {
  const units = [];
  for (const rec of party) {
    const s = memberStats(rec.id, rec.lv), m = MEMBERS[rec.id];
    units.push({ side: 'party', id: rec.id, rec, name: m.name, weapon: m.weapon, skills: learnedSkills(rec.id, rec.lv), ...s,
      maxHp: s.hp, maxSp: s.sp, hp: Math.min(rec.hp, s.hp), sp: Math.min(rec.sp, s.sp), bp: 1, boostedLast: false, defending: false, priority: false });
  }
  const counts = {};
  enemies.forEach(k => { counts[k] = (counts[k] || 0) + 1; });
  const seen = {};
  enemies.forEach((k, i) => {
    const e = ENEMIES[k];
    seen[k] = (seen[k] || 0) + 1;
    const suffix = counts[k] > 1 ? ' ' + 'ABCD'[seen[k] - 1] : '';
    revealed[k] ??= [];
    units.push({ side: 'enemy', id: 'e' + i, key: k, name: e.name + suffix, art: e.art, boss: !!e.boss, hp: e.hp, maxHp: e.hp, atk: e.atk, mag: e.mag, def: e.def, spd: e.spd,
      shield: e.shield, maxShield: e.shield, weak: e.weak, known: revealed[k], skills: e.skills, actions: e.actions || 1,
      phase: 1, broken: false, breakUntil: -1, priority: false });
  });

  const b = {
    units, items, round: 0, queue: [], result: null, log: [],
    get party() { return units.filter(u => u.side === 'party'); },
    get enemies() { return units.filter(u => u.side === 'enemy'); },
    alive: u => u.hp > 0,
    canEscape
  };

  const vary = () => 0.92 + rng() * 0.16;
  const order = (randomize) => {
    const list = [];
    for (const u of units) {
      if (u.hp <= 0 || (u.side === 'enemy' && u.breakUntil >= b.round)) continue;
      const base = u.spd * (randomize ? 0.9 + rng() * 0.2 : 1) + (u.priority ? 1000 : 0);
      list.push({ u, s: base });
      for (let k = 1; k < (u.actions || 1); k++) list.push({ u, s: base * (0.55 - k * 0.1) });
    }
    return list.sort((a, b2) => b2.s - a.s).map(x => x.u);
  };

  function newRound() {
    b.round++;
    for (const u of units) {
      if (u.side === 'enemy' && u.broken && b.round > u.breakUntil) { u.broken = false; u.shield = u.maxShield; }
    }
    b.queue = order(true);
    for (const u of units) u.priority = false;
  }

  // 行動順序預覽：本回合剩下的＋下一回合（不含亂數，只是參考）
  b.preview = () => {
    const now = b.queue.filter(u => u.hp > 0 && !(u.side === 'enemy' && u.breakUntil >= b.round));
    const saved = b.round; b.round++;
    const next = order(false); b.round = saved;
    return { now, next };
  };

  b.nextActor = () => {
    if (b.result) return null;
    for (;;) {
      if (!b.queue.length) newRound();
      const u = b.queue.shift();
      if (u.hp <= 0) continue;
      if (u.side === 'enemy' && u.breakUntil >= b.round) continue;
      if (u.side === 'party') {
        if (!u.boostedLast) u.bp = Math.min(MAX_BP, u.bp + (b.round === 1 && !u.started ? 0 : 1));
        u.started = true; u.boostedLast = false; u.defending = false;
      }
      return u;
    }
  };

  const damage = (src, tgt, stat, power, type, boost) => {
    const defense = stat === 'mag' ? tgt.def * 0.5 : tgt.def;
    let d = Math.max(1, src[stat] * 2 - defense) * power * boost * vary();
    const weak = tgt.side === 'enemy' && tgt.weak.includes(type);
    if (weak) d *= WEAK_MULT;
    if (tgt.broken) d *= BREAK_MULT;
    if (tgt.defending) d *= DEFEND_MULT;
    return { dmg: Math.max(1, Math.round(d)), weak };
  };

  function hit(ev, src, tgt, stat, power, type, boost) {
    if (tgt.hp <= 0) return;
    const { dmg, weak } = damage(src, tgt, stat, power, type, boost);
    tgt.hp = Math.max(0, tgt.hp - dmg);
    ev.push({ t: 'hit', src, target: tgt, dmg, weak, type });
    if (weak && !tgt.known.includes(type)) { tgt.known.push(type); ev.push({ t: 'reveal', target: tgt, type }); }
    if (tgt.side === 'enemy' && weak && !tgt.broken && tgt.hp > 0) {
      tgt.shield--;
      ev.push({ t: 'shield', target: tgt, value: tgt.shield });
      if (tgt.shield <= 0) {
        tgt.broken = true;
        tgt.breakUntil = b.round + 1;
        ev.push({ t: 'break', target: tgt });
      }
    }
    if (tgt.hp <= 0) { tgt.defending = false; ev.push({ t: 'ko', target: tgt }); }
    else if (tgt.side === 'enemy' && tgt.phase === 1 && ENEMIES[tgt.key].phase2 && tgt.hp <= tgt.maxHp * ENEMIES[tgt.key].phase2.at) {
      const p2 = ENEMIES[tgt.key].phase2;
      tgt.phase = 2; tgt.skills = p2.skills; tgt.maxShield = p2.shield;
      if (!tgt.broken) tgt.shield = p2.shield;
      ev.push({ t: 'phase', target: tgt, text: p2.text });
    }
  }

  function checkEnd(ev) {
    if (b.enemies.every(u => u.hp <= 0)) b.result = 'win';
    else if (b.party.every(u => u.hp <= 0)) b.result = 'lose';
    if (b.result) ev.push({ t: 'end', result: b.result });
  }

  // cmd：{ type: 'attack'|'skill'|'item'|'defend'|'escape', skill, item, target, bp }
  b.act = (u, cmd) => {
    const ev = [];
    const bp = u.side === 'party' ? Math.max(0, Math.min(cmd.bp || 0, MAX_BOOST, u.bp)) : 0;
    if (bp) { u.bp -= bp; u.boostedLast = true; }
    const foes = units.filter(x => x.side !== u.side && x.hp > 0);
    const friends = units.filter(x => x.side === u.side && x.hp > 0);
    if (cmd.type === 'attack') {
      const tgt = cmd.target?.hp > 0 ? cmd.target : foes[0];
      ev.push({ t: 'act', unit: u, label: bp ? `攻擊（蓄力 ${bp}）` : '攻擊', kind: 'attack', type: u.weapon, targets: [tgt], bp });
      for (let k = 0; k <= bp; k++) hit(ev, u, tgt.hp > 0 ? tgt : foes.find(f => f.hp > 0) || tgt, 'atk', 1, u.weapon, 1);
    } else if (cmd.type === 'skill') {
      const s = SKILLS[cmd.skill];
      u.sp -= s.sp;
      const boost = 1 + bp * 0.9;
      if (s.kind === 'heal') {
        const list = s.target === 'allies' ? friends : [cmd.target];
        ev.push({ t: 'act', unit: u, label: s.name, kind: 'heal', targets: list, bp });
        for (const tgt of list) {
          if (tgt.hp <= 0) continue;
          const amt = Math.min(tgt.maxHp - tgt.hp, Math.round(u.mag * s.power * 2 * (1 + bp * 0.7) * vary()));
          tgt.hp += amt; ev.push({ t: 'heal', target: tgt, amount: amt });
        }
      } else if (s.kind === 'reveal') {
        const tgt = cmd.target;
        ev.push({ t: 'act', unit: u, label: s.name, kind: 'reveal', targets: [tgt], bp });
        for (const ty of tgt.weak) if (!tgt.known.includes(ty)) { tgt.known.push(ty); ev.push({ t: 'reveal', target: tgt, type: ty }); }
        if (ev.length === 1) ev.push({ t: 'note', text: '已經知道所有弱點了。' });
      } else {
        const list = s.target === 'enemies' ? foes : [cmd.target?.hp > 0 ? cmd.target : foes[0]];
        ev.push({ t: 'act', unit: u, label: s.name, kind: 'skill', type: s.type, targets: list, bp });
        for (let k = 0; k < (s.hits || 1); k++) for (const tgt of list) hit(ev, u, tgt, s.stat, s.power, s.type, boost);
      }
    } else if (cmd.type === 'item') {
      const it = ITEMS[cmd.item], tgt = cmd.target;
      items[cmd.item]--;
      ev.push({ t: 'act', unit: u, label: it.name, kind: 'item', targets: [tgt], bp: 0 });
      if (it.revive && tgt.hp <= 0) { const amt = Math.round(tgt.maxHp * it.revive); tgt.hp = amt; ev.push({ t: 'revive', target: tgt, amount: amt }); }
      if (it.heal && tgt.hp > 0) { const amt = Math.min(tgt.maxHp - tgt.hp, it.heal); tgt.hp += amt; ev.push({ t: 'heal', target: tgt, amount: amt }); }
      if (it.sp && tgt.hp > 0) { const amt = Math.min(tgt.maxSp - tgt.sp, it.sp); tgt.sp += amt; ev.push({ t: 'sp', target: tgt, amount: amt }); }
    } else if (cmd.type === 'defend') {
      u.defending = true; u.priority = true;
      ev.push({ t: 'act', unit: u, label: '防禦', kind: 'defend', targets: [u], bp: 0 });
    } else if (cmd.type === 'escape') {
      ev.push({ t: 'act', unit: u, label: '逃跑', kind: 'escape', targets: [], bp: 0 });
      b.result = 'escape'; ev.push({ t: 'end', result: 'escape' });
      return ev;
    } else if (cmd.type === 'enemy') {
      const s = cmd.skill, list = s.target === 'all' ? foes : [cmd.target];
      ev.push({ t: 'act', unit: u, label: s.name, kind: s.target === 'all' ? 'enemyAll' : 'enemy', targets: list, bp: 0 });
      for (const tgt of list) hit(ev, u, tgt, s.stat || 'atk', s.power, null, 1);
    }
    checkEnd(ev);
    return ev;
  };

  // 敵人的行動：依權重挑招式，單體招式隨機挑目標（頭目偏好血量較低的同伴）。
  b.enemyCommand = u => {
    const total = u.skills.reduce((a, s) => a + s.w, 0);
    let r = rng() * total, skill = u.skills[0];
    for (const s of u.skills) { r -= s.w; if (r <= 0) { skill = s; break; } }
    const alive = b.party.filter(x => x.hp > 0);
    let target = alive[Math.floor(rng() * alive.length)];
    if (u.boss && rng() < 0.4) target = alive.reduce((a, x) => (x.hp / x.maxHp < a.hp / a.maxHp ? x : a));
    return { type: 'enemy', skill, target };
  };

  b.rewards = () => b.enemies.reduce((a, u) => a + ENEMIES[u.key].exp, 0);
  return b;
}

// 自動作戰：給自動測試與平衡模擬使用，模擬「熟悉規則的玩家」。
// 對每個可行指令估一個分數：造成的有效傷害、削減護盾、破防，扣掉 BP 與 SP 成本。
export function autoCommand(b, u) {
  const foes = b.enemies.filter(x => x.hp > 0);
  const allies = b.party.filter(x => x.hp > 0);
  const fallen = b.party.filter(x => x.hp <= 0);
  const can = s => u.skills.includes(s) && u.sp >= SKILLS[s].sp;
  if (fallen.length && b.items.feather > 0) return { type: 'item', item: 'feather', target: fallen[0] };
  const low = allies.filter(x => x.hp < x.maxHp * 0.45).sort((a, c) => a.hp / a.maxHp - c.hp / c.maxHp);
  if (low.length) {
    if (low.length >= 2 && can('blessing')) return { type: 'skill', skill: 'blessing', target: null, bp: Math.min(u.bp, 1) };
    if (can('heal')) return { type: 'skill', skill: 'heal', target: low[0], bp: low[0].hp < low[0].maxHp * 0.25 ? Math.min(u.bp, 1) : 0 };
    const healer = allies.find(x => x.skills.includes('heal') && x.sp >= SKILLS.heal.sp);
    if ((!healer || low[0].hp < low[0].maxHp * 0.2) && b.items.herb > 0) return { type: 'item', item: 'herb', target: low[0] };
  }
  if (u.sp < u.maxSp * 0.25 && b.items.dew > 0 && u.skills.includes('heal')) return { type: 'item', item: 'dew', target: u };

  const est = (stat, power, type, tgt, bp) => {
    const defense = stat === 'mag' ? tgt.def * 0.5 : tgt.def;
    let d = Math.max(1, u[stat] * 2 - defense) * power * bp;
    if (tgt.weak.includes(type)) d *= WEAK_MULT;
    if (tgt.broken) d *= BREAK_MULT;
    return d;
  };
  const score = (targets, stat, power, type, hits, boostMult, bp, spCost) => {
    let v = 0;
    for (const tgt of targets) {
      let hp = tgt.hp, shield = tgt.shield;
      const weak = tgt.weak.includes(type);
      for (let k = 0; k < hits; k++) {
        const d = est(stat, power, type, tgt, boostMult);
        v += Math.min(d, hp); hp -= d;
        if (hp <= 0) { v += 40; break; }
        if (weak && !tgt.broken) { shield--; v += 18; if (shield === 0) v += 90 + tgt.maxHp * 0.08; }
      }
    }
    const brokenTarget = targets.some(t => t.broken);
    return v - bp * (brokenTarget ? 4 : u.bp >= 4 ? 10 : 35) - spCost * 2.2;
  };
  let best = { type: 'attack', target: foes[0], bp: 0 }, bestV = -Infinity;
  for (const tgt of foes) for (let bp = 0; bp <= Math.min(MAX_BOOST, u.bp); bp++) {
    const v = score([tgt], 'atk', 1, u.weapon, 1 + bp, 1, bp, 0);
    if (v > bestV) { bestV = v; best = { type: 'attack', target: tgt, bp }; }
  }
  for (const s of u.skills) {
    const sk = SKILLS[s];
    if (sk.kind || !can(s)) continue;
    const targetSets = sk.target === 'enemies' ? [foes] : foes.map(f => [f]);
    for (const set of targetSets) for (let bp = 0; bp <= Math.min(MAX_BOOST, u.bp); bp++) {
      const v = score(set, sk.stat, sk.power, sk.type, sk.hits || 1, 1 + bp * 0.9, bp, sk.sp);
      if (v > bestV) { bestV = v; best = { type: 'skill', skill: s, target: set[0], bp }; }
    }
  }
  return best;
}
