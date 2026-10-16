// 共享类型定义(主进程 / Worker / Renderer 三端通用)

/** 游戏窗口信息 */
export interface GameWindow {
  hwnd: number;
  pid: number;
  title: string;
  className: string;
  processName: string;
  rect: { x: number; y: number; w: number; h: number };
  isForeground: boolean;
  isMinimized: boolean;
}

/** 角色信息(从 Profile 读) */
export interface CharacterInfo {
  name: string;
  class: 'warrior' | 'mage' | 'taoist' | 'archer' | 'assassin';
  level: number;
}

/**
 * 任务类型
 * town-profile(城镇档案)/ dialog-recipe(对话配方)/ map-profile(过图路线)/ pet-training(宠物带练)是配置型"任务":
 * 与任务同样存储/编辑,但不可作为任务运行 —— 它们是挂机流程读用的档案 / 辅助执行配置
 */
export type TaskType =
  | 'farm'
  | 'mine'
  | 'catch-pet'
  | 'refine'
  | 'reputation'
  | 'default-skill'
  | 'town-profile'
  | 'dialog-recipe'
  | 'map-profile'
  | 'pet-training';

/** 脚本状态(主面板卡片显示) */
export type ScriptStatus =
  | 'idle' // 已停止 / 未运行(无 task)
  | 'pending' // bootstrap 已就绪,等待 start-task 启动命令
  | 'combat' // 战斗中
  | 'moving' // 移动中
  | 'resupply' // 回城中
  | 'alert' // 异常
  | 'paused'; // 暂停

/** 任务名称(显示用) */
export type TaskName = '挂机打怪' | '挖矿' | '捕捉宠物' | '装备炼化' | '名誉任务' | '缺省技能';

/** 路径点 */
export interface Waypoint {
  id: string;
  x: number;
  y: number;
  /**
   * farm-spot = 挂机点(可绑定技能) / rest = 休息点(回血回蓝) / path = 路径中间点
   * entry = 入图点:回城/开工补给重新进入挂机地图后,先按这些点从地图入口走到挂机点
   *   (入口到挂机点有一段路,直线走会被地形/走廊卡住,所以要显式配中间点);
   *   平时的挂机循环会跳过它们,顺序 = 列表里从上到下
   */
  type: 'farm-spot' | 'rest' | 'path' | 'entry';
  /** 挂机点绑定的技能 id 列表(引用 FarmTaskConfig.skills;空/未配 = worker 回退为全部技能) */
  skillIds?: string[];
  note?: string;
}

/** 屏幕矩形(大漠绑定的窗口客户区相对坐标) */
export interface ScreenRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 技能施法方式 */
export type SkillCastMethod =
  | 'quick' // 快捷施法:只按键
  | 'target' // 缺省施法:按键 + 鼠标左键点击目标坐标
  | 'self' // 状态施法:点击角色自身 + 按键(自身 buff 类)
  | 'item' // 物品使用:只按快捷键消耗快捷栏物品(药品等)
  | 'pet'; // 宠物技能:只按键(骑乘等宠物技能;不参与打怪循环,由「宠物骑乘」的上骑/下骑调用)

/** 挂机打怪技能配置(任务级;路径点通过 skillIds 引用其中若干个) */
export interface FarmSkillConfig {
  /** 唯一 id(UI 排序/删除 + 路径点绑定用) */
  id: string;
  /** 技能键:第一页 F1-F10 / 第二页 TF1-TF10(按一次 Tab 切到第二页;T = Tab,见 core/platform/input/skill-key.ts) */
  key: string;
  /** 技能名称(便于在路径点绑定界面辨认) */
  name?: string;
  /** 技能时间间隔/冷却(毫秒,两次释放之间的最短间隔) */
  cooldownMs: number;
  /** 技能吟唱时间(毫秒):target=按键后等多久再点鼠标;quick/self=按键后等多久再放下一个技能 */
  castMs?: number;
  /** 施法距离(屏幕像素,以角色为圆心):定点打怪=缺省施法技能落点离自身的距离(0=默认300px);定点识别=超出该距离的怪跳过不打 */
  rangePx?: number;
  /** 施法方式(默认 target,兼容旧配置) */
  method?: SkillCastMethod;
  /** 是否启用(临时禁用不删除) */
  enabled?: boolean;
  /** 备注 */
  note?: string;
}

/** 挂机打怪模式: fixed=定点打怪 / fixed-detect=定点识别 / move-detect=移动识别 */
export type FarmMode = 'fixed' | 'fixed-detect' | 'move-detect';

/**
 * 宠物技能配置(farm 专属,界面上是「宠物技能」分组):
 *
 * 宠物骑乘(前三个字段)——勾选后每次回城补给回到城里,先检查宠物是否激活(OCR「暂时没有宠物」),
 * 激活则释放「上骑」技能并检测骑乘提示字样(最多 3 次,间隔 1s);
 * 到了挂机点再释放一次「下骑」技能后才开始打怪。
 * 上骑/下骑都从「宠物技能」(method='pet')的条目里选,可以是同一个按键。
 *
 * 打怪前开启宠物技能(后两个字段)——与宠物骑乘开关无关:在挂机点开始打怪之前释放一次这个宠物技能;
 * 它是状态技能(开一次就一直有),所以每圈只在第一个到达的挂机点放一次;
 * 若那一步刚好执行了下骑,则在下骑之后隔 1s 再释放(避开下骑动作)。
 */
