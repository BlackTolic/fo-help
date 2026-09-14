// CombatEngine: 战斗状态机
// 状态流: IDLE → APPROACH → ENGAGE → LOOT → IDLE

import type { IInputProvider } from '../platform/input/IInputProvider';
import type { CoordinateReader } from '../state/CoordinateReader';
import type { SkillManager, CombatContext } from '../state/SkillManager';
import type { TargetFinder, CombatTarget, FindFilter } from './TargetFinder';

export type CombatState =
  | { kind: 'idle' }
  | { kind: 'searching' }
  | { kind: 'approaching'; target: CombatTarget }
  | { kind: 'engaging'; target: CombatTarget; startedAt: number }
  | { kind: 'looting' }
  | { kind: 'alert'; reason: string }
  | { kind: 'paused' };

export interface CombatCallbacks {
  onStateChange?: (state: CombatState) => void;
  onKill?: () => void;
  onLog?: (level: string, msg: string) => void;
}

export class CombatEngine {
  private state: CombatState = { kind: 'idle' };
  private killCount = 0;
  private findAttempts = 0;
  private lastFindTime = 0;
  private running = false;
  private currentCtx: CombatContext = this.emptyCtx();

  constructor(
    private input: IInputProvider,
    private coord: CoordinateReader,
    private skills: SkillManager,
    private finder: TargetFinder,
    private profile: any,
    private cb: CombatCallbacks = {},
  ) {}

  private emptyCtx(): CombatContext {
    return {
      selfHp: 100,
      selfMp: 100,
      targetHp: 100,
      nearbyMobs: 0,
      inCombat: false,
      distance: 999,
      onCombatStart: false,
    };
  }

  /** 启动战斗循环(异步) */
  async start(): Promise<void> {
    this.running = true;
    this.cb.onLog?.('info', '战斗引擎启动');
    while (this.running) {
      try {
        await this.tick();
      } catch (e: any) {
        this.cb.onLog?.('error', `战斗循环异常: ${e.message}`);
        this.setState({ kind: 'alert', reason: e.message });
        await this.wait(1000);
      }
    }
  }

  /** 停止战斗循环 */
  stop() {
    this.running = false;
    this.setState({ kind: 'idle' });
  }

  /** 单个 tick(由 start() 循环调用) */
  private async tick(): Promise<void> {
    const t = (this.profile.combat.findTargetIntervalMs || 1500);
    const now = Date.now();

    // 1. 找怪(节流:每 t 毫秒找一次)
    if (now - this.lastFindTime >= t) {
      this.lastFindTime = now;
      this.findAttempts++;
      if (this.findAttempts > 20) {
        this.cb.onLog?.('warn', '找怪 20 次无果,休息 5s');
        this.findAttempts = 0;
        await this.wait(5000);
      }

      const filter: FindFilter = {
        nameKeywords: this.getMobKeywords(),
      };
      this.setState({ kind: 'searching' });
      const target = await this.finder.find(filter);
      if (!target) {
        // 没找到,继续等
        await this.wait(t);
        return;
      }
      this.cb.onLog?.('info', `找到目标: ${target.name} @ (${target.screenPos.x}, ${target.screenPos.y})`);

      // 2. 点击怪物(QQ 幻想:左键点怪 = 选中 + 攻击,有时还需走近)
      this.setState({ kind: 'approaching', target });
      await this.input.moveMouse(target.screenPos, { kind: 'human', durationMs: 200 });
      await this.wait(50);
      await this.input.click('left', 1);
      this.cb.onLog?.('info', `已点击目标`);

      // 3. 进入战斗循环
      await this.combatLoop(target);
    } else {
      // 战斗中持续选技
      this.skills.checkPotions(this.currentCtx);
      const best = this.skills.pickBest(this.currentCtx);
      if (best) {
        this.skills.cast(best, this.currentCtx);
        this.cb.onLog?.('debug', `选技: ${best}`);
      }
      await this.wait(300);
    }
  }

  /** 单个怪的生命周期(从点击到死亡) */
  private async combatLoop(target: CombatTarget): Promise<void> {
    this.setState({ kind: 'engaging', target, startedAt: Date.now() });
    this.currentCtx.onCombatStart = true;
    this.currentCtx.inCombat = true;
    this.currentCtx.targetHp = 100;
    this.currentCtx.nearbyMobs = 1;
    this.currentCtx.distance = 3;

    const timeoutMs = this.profile.combat.combatTimeoutMs || 60000;
    const start = Date.now();
    let lastTargetHp = 100;

    while (this.running) {
      if (Date.now() - start > timeoutMs) {
        this.cb.onLog?.('warn', `战斗超时 ${timeoutMs}ms,放弃目标`);
        return;
      }

      // 1. 读自己 HP/MP
      const selfHp = await this.coord.readSelfHpPercent().catch(() => null);
      const selfMp = await this.coord.readSelfMpPercent().catch(() => null);
      this.currentCtx.selfHp = selfHp ?? this.currentCtx.selfHp;
      this.currentCtx.selfMp = selfMp ?? this.currentCtx.selfMp;

      // 2. 读目标 HP
      const targetHp = await this.coord.readTargetHpPercent().catch(() => null);
      if (targetHp !== null) {
        this.currentCtx.targetHp = targetHp;
        if (targetHp <= 0) {
          this.cb.onLog?.('info', `目标 ${target.name} HP=0,击杀!`);
          this.killCount++;
          this.cb.onKill?.();
          return;
        }
        // 检测目标 HP 没了(突然变成 0 或 0 维持)
        if (targetHp === lastTargetHp && targetHp < 5) {
          this.cb.onLog?.('info', `目标血量过低 (${targetHp}%),认为死亡`);
          this.killCount++;
          this.cb.onKill?.();
          return;
        }
        lastTargetHp = targetHp;
      } else {
        // 读不到目标 HP,可能目标消失了(脱战 / 死亡)
        // 简化:连续 3 次读不到,认为目标已消失
        if (!this._targetHpReadAttempts) this._targetHpReadAttempts = 0;
        this._targetHpReadAttempts++;
        if (this._targetHpReadAttempts > 3) {
          this.cb.onLog?.('info', `读不到目标血条,认为目标消失`);
          this.killCount++;
          this.cb.onKill?.();
          return;
        }
      }

      // 3. 药水检查
      this.skills.checkPotions(this.currentCtx);

      // 4. 智能选技
      const best = this.skills.pickBest(this.currentCtx);
      if (best) {
        const ok = this.skills.cast(best, this.currentCtx);
        if (ok) this.cb.onLog?.('debug', `释放技能 ${best}`);
      }

      this.currentCtx.onCombatStart = false;  // 只在战斗开始时 true 一次
      await this.wait(300);
    }
  }

  private _targetHpReadAttempts = 0;

  /** 从 Profile 读怪名关键字(简化:从 mobFilter 取) */
  private getMobKeywords(): string[] {
    const filter = this.profile.combat.mobFilter as any;
    if (filter.nameKeywords && Array.isArray(filter.nameKeywords)) {
      return filter.nameKeywords;
    }
    if (filter.namePattern) {
      return [filter.namePattern];
    }
    // 兜底:用 mobFilter 的名字 + 一些常见怪
    return ['野', '狼', '鸡', '鹿', '狐', '猫', '怪', '兽'];
  }

  private setState(s: CombatState) {
    this.state = s;
    this.cb.onStateChange?.(s);
  }

  getState(): CombatState { return this.state; }
  getKillCount(): number { return this.killCount; }

  private wait(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
