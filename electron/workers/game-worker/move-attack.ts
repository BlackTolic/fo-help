// 移动攻击测试:沿路径点循环移动,每到一个点停下扫描怪物,释放所有 CD 已好的指向性技能
//
// 技能释放方式(按你的游戏):按技能键(F1-F9) → 鼠标左键点击怪物屏幕坐标
// 结束条件:stop 命令 / 跑满最大圈数 / 血量过低(可选) / 连续多个路径点卡住
//
// 配置来源:优先读 ctx.init.taskConfig(WindowCard「挂机打怪」弹窗点"确认/保存"后
//   经 start-task 命令下发);字段缺失时回退到下面的内置默认值。
//
// 为什么"到点才释放"而不是移动中释放:
//   QQ 幻想是点地移动,移动时左键处于按住状态(MovementControllerByRandom.holding),
//   而指向性技能需要"按技能键 → 左键点击怪物"。移动中放技能,点击会被当成移动指令,
//   所以必须等 moveTo 到达(arriveTolerance 内)、控制器松开左键后再释放。

import { dmApi } from '../../../core/platform/damoo/dm-api';
import { DamooVisionProvider } from '../../../core/platform/vision/damoo/DamooProvider';
import { DamooInputProvider } from '../../../core/platform/input/damoo/DamooInputProvider';
import { MapCoordReader } from '../../../core/perception/MapCoordReader';
import { MovementControllerByRandom } from '../../../core/navigation/MovementController';
import { CoordinateReader } from '../../../core/state/CoordinateReader';
import type { Point } from '../../../core/platform/vision/IVisionProvider';
import type { MapPosition } from '../../../core/perception/types';
import type { WorkerContext } from './context';
import type { FarmTaskConfig } from '../../../shared/types';
import { DEFAULT_ROLE_POSITION, DEFAULT_SIM } from '../../../core/constant-ocr/position';
import { COLOR_WHITE } from '../../../core/constant-ocr/color';

// ===== 内置默认值(taskConfig 里没配对应字段时用;按你的游戏实际情况改)=====

/** 屏幕中心(角色脚下):1280x800 窗口;分辨率不同则改 */
const SCREEN_CENTER: Point = { x: 640, y: 400 };

/** 默认路径点(地图坐标):从 A 出发依次经过 B/C/D/E,一圈结束后自动回到 A 再循环 */
const DEFAULT_PATH_POINTS = [
  { x: 100, y: 100 }, // A 起点,每圈终点也回到这里
  { x: 130, y: 100 }, // B
  { x: 130, y: 130 }, // C
  { x: 100, y: 130 }, // D
  { x: 85, y: 115 }, // E
];

/** 默认指向性技能列表:cooldownMs 按游戏实际填(3~10s 不等) */
const DEFAULT_SKILLS = [
  { key: 'F1' as const, cooldownMs: 3000 },
  { key: 'F2' as const, cooldownMs: 5000 },
  { key: 'F3' as const, cooldownMs: 8000 },
  { key: 'F4' as const, cooldownMs: 10000 },
];

/** 默认找怪配置 */
const DEFAULT_MONSTER_KEYWORDS = ['野狼', '野猪'];
const DEFAULT_MONSTER_COLOR = 'FFFFFF-FFFFFF';

/** 按技能键后等多久再点鼠标(给游戏响应技能的时间) */
const PRESS_TO_CLICK_MS = 400;
/** 两个技能释放之间的间隔(避免按键/点击冲突) */
const BETWEEN_SKILLS_MS = 400;
/** 到达路径点后,站稳多久再扫描/释放 */
const SETTLE_MS = 500;

/** 怪物扫描配置(搜索区域/偏移是屏幕几何,留在代码里;关键字/颜色来自 taskConfig) */
const MONSTER_SCAN = {
  /** 搜索区域(游戏画面区,尽量排除 UI) */
  roi: { x: 0, y: 0, w: 1280, h: 800 },
  similarity: 0.85,
  /** 点击位置 = 找到的字 + 该偏移(点在怪身体而不是名字上) */
  clickOffset: { x: 0, y: 20 },
};

