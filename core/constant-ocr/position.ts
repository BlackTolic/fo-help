import { COLOR_WHITE } from './color';
import type { WindowSizeKey } from './popup';
import { DEFAULT_FUZZY_SIM, DEFAULT_SIM } from './sim';

type DM_OCR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

// 角色坐标
export const DEFAULT_ROLE_POSITION = {
  '1600*900': { x: 1487, y: 39, w: 64, h: 20 },
  '1280*800': { x: 1167, y: 39, w: 51, h: 17 },
};

/**
 * 地图名文字区域(小地图旁):OCR 读出当前地图名
 * 坐标来源:移植自 ffo-auto-tool(实测值)
 * MapCoordReader 构造时给了分辨率档位且配置里没配 mapNameRoi,就按档位取这里做默认值
 */
export const MAP_NAME_ROI: DM_OCR = {
  '1600*900': { x1: 1458, y1: 0, x2: 1563, y2: 20, color: COLOR_WHITE, sim: DEFAULT_FUZZY_SIM },
  '1280*800': { x1: 1130, y1: 0, x2: 1258, y2: 19, color: COLOR_WHITE, sim: DEFAULT_FUZZY_SIM },
};

// 已锁定怪物名称(怪物被锁定后,HUD 会在该区域显示它的名字;没锁定时为空)
// 大漠绑定窗口客户区相对坐标,各分辨率同一位置(实测 x1:95,y1:109,x2:200,y2:144)
export const DEFAULT_LOCKED_MONSTER_NAME = { x: 95, y: 109, w: 105, h: 35 };
