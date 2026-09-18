// 挂机打怪(farm)任务:战斗引擎组装 + combat.start()
// 注意:assembleCombatEngine 在 bootstrap 阶段被无条件调用(与任务类型无关),
//   因为 pause/stop/resume 命令会直接操作 ctx.combat —— 这是原
//   game-utility-worker.ts 的既有行为,不能改成只在 farm 任务时才组装

import { DamooVisionProvider } from '../../../../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../../../../core/platform/input/damoo/DamooInputProvider';
import { CoordinateReader } from '../../../../core/state/CoordinateReader';
import { SkillManager } from '../../../../core/state/SkillManager';
import { TargetFinder } from '../../../../core/combat/TargetFinder';
import { CombatEngine, type CombatState } from '../../../../core/combat/CombatEngine';
import type { ScriptStatus } from '../../../../shared/types';
import type { WorkerContext } from '../context';
import type { TaskController, TaskFactoryContext } from './types';

export const STATUS_MAP: Record<CombatState['kind'], ScriptStatus> = {
  idle: 'idle',
  searching: 'moving',
  approaching: 'moving',
  engaging: 'combat',
  looting: 'combat',
  alert: 'alert',
  paused: 'paused',
} as const;

/** 组装战斗引擎(bootstrap 无条件调用,结果挂到 ctx.combat) */
export function assembleCombatEngine(ctx: WorkerContext): CombatEngine {
  const profile = ctx.profile;
  const vision = new DamooVisionProvider();
  const input = new DamooInputProvider();
  vision.bind(ctx.init.hwnd);
  input.bind(ctx.init.hwnd);

  const coord = new CoordinateReader(vision, profile);
  const skills = new SkillManager(input, profile);
  const finder = new TargetFinder();
  return new CombatEngine(input, coord, skills, finder, profile, {
    onLog: (level, msg) => ctx.sendLog(level, msg),
    onStateChange: (s) => {
      const status: ScriptStatus = STATUS_MAP[s.kind] as ScriptStatus;
      let detail: string = s.kind;
      if (s.kind === 'engaging') detail = `战斗中: ${(s as any).target.name}`;
      else if (s.kind === 'approaching') detail = `接近: ${(s as any).target.name}`;
      else if (s.kind === 'alert') detail = `异常: ${(s as any).reason}`;
      ctx.setStatus(status, detail);
    },
    onKill: () => {
      ctx.killCount += 1;
      ctx.sendLog('info', `累计击杀: ${ctx.killCount}`);
    },
  });
}

export function createFarmTask(fc: TaskFactoryContext): TaskController {
  return {
    async start() {
      await fc.ctx.combat!.start();
    },
  };
}