/** 兜底点击方向:扫不到怪时,点在角色脚下哪个方向 */
const FALLBACK = {
  /**
   * behind = 移动的反方向(引怪场景:怪在身后追着你跑)
   * fixed  = 固定角度(fixedAngleDeg,0=正右,90=正下,180=正左)
   */
  mode: 'behind' as 'behind' | 'fixed',
  fixedAngleDeg: 0,
  /** 点击位置离屏幕中心的距离(px) */
  distance: 300,
};

/** 结束条件(taskConfig 未配时用) */
const END_CONDITIONS = {
  /** 最多跑多少圈 */
  maxLoops: 20,
  /** 血量低于该值结束;0 = 不检查(需要 profile.regions.selfHp 已配置) */
  minSelfHpPercent: 0,
  /** 连续多少个路径点未到达(卡住)就结束 */
  maxStuckPoints: 3,
};

/** 地图坐标读取配置(同 testMovement) */
const MAP_COORD_CONFIG = {
  coordRoi: DEFAULT_ROLE_POSITION['1280*800'],
  coordColor: COLOR_WHITE,
  similarity: DEFAULT_SIM,
};

// ===== 运行时配置(由 taskConfig + 默认值合成)=====

interface MoveAttackSkill {
  key: 'F1' | 'F2' | 'F3' | 'F4' | 'F5' | 'F6' | 'F7' | 'F8' | 'F9';
  cooldownMs: number;
}

interface ResolvedConfig {
  pathPoints: { x: number; y: number }[];
  skills: MoveAttackSkill[];
  monsterKeywords: string[];
  monsterColor: string;
  /** 移动步进间隔(ms),来自 taskConfig.movementSpeed */
  stepIntervalMs: number;
  maxLoops: number;
}

const VALID_SKILL_KEYS = new Set(['F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9']);

/**
 * 从 ctx.init.taskConfig(FarmTaskConfig)解析移动攻击配置,缺失字段用内置默认值兜底
 */
