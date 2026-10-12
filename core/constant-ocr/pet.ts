// 宠物骑乘相关的大漠识别区域常量
// 坐标来源:移植自 ffo-auto-tool 的 constant/OCR-pos.ts(DEFAULT_PET_ACTIVE,实测值)
// 按窗口客户区分辨率分档,与 DEFAULT_ROLE_POSITION 同风格

import { DEFAULT_SIM } from './sim';
import type { WindowSizeKey } from './popup';

type DM_OCR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

/**
 * 宠物是否激活的 OCR 区域(参考 ffo-auto-tool 的 checkPetActive):
 * 没有宠物时这里显示「暂时没有宠物」,读到别的内容视为已激活
 */
export const PET_ACTIVE_ROI: DM_OCR = {
  '1600*900': { x1: 82, y1: 67, x2: 169, y2: 105, color: 'e8c020-111111', sim: DEFAULT_SIM },
  '1280*800': { x1: 48, y1: 65, x2: 173, y2: 106, color: 'e8c020-111111', sim: DEFAULT_SIM },
};

/** 未激活宠物的提示文字(OCR 读到它 = 没有激活宠物) */
export const PET_INACTIVE_TEXT = '暂时没有宠物';

/**
 * 激活宠物的双击位置(客户区相对坐标;宠物面板里的宠物头像)
 * 宠物面板的打开/关闭走快捷键 Alt+P(见 shared/game-hotkeys.ts 的 openPetPanel),不再用点击坐标。
 * 1280*800 为实测值;1600*900 暂用参考工程的值(未实测,按需调整)
 */
export const PET_ACTIVATE_POS: Record<WindowSizeKey, { x: number; y: number }> = {
  '1600*900': { x: 627, y: 454 },
  '1280*800': { x: 473, y: 450 },
};

/** 骑乘提示字样出现的区域(客户区相对坐标) */
export const PET_MOUNT_TEXT_ROI = { x1: 401, y1: 94, x2: 849, y2: 462 };

/** 骑乘提示字样的颜色(大漠颜色格式) */
export const PET_MOUNT_TEXT_COLOR = '000400-111111';

/** 证明已经骑上的提示字样(找字,命中任一即算骑上) */
export const PET_MOUNT_TEXTS = ['飞毛腿来啦', '骑驴看唱板儿'];
