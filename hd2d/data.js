// 戰鬥資料：同伴、技能、敵人、道具與遭遇組合。
// 數值調整後請執行 tools/平衡模擬.mjs，確認各章戰鬥的回合數與剩餘血量仍在預期範圍。

// 攻擊屬性：三種武器＋三種元素。敵人的弱點也用這些代號。
export const TYPES = { sword: '劍', dagger: '匕', staff: '杖', fire: '火', wind: '風', light: '光' };

// base 是 1 級數值，grow 是每升一級增加的量。
export const MEMBERS = {
  hero: {
    name: '旅人', palette: 'hero', weapon: 'sword',
    base: { hp: 150, sp: 30, atk: 24, mag: 12, def: 14, spd: 14 },
    grow: { hp: 19, sp: 3, atk: 2.6, mag: 1.2, def: 1.8, spd: 0.8 },
    skills: [['flameSlash', 1], ['galeSlash', 3], ['starFlash', 6]]
  },
  mira: {
    name: '米菈', palette: 'florist', weapon: 'staff',
    base: { hp: 115, sp: 48, atk: 15, mag: 23, def: 11, spd: 16 },
    grow: { hp: 14, sp: 4, atk: 1.4, mag: 2.6, def: 1.4, spd: 0.9 },
    skills: [['heal', 1], ['petalWind', 1], ['blessing', 4], ['starPrayer', 7]]
  },
  sein: {
    name: '賽恩', palette: 'merchant', weapon: 'dagger',
    base: { hp: 130, sp: 36, atk: 21, mag: 16, def: 12, spd: 21 },
    grow: { hp: 16, sp: 3, atk: 2.4, mag: 1.6, def: 1.5, spd: 1.1 },
    skills: [['ambush', 1], ['powderKeg', 1], ['appraise', 1], ['windKnife', 8]]
  }
};

// target：enemy 單體、enemies 全體、ally 單一同伴、allies 全體同伴。
// power 是倍率；hits 是連擊次數，每一擊打中弱點都會削減 1 點護盾。
export const SKILLS = {
  flameSlash: { name: '烈焰斬', type: 'fire', sp: 6, target: 'enemy', stat: 'atk', power: 1.5, desc: '火屬性斬擊一名敵人。' },
  galeSlash: { name: '疾風連斬', type: 'sword', sp: 8, target: 'enemy', stat: 'atk', power: 0.85, hits: 2, desc: '劍屬性兩連擊，可削減兩點護盾。' },
  starFlash: { name: '星光一閃', type: 'light', sp: 14, target: 'enemies', stat: 'atk', power: 1.05, desc: '光屬性，攻擊全體敵人。' },
  heal: { name: '治癒之花', kind: 'heal', sp: 5, target: 'ally', power: 2.1, desc: '回復一名同伴的 HP。' },
  petalWind: { name: '風之花瓣', type: 'wind', sp: 6, target: 'enemies', stat: 'mag', power: 0.9, desc: '風屬性，攻擊全體敵人。' },
  blessing: { name: '花之祝福', kind: 'heal', sp: 12, target: 'allies', power: 1.4, desc: '回復全體同伴的 HP。' },
  starPrayer: { name: '星之祈禱', type: 'light', sp: 10, target: 'enemy', stat: 'mag', power: 1.7, desc: '光屬性，攻擊一名敵人。' },
  ambush: { name: '偷襲', type: 'dagger', sp: 4, target: 'enemy', stat: 'atk', power: 0.75, hits: 2, desc: '匕首兩連擊，可削減兩點護盾。' },
  powderKeg: { name: '火藥瓶', type: 'fire', sp: 7, target: 'enemies', stat: 'atk', power: 0.8, desc: '火屬性，攻擊全體敵人。' },
  appraise: { name: '鑑定', kind: 'reveal', sp: 2, target: 'enemy', desc: '看穿一名敵人的所有弱點。' },
  windKnife: { name: '疾風飛刃', type: 'wind', sp: 7, target: 'enemy', stat: 'atk', power: 1.5, desc: '風屬性，攻擊一名敵人。' }
};

export const ITEMS = {
  herb: { name: '回復藥草', target: 'ally', heal: 150, desc: '回復一名同伴 150 HP。' },
  dew: { name: '星露', target: 'ally', sp: 30, desc: '回復一名同伴 30 SP。' },
  feather: { name: '星之羽', target: 'fallen', revive: 0.5, desc: '讓倒下的同伴復活，並回復一半 HP。' }
};