export interface FarmPetRideConfig {
  /** 是否开启宠物骑乘 */
  enabled: boolean;
  /** 上骑技能 id(引用 FarmSkillConfig.id,该技能 method 必须是 'pet') */
  mountSkillId?: string;
  /** 下骑技能 id(同上) */
  dismountSkillId?: string;
  /** 是否开启「打怪前开启宠物技能」(与 enabled 相互独立) */
  preFarmSkillEnabled?: boolean;
  /** 打怪前释放的宠物技能 id(method 必须是 'pet') */
  preFarmSkillId?: string;
}

/**
 * 挂机打怪施法方式:
 * - smart  智能施法:定点打怪=每个挂机点自动选一个可释放技能;定点识别=循环释放全部已配置技能直到锁定的怪名消失
 * - custom 自定义施法:按路径点绑定的 skillIds 释放(不选 = 全部)
 */
export type FarmCastMode = 'smart' | 'custom';

/** 组队申请处理方式:agree=点同意进队 / reject=点拒绝关闭弹框 */
export type TeamInviteAction = 'agree' | 'reject';

/**
 * 挂机看门狗配置(挂机打怪期间与主循环并发执行的检查项)
 * 四项全不勾选 = 不启动看门狗(不影响性能);勾选任意一项才启用
 */
export interface FarmWatchdogConfig {
  /** 组队申请:收到邀请弹框时自动点「同意」/「拒绝」 */
  teamInvite?: { action: TeamInviteAction };
  /** 神医验证码:弹出验证码时自动识别并作答(不勾 = 不处理) */
  verifyCode?: boolean;
  /**
   * 生命回复:血条见底时自动使用物品
   * itemIds 引用 skills 里 method='item' 的技能 id(与「物品使用」共用同一份快捷栏配置)
   */
  autoHeal?: { itemIds: string[] };
  /** 角色停级:经验条快满时停止自动打怪,避免角色升级 */
  stopLevelUp?: boolean;
}

/**
 * 一条物品拾取规则:颜色(可多选)+ 物品名(可空),两个条件同时满足才算命中
 *   - 只选颜色、名称留空 = 这个颜色的所有物品都要(找色定位,不读文字)
 *   - 选颜色 + 填名称   = 只捡这些颜色的文字里叫这些名字的(找字定位)
 *   - 不选颜色 + 填名称 = 不限颜色,按名称找
 * 多条规则之间是「或」:任一条命中就捡,按规则顺序找
 *   例:所有紫色装备 + 蓝色里只要无极剑 = [{colors:[紫]}, {colors:[蓝], nameKeywords:[无极剑]}]
 */
export interface FarmPickupRule {
  /** 这条规则的颜色(大漠颜色格式,可多选;空 = 不限颜色) */
  colors?: string[];
  /** 这条规则的物品名(空 = 这个颜色的所有物品都要) */
  nameKeywords?: string[];
}

/**
 * 物品拾取(挂机打怪期间捡地上的掉落物)
 *
 * 时机:拾取优先 —— 定点识别里每轮循环先捡一次(正在打的怪也先放下),
 * 走到路径点、准备移动前也捡一次;一轮会把范围内能找到的物品都捡完才继续下一个动作。
 * 不打断"正在释放的那一个技能",只在技能之间插;单件点了 maxClicks 次仍未消失就放弃这件。
 *
 * 筛选方式见 FarmPickupRule(rules 之间是「或」)。
 * rules 为空(或每条规则的颜色和名称都空)= 没有可筛条件,worker 按「未开启」处理(UI 也会提示)
 */
export interface FarmPickupConfig {
  /** 是否开启物品拾取 */
  enabled: boolean;
  /** 拾取范围:default = 游戏画面去掉上下 UI 边距(默认)/ custom = 用 range 自定义 */
  rangeMode?: 'default' | 'custom';
  /** 自定义拾取范围(窗口客户区相对坐标;rangeMode='custom' 时用) */
  range?: ScreenRect;
  /** 拾取规则(任一条命中就捡) */
  rules?: FarmPickupRule[];
  /** @deprecated 旧的扁平写法:等价于单条规则 rules=[{ colors, nameKeywords }];读取时自动迁移 */
  colors?: string[];
  /** @deprecated 同上 */
  nameKeywords?: string[];
  /** 点击物品名时的偏移(像素;默认 0,0 = 点在物品名上,和怪名的 clickOffset 同理) */
  clickOffset?: { x: number; y: number };
}

/**
 * 回城卷轴(farm 专属):在野外/任意地图启动任务时,先按物品栏里的回城卷轴回主城,
 * 再从主城走到飞空艇 NPC 传送(见 TownProfileConfig.transitFrom / exits)前往挂机图。
 * 只在「起点既不是挂机图、也不在过图链路、也不是出发城镇」时才按(正常起点不消耗卷轴)。
 */
export interface FarmReturnScrollConfig {
  /** 是否开启 */
  enabled: boolean;
  /** 回城卷轴技能 id(引用 FarmSkillConfig.id;该技能 method 必须是 'item',即物品栏快捷栏位) */
  skillId?: string;
  /** 按下后等切图的超时(毫秒);不配 = 60000 */
  timeoutMs?: number;
}

