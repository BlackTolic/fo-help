// 任务插件机制的类型定义:每个 taskType 对应一个 TaskFactory,产出 TaskController
// 新增任务类型 = 新建一个文件实现 TaskFactory + 在 tasks/index.ts 的 TASK_RUNNERS 加一行

import type { DamooConfig } from '../../../../core/platform/damoo/dm-api';
import type { InitData, WorkerContext } from '../context';

/** 运行中的任务控制器 */
export interface TaskController {
  /** 启动任务主循环(await 返回 = 任务结束) */
  start(): Promise<void>;
  pause?(): void;
  resume?(): void;
  stop?(): void;
}

/** 任务 factory 能拿到的全部依赖 */
export interface TaskFactoryContext {
  ctx: WorkerContext;
  init: InitData;
  profile: any;
  damooConfig: DamooConfig;
}

export type TaskFactory = (fc: TaskFactoryContext) => TaskController;