// 敵人招式：power 倍率、target one/all、stat atk/mag、w 為出招權重。
// actions 為每回合行動次數；phase2 為血量低於一半時的變化。
export const ENEMIES = {
  fox: { name: '影狐', art: 'fox', hp: 130, atk: 19, mag: 10, def: 9, spd: 17, shield: 2, weak: ['sword', 'light'], exp: 26,
    skills: [{ name: '撲咬', power: 1, w: 3 }, { name: '影爪', power: 1.3, w: 1 }] },
  bat: { name: '黃昏蝙蝠', art: 'bat', hp: 85, atk: 16, mag: 14, def: 6, spd: 20, shield: 1, weak: ['wind', 'sword'], exp: 18,
    skills: [{ name: '俯衝', power: 1, w: 3 }, { name: '超音波', power: 0.6, target: 'all', stat: 'mag', w: 1 }] },
  thorn: { name: '荊棘精', art: 'thorn', hp: 150, atk: 18, mag: 18, def: 10, spd: 11, shield: 2, weak: ['fire', 'dagger'], exp: 30,
    skills: [{ name: '藤鞭', power: 1, w: 3 }, { name: '尖刺雨', power: 0.65, target: 'all', stat: 'mag', w: 1 }] },
  crab: { name: '潮影蟹', art: 'crab', hp: 420, atk: 24, mag: 20, def: 18, spd: 9, shield: 3, weak: ['wind', 'staff'], exp: 75,
    skills: [{ name: '巨鉗', power: 1.2, w: 3 }, { name: '泡沫', power: 0.7, target: 'all', stat: 'mag', w: 1 }] },
  wolf: { name: '霧狼', art: 'wolf', hp: 480, atk: 35, mag: 18, def: 19, spd: 19, shield: 3, weak: ['fire', 'dagger'], exp: 60,
    skills: [{ name: '撕咬', power: 1, w: 3 }, { name: '霧襲', power: 1.3, w: 1 }] },
  shroom: { name: '毒蕈', art: 'shroom', hp: 400, atk: 29, mag: 32, def: 15, spd: 10, shield: 3, weak: ['wind', 'sword'], exp: 50,
    skills: [{ name: '撞擊', power: 1, w: 2 }, { name: '孢子', power: 0.65, target: 'all', stat: 'mag', w: 1 }] },
  treant: { name: '樹靈', art: 'treant', hp: 700, atk: 38, mag: 22, def: 24, spd: 7, shield: 4, weak: ['fire', 'staff'], exp: 85,
    skills: [{ name: '重擊', power: 1.35, w: 2 }, { name: '枝葉橫掃', power: 0.75, target: 'all', w: 1 }] },
  wolfKing: { name: '霧狼王', art: 'wolfKing', hp: 2600, atk: 44, mag: 36, def: 23, spd: 18, shield: 6, weak: ['fire', 'light', 'dagger'], exp: 300, actions: 2, boss: true,
    skills: [{ name: '利牙', power: 1.2, w: 3 }, { name: '霧之嚎叫', power: 0.75, target: 'all', stat: 'mag', w: 2 }, { name: '迅影', power: 1.6, w: 1 }] },
  golem: { name: '石像守衛', art: 'golem', hp: 980, atk: 48, mag: 20, def: 36, spd: 6, shield: 5, weak: ['staff', 'wind'], exp: 180,
    skills: [{ name: '岩拳', power: 1.3, w: 2 }, { name: '地鳴', power: 0.75, target: 'all', w: 1 }] },
  knight: { name: '暗影騎士', art: 'knight', hp: 820, atk: 50, mag: 40, def: 28, spd: 15, shield: 4, weak: ['light', 'sword'], exp: 170,
    skills: [{ name: '暗刃', power: 1.1, w: 3 }, { name: '黑焰', power: 0.8, target: 'all', stat: 'mag', w: 1 }] },
  starEater: { name: '熄星者', art: 'starEater', hp: 4200, atk: 44, mag: 38, def: 28, spd: 17, shield: 8, weak: ['light', 'staff', 'dagger'], exp: 0, actions: 2, boss: true,
    skills: [{ name: '暗星', power: 1.2, stat: 'mag', w: 3 }, { name: '吞光', power: 0.75, target: 'all', stat: 'mag', w: 2 }, { name: '星蝕之爪', power: 1.45, w: 1 }],
    phase2: { at: 0.5, shield: 10, text: '熄星者吞下了四周的星光，護盾重新凝聚！',
      skills: [{ name: '暗星', power: 1.25, stat: 'mag', w: 2 }, { name: '星之吞噬', power: 0.95, target: 'all', stat: 'mag', w: 2 }, { name: '星蝕之爪', power: 1.55, w: 1 }] } }
};

// 遭遇組合：stage 決定戰鬥背景；escape 為 false 時不能逃跑。drops 是勝利後必定取得的道具。
export const ENCOUNTERS = {
  shrineGuard: { enemies: ['thorn', 'thorn'], stage: 'town', escape: false, drops: { herb: 1 } },
  pierGuard: { enemies: ['crab'], stage: 'shore', escape: false, drops: { dew: 1 } },
  fieldGuard: { enemies: ['fox', 'fox'], stage: 'town', escape: false, drops: { herb: 1 } },
  beachBats: { enemies: ['bat', 'bat'], stage: 'shore', drops: {} },
  meadowFox: { enemies: ['fox', 'bat'], stage: 'town', drops: { herb: 1 } },
  forestWolf: { enemies: ['wolf'], stage: 'forest', drops: {} },
  forestShrooms: { enemies: ['shroom', 'shroom'], stage: 'forest', drops: { herb: 1 } },
  forestPack: { enemies: ['wolf', 'shroom'], stage: 'forest', drops: {} },
  forestTreant: { enemies: ['treant'], stage: 'forest', drops: { dew: 1 } },
  forestDeep: { enemies: ['treant', 'wolf'], stage: 'forest', drops: { feather: 1 } },
  wolfKing: { enemies: ['wolfKing'], stage: 'forest', escape: false, drops: { herb: 2, dew: 1 } },
  ruinKnight: { enemies: ['knight'], stage: 'ruins', drops: {} },
  ruinGolem: { enemies: ['golem'], stage: 'ruins', drops: { herb: 1 } },
  ruinPair: { enemies: ['golem', 'knight'], stage: 'ruins', drops: { dew: 1 } },
  ruinKnights: { enemies: ['knight', 'knight'], stage: 'ruins', drops: { feather: 1 } },
  starEater: { enemies: ['starEater'], stage: 'boss', escape: false, drops: {} }
};
