// 启动任务时把「回城补给 / 地图跨越」引用的配置解析成完整 auxConfigs(见 shared/types.ts 的 StartTaskAuxConfigs)
//
// worker 侧约定(见 electron/workers/game-worker/resupply/resupply-runner.ts):
//   auxConfigs.townProfile  城镇档案整份下发给 worker(从 taskHistory 里按名字取)
//   auxConfigs.recipes      全部对话配方(带任务名;城镇 NPC 与过图路线途经点的 NPC 都按 recipeName 取)
//   auxConfigs.farmMapName  farm 挂机地图的中文名(worker 用它匹配 exits[].toMap 找回家的出口)
//   auxConfigs.mapProfiles  地图跨越要依次穿越的中间地图档案(带任务名;按 farm.mapCrossings 顺序)
//
// 解析入口:WindowCard 的 handleTaskSaved / handleHistorySelect / pending 状态的「启动」按钮

import type {
  DialogRecipeConfig,
  FarmTaskConfig,
  MapProfileConfig,
  ResupplyMapProfile,
  ResupplyRecipe,
  StartTaskAuxConfigs,
  StoredTaskConfig,
  TaskConfig,
  TownProfileConfig,
  TownProfileNpc,
} from '../shared/types';
import { normalizeNpcName } from '../shared/npc';
import { resolveFarmMapName } from './farm-maps';

/** 解析结果:ok=false 时 error 是要展示给用户的原因(调用方不要启动) */
export type AuxResolveResult = { ok: true; auxConfigs: StartTaskAuxConfigs | null } | { ok: false; error: string };

/** 配置型"任务"(城镇档案 / 对话配方 / 过图路线):可存储/编辑,但不可作为任务运行 */
export function isConfigOnlyTaskType(type: TaskConfig['type'] | undefined | null): boolean {
  return type === 'town-profile' || type === 'dialog-recipe' || type === 'map-profile';
}

/**
 * 某个配置型"任务"被哪些 farm 任务引用(只用来做删除前的提示,不硬阻止):
 *   - town-profile:看 farm.resupply.townProfileName 是否等于它的任务名
 *   - dialog-recipe:先看哪些城镇档案的 NPC / 过图路线途经点的 NPC 用 recipeName 引用了它,再看哪些 farm 用了那些档案
 *   - map-profile:看哪些 farm 的 mapCrossings 里引用了它
 */
export function referencedByFarmTasks(stored: StoredTaskConfig, history: StoredTaskConfig[]): string[] {
  const farmTasks = history.filter((h) => h.config.type === 'farm');
  if (stored.config.type === 'town-profile') {
    return farmTasks
      .filter((h) => {
        const c = h.config as FarmTaskConfig;
        return c.resupply?.enabled === true && c.resupply?.townProfileName === stored.name;
      })
      .map((h) => h.name);
  }
  if (stored.config.type === 'dialog-recipe') {
    const owners = history
      .filter((h) => h.config.type === 'town-profile')
      .filter((h) => ((h.config as TownProfileConfig).npcs ?? []).some((n) => (n.recipeName ?? '').trim() === stored.name))
      .map((h) => h.name);
    // 过图路线途经点的 NPC 也可能引用它:找出引用它的 map-profile,再看哪些 farm 用了那些档案
    const crossingOwners = history
      .filter((h) => h.config.type === 'map-profile')
      .filter((h) => ((h.config as MapProfileConfig).waypoints ?? []).some((w) => (w.npc?.recipeName ?? '').trim() === stored.name))
      .map((h) => h.name);
    if (owners.length === 0 && crossingOwners.length === 0) return [];
    return farmTasks
      .filter((h) => {
        const c = h.config as FarmTaskConfig;
        if (c.resupply?.enabled === true && owners.includes(c.resupply?.townProfileName ?? '')) return true;
        return (c.mapCrossings ?? []).some((n) => crossingOwners.includes(n));
      })
      .map((h) => h.name);
  }
  if (stored.config.type === 'map-profile') {
    return farmTasks.filter((h) => ((h.config as FarmTaskConfig).mapCrossings ?? []).includes(stored.name)).map((h) => h.name);
  }
  return [];
}

/** 把一份 map-profile 配置规整成可下发的形态(补齐缺省字段,trim 字符串) */
function normalizeMapProfile(name: string, raw: MapProfileConfig): ResupplyMapProfile {
  return {
    name,
    type: 'map-profile',
    mapName: String(raw.mapName ?? '').trim(),
    entrance: {
      position: { x: raw.entrance?.position?.x ?? 0, y: raw.entrance?.position?.y ?? 0 },
      toMap: String(raw.entrance?.toMap ?? '').trim(),
    },
    exit: {
      position: { x: raw.exit?.position?.x ?? 0, y: raw.exit?.position?.y ?? 0 },
      toMap: String(raw.exit?.toMap ?? '').trim(),
    },
    waypoints: (raw.waypoints ?? []).map((w) => {
      const npcName = String(w.npc?.name ?? '').trim();
      return {
        x: w.x ?? 0,
        y: w.y ?? 0,
        npc: npcName ? { name: npcName, recipeName: String(w.npc?.recipeName ?? '').trim() } : undefined,
      };
    }),
  };
}