/** 条件回城的回城方式(二选一) */
export type FarmEndReturnMethod =
  /** 使用回城卷轴(技能取 FarmReturnScrollConfig.skillId) */
  | 'scroll'
  /** 小退回城:清怪 → Alt+O → 选择角色 → 停留 3 秒 → Enter 重新上线(实现见 electron/workers/game-worker/relogin.ts) */
  | 'relogin';

/** 使用回城卷轴回城的参数;技能配置共用「回城卷轴」(FarmReturnScrollConfig.skillId) */
export interface FarmEndReturnScrollConfig {
  /** 最多按几次;不配 = 5 */
  maxAttempts?: number;
  /**
   * 每次按下后的观察窗口(毫秒):窗口内地图名变了 = 回城成功,否则再按一次。
   * 被攻击时卷轴可能不生效,所以要重按;但也不能按太密(读条没完就按第二次会白耗一张卷轴)
   */
  pressIntervalMs?: number;
}

/** 小退回城(Alt+O → 选择角色 → 重新上线)的参数 */
export interface FarmEndReturnReloginConfig {
  /** 小退前先清掉周围的怪 —— 被攻击时小退不会成功;缺省开启(只有显式 false 才关闭) */
  clearMobs?: boolean;
  /**
   * 清怪的识别参数(界面可单独配一份,不与「定点识别」共享):只用到 ocrRange / nameColors / nameKeywords。
   * 逐项判"填了没":填了的项覆盖本任务的识别参数,没填的项沿用本任务的(见 relogin.ts 的 resolveClearMobsFilter)。
   * 不配 / 三项都没填 = 清怪完全沿用本任务的找怪设置。
   */
  mobFilter?: Partial<FarmTaskConfig['mobFilter']>;
  /** 清怪总超时(毫秒):怪会刷新,不能无限打;不配 = 120000 */
  clearTimeoutMs?: number;
  /** 小退最多尝试几次;不配 = 3 */
  maxAttempts?: number;
}

/**
 * 条件回城(界面叫「结束自动打怪并回城」):满足条件后结束本轮挂机打怪 → 回城 →
 * 按落点走城市逻辑(城镇档案:检查/按需访问商人/出城)或跨境逻辑(过图链路逐跳) →
 * 回到挂机图继续下一轮打怪(不结束整个任务);圈数计数在每轮回城后归零重新计。
 */
export interface FarmEndReturnConfig {
  /** 是否开启 */
  enabled: boolean;
  /** 完成 N 圈后回城(1 = 每打完一圈就回城一次,可设多圈);不配 / <= 0 = 不用这个条件 */
  loops?: number;
  /** 背包/装备已负载(装满)时回城(检测区域见 core/constant-ocr/bag.ts);不配 = 不用这个条件 */
  overloaded?: boolean;
  /** 回城方式;不配 = 'scroll' */
  method?: FarmEndReturnMethod;
  /** 使用回城卷轴(仅 method='scroll' 时有意义) */
  scroll?: FarmEndReturnScrollConfig;
  /** 小退回城(仅 method='relogin' 时有意义) */
  relogin?: FarmEndReturnReloginConfig;
}

