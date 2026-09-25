// bootstrap: 子进程启动流程
//   profile 准备 → loadDamoo → bindWindow → 字库 → OCR 角色名 → 发 state → 缩略图
// 失败路径与原 game-utility-worker.ts 完全一致:
//   大漠未加载 / 绑定失败 → setStatus('alert', ...) 后返回 false,不再继续后续步骤
//
// 注:原流程末尾会无条件组装 CombatEngine 挂到 ctx.combat(供 pause/stop/resume 直接操作)。
//   挂机打怪改成「沿路径点循环 + 到点按技能键点怪物」后不再使用 CombatEngine,该步骤已移除;
//   任务级暂停/停止统一由 ctx 上的运行标志驱动(ctx.skill / ctx.moveAttack)。

import {
  getDamoo,
  bindWindow,
  setDamooRegisterCode,
  DEFAULT_DAMOO_CONFIG,
  dmApi,
  type DamooConfig,
} from '../../../core/platform/damoo/dm-api';
import { dmErrorFull } from '../../../core/platform/damoo/dm-errors';
import type { TaskType, TaskName } from '../../../shared/types';
import type { WorkerContext } from './context';
import { takeAndSendThumbnail } from './thumbnail';

export const taskNameMap: Record<TaskType, TaskName> = {
  farm: '挂机打怪',
  mine: '挖矿',
  'catch-pet': '捕捉宠物',
  refine: '装备炼化',
  reputation: '名誉任务',
  'default-skill': '缺省技能',
};

export const DEFAULT_PROFILE: any = {
  id: 'default',
  name: 'Default',
  class: {
    name: 'warrior',
    skills: {},
    potions: {},
  },
  combat: {
    findTargetIntervalMs: 1500,
    combatTimeoutMs: 60000,
    mobFilter: { nameKeywords: [] },
  },
  engine: {},
  regions: {},
  // 默认字库(assets/font/0_ffo.txt,QQ幻想 专用)
  fontLib: '0_ffo.txt',
};

export async function readCharacterNameMock(fallback: string): Promise<string> {
  await new Promise((r) => setTimeout(r, 300));
  const r = Math.floor(Math.random() * 100);
  return `${fallback || '角色'}-${r.toString().padStart(2, '0')}`;
}

/**
 * 跑启动流程。返回 true = 成功(继续等 start-task / 跑任务);
 * false = 失败(已 setStatus('alert'),调用方直接 return)
 */
