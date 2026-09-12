// Profile 类型定义 - 全部基于 YAML 配置,引擎不写死逻辑

export type AttackType = 'melee' | 'ranged';
export type CombatStyle = 'single' | 'aoe' | 'pull' | 'kite' | 'backline';
export type SkillType = 'basic' | 'aoe' | 'gap_close' | 'heal' | 'threat' | 'buff' | 'utility';
export type PotionType = 'hp_potion' | 'mp_potion' | 'buff' | 'emergency_teleport' | 'cleanse';

/** 触发条件 */
export interface Condition {
  type: 'selfHp' | 'selfMp' | 'targetHp' | 'nearbyMobs' | 'distance' | 'onCombatStart' | 'inCombat';
  op: 'less_than' | 'greater_than' | 'equal' | 'at_least' | 'at_most';
  value: number | boolean;
}

/** 技能配置 */
export interface SkillConfig {
  name: string;
  type: SkillType;
  cooldownMs: number;
  priority: number;
  condition?: Condition;
  interruptible?: boolean;
  preemptedBy?: string[];  // 被这些键位的技能打断
}

/** 药水/特殊按键配置 */
export interface PotionConfig {
  type: PotionType;
  trigger: Condition;
  priority?: number;
}

/** 职业配置 */
export interface ClassConfig {
  name: string;                            // 战士 / 法师 / 道士 / ...
  attackType: AttackType;
  combatStyle: CombatStyle;
  idealDistance: number;                   // 理想作战距离(像素)
  movementSpeed: number;                   // 战斗内移动间隔 ms
  skills: Partial<Record<'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9', SkillConfig>>;
  potions: Partial<Record<'Q' | 'W' | 'E' | 'R' | 'A' | 'S' | 'D' | 'F', PotionConfig>>;
}

/** 大漠绑定配置 */
export interface EngineConfig {
  display: 'normal' | 'gdi' | 'gdi2' | 'dx' | 'dx2' | 'dx3';
  mouse: 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2';
  keypad: 'normal' | 'windows' | 'windows2' | 'dx' | 'dx2';
  mode: number;  // 0-101
}

/** UI 区域(屏幕坐标) */
export interface Regions {
  minimap: Rect;
  selfHp: Rect;
  selfMp: Rect;
  targetHp: Rect;
  skillBar: Rect;
  chat: Rect;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 战斗策略 */
export interface CombatConfig {
  approachDistance: number;
  combatTimeoutMs: number;
  healThreshold: number;
  escapeThreshold: number;
  kiteDistance?: number;
  findTargetRange: number;             // 视野范围
  findTargetIntervalMs: number;        // 找怪间隔
  mobFilter: {
    minLevel?: number;
    maxLevel?: number;
    namePattern?: string;              // 正则
    nameKeywords?: string[];           // 怪名关键字(任一匹配) - 简化
    colorFilter?: ('white' | 'yellow' | 'red')[];  // 白/黄/红名
  };
}

/** 任务 */
export type TaskTypeConfig = 'farm' | 'mine' | 'catch-pet' | 'refine' | 'reputation';

export interface FarmConfig extends CombatConfig {
  farmSpot: { x: number; y: number };
  returnThreshold: number;
  resupply: {
    hpPotionThreshold: number;
    mpPotionThreshold: number;
  };
}

/** 完整 Profile */
export interface Profile {
  id: string;
  name: string;
  game: string;
  version: number;
  description?: string;

  engine: EngineConfig;
  regions: Regions;
  fontLib: string;             // 字库路径(0_ffo.txt)
  templates: {
    mobNormal?: string;
    mobElite?: string;
    playerArrow: string;
    dropWhite?: string;
    dropBlue?: string;
  };

  class: ClassConfig;
  combat: CombatConfig;
  farm?: FarmConfig;

  // 任务配置(简版,P4 扩展)
  tasks: TaskTypeConfig[];
}
