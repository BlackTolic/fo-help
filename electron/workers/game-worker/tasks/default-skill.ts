// 缺省技能(default-skill)任务:纯按键编排循环,不依赖战斗引擎
// 控制标志(ctx.skill.running/paused/resumeResolve/loopCount)在 WorkerContext 上,
// 由 commands.ts 的 pause/resume/stop 命令直接操作(可在任务 start() 之前到达),
// 与原 game-utility-worker.ts 的模块级变量语义一致

import { dmApi } from '../../../../core/platform/damoo/dm-api';
import { parseKeyCombo } from '../../../../shared/key-combo';
import type { DefaultSkillTaskConfig } from '../../../../shared/types';
import type { TaskController, TaskFactoryContext } from './types';

export class DefaultSkillTask implements TaskController {
  constructor(private fc: TaskFactoryContext) {}

  async start(): Promise<void> {
    const { ctx } = this.fc;
    const skillCfg = ctx.init.taskConfig as DefaultSkillTaskConfig | undefined;
    if (!skillCfg || !Array.isArray(skillCfg.steps)) {
      ctx.sendLog('error', '缺省技能任务缺少 taskConfig.steps,直接结束');
      ctx.setStatus('alert', '缺省技能 config 缺失');
      return;
    }
    await this.run(skillCfg);
  }

  private async run(cfg: DefaultSkillTaskConfig): Promise<void> {
    const { ctx } = this.fc;
    const skill = ctx.skill;
    // ★ 诊断:把 cfg 摘要打出来,定位 steps 为空的原因(undefined / [] / 全 disabled)
    ctx.sendLog(
      'info',
      `缺省技能 config 摘要: cfg=${cfg ? 'present' : 'undefined'}, type=${cfg?.type}, ` +
        `steps.length=${cfg?.steps?.length ?? 'n/a'}, ` +
        `loopCount=${cfg?.loopCount}, loopIntervalMs=${cfg?.loopIntervalMs}, ` +
        `steps=${cfg?.steps ? JSON.stringify(cfg.steps.map((s) => ({ key: s.key, enabled: s.enabled, intervalMs: s.intervalMs }))) : 'n/a'}`,
    );
    const steps = (cfg.steps || []).filter((s) => s.enabled !== false);
    if (steps.length === 0) {
      ctx.sendLog('warn', '缺省技能任务:steps 为空或全部禁用,直接结束');
      ctx.setStatus('idle', '无可执行步骤');
      return;
    }
    const loopCount = cfg.loopCount ?? 0; // 0 = 无限
    const infinite = loopCount === 0;
    ctx.sendLog(
      'info',
      `缺省技能循环开始: ${steps.length} 个步骤, 循环=${infinite ? '无限' : loopCount + ' 轮'}`,
    );
    ctx.setStatus('combat', `缺省技能: 第 1 轮 / ${infinite ? '∞' : loopCount}`);

    let loop = 0;
    while (skill.running && (infinite || loop < loopCount)) {
      for (let i = 0; i < steps.length; i++) {
        if (!skill.running) break;

        // 暂停检查:在每一步之间等 resume
        if (skill.paused) {
          ctx.setStatus('paused', `缺省技能: 第 ${loop + 1} 轮 第 ${i + 1} 步前暂停`);
          await new Promise<void>((resolve) => {
            skill.resumeResolve = resolve;
          });
        }
        if (!skill.running) break;

        const step = steps[i];
        const parsed = parseKeyCombo(step.key);
        if (!parsed) {
          ctx.sendLog('warn', `缺省技能:不支持的按键 "${step.key}",跳过`);
          continue;
        }

        // 执行按键:修饰键按下 → 主键 keyDown → 等 holdMs → 主键 keyUp → 修饰键抬起(反序)
        try {
          for (const m of parsed.modifiers) dmApi.keyDown(m);
          dmApi.keyDown(parsed.mainVk);
          await new Promise((r) => setTimeout(r, step.holdMs ?? 50));
          dmApi.keyUp(parsed.mainVk);
          for (let k = parsed.modifiers.length - 1; k >= 0; k--) {
            dmApi.keyUp(parsed.modifiers[k]);
          }
        } catch (e: any) {
          ctx.sendLog('error', `缺省技能按键失败 step=${i + 1} key=${step.key}: ${e.message}`);
        }

        // 步骤间间隔
        if (step.intervalMs > 0 && i < steps.length - 1) {
          await new Promise((r) => setTimeout(r, step.intervalMs));
        } else if (step.intervalMs > 0 && i === steps.length - 1) {
          // 最后一步也等 intervalMs,后面再统一等 loopIntervalMs(避免双倍等待)
          await new Promise((r) => setTimeout(r, step.intervalMs));
        }
      }
      if (!skill.running) break;

      loop++;
      skill.loopCount = loop;
      ctx.setStatus(
        'combat',
        `缺省技能: 第 ${infinite ? loop + 1 : Math.min(loop + 1, loopCount)} 轮 / ${infinite ? '∞' : loopCount}`,
      );

      // 轮间间隔
      if (cfg.loopIntervalMs > 0 && (infinite || loop < loopCount)) {
        await new Promise((r) => setTimeout(r, cfg.loopIntervalMs));
      }
    }

    ctx.sendLog('info', `缺省技能循环结束,共执行 ${loop} 轮`);
    skill.paused = false;
    skill.resumeResolve = null;
    ctx.setStatus('idle', `缺省技能已结束(${loop} 轮)`);
  }
}

export function createDefaultSkillTask(fc: TaskFactoryContext): TaskController {
  return new DefaultSkillTask(fc);
}