export async function bootstrap(ctx: WorkerContext): Promise<boolean> {
  const init = ctx.init;
  const t0 = Date.now();
  ctx.mainStart = t0;
  const elapsed = () => `[+${Date.now() - t0}ms]`;
  ctx.sendLog(
    'info',
    `UtilityWorker 启动(PID=${process.pid}) ${elapsed()}: hwnd=${init.hwnd} 任务=${taskNameMap[init.taskType]} 角色=${init.characterName}`,
  );
  try {
    process.stderr.write(`[STEP-START] main 进入 [+0ms]\n`);
  } catch {}

  const profile = init.profile || DEFAULT_PROFILE;
  ctx.profile = profile;
  // 注:挂机打怪的找怪关键字/颜色直接读 ctx.init.taskConfig(tasks/farm.ts 的 resolveConfig),
  //   不再往 profile.combat.mobFilter 里灌。这里只做一条启动日志方便排查。
  if (init.taskConfig?.type === 'farm' && init.taskConfig.mobFilter?.nameKeywords) {
    ctx.sendLog(
      'info',
      `taskConfig 找怪关键字: ${init.taskConfig.mobFilter.nameKeywords.join(', ')}`,
    );
  } else {
    ctx.sendLog('info', `默认 profile: 职业=${profile.class?.name || 'warrior'}`);
  }

  try {
    const tLoad = Date.now();
    // 设置里填了大漠注册码就先用它覆盖内置注册码(必须在 COM 初始化前调用)
    if (init.settings?.damooRegisterCode) {
      setDamooRegisterCode(init.settings.damooRegisterCode, init.settings.damooAttachCode);
      ctx.sendLog('info', '大漠注册码:使用设置中配置的注册码');
    } else {
      ctx.sendLog('info', '大漠注册码:使用程序内置注册码(设置中未配置)');
    }
    ctx.stepStart('loadDamoo(同步 COM 初始化 + 注册码校验)');
    ctx.dm = getDamoo();
    const ver = dmApi.version();
    ctx.stepEnd('loadDamoo', true, `version=${ver} 耗时=${Date.now() - tLoad}ms`);
    ctx.sendLog('info', `大漠加载成功,版本 ${ver} (耗时 ${Date.now() - tLoad}ms)`);
  } catch (e: any) {
    ctx.stepEnd('loadDamoo', false, e.message);
    ctx.log.error(`大漠加载失败: ${e.message}`);
    ctx.setStatus('alert', '大漠未加载');
    return false;
  }

  const profileEngine = profile?.engine;
  const cfg: DamooConfig = {
    display: profileEngine?.display || init.damooConfig?.display || DEFAULT_DAMOO_CONFIG.display,
    mouse: profileEngine?.mouse || init.damooConfig?.mouse || DEFAULT_DAMOO_CONFIG.mouse,
    keypad: profileEngine?.keypad || init.damooConfig?.keypad || DEFAULT_DAMOO_CONFIG.keypad,
    mode: profileEngine?.mode ?? init.damooConfig?.mode ?? DEFAULT_DAMOO_CONFIG.mode,
  };
  ctx.damooConfig = cfg;
  const tBind = Date.now();
  // ⚠️ bindWindow 在以下场景会同步 hang(无法 unblock):
  //   - hwnd 无效/已销毁(此时 dm.dll 等不到窗口消息,无限挂起)
  //   - 窗口最小化/被遮挡且 mode 选了 dx.public.inject(等 D3D 表面)
  //   - 反作弊拦截 user32 hook 安装
  //   stepStart/stepEnd 是同步 stderr 写入,即使后续 hang 也能在 stderr 看到「卡在 bindWindow」
  ctx.stepStart(`bindWindow(hwnd=${init.hwnd}, mode=${cfg.mode}, display=${cfg.display})`);
  const bindOk = (ctx.bindSuccess = bindWindow(init.hwnd, cfg));
  ctx.stepEnd('bindWindow', bindOk, `耗时=${Date.now() - tBind}ms`);
  ctx.sendLog(
    'info',
    `bindWindow 完成: ${bindOk ? '成功' : '失败'} (耗时 ${Date.now() - tBind}ms)`,
  );
  if (!bindOk) {
    const code = dmApi.getLastError();
    const { message, advice } = dmErrorFull(code);
    ctx.sendLog(
      'error',
      `窗口绑定失败 hwnd=${init.hwnd} code=${code} ${message}${advice ? ' | 建议:' + advice : ''}`,
    );
    // 绑定失败后不再截图:未绑定状态下 Capture 必然失败,
    // 会掩盖真正的「绑定失败」根因,误导排查方向
    ctx.setStatus('alert', `绑定失败: ${message}`);
    return false;
  }

  if (profile?.fontLib) {
    try {
      const fs = require('fs');
      const path = require('path');
      // utilityProcess 里 require('electron') 拿不到 app,appPath 由主进程通过 init 传入
      const appPath = init.appPath || process.cwd();
      // 字库路径双候选(与 dm.dll 同理,damoo-registrar.getDmPath):
      //   packaged: extraResources 抽到 resources/font/(真实磁盘,asar 外,SetDict 读不了 asar 内文件)
      //   dev:      项目根/assets/font/
      const fontPath = path.isAbsolute(profile.fontLib)
        ? profile.fontLib
        : ([
            path.join(process.resourcesPath || '', 'font', profile.fontLib),
            path.join(appPath, 'assets', 'font', profile.fontLib),
            path.join(appPath, profile.fontLib),
          ].find((p: string) => fs.existsSync(p)) ?? null);
      if (!fontPath) {
        ctx.sendLog(
          'warn',
          `字库文件不存在: ${profile.fontLib} (已找 resources/font 和 assets/font)`,
        );
      } else {
        const ret = dmApi.setDict(0, fontPath);
        if (ret === 1) {
          dmApi.useDict(0);
          ctx.sendLog('info', `字库已加载: ${fontPath}`);
        } else {
          ctx.sendLog('warn', `字库加载失败: SetDict 返回 ${ret} (${fontPath})`);
        }
      }
    } catch (e: any) {
      ctx.sendLog('warn', `字库加载失败: ${e.message}`);
    }
  } else {
    ctx.sendLog('info', `字库未加载`);
  }

  // OCR读取角色名称
  ctx.characterName = await readCharacterNameMock(init.characterName);
  ctx.sendLog('info', `OCR 角色名: ${ctx.characterName}`);

  ctx.postMessage({
    type: 'state',
    state: {
      characterName: ctx.characterName,
    },
  });

  const tCap = Date.now();
  // 截图只影响缩略图显示,失败(返回 false)不阻断后续战斗循环,
  // takeAndSendThumbnail 内部已回传 dataUrl=null 让 bootstrap 正常 resolve
  const captureOk = await takeAndSendThumbnail(ctx, init.hwnd);
  if (!captureOk) {
    ctx.sendLog('warn', `缩略图截图失败(不影响后续任务)。耗时 ${Date.now() - tCap}ms`);
  }
  ctx.sendLog('info', `thumbnail 发送完成 (耗时 ${Date.now() - tCap}ms)`);

  // 启动流程到此结束:任务类型/配置由 start-task 命令下发,tasks/index.ts 按类型分派
  ctx.sendLog('info', 'bootstrap 完成,等待 start-task 命令...');
  return true;
}