/** 挂机打怪任务配置 */
export interface FarmTaskConfig {
  type: 'farm';
  /** 地图 ID(预置 + 自定义) */
  mapId: string;
  /** 自定义地图名(mapId='custom' 时用) */
  customMapName?: string;
  /** 打怪模式: fixed=定点打怪(固定技能) / fixed-detect=定点识别 / move-detect=移动识别 */
  mode: FarmMode;
  /** 施法方式: smart=智能施法(每个挂机点从全部技能里选一个 CD 最长的可释放技能;不绑定点技能) / custom=自定义施法(按路径点绑定的 skillIds,不选=全部);缺省 = smart */
  castMode?: FarmCastMode;
  /** 路径点列表(patrol 模式必填;移动攻击测试作为 A→B→C… 移动路径) */
  waypoints: Waypoint[];
  /** 找怪配置 */
  mobFilter: {
    /**
     * 怪名字关键字(逗号分隔):
     * - 定点识别:可选白名单——配了只认含关键字的怪名(用找字定位,最快最准),留空 = 纯 OCR(范围内任意文字都算怪名)
     * - 移动识别 / 移动攻击测试:按关键字找怪
     */
    nameKeywords: string[];
    minLevel?: number;
    maxLevel?: number;
    /**
     * 怪名字颜色(可多选;大漠颜色格式,如 'FFFFFF-FFFFFF';可选值见 core/constant-ocr/color.ts)
     * 多选时 worker 用 '|' 拼成一个颜色串(找字支持多色)
     */
    nameColors?: string[];
    /** @deprecated 旧的单值怪名颜色;新配置写 nameColors,worker 读不到 nameColors 时才回退读它 */
    nameColor?: string;
    /** 定点识别的 OCR 识别范围(客户区相对坐标;不配 = 整个游戏画面) */
    ocrRange?: ScreenRect;
    /**
     * 定点识别:已锁定怪物名称的显示区域(客户区相对坐标;不配 = 默认 x95,y109,w105,h35)。
     * 怪物被锁定后游戏在此显示它的名字,没锁定时为空 —— 用来判断锁定 / 怪是否已死
     */
    lockedNameRoi?: ScreenRect;
    /**
     * 定点识别:点击识别到的怪名时的偏移(像素;默认 0,0 = 点在名字上,有些游戏需要点到名字下方)。
     * 「左键点怪名开打」与 target 技能的落点都用它(定点打怪那种按角度算的落点不用)
     */
    clickOffset?: { x: number; y: number };
  };
  /** 任务级技能列表(路径点通过 skillIds 引用;空 = 用 worker 内置默认) */
  skills?: FarmSkillConfig[];
  /**
   * 走位点击间隔(毫秒):沿路径点走位时,每点一次地面(走一步)后隔多久再读坐标纠偏。
   * 调小 = 走位更频繁(读坐标也更密),调大 = 反之;不配 / 小于 100 = 用内置 800。
   * 只影响挂机循环里路径点之间的走位;过图/跨境/补给入图那些段落用各自写死的间隔。
   */
  moveStepIntervalMs?: number;
  /** @deprecated 旧字段名(界面曾叫「角色移动间隔」);新配置写 moveStepIntervalMs,worker 读不到时才回退读它 */
  movementSpeed?: number;
  /**
   * 挂机点停留时间(毫秒):仅「定点识别」生效 —— 在挂机点连续这么久没锁定到怪(打光了 / 没刷出来)
   * 就前往下一个路径点;不配 / <= 0 = 用内置 2000。
   */
  spotIdleMs?: number;
  /**
   * 路径点卡住时是否跳过该点(走不到 = 坐标在超时时间内没变化)。
   * 缺省/旧配置 = true(跳过,记一条日志接着走下一个点);显式 false = 不跳过:
   * 在该点周围 10 像素内随机点一下地面尽量就近落脚,并照常执行该点的技能操作。
   */
  skipStuckWaypoint?: boolean;
  /** 挂机看门狗(组队申请/神医验证码/生命回复/角色停级);不配 = 旧配置,只开验证码 */
  watchdog?: FarmWatchdogConfig;
  /** 物品拾取(打怪间隙捡掉落物);不配 = 不开启 */
  pickup?: FarmPickupConfig;
  /** 宠物骑乘(回城后上骑、到挂机点下骑;依赖回城补给/开工补给的回城时机);不配 = 不开启 */
  petRide?: FarmPetRideConfig;
  /** 回城卷轴(野外/任意地图启动时先按它回主城,再坐飞空艇中转/去挂机图);不配 = 不开启 */
  returnScroll?: FarmReturnScrollConfig;
  /** 回城补给(死亡后复活 → 检查耐久/药水 → 找商人对话补给 → 返回野外);不配 = 不开启 */
  resupply?: FarmResupplyConfig;
  /** 条件回城(达到条件就结束本轮打怪并回城,回城后走城市/跨境逻辑回到挂机图继续打);不配 = 不开启 */
  endReturn?: FarmEndReturnConfig;
  /**
   * 地图跨越:出发图 → 挂机图之间要依次穿越的中间地图(引用 map-profile 任务名,按顺序)。
   * 不含出发城镇、不含挂机图本身(城镇→首图由城镇档案 exits 负责,可以是走过去出城口,也可以是
   * 与飞空艇等传送 NPC 对话后传送,见 TownProfileExit.via;挂机图内由入图点负责);
   * 空/不配 = 不跨图(行为与旧配置一致)。任务启动与死亡返程都会按它逐跳穿越。
   */
  mapCrossings?: string[];
  /**
   * 挂机辅助配置:勾选哪些「辅助配置」(引用 pet-training 这类辅助配置的任务名,顺序 = 执行顺序)。
   * 每份辅助配置自己挑触发点(见 FarmAuxTrigger),worker 在对应时机按这里的顺序依次执行;
   * 空/不配 = 没有辅助配置(行为与旧配置一致)。
   */
  auxConfigNames?: string[];
  /**
   * 进入新地图时屏蔽所有人:检测到换图就按一次 F11×4(见 shared/game-hotkeys.ts 的 blockAllPlayers)。
   * 游戏换图会把"屏蔽玩家"重置,所以每次进新图要重新屏蔽;不配 = 不处理
   */
  blockAllPlayersOnNewMap?: boolean;
  /**
   * 小地图缩放:任务启动时按一次 Alt+- 把右上角小地图缩小(地图放大 Alt++)。
   * 缺省/旧配置 = 开启(只有显式 false 才关闭)
   */
  zoomOutMinimap?: boolean;
  /**
   * 关闭聊天背景:任务启动时鼠标移到聊天框(11,727)点一次左键,把聊天背景关掉。
   * 缺省/旧配置 = 开启(只有显式 false 才关闭)
   */
  closeChatBackground?: boolean;
  /** 自定义备注 */
  note?: string;
}

// ===== 挂机辅助配置(farm 用的"执行配置")=====
// 与城镇档案 / 对话配方 / 过图路线一样按"任务名"存储、可跨任务复用,但它们不只是被读的数据:
// 挂机跑起来后会在配置的触发点上真正执行(farm.auxConfigNames 多选引用,顺序 = 执行顺序)。

