// 挂机辅助配置的执行入口:挂机主循环在几个固定时机调它,它挑出「在这个时机要跑」的辅助配置依次执行
//
// 辅助配置本体由 renderer 解析后随 start-task 下发(见 shared/types.ts 的 StartTaskAuxConfigs.auxList);
// 每份配置自己挑触发点(FarmAuxTrigger),这里只负责"这个时机该跑哪些、按勾选顺序跑"。
// 单份配置抛错不能打断挂机(见 AGENTS.md 的错误处理约定):逐份 try/catch,失败记日志继续下一份。

import { farmAuxTriggerLabel } from '../../../shared/farm-aux';
import type { FarmAuxTrigger } from '../../../shared/types';
import type { WorkerContext } from './context';
import type { PetRideDeps } from './pet-ride';
import { runPetTraining } from './pet-training';

/** 当前时机下要执行的辅助配置(没勾任何配置 / 这个时机没人要跑 = 空数组) */
export function pickFarmAux(ctx: WorkerContext, trigger: FarmAuxTrigger) {
  return (ctx.init.auxConfigs?.auxList ?? []).filter((c) => (c.triggers ?? []).includes(trigger));
}

/**
 * 执行某个时机下的全部辅助配置(按 farm.auxConfigNames 的勾选顺序)。
 * 没有任何配置要跑时直接返回,不产生日志;有配置时先记一条"这个时机跑哪些"。
 */
export async function runFarmAux(ctx: WorkerContext, deps: PetRideDeps, trigger: FarmAuxTrigger, label: string): Promise<void> {
  const list = pickFarmAux(ctx, trigger);
  if (list.length === 0) return;
  ctx.sendLog('info', `[${label}] 辅助配置(${farmAuxTriggerLabel(trigger)}):${list.map((c) => c.name).join('、')}`);

  for (const conf of list) {
    // 每份配置跑之前看一眼运行标志:长流程(开面板/OCR/点击)期间被停止就别再往下走了
    if (!ctx.moveAttack.running) return;
    try {
      if (conf.type === 'pet-training') {
        await runPetTraining(ctx, deps, conf, label);
      } else {
        ctx.sendLog('warn', `[${label}] 辅助配置「${conf.name}」的类型(${(conf as { type: string }).type})暂不支持,跳过`);
      }
    } catch (e: unknown) {
      ctx.sendLog('warn', `[${label}] 辅助配置「${conf.name}」执行失败:${e instanceof Error ? e.message : String(e)}`);
    }
  }
}