/**
 * 校验地图跨越链路是否连通(启动前拦下,避免跑到一半才发现出口对不上):
 *   每张图的 exit.toMap 必须等于链路下一站(下一张图名,链尾 = 挂机地图名);
 *   每张图都要填 entrance.toMap(返程用)。
 * 返回 null = 通过。
 */
function validateCrossingChain(profiles: ResupplyMapProfile[], farmMapName: string): string | null {
  for (let i = 0; i < profiles.length; i++) {
    const p = profiles[i];
    if (!p.mapName) return `过图路线「${p.name}」没填「本图地图名」(必须是游戏内 OCR 读到的中文名)`;
    const next = profiles[i + 1]?.mapName ?? farmMapName;
    if (p.exit.toMap !== next) {
      return (
        `过图路线「${p.name}」的出口通向「${p.exit.toMap || '未填'}」,但链路下一站是「${next}」` +
        `(把出口 toMap 改成下一张图名;链尾那张要改成挂机地图名「${farmMapName}」)`
      );
    }
    if (!p.entrance.toMap) return `过图路线「${p.name}」没填「入口通向的图名」(返程要用,填上一张图名)`;
  }
  return null;
}

/** 校验过图路线途经点上的 NPC 引用:配了 NPC 必须选配方,且配方要存在 */
function validateCrossingNpcRecipes(profiles: ResupplyMapProfile[], recipes: ResupplyRecipe[]): string | null {
  for (const p of profiles) {
    for (const wp of p.waypoints ?? []) {
      const npc = wp.npc;
      if (!npc) continue;
      const rn = (npc.recipeName ?? '').trim();
      if (!rn) return `过图路线「${p.name}」的途经点 (${wp.x},${wp.y}) 配了 NPC「${npc.name}」,但没有选对话配方`;
      if (!recipes.some((r) => r.name === rn)) {
        return `过图路线「${p.name}」里 NPC「${npc.name}」引用的对话配方「${rn}」不存在(可能已被删除或改名)`;
      }
    }
  }
  return null;
}

/**
 * 解析 startTask 的附属配置:
 *   - 非 farm / 既没开回城补给也没配地图跨越 → auxConfigs = null(保持原有启动行为,不影响老流程)
 *   - 开了回城补给 → 必须能解析出城镇档案(引用配方也要存在),解析不出就返回 error 阻止启动
 *   - 配了地图跨越 → 必须能按顺序解析出全部过图路线,链表要连通、途经点的 NPC 配方要存在
 */