function resolveConfig(ctx: WorkerContext): ResolvedConfig {
  const cfg = ctx.init.taskConfig as FarmTaskConfig | undefined;
  const isFarm = cfg?.type === 'farm';

  // 路径点:waypoints 非空则用,否则用默认
  const pathPoints =
    isFarm && cfg.waypoints && cfg.waypoints.length > 0
      ? cfg.waypoints.map((w) => ({ x: w.x, y: w.y }))
      : DEFAULT_PATH_POINTS;

  // 技能:配置了至少 1 个启用技能则用(过滤非法键/负 CD),否则用默认
  let skills: MoveAttackSkill[] = DEFAULT_SKILLS;
  if (isFarm && cfg.skills && cfg.skills.some((s) => s.enabled !== false)) {
    const resolved = cfg.skills
      .filter((s) => s.enabled !== false)
      .filter((s) => VALID_SKILL_KEYS.has(s.key))
      .map((s) => ({
        key: s.key as MoveAttackSkill['key'],
        cooldownMs: Math.max(0, s.cooldownMs | 0),
      }));
    if (resolved.length > 0) skills = resolved;
  }

  // 找怪关键字/颜色
  const monsterKeywords =
    isFarm && cfg.mobFilter?.nameKeywords && cfg.mobFilter.nameKeywords.length > 0
      ? cfg.mobFilter.nameKeywords
      : DEFAULT_MONSTER_KEYWORDS;
  const monsterColor =
    isFarm && cfg.mobFilter?.nameColor?.trim()
      ? cfg.mobFilter.nameColor.trim()
      : DEFAULT_MONSTER_COLOR;

  // 移动步进间隔(角色移动速度)
  const stepIntervalMs =
    isFarm && cfg.movementSpeed && cfg.movementSpeed >= 100 ? cfg.movementSpeed : 800;

  const maxLoops = END_CONDITIONS.maxLoops;

  return { pathPoints, skills, monsterKeywords, monsterColor, stepIntervalMs, maxLoops };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** 扫描怪物,返回屏幕坐标;找不到返回 null */
function scanMonster(keywords: string[], color: string): Point | null {
  for (const keyword of keywords) {
    const x = { value: 0, byref: true } as any;
    const y = { value: 0, byref: true } as any;
    const found = dmApi.findStrE(
      MONSTER_SCAN.roi.x,
      MONSTER_SCAN.roi.y,
      MONSTER_SCAN.roi.x + MONSTER_SCAN.roi.w,
      MONSTER_SCAN.roi.y + MONSTER_SCAN.roi.h,
      keyword,
      color,
      MONSTER_SCAN.similarity,
      x,
      y,
    );
    if (found === 1) {
      return {
        x: Math.floor(x.value) + MONSTER_SCAN.clickOffset.x,
        y: Math.floor(y.value) + MONSTER_SCAN.clickOffset.y,
      };
    }
  }
  return null;
}

/** 兜底点击点:移动的反方向(或固定角度),距离屏幕中心 FALLBACK.distance */
function fallbackPoint(current: MapPosition, prev: MapPosition | null): Point {
  let angle: number;
  if (FALLBACK.mode === 'fixed') {
    angle = (FALLBACK.fixedAngleDeg * Math.PI) / 180;
  } else if (prev) {
    // 地图坐标 y 轴向南 = 屏幕 y 轴向南,atan2 角可直接映射到屏幕偏移
    angle = Math.atan2(current.y - prev.y, current.x - prev.x) + Math.PI; // 移动反方向
  } else {
    angle = 0; // 第一个点没有上一位置可参考,默认正右
  }
  return {
    x: Math.round(SCREEN_CENTER.x + FALLBACK.distance * Math.cos(angle)),
    y: Math.round(SCREEN_CENTER.y + FALLBACK.distance * Math.sin(angle)),
  };
}

/**
 * 移动攻击主流程:
 *   沿路径点循环,每到一个点:站稳 → 扫怪(失败则兜底方向)→ 释放所有 CD 已好的技能
 * 短 CD 技能(3s)每个点都能放,长 CD 技能(10s)隔几个点才轮到,无需对某个点做特殊处理。
 */
export async function runMoveAttackTest(ctx: WorkerContext, hwnd: number): Promise<void> {
  const report = (ok: boolean, detail: string) => {
    ctx.sendLog(ok ? 'info' : 'warn', `[移动攻击] ${detail}`);
    ctx.postMessage({
      type: 'thumbnail-test',
      hwnd,
      ...(ok ? { info: detail } : { error: detail }),
    });
  };

  const ctrl = ctx.moveAttack;
  ctrl.running = true; // 每次进入测试都重置(上次 stop 会置 false)

  // 解析配置:优先用「挂机打怪」弹窗确认后下发的 taskConfig,缺失回退默认值
  const conf = resolveConfig(ctx);
  console.log(conf,'移动攻击配置解析');
  ctx.sendLog(
    'info',
    `[移动攻击] 配置: 路径点=${conf.pathPoints.length} 技能=[${conf.skills
      .map((s) => `${s.key}/${s.cooldownMs}ms`)
      .join(
        ', ',
      )}] 关键字=[${conf.monsterKeywords.join(',')}] 颜色=${conf.monsterColor} 移动间隔=${conf.stepIntervalMs}ms 最大圈数=${conf.maxLoops}` +
      (ctx.init.taskConfig?.type === 'farm' ? '' : '(taskConfig 非 farm,用内置默认)'),
  );

  try {
    const vision = new DamooVisionProvider();
    const input = new DamooInputProvider();
    vision.bind(hwnd);
    input.bind(hwnd);

    const coordReader = new MapCoordReader(vision, MAP_COORD_CONFIG);
    const movement = new MovementControllerByRandom(input, coordReader, { center: SCREEN_CENTER });
    const hpReader =
      END_CONDITIONS.minSelfHpPercent > 0 && ctx.profile?.regions?.selfHp
        ? new CoordinateReader(vision, ctx.profile)
        : null;

    const start = await movement.readPosition();
    if (!start) {
      report(false, '读不到当前坐标(检查 MAP_COORD_CONFIG 的 coordRoi/coordColor)');
      return;
    }
    ctx.sendLog('info', `[移动攻击] 起点: (${start.x}, ${start.y}) 地图=${start.map ?? '未知'}`);

    const lastCast = new Map<string, number>(); // 每个技能的上次释放时间戳
    let loop = 0;
    let stuckCount = 0;

    // 主循环:沿路径点移动,每到一个点:站稳 → 扫怪(失败则兜底方向)→ 释放所有 CD 已好的技能
    while (ctrl.running && loop < conf.maxLoops) {
      // 暂停等待(resume 命令会清 paused 并 resolve;stop 命令也会 resolve 并置 running=false)
      if (ctrl.paused) {
        ctx.sendLog('info', '[移动攻击] 已暂停,等待 resume');
        await new Promise<void>((resolve) => {
          ctrl.resumeResolve = resolve;
          // race 兜底:resume 可能先于 resumeResolve 注册到达,此时 paused 已是 false,直接放行
          if (!ctrl.paused) resolve();
        });
        ctrl.resumeResolve = null;
        if (!ctrl.running) break;
        ctx.sendLog('info', '[移动攻击] 继续');
      }

      loop++;
      ctx.setStatus('moving', `移动攻击 第 ${loop}/${conf.maxLoops} 圈`);
      ctx.sendLog('info', `[移动攻击] 第 ${loop}/${conf.maxLoops} 圈开始`);

      let prev: MapPosition | null = null;
      for (const point of conf.pathPoints) {
        if (!ctrl.running) break;

        const target: MapPosition = { map: start.map, x: point.x, y: point.y };
        const arrived = await movement.moveTo(target, {
          arriveTolerance: 3,
          stepIntervalMs: conf.stepIntervalMs,
          noMoveTimeoutMs: 20000,
        });

        const current: MapPosition | null = (await movement.readPosition()) ?? prev;
        if (!arrived) {
          stuckCount++;
          ctx.sendLog(
            'warn',
            `[移动攻击] 路径点 (${point.x},${point.y}) 未到达,卡住 ${stuckCount}/${END_CONDITIONS.maxStuckPoints}`,
          );
          if (stuckCount >= END_CONDITIONS.maxStuckPoints) {
            report(false, `连续 ${stuckCount} 个路径点卡住,终止`);
            return;
          }
          prev = current;
          continue;
        }
        stuckCount = 0;
        if (!current) continue;

        // 血量检查(可选结束条件)
        if (hpReader) {
          const hp = await hpReader.readSelfHpPercent().catch(() => null);
          if (hp !== null && hp <= END_CONDITIONS.minSelfHpPercent) {
            report(false, `血量过低 (${hp}%),终止`);
            return;
          }
        }

        // 到达:站稳 → 扫怪 → 释放所有 CD 已好的技能
        await sleep(SETTLE_MS);
        const monster = scanMonster(conf.monsterKeywords, conf.monsterColor);
        const clickPos = monster ?? fallbackPoint(current, prev);
        ctx.sendLog(
          'info',
          `[移动攻击] 到达 (${current.x},${current.y}) ` +
            (monster
              ? `发现怪物 @(${clickPos.x},${clickPos.y})`
              : `未发现怪物,兜底点击 (${clickPos.x},${clickPos.y})`),
        );

        const now = Date.now();
        for (const skill of conf.skills) {
          if (!ctrl.running) break;
          const last = lastCast.get(skill.key) || 0;
          if (now - last < skill.cooldownMs) continue; // 还在 CD,跳过
          await input.pressKey(skill.key);
          await sleep(PRESS_TO_CLICK_MS);
          await input.moveMouse(clickPos, { kind: 'instant' });
          await input.click('left');
          lastCast.set(skill.key, Date.now());
          ctx.sendLog('info', `[移动攻击] 释放 ${skill.key} @(${clickPos.x},${clickPos.y})`);
          await sleep(BETWEEN_SKILLS_MS);
        }

        prev = current;
      }
    }

    report(true, `结束:共 ${loop} 圈,running=${ctrl.running}`);
  } catch (e: any) {
    report(false, `异常: ${e.message}`);
  }
}
