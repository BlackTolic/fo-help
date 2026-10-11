// 启动任务时把「回城补给」引用的配置解析成完整 auxConfigs(见 shared/types.ts 的 StartTaskAuxConfigs)
//
// worker 侧约定(见 electron/workers/game-worker/resupply/resupply-runner.ts):
//   auxConfigs.townProfile  城镇档案整份下发给 worker(从 taskHistory 里按名字取)
//   auxConfigs.recipes      全部对话配方(带任务名;worker 按 NPC 的 recipeName 取)
//   auxConfigs.farmMapName  farm 挂机地图的中文名(worker 用它匹配 exits[].toMap 找回家的出口)
//
// 解析入口:WindowCard 的 handleTaskSaved / handleHistorySelect / pending 状态的「启动」按钮

import type {
  DialogRecipeConfig,
  FarmTaskConfig,
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

/** 配置型"任务"(城镇档案 / 对话配方):可存储/编辑,但不可作为任务运行 */
export function isConfigOnlyTaskType(type: TaskConfig['type'] | undefined | null): boolean {
  return type === 'town-profile' || type === 'dialog-recipe';
}

/**
 * 某个配置型"任务"被哪些 farm 任务的回城补给引用(只用来做删除前的提示,不硬阻止):
 *   - town-profile:看 farm.resupply.townProfileName 是否等于它的任务名
 *   - dialog-recipe:先看哪些城镇档案的 NPC 用 recipeName 引用了它,再看哪些 farm 用了那些档案
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
    if (owners.length === 0) return [];
    return farmTasks
      .filter((h) => {
        const c = h.config as FarmTaskConfig;
        return c.resupply?.enabled === true && owners.includes(c.resupply?.townProfileName ?? '');
      })
      .map((h) => h.name);
  }
  return [];
}

/**
 * 解析 startTask 的附属配置:
 *   - 非 farm / 没开回城补给 → auxConfigs = null(保持原有启动行为,不影响老流程)
 *   - 开了回城补给 → 必须能解析出城镇档案与挂机地图中文名,解析不出就返回 error 阻止启动
 *     (worker 缺这两样会直接判补给失败,不如在界面上先说清楚)
 */
export function resolveAuxConfigs(config: TaskConfig | null | undefined, history: StoredTaskConfig[]): AuxResolveResult {
  if (!config || config.type !== 'farm' || config.resupply?.enabled !== true) {
    return { ok: true, auxConfigs: null };
  }

  const townProfileName = String(config.resupply.townProfileName ?? '').trim();
  if (!townProfileName) {
    return { ok: false, error: '回城补给已开启,但没有选择城镇档案' };
  }

  const stored = history.find((h) => h.taskType === 'town-profile' && h.name === townProfileName);
  if (!stored || stored.config.type !== 'town-profile') {
    return { ok: false, error: `引用的城镇档案「${townProfileName}」不存在(可能已被删除,请重新选择)` };
  }

  const farmMapName = resolveFarmMapName(config.mapId, config.customMapName);
  if (!farmMapName) {
    return { ok: false, error: '无法确定挂机地图的中文名:请在「地图」里重新选择,或选「自定义...」并填写游戏内地图名' };
  }

  // 对话配方:带上任务名(城镇档案的 NPC 用 recipeName 引用它);旧的 DialogRecipeConfig.npcKind 已弃用
  const recipes: ResupplyRecipe[] = history
    .filter((h) => h.config.type === 'dialog-recipe')
    .map((h) => ({ name: h.name, type: 'dialog-recipe' as const, steps: (h.config as DialogRecipeConfig).steps ?? [] }));

  // 旧档案迁移:npc.kind(已废弃)→ name,避免升级后丢掉游戏内找字用的名字
  const rawTown = stored.config as TownProfileConfig;
  const townProfile: TownProfileConfig = {
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

  // 启动前校验:补给得有事可做 —— 引用的配方必须都存在,且至少有一个 NPC 配了配方
  const referenced = townProfile.npcs.map((n) => (n.recipeName ?? '').trim()).filter(Boolean);
  const missing = [...new Set(referenced.filter((x) => !recipes.some((r) => r.name === x)))];
  if (missing.length > 0) {
    return { ok: false, error: `城镇档案「${townProfileName}」里有 NPC 引用的对话配方不存在:${missing.join('、')}(可能已被删除或改名)` };
  }
  if (referenced.length === 0) {
    return {
      ok: false,
      error: `城镇档案「${townProfileName}」里的 NPC 都没有引用对话配方,回城补给会无事可做(请在档案里给 NPC 选一份配方)`,
    };
  }

  return {
    ok: true,
    auxConfigs: { townProfile, recipes, farmMapName },
  };
}
