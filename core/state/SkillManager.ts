// SkillManager: 技能冷却管理 + 智能选技
// 从 Profile.class.skills 读配置

import type { IInputProvider, KeyCode } from '../platform/input/IInputProvider';
import type { Profile, Condition } from '../profile/types';

const KEY_TO_VK: Record<string, KeyCode> = {
  F1: 'F1', F2: 'F2', F3: 'F3', F4: 'F4', F5: 'F5',
  F6: 'F6', F7: 'F7', F8: 'F8', F9: 'F9',
  Q: 'Q', W: 'W', E: 'E', R: 'R',
  A: 'A', S: 'S', D: 'D', F: 'F',
};

export interface CombatContext {
  selfHp: number;
  selfMp: number;
  targetHp: number;
  nearbyMobs: number;
  inCombat: boolean;
  distance: number;       // 当前与目标距离
  onCombatStart: boolean;
}

export class SkillManager {
  private lastCast: Map<string, number> = new Map();  // key -> timestamp
  private lastPotion: Map<string, number> = new Map();

  constructor(
    private input: IInputProvider,
    private profile: Profile,
  ) {}

  /**
   * 尝试释放技能(自动判断冷却 + 条件)
   * @returns 是否真的施放了
   */
  cast(key: string, ctx: CombatContext): boolean {
    const skill = this.profile.class.skills[key as keyof typeof this.profile.class.skills];
    if (!skill) return false;

    const now = Date.now();
    const last = this.lastCast.get(key) || 0;
    if (now - last < skill.cooldownMs) return false;  // 还在冷却

    if (!this.evalCondition(skill.condition, ctx)) return false;

    // 真的施放
    const vk = KEY_TO_VK[key] || (key as KeyCode);
    this.input.pressKey(vk);
    this.lastCast.set(key, now);
    return true;
  }

  /** 强制施放(忽略冷却) */
  forceCast(key: string): void {
    const vk = KEY_TO_VK[key] || (key as KeyCode);
    this.input.pressKey(vk);
    this.lastCast.set(key, Date.now());
  }

  /** 检查药水 */
  checkPotions(ctx: CombatContext): boolean {
    const potions = this.profile.class.potions || {};
    let anyUsed = false;
    for (const [key, cfg] of Object.entries(potions)) {
      if (!cfg) continue;
      const last = this.lastPotion.get(key) || 0;
      // 药水至少 1 秒 CD(防止狂按)
      if (Date.now() - last < 1000) continue;
      if (this.evalCondition(cfg.trigger, ctx)) {
        const vk = KEY_TO_VK[key] || (key as KeyCode);
        this.input.pressKey(vk);
        this.lastPotion.set(key, Date.now());
        anyUsed = true;
        console.log(`[SkillManager] 触发药水 ${key} (${cfg.type})`);
      }
    }
    return anyUsed;
  }

  /** 获取最优技能(按优先级 + 冷却 + 条件) */
  pickBest(ctx: CombatContext): string | null {
    const skills = Object.entries(this.profile.class.skills || {});
    const now = Date.now();

    const candidates = skills
      .filter(([key, s]) => {
        if (!s) return false;
        const last = this.lastCast.get(key) || 0;
        if (now - last < s.cooldownMs) return false;
        return this.evalCondition(s.condition, ctx);
      })
      .sort((a, b) => (b[1].priority || 1) - (a[1].priority || 1));

    return candidates[0]?.[0] || null;
  }

  /** 评估触发条件 */
  private evalCondition(cond: Condition | undefined, ctx: CombatContext): boolean {
    if (!cond) return true;  // 没条件 = 总是 true
    const v = ctxValue(cond.type, ctx);
    if (v === undefined || v === null) return false;

    // 数值比较时把 value 转 number;bool 严格相等
    if (cond.op === 'equal') {
      return v === cond.value;
    }
    const numV = typeof v === 'number' ? v : Number(v);
    const numTarget = Number(cond.value);
    if (isNaN(numV) || isNaN(numTarget)) return false;
    switch (cond.op) {
      case 'less_than':    return numV < numTarget;
      case 'greater_than': return numV > numTarget;
      case 'at_least':     return numV >= numTarget;
      case 'at_most':      return numV <= numTarget;
      default:             return true;
    }
  }
}

function ctxValue(type: Condition['type'], ctx: CombatContext): number | boolean | undefined {
  switch (type) {
    case 'selfHp':         return ctx.selfHp;
    case 'selfMp':         return ctx.selfMp;
    case 'targetHp':       return ctx.targetHp;
    case 'nearbyMobs':     return ctx.nearbyMobs;
    case 'distance':       return ctx.distance;
    case 'inCombat':       return ctx.inCombat;
    case 'onCombatStart':  return ctx.onCombatStart;
  }
}
