// 全局声明:window.fohelp (preload 暴露的 API)

import type {
  GameWindow,
  TaskType,
  TaskConfig,
  WorkerState,
  StoredTaskConfig,
  AppSettings,
} from '../shared/types';

interface FohelpAPI {
  listGameWindows: () => Promise<GameWindow[]>;
  refreshGameWindows: () => Promise<GameWindow[]>;
  captureWindow: (hwnd: number) => Promise<string | null>;
  recaptureThumbnail: (hwnd: number) => Promise<string | null>;
  startWorker: (
    hwnd: number,
    characterName: string,
    taskType: TaskType,
  ) => Promise<{ ok: boolean; workerId?: string; error?: string }>;
  /**
   * Bootstrap 模式:启动 worker 停在 idle 等命令,返回 thumbnail + characterName
   * taskType + taskConfig 不传时默认 'farm' + null(只是要 thumbnail,不强求正确);
   * 上层要精确启动默认技能/历史任务等,必须传。
   */
  bootstrapWorker: (
    hwnd: number,
    characterName: string,
    taskType?: TaskType,
    taskConfig?: TaskConfig,
  ) => Promise<{ ok: boolean; dataUrl?: string | null; characterName?: string; error?: string }>;
  /** 给已 bootstrap 的 worker 发 start-task,进入战斗/任务
   * taskType + taskConfig 可选:调用方在 dialog 保存后才确定,worker 收到后覆盖 init 字段分派 */
  startTask: (
    hwnd: number,
    taskType?: TaskType,
    taskConfig?: TaskConfig | null,
  ) => Promise<{ ok: boolean; error?: string }>;
  /** 通过 hwnd 停 worker(用于取消 bootstrap) */
  stopWorkerByHwnd: (hwnd: number) => Promise<{ ok: boolean }>;
  /** 截图测试:截一张到 thumbnails/test-<hwnd>-<ts>.png,返回 filePath */
  captureTest: (hwnd: number) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  /** Windows 资源管理器高亮显示文件 */
  showItemInFolder: (filePath: string) => Promise<{ ok: boolean }>;
  stopWorker: (workerId: string) => Promise<boolean>;
  pauseWorker: (workerId: string) => Promise<boolean>;
  resumeWorker: (workerId: string) => Promise<boolean>;
  listWorkers: () => Promise<WorkerState[]>;
  /** 检查大漠 dll 是否已注册到当前项目自带的 dm.dll */
  checkDamoo: () => Promise<{
    ok: boolean;
    status?: {
      kind: 'ok' | 'wrong' | 'missing' | 'no-dll';
      path?: string;
      registeredPath?: string;
      expectedPath?: string;
      reason?: string;
    };
    message?: string;
    error?: string;
  }>;
  /** 触发 UAC → regsvr32 /s 注册项目自带的 dm.dll(用户需在桌面 UAC 弹窗点"是") */
  registerDamoo: () => Promise<{ ok: boolean; error?: string }>;
  /** 读取应用设置(分辨率 / 大漠注册码 / 大模型 API key) */
  getAppSettings: () => Promise<AppSettings>;
  /** 合并保存应用设置,返回保存后的完整设置 */
  saveAppSettings: (
    patch: Partial<AppSettings>,
  ) => Promise<{ ok: boolean; settings: AppSettings; error?: string }>;
  /** 保存任务配置(按 name 唯一,重名拒绝) */
  saveTaskConfig: (
    hwnd: number,
    config: TaskConfig,
    name: string,
  ) => Promise<{ ok: boolean; stored?: StoredTaskConfig; error?: string }>;
  /** 列出所有已保存的任务(全局) */
  listAllTaskConfigs: () => Promise<StoredTaskConfig[]>;
  /** 按任务名加载配置 */
  loadTaskByName: (name: string) => Promise<StoredTaskConfig | null>;
  /** 按 name 删除任务(从磁盘移除) */
  deleteTaskConfig: (name: string) => Promise<{ ok: boolean; error?: string }>;
  /** 原地更新已有任务(保留 id/createdAt),用于历史任务编辑 */
  updateTaskConfig: (
    name: string,
    config: TaskConfig,
  ) => Promise<{ ok: boolean; stored?: StoredTaskConfig; error?: string }>;
  /** 旧 API 保留(返回 null) */
  getTaskConfig: (hwnd: number) => Promise<TaskConfig | null>;
  onWorkerStateChanged: (cb: (state: WorkerState) => void) => () => void;
  onWorkerLog: (
    cb: (log: { workerId: string; level: string; msg: string; timestamp: number }) => void,
  ) => () => void;
  onWorkerError: (
    cb: (err: { workerId: string; error: any; timestamp: number }) => void,
  ) => () => void;
  /** 弹框中断事件(验证码/组队邀请等):kind=detected/handled/failed */
  onWorkerInterrupt: (
    cb: (event: {
      workerId: string;
      kind: string;
      popupType: string;
      detail: string;
      at: number;
    }) => void,
  ) => () => void;
  onThumbnailUpdate: (cb: (data: { hwnd: number; dataUrl: string | null }) => void) => () => void;
}

declare global {
  interface Window {
    fohelp: FohelpAPI;
  }
}

export {};
