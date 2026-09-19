// 任务注册表:taskType → TaskFactory
// 新增任务类型 = 新建一个 tasks/xxx.ts 实现 TaskFactory + 在这里加一行
// 未实现/未知 taskType → sendLog('warn') + 回退 farm(保留原 game-utility-worker.ts 的行为)

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

export const TASK_RUNNERS: Record<TaskType, TaskFactory> = {
  farm: createFarmTask,
  mine: fallbackToFarm('mine'),
  'catch-pet': fallbackToFarm('catch-pet'),
  refine: fallbackToFarm('refine'),
  reputation: fallbackToFarm('reputation'),
  'default-skill': createDefaultSkillTask,
};

/** 按(可能被 start-task 命令覆盖过的)init.taskType 分派任务并跑到结束 */
export async function runTask(ctx: WorkerContext): Promise<void> {
  const factory =
    (TASK_RUNNERS as Partial<Record<TaskType, TaskFactory>>)[ctx.init.taskType] ??
    fallbackToFarm(ctx.init.taskType);
  const fc: TaskFactoryContext = {
    ctx,
    init: ctx.init,
    profile: ctx.profile,
    damooConfig: ctx.damooConfig,
  };
  await factory(fc).start();
}
