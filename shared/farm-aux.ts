// 挂机辅助配置的触发点表(界面下拉/多选 与 worker 侧过滤共用同一份)
// 类型 FarmAuxTrigger 与各辅助配置的字段见 shared/types.ts;这里只放"触发点有哪些 + 怎么显示"

import type { FarmAuxTrigger } from './types';

/** 一个触发点的界面描述 */
export interface FarmAuxTriggerOption {
  id: FarmAuxTrigger;
  /** 界面上的名字 */
  label: string;
  /** 界面上的说明(这个时机到底发生在什么时候) */
  hint: string;
}

/** 全部触发点(顺序 = 界面上的展示顺序) */
export const FARM_AUX_TRIGGERS: FarmAuxTriggerOption[] = [
  {
    id: 'afterReturn',
    label: '回城/小退后重新进入时',
    hint: '回城(含小退)后重新站回挂机图时触发(任务启动那次不算,那次走「进入挂机地图时」)',
  },
  {
    id: 'enterFarmMap',
    label: '进入挂机地图时',
    hint: '检测到换图、且当前图就是挂机图时触发(每次进图一次)',
  },
  {
    id: 'firstFarmSpot',
    label: '进入第一个挂机点时',
    hint: '每一轮打怪走到第一个挂机点时触发(每圈一次)',
  },
  {
    id: 'roundEnd',
    label: '每一轮自动打怪结束时',
    hint: '本圈路径点全部走完时触发(死亡/背包满提前结束的圈不触发)',
  },
];

/** 触发点 id → 界面名字(日志/提示用) */
export function farmAuxTriggerLabel(id: FarmAuxTrigger): string {
  return FARM_AUX_TRIGGERS.find((t) => t.id === id)?.label ?? id;
}