export function resolveAuxConfigs(config: TaskConfig | null | undefined, history: StoredTaskConfig[]): AuxResolveResult {
  const farm = config?.type === 'farm' ? config : null;
  const crossings = (farm?.mapCrossings ?? []).map((s) => String(s ?? '').trim()).filter(Boolean);
  const resupplyOn = farm?.resupply?.enabled === true;
  // 条件回城:回城卷轴只会把人送进主城,回挂机图要靠城镇档案出城 —— 没档案直接拦在启动前
  const endReturnOn = farm?.endReturn?.enabled === true;
  if (!farm || (!resupplyOn && crossings.length === 0)) {
    if (endReturnOn) {
      return {
        ok: false,
        error: '开启「结束自动打怪并回城」需要先在「回城补给」里开启补给并选好城镇档案(回城后要按它走回挂机图)',
      };
    }
    return { ok: true, auxConfigs: null };
  }

  const farmMapName = resolveFarmMapName(farm.mapId, farm.customMapName);
  if (!farmMapName) {
    return { ok: false, error: '无法确定挂机地图的中文名:请在「地图」里重新选择,或选「自定义...」并填写游戏内地图名' };
  }

  // 地图跨越:按 farm.mapCrossings 顺序取档案本体
  const mapProfiles: ResupplyMapProfile[] = [];
  for (const name of crossings) {
    const stored = history.find((h) => h.taskType === 'map-profile' && h.name === name);
    if (!stored || stored.config.type !== 'map-profile') {
      return { ok: false, error: `地图跨越引用的过图路线「${name}」不存在(可能已被删除,请重新选择)` };
    }
    mapProfiles.push(normalizeMapProfile(stored.name, stored.config));
  }
  const chainErr = validateCrossingChain(mapProfiles, farmMapName);
  if (chainErr) return { ok: false, error: chainErr };

  // 全部对话配方:城镇档案的 NPC 与过图路线途经点的 NPC 都按 recipeName 引用它
  const recipes: ResupplyRecipe[] = history
    .filter((h) => h.config.type === 'dialog-recipe')
    .map((h) => ({ name: h.name, type: 'dialog-recipe' as const, steps: (h.config as DialogRecipeConfig).steps ?? [] }));

  // 过图路线途经点的 NPC 引用校验
  const npcErr = validateCrossingNpcRecipes(mapProfiles, recipes);
  if (npcErr) return { ok: false, error: npcErr };

  // 城镇档案:开回城补给 / 开了条件回城时必须下发;没开补给但配了地图跨越、又指定了城镇档案时也下发
  // (这样「不开补给、只想从出发城镇启动」也能走 NPC 传送 / 出城口)
  const townProfileName = String(farm.resupply?.townProfileName ?? '').trim();
  let townProfile: TownProfileConfig | undefined;
  if (resupplyOn || endReturnOn || (crossings.length > 0 && townProfileName)) {
    if (!townProfileName) {
      return {
        ok: false,
        error:
          endReturnOn && !resupplyOn
            ? '开启「结束自动打怪并回城」但没有选择城镇档案(回城后回不到挂机图)'
            : '回城补给已开启,但没有选择城镇档案',
      };
    }
    const stored = history.find((h) => h.taskType === 'town-profile' && h.name === townProfileName);
    if (!stored || stored.config.type !== 'town-profile') {
      return { ok: false, error: `引用的城镇档案「${townProfileName}」不存在(可能已被删除,请重新选择)` };
    }

    // 旧档案迁移:npc.kind(已废弃)→ name,避免升级后丢掉游戏内找字用的名字
    const rawTown = stored.config as TownProfileConfig;
    townProfile = {
      ...rawTown,
      npcs: (rawTown.npcs ?? []).map((n) => {
        const legacy = n as TownProfileNpc & { kind?: unknown };
        return {
          id: legacy.id,
          name: legacy.name || normalizeNpcName(legacy.kind),
          position: legacy.position,
          recipeName: legacy.recipeName,
        };
      }),
    };

    // 回城补给的启动前校验:只拦"引用了不存在的配方"(配置错误)。
    // 档案里一个配方都没配是允许的 —— 没商人可找就直接去出城口返程(见 resupply-runner)
    if (resupplyOn) {
      const referenced = townProfile.npcs.map((n) => (n.recipeName ?? '').trim()).filter(Boolean);
      const missing = [...new Set(referenced.filter((x) => !recipes.some((r) => r.name === x)))];
      if (missing.length > 0) {
        return {
          ok: false,
          error: `城镇档案「${townProfileName}」里有 NPC 引用的对话配方不存在:${missing.join('、')}(可能已被删除或改名)`,
        };
      }
    }

    // 传送出口校验:via='npc' 的出口必须填传送 NPC 与已存在的对话配方
    const teleportErr = validateTownTeleportExits(townProfile, recipes);
    if (teleportErr) return { ok: false, error: teleportErr };

    // 配了地图跨越时,城镇要能到链首(走到出城口过图,或与传送 NPC 对话后传送)
    if (mapProfiles.length > 0) {
      const firstTarget = mapProfiles[0].mapName;
      const hasExit = (townProfile.exits ?? []).some((e) => (e.toMap ?? '').trim() === firstTarget);
      if (!hasExit) {
        return {
          ok: false,
          error:
            `城镇档案「${townProfileName}」里没有去「${firstTarget}」的出口(exits[].toMap 要和第一张中间图名一致;` +
            `若靠 NPC 传送就把该出口的通行方式设为「对话传送」)`,
        };
      }
    }
  }

  return {
    ok: true,
    auxConfigs: { townProfile, recipes, farmMapName, mapProfiles },
  };
}

/**
 * 校验城镇档案的传送类引用(启动前就拦下,避免跑到一半才发现配置不对):
 *   - 出口 via='npc':必须填传送 NPC 与配方,且配方要存在
 *   - 其它主城中转(transitFrom):必须填地图名/NPC/配方,且配方要存在
 */
function validateTownTeleportExits(town: TownProfileConfig, recipes: ResupplyRecipe[]): string | null {
  for (const exit of town.exits ?? []) {
    if (exit.via !== 'npc') continue;
    const to = (exit.toMap ?? '').trim() || '(未填地图名)';
    const npcName = (exit.npcName ?? '').trim();
    const recipeName = (exit.recipeName ?? '').trim();
    if (!npcName) return `城镇档案「${town.mapName}」的出口「→${to}」选了「对话传送」,但没有填传送 NPC 名`;
    if (!recipeName) return `城镇档案「${town.mapName}」的出口「→${to}」选了「对话传送」,但没有选对话配方`;
    if (!recipes.some((r) => r.name === recipeName)) {
      return `城镇档案「${town.mapName}」的出口「→${to}」引用的对话配方「${recipeName}」不存在(可能已被删除或改名)`;
    }
  }

  for (const transit of town.transitFrom ?? []) {
    const from = (transit.mapName ?? '').trim() || '(未填地图名)';
    const npcName = (transit.npcName ?? '').trim();
    const recipeName = (transit.recipeName ?? '').trim();
    if (!npcName) return `城镇档案「${town.mapName}」的「其它主城中转」(${from})没有填飞空艇 NPC 名`;
    if (!recipeName) return `城镇档案「${town.mapName}」的「其它主城中转」(${from})没有选对话配方`;
    if (!recipes.some((r) => r.name === recipeName)) {
      return `城镇档案「${town.mapName}」的「其它主城中转」(${from})引用的对话配方「${recipeName}」不存在(可能已被删除或改名)`;
    }
  }
  return null;
}
