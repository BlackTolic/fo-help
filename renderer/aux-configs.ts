// 启动任务时把「回城补给」引用的配置解析成完整 auxConfigs(见 shared/types.ts 的 StartTaskAuxConfigs)
//
// worker 侧约定(见 electron/workers/game-worker/resupply/resupply-runner.ts):
//   auxConfigs.townProfile  城镇档案整份下发给 worker(从 taskHistory 里按名字取)
//   auxConfigs.recipes      全部对话配方(worker 按 npcKind='item-merchant' 自己挑)
//   auxConfigs.farmMapName  farm 挂机地图的中文名(worker 用它匹配 exits[].toMap 找回家的出口)
//
// 解析入口:WindowCard 的 handleTaskSaved / handleHistorySelect / pending 状态的「启动」按钮

import type {
  DialogRecipeConfig,
  FarmTaskConfig,
  StartTaskAuxConfigs,
  StoredTaskConfig,
  TaskConfig,
  TownProfileConfig,
} from '../shared/types';
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
 *   - dialog-recipe:回城补给只按 npcKind='item-merchant' 取配方,所以只有它是这个 kind 时才算被引用
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
  if (stored.config.type === 'dialog-recipe' && (stored.config as DialogRecipeConfig).npcKind === 'item-merchant') {
    return farmTasks.filter((h) => (h.config as FarmTaskConfig).resupply?.enabled === true).map((h) => h.name);
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

  const recipes = history.filter((h) => h.config.type === 'dialog-recipe').map((h) => h.config as DialogRecipeConfig);

  return {
    ok: true,
    auxConfigs: {
      townProfile: stored.config as TownProfileConfig,
      recipes,
      farmMapName,
    },
  };
}
