// 装备耐久检测的找色区域常量
// 坐标来源:移植自 ffo-auto-tool(实测值)
// 用法:打开人物(状态)面板(Alt+C)后,装备槽区域能找到红 = 有装备耐久见底(需要修理/补给)
// 判定流程见 core/perception/EquipDamageDetector.ts

import type { WindowSizeKey } from './popup';

type DM_FIND_COLOR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

/**
 * 装备槽区域:人物(状态)面板(Alt+C)打开后,区域内找到红 = 有装备耐久见底
 * (只看颜色不看具体数值:耐久见底的装备槽会标红)
 */
export const EQUIP_DAMAGE_ROI: DM_FIND_COLOR = {
  '1600*900': { x1: 1085, y1: 577, x2: 1181, y2: 692, color: 'd85030-111111', sim: 1.0 },
  '1280*800': { x1: 888, y1: 574, x2: 983, y2: 689, color: 'd85030-111111', sim: 1.0 },
};
