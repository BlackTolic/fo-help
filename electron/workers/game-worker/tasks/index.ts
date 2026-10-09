// 任务注册表:taskType → TaskFactory
// 新增任务类型 = 新建一个 tasks/xxx.ts 实现 TaskFactory + 在这里加一行
// 未实现/未知 taskType → sendLog('error') + 停在非运行状态(alert):
//   静默回退成"挂机打怪"会把配置型任务(town-profile / dialog-recipe)当 farm 跑,必须报错说清楚

import type { TaskType } from '../../../../shared/types';
import type { WorkerContext } from '../context';
import type { TaskFactory, TaskFactoryContext } from './types';
import { createFarmTask } from './farm';
import { createDefaultSkillTask } from './default-skill';

/** 暂未实现的任务:warn 后按挂机打怪跑(原行为) */
function fallbackToFarm(taskType: string): TaskFactory {
  return (fc) => ({
    async start() {
      fc.ctx.sendLog('warn', `任务 ${taskType} 暂未实现,只跑挂机打怪`);
      await createFarmTask(fc).start();
    },
  });
}

/**
 * 没有执行器的任务类型:明确报错并停在非运行状态,不做任何自动化操作。
 * 覆盖两类:配置型"任务"(town-profile / dialog-recipe,只用于存储/编辑)、以及未来的未知类型。
 * 留在 alert 状态而不是 idle:主面板卡片上能直接看到原因(statusDetail),便于排查。
 */
function unregisteredTask(taskType: string): TaskFactory {
  return (fc) => ({
    async start() {
      const detail = `任务类型 ${taskType} 没有对应的执行器(配置型任务不可运行),已停在未运行状态`;
      fc.ctx.sendLog('error', detail);
      fc.ctx.setStatus('alert', detail);
    },
  });
}

export const TASK_RUNNERS: Partial<Record<TaskType, TaskFactory>> = {
  farm: createFarmTask,
  mine: fallbackToFarm('mine'),
  'catch-pet': fallbackToFarm('catch-pet'),
  refine: fallbackToFarm('refine'),
  reputation: fallbackToFarm('reputation'),
  'default-skill': createDefaultSkillTask,
};

/** 按(可能被 start-task 命令覆盖过的)init.taskType 分派任务并跑到结束 */
export async function runTask(ctx: WorkerContext): Promise<void> {
  const taskType = ctx.init.taskType;
  const factory = TASK_RUNNERS[taskType] ?? unregisteredTask(taskType ?? '(未指定)');
  const fc: TaskFactoryContext = {
    ctx,
    init: ctx.init,
    profile: ctx.profile,
    damooConfig: ctx.damooConfig,
  };
  await factory(fc).start();
}
