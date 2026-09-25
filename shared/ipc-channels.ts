// IPC 通道定义

/** Renderer → Main(请求) */
export enum RequestChannel {
  // 窗口
  ListGameWindows = 'window:list',
  RefreshGameWindows = 'window:refresh',
  CaptureWindow = 'window:capture', // 截取指定 hwnd 的缩略图

  // Worker
  StartWorker = 'worker:start',
  BootstrapWorker = 'worker:bootstrap', // 启动 worker 但停在 idle 等命令(等任务配置 + 启动信号)
  StartTask = 'worker:start-task', // 给已 bootstrap 的 worker 发"开始执行"信号
  StopWorkerByHwnd = 'worker:stop-by-hwnd', // 通过 hwnd 找到 workerId 停止(用于取消 bootstrap)
  StopWorker = 'worker:stop',
  PauseWorker = 'worker:pause',
  ResumeWorker = 'worker:resume',
  ListWorkers = 'worker:list',

  // 任务配置
  SaveTaskConfig = 'task:save', // 新建(按 name 唯一存储,重名拒绝)
  UpdateTaskConfig = 'task:update', // 原地更新已有任务(保留 id/createdAt),用于历史任务编辑
  DeleteTaskConfig = 'task:delete', // 按 name 删除任务(从磁盘移除 JSON 文件)
  GetTaskConfig = 'task:get', // 读任务配置(旧 API,新流程用 loadTaskByName)
  ListTaskConfigs = 'task:list', // 列出所有任务(旧 API,新流程用 listAllTaskConfigs)
  ListAllTaskConfigs = 'task:list-all', // 列出所有保存的任务(全局,按 name 去重)
  LoadTaskByName = 'task:load-by-name', // 按任务名加载配置

  // Profile
  ListProfiles = 'profile:list',
  LoadProfile = 'profile:load',

  // 大漠插件注册
  CheckDamoo = 'damoo:check',
  RegisterDamoo = 'damoo:register',

  // 应用设置(分辨率 / 大漠注册码 / 大模型 API key)
  GetAppSettings = 'settings:get',
  SaveAppSettings = 'settings:save',
}

/** Main → Renderer(推送事件) */
export enum PushChannel {
  GameWindowsChanged = 'window:changed', // 游戏窗口列表变化
  WorkerStateChanged = 'worker:state', // Worker 状态变化
  WorkerLog = 'worker:log', // Worker 日志
  WorkerError = 'worker:error', // Worker 错误
  WorkerInterrupt = 'worker:interrupt', // 弹框中断事件(验证码/组队邀请等)
  ThumbnailUpdate = 'thumbnail:update', // 后台截图推送
}