/** 辅助配置的执行时机(对应挂机主循环里真实存在的几个节点;可多选) */
export type FarmAuxTrigger =
  /** 回城(含小退)后重新进入挂机图时 —— 已走完入图点、站在挂机图里(任务启动那次不算,那次走 enterFarmMap) */
  | 'afterReturn'
  /** 每一轮自动打怪走到第一个挂机点时(本圈第一个到位的挂机点,每圈只触发一次) */
  | 'firstFarmSpot'
  /** 进入挂机地图时(检测到换图、且当前图就是挂机图;每次进图触发一次) */
  | 'enterFarmMap'
  /** 每一轮自动打怪结束时(本圈路径点全部走完) */
  | 'roundEnd';

/**
 * 宠物带练:到触发点时打开宠物栏,看当前出战宠物的等级;达标(等级够 或 学会了目标技能)就换下一只继续,
 * 直到带练够 petCount 只。
 *
 * 出战规则(实测):同一时刻最多只有 1 只宠物是「醒」的 —— 双击睡眠的那只会让它出战(原来出战的那只
 * 自动变睡眠),双击出战的那只会让它睡眠。所以「第 k 只是醒的」= 前 k-1 只都已经练好了(出战序号本身
 * 就是带练进度,不用另外存);全是睡眠就先唤醒第 1 只。
 * 宠物栏用游戏快捷键 Alt+P 开关(见 shared/game-hotkeys.ts 的 openPetPanel);
 * 宠物面板里的识别区域/颜色/找字见 core/constant-ocr/pet.ts。
 */
export interface PetTrainingConfig {
  type: 'pet-training';
  /** 在哪些时机执行(可多选;空 = 不执行) */
  triggers: FarmAuxTrigger[];
  /** 要带练的宠物数量:依次带练宠物栏里的前 N 只,全部达标后收工 */
  petCount: number;
  /** 目标等级:当前宠物达到该等级(含)就换下一只;不配 / <= 0 = 不用等级判据 */
  targetLevel?: number;
  /** 目标技能:宠物学会了这个技能(在宠物面板里能识别到这个名字)就换下一只;不配 = 不用技能判据 */
  targetSkill?: string;
  /** 自定义备注 */
  note?: string;
}

/**
 * 复活方式(死亡弹框上的三个按钮,点击坐标见 core/constant-ocr/death.ts):
 * - immediate 立即复活(免费原地复活)
 * - huihun    回魂娃娃
 * - tishen    替身娃娃
 * 旧配置的 'auto'(自动点原地复活)迁移为 immediate;'manual'(等玩家自己复活)已取消,同样迁移为 immediate
 */
export type FarmReviveMode = 'immediate' | 'huihun' | 'tishen';

/**
 * 回城处理配置(farm 专属,界面叫「城市事件」):
 * 角色死亡后 自动复活 → 按所选城镇档案走一遍(可选检查耐久/药水 → 按需访问商人 NPC → 出城口 → 走回野外地图续跑);
 * 没配 NPC / 检查项没触发时,就只是"复活 → 直接去出城口返程"。
 * 同一段流程挂在第二个触发器上:runOnStart=true 时任务启动也先跑一遍(不复活,直接确认位置 → 检查状态 → 必要时访问 NPC → 挂机地图)
 * 依赖 StartTaskAuxConfigs 下发的 townProfile(城镇档案)与 recipes(对话配方)
 *
 * 注:是否检查耐久/药水已迁到城镇档案(TownProfileConfig.checkDurability / potionThreshold)——
 * 它们决定"要不要去访问档案里配了配方的商人 NPC",跟城镇绑定更自然。
 * 这里的同名字段仅为兼容旧配置保留,worker 读不到档案里的值时回退读它。
 */
export interface FarmResupplyConfig {
  /** 是否开启回城处理(死亡复活 / 开工前先处理一遍) */
  enabled: boolean;
  /** 城镇档案名(按"任务名"存储的那份 TownProfileConfig 的 name) */
  townProfileName: string;
  /** 复活方式: immediate=立即复活 / huihun=回魂娃娃 / tishen=替身娃娃 */
  reviveMode: FarmReviveMode;
  /** 等复活超时(毫秒),超时按异常处理 */
  reviveTimeoutMs: number;
  /** @deprecated 已迁到 TownProfileConfig.checkDurability;仅为兼容旧配置保留 */
  checkDurability?: boolean;
  /** @deprecated 已迁到 TownProfileConfig.potionThreshold;仅为兼容旧配置保留 */
  potionThreshold?: number;
  /** 任务启动时先跑一次(检查状态 → 必要时访问商人 NPC → 前往挂机地图)再进入打怪循环;缺省 false */
  runOnStart: boolean;
}

// ===== 城镇档案(town-profile):某城镇的复活点 / NPC / 出入口 + 锚点间寻路路线 =====
// 配置型"任务":作为任务配置存储/编辑,但不能作为任务运行;
// farm 的 resupply 通过 StartTaskAuxConfigs.townProfile 整份下发给 worker

/** 城镇 NPC(道具商人/仓库等);position 为游戏内地图坐标 */
export interface TownProfileNpc {
  id: string;
  /** NPC 名称(中文,取值见 shared/npc.ts);既是列表里的显示名,也是游戏内找字用的绿字名 */
  name: string;
  position: { x: number; y: number };
  /**
   * 引用的对话配方名(= 历史任务里那份 dialog-recipe 的任务名)。
   * 补给时按档案里的顺序依次访问所有配了它的 NPC;留空 = 只当路线锚点,不会被访问。
   */
  recipeName?: string;
}

