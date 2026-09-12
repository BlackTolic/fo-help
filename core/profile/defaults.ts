// Profile 默认值 - 任何缺失字段都用这里兜底

import type { Profile, Rect } from './types';

export const DEFAULT_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

export const DEFAULT_ENGINE = {
  display: 'gdi' as const,
  mouse: 'windows' as const,
  keypad: 'windows' as const,
  mode: 0,
};

export const DEFAULT_REGIONS = {
  minimap: { x: 1700, y: 0, w: 220, h: 220 },
  selfHp: { x: 60, y: 50, w: 200, h: 30 },
  selfMp: { x: 60, y: 90, w: 200, h: 30 },
  targetHp: { x: 800, y: 100, w: 200, h: 20 },
  skillBar: { x: 700, y: 900, w: 500, h: 80 },
  chat: { x: 0, y: 600, w: 400, h: 200 },
};

export const DEFAULT_COMBAT: Profile['combat'] = {
  approachDistance: 8,
  combatTimeoutMs: 60000,
  healThreshold: 40,
  escapeThreshold: 15,
  kiteDistance: 12,
  findTargetRange: 400,
  findTargetIntervalMs: 1500,
  mobFilter: {
    minLevel: 1,
    maxLevel: 999,
    nameKeywords: ['野', '狼', '鸡', '鹿', '狐', '猫', '怪', '兽'],
    colorFilter: ['white', 'yellow', 'red'],
  },
};

export const DEFAULT_FARM = {
  farmSpot: { x: 1234, y: 5678 },
  returnThreshold: 8,
  resupply: {
    hpPotionThreshold: 50,
    mpPotionThreshold: 30,
  },
};