/** 锚点间的一条寻路路线;waypoints 为地图坐标途径点 */
export interface TownProfileRoute {
  id: string;
  /** 起点锚点 id: 'revive' | 某 npc.id | 某 exit.id */
  from: string;
  /** 终点锚点 id: 同上 */
  to: string;
  waypoints: { x: number; y: number }[];
}

/**
 * 城镇出口(离城方式);toMap 是游戏内 OCR 地图名(中文),如 '无泪南郊'。
 * 两种通行方式(见 via):
 *   - walk(缺省):走到 position 踩上传送点,游戏自动切图
 *   - npc:走到 position 与 npcName 对话、跑完 recipeName 后传送(飞空艇/传送 NPC 用这种)
 */
export interface TownProfileExit {
  id: string;
  toMap: string;
  position: { x: number; y: number };
  /** 通行方式:不填/'walk' = 踩传送点过图;'npc' = 与 NPC 对话后传送(飞空艇等) */
  via?: 'walk' | 'npc';
  /** via='npc' 时必填:NPC 绿字名(游戏内找字用,取值见 shared/npc.ts) */
  npcName?: string;
  /** via='npc' 时必填:对话配方名(= dialog-recipe 的任务名),配方里点「使用传送 → 目的地 → 确认」 */
  recipeName?: string;
}

/**
 * 从某个主城坐飞空艇来到本城镇(出发城镇)的中转配置:
 * 回城卷轴可能落在别的主城 → 在那个主城走到飞空艇 NPC 跑配方传送回本城镇,再接本城镇的 exits。
 * 不配 = 回城后必须正好落在本城镇(mapName)。
 */
export interface TownTransitCity {
  id: string;
  /** 该主城的 OCR 中文地图名 */
  mapName: string;
  /** 该主城飞空艇 NPC 的绿字名(取值见 shared/npc.ts) */
  npcName: string;
  /** 该主城飞空艇 NPC 的位置(游戏内地图坐标) */
  position: { x: number; y: number };
  /** 对话配方名(点「使用传送 → 本城镇 → 确认」) */
  recipeName: string;
  /** 从落地位置走到该 NPC 的途经点(可空;有障碍时配) */
  waypoints?: { x: number; y: number }[];
}

export interface TownProfileConfig {
  type: 'town-profile';
  /** 本城镇的 OCR 地图名 */
  mapName: string;
  /** 复活点(原地复活后所在位置) */
  revivePoint: { x: number; y: number };
  /**
   * 回城时是否开角色面板检查装备耐久(装备红/快红 → 触发访问配了配方的商人 NPC)。
   * 这是「要不要找商人」的触发条件,跟城镇绑定;都不触发就直接去出城口返程。
   */
  checkDurability?: boolean;
  /** 红药 OCR 数量少于该值则触发访问配了配方的商人 NPC;不配 = 不检查药水 */
  potionThreshold?: number;
  /**
   * 回城时是否检查/创建队伍:勾了就在每次回城补给时按 Alt+Q 看交友面板,
   * 面板显示「组队」= 未组队 → 自动点它 + 点建队确认,完成建队;显示「解散」= 已在队伍 → 直接关掉面板。
   * 与"要不要找商人"无关(不参与 reasons 判定),队伍检查失败只记日志、不阻断补给。
   * 面板区域等常量见 core/constant-ocr/team.ts,流程见 resupply/team-check.ts。
   */
  createTeam?: boolean;
  npcs: TownProfileNpc[];
  routes: TownProfileRoute[];
  exits: TownProfileExit[];
  /** 从其它主城坐飞空艇回到本城镇的中转(回城卷轴落在别的主城时用);不配 = 只能落在本城镇 */
  transitFrom?: TownTransitCity[];
}

// ===== 过图路线(map-profile):一张中间地图的两个出入口 + 途经点,供 farm 的「地图跨越」逐跳穿越 =====
// 同为配置型"任务";farm.mapCrossings 按顺序引用它,worker 用 RouteTraveler.travelToExit 逐跳过图

/** 过图路线的一个出入口;position 为游戏内地图坐标 */
export interface MapProfilePortal {
  /** 出入口在本图的坐标(游戏内地图坐标) */
  position: { x: number; y: number };
  /** 穿过这个口子会到达的图(游戏内 OCR 中文地图名) */
  toMap: string;
}

/** 过图路线途经点上的 NPC 交互:走到这个点后先和 NPC 对话(跑完配方)再继续 */
export interface MapProfileNpc {
  /** NPC 名称(中文,取值见 shared/npc.ts);也是游戏内找字用的绿字名 */
  name: string;
  /** 引用的对话配方名(= dialog-recipe 的任务名);必填,否则没有可执行的对话 */
  recipeName: string;
}

/** 过图路线的一个途经点 */
export interface MapProfileWaypoint {
  x: number;
  y: number;
  /** 可选:到这个点时先和这个 NPC 对话,配方跑完才走下一个点(去程/返程都会触发) */
  npc?: MapProfileNpc;
}

/**
 * 过图路线档案:一张中间地图怎么从一端走到另一端并过图。
 * 只支持"线性两端"的图(一个入口、一个出口);有岔路/多出入口的图需要拆成多份或后续升级为锚点+多路线模型。
 */
export interface MapProfileConfig {
  type: 'map-profile';
  /** 本图 OCR 中文地图名(必须和游戏里读到的名字一致) */
  mapName: string;
  /** 入口口子:从上一张图过图后落到这里;返程时从这里走出去(→ entrance.toMap) */
  entrance: MapProfilePortal;
  /** 出口口子:去下一张图;返程时从这里进入本图(→ exit.toMap) */
  exit: MapProfilePortal;
  /** entrance → exit 的途经点(单向);返程按反向走;途经点可挂 NPC(到点先对话) */
  waypoints: MapProfileWaypoint[];
}

// ===== 对话配方(dialog-recipe):在某个 NPC 处按顺序执行的步骤脚本(修理 / 买药等) =====
// 同为配置型"任务";城镇档案里的 NPC 用 TownProfileNpc.recipeName 引用它,worker 按名字取用

/**
 * 对话步骤:
 * - click-text   点对话选项里含指定文字的条目(offsetX/offsetY=点击偏移;onMissing=找不到时 skip/fail)
 * - click-at     直接点屏幕坐标(客户区相对坐标)
 * - key          按键(如 Enter/Esc/F1~F12)
 * - wait         等待毫秒
 * - input-text   输入文字(如购买数量)
 * - if-text      条件分支:对话窗口含指定文字则跳 thenId,否则跳 elseId(缺省 = 顺序往下)
 * - close-dialog 关闭对话窗口
 * thenId / elseId 引用同一配方里其它步骤的 id
 */
export type DialogStep =
  | { id: string; kind: 'click-text'; text: string; offsetX?: number; offsetY?: number; onMissing: 'skip' | 'fail' }
  | { id: string; kind: 'click-at'; x: number; y: number; note?: string }
  | { id: string; kind: 'key'; key: string }
  | { id: string; kind: 'wait'; ms: number }
  | { id: string; kind: 'input-text'; text: string }
  | { id: string; kind: 'if-text'; text: string; thenId?: string; elseId?: string }
  | { id: string; kind: 'close-dialog' };

/** 对话配方:一段与 NPC 对话的步骤脚本;由城镇档案里的 NPC 按名字引用(见 TownProfileNpc.recipeName) */
export interface DialogRecipeConfig {
  type: 'dialog-recipe';
  steps: DialogStep[];
}

/**
 * 缺省技能任务步骤 — 一个"按键动作" + 它的执行参数
 *
 * 设计要点(数据驱动):
 * - key 用字符串描述(F1/Alt+F2/Shift+F3),shared/key-combo.ts 提供解析
 * - 按键后立刻 keyUp,不在 worker 里阻塞 — 防按住期间被检测
 * - intervalMs = 按键抬起后到下一次按键的间隔(毫秒),用来调频率
 * - holdMs = 按键按住时长(毫秒,可选),默认 50ms;有长按需求时调大
 *
 * 例:连击 F1 每 200ms 一次 = { key:'F1', intervalMs:200, holdMs:50 }
 * 例:Alt+F1 慢放 = { key:'Alt+F1', intervalMs:1500, holdMs:80 }
 */
export interface DefaultSkillStep {
  /** 唯一 id(数组 reorder / delete 用,不要给业务用) */
  id: string;
  /** 按键描述:F1~F12 / Alt+F1~F12 / Shift+F1~F10 */
  key: string;
  /** 按键之间的间隔(毫秒) — 抬起主键后等多久再按下一个 */
  intervalMs: number;
  /** 按键按住时长(毫秒,可选,默认 50ms) */
  holdMs?: number;
  /** 该步骤是否启用(临时禁用某个步骤不删它) */
  enabled?: boolean;
  /** 备注 */
  note?: string;
}

/**
 * 缺省技能任务配置
 * - 按 steps 数组顺序执行,执行完一遍后等待 loopIntervalMs 再来一遍
 * - loopCount = 0 表示无限循环(默认)
 * - 没有 OCR / 战斗状态判定:纯按键编排,玩家自己承担"何时该按"的责任
 *   (这是"缺省技能"名字的由来:把一组固定按键循环跑下去)
 */
export interface DefaultSkillTaskConfig {
  type: 'default-skill';
  /** 按键步骤(按数组顺序执行) */
  steps: DefaultSkillStep[];
  /** 循环次数,0 = 无限循环 */
  loopCount: number;
  /** 一轮 steps 跑完到下一轮之间的间隔(毫秒) */
  loopIntervalMs: number;
  /** 备注 */
  note?: string;
}

/** 留白任务配置(后续实现) */
export interface PlaceholderTaskConfig {
  type: 'mine' | 'catch-pet' | 'refine' | 'reputation';
  _todo?: never;
}

/**
 * 任务配置联合类型
 * town-profile(城镇档案)/ dialog-recipe(对话配方)/ map-profile(过图路线)/ pet-training(宠物带练)只参与存储/编辑,不可作为任务运行
 */
export type TaskConfig =
  | FarmTaskConfig
  | PlaceholderTaskConfig
  | DefaultSkillTaskConfig
  | TownProfileConfig
  | DialogRecipeConfig
  | MapProfileConfig
  | PetTrainingConfig;

/**
 * start-task 命令的附属配置(farm 回城补给用):
 * renderer 启动任务时把 farm 配置里的引用解析成完整配置,随 start-task 一并下发,
 * worker 收到后存到 ctx.init.auxConfigs(与 taskConfig 同生命周期)
 */
/**
 * 下发给 worker 的对话配方:配方本体 + 它的任务名。
 * 城镇档案里的 NPC 用 TownProfileNpc.recipeName 引用它(名字 = 历史任务里那份 dialog-recipe 的任务名)。
 */
export type ResupplyRecipe = DialogRecipeConfig & { name: string };

/**
 * 下发给 worker 的过图路线档案:档案本体 + 它的任务名。
 * farm 的 mapCrossings 按名字引用它(顺序 = 穿越顺序)。
 */
export type ResupplyMapProfile = MapProfileConfig & { name: string };

/**
 * 下发给 worker 的辅助配置:配置本体 + 它的任务名。
 * farm 的 auxConfigNames 多选引用它(顺序 = 执行顺序);worker 按每份配置自己的 triggers 挑时机执行。
 */
export type ResupplyAuxConfig = PetTrainingConfig & { name: string };

export interface StartTaskAuxConfigs {
  /** 城镇档案(farm.resupply.townProfileName 指向的那份) */
  townProfile?: TownProfileConfig;
  /** 全部对话配方(worker 按 NPC 的 recipeName 从中取) */
  recipes?: ResupplyRecipe[];
  /** farm 挂机地图的 OCR 中文地图名(回城后靠它找出口返回),renderer 启动时解析传入 */
  farmMapName?: string;
  /** farm.mapCrossings 引用到的全部过图路线档案(按穿越顺序),renderer 启动时解析传入 */
  mapProfiles?: ResupplyMapProfile[];
  /** farm.auxConfigNames 勾选到的全部辅助配置(按勾选顺序),renderer 启动时解析传入 */
  auxList?: ResupplyAuxConfig[];
}

/** worker:read-position 的响应:成功 = { map, x, y }(map=null 表示地图名未识别);失败/超时 = error 有值 */
export interface WorkerPositionResult {
  /** 当前地图名(OCR 中文);未识别为 null */
  map: string | null;
  x: number;
  y: number;
  /** 失败原因(OCR 失败 / worker 不存在 / 超时等);成功时为 undefined */
  error?: string;
}

/** 任务配置存储(按"任务名"维度存储,跨窗口复用) */
export interface StoredTaskConfig {
  id: string; // 唯一 ID(默认等于 name,但允许 name 重命名时保留稳定 id)
  /** 用户自定义的任务名(全局唯一,创建时必填,跨窗口复用) */
  name: string;
  taskType: TaskType;
  config: TaskConfig;
  createdAt: number;
  updatedAt: number;
}

/** 游戏窗口客户区分辨率(坐标常量按此分档) */
export type GameResolution = '1600*900' | '1280*800';

/** 应用设置(设置面板读写,持久化到本地 JSON) */
export interface AppSettings {
  /** 游戏分辨率;null = 未设置(首次启动会弹设置面板让用户选) */
  resolution: GameResolution | null;
  /** 大漠插件注册码(留空 = 用项目内置注册码) */
  damooRegisterCode: string;
  /** 大漠插件附加码(留空 = 用项目内置附加码) */
  damooAttachCode: string;
  /** 图鉴(ttshitu)账号:识别神医验证码的问题截图;账号或密码留空 = 兜底点第一个选项 */
  tuJianAccount: string;
  /** 图鉴(ttshitu)密码 */
  tuJianPassword: string;
}

/** 应用内提醒(主进程 → 渲染进程右下角浮层,如"未配置图鉴账号") */
export interface AppToastPayload {
  /** 去重键,同一件事在本次运行内只提醒一次 */
  key: string;
  title: string;
  body: string;
}

/** 看门狗中断事件(检测命中与处理结果) */
export interface InterruptEvent {
  /** detected=检测命中 / handled=处理完成 / failed=处理失败 */
  kind: 'detected' | 'handled' | 'failed';
  /** 检查项类型:verify-code=神医验证码 / team-invite=组队申请 / heal=生命回复 / stop-level-up=角色停级 */
  popupType: string;
  /** 人类可读细节(如 anchor 坐标 / 失败原因) */
  detail: string;
  /** 事件发生时间戳(ms) */
  at: number;
}

/** Worker 状态(上报给主面板) */
export interface WorkerState {
  workerId: string;
  hwnd: number;
  character: CharacterInfo | null;
  taskType: TaskType | null;
  taskName: TaskName | null;
  status: ScriptStatus;
  statusDetail?: string;
  startedAt: number | null;
  stats: {
    killCount: number;
    deathCount: number;
    uptimeMs: number;
  };
  /** 当前任务配置(挂机打怪才有) */
  taskConfig?: TaskConfig;
  /** 缩略图(base64 dataURL,可选) */
  thumbnail?: string;
  /** 子进程是否已 ready(顶层代码执行完,message listener 已注册,可以安全发命令) */
  ready?: boolean;
}
