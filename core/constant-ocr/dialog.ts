// NPC 对话的找字区域常量(NPC 名字为绿色字)
// 坐标来源:NPC_SCAN_BOX / DIALOG_CLOSE_BTN 两档均为 ffo-auto-tool 实测值;
//           DIALOG_OPTIONS_ROI 的 1600*900 为实测值,1280*800 为缩放估算(见 TODO 标注)
// 用法见 core/perception/NpcDialog.ts

import type { WindowSizeKey } from './popup';

/** 找字区域(文字内容不固定,由调用方传入;颜色/相似度按档位配好) */
type DM_FIND_STR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

/** 找 NPC 名字(绿色字)的全屏扫描区 */
export const NPC_SCAN_BOX: DM_FIND_STR = {
  '1600*900': { x1: 144, y1: 2, x2: 1474, y2: 845, color: '00f000-111111', sim: 1.0 },
  '1280*800': { x1: 78, y1: 100, x2: 1208, y2: 713, color: '00f000-111111', sim: 1.0 },
};

/** 对话框关闭钮 '@X' 查找区:用于验证对话已打开 / 关闭对话 */
export const DIALOG_CLOSE_BTN: DM_FIND_STR = {
  '1600*900': { x1: 298, y1: 96, x2: 1223, y2: 663, color: 'b89838-111111', sim: 1.0 },
  '1280*800': { x1: 212, y1: 113, x2: 1074, y2: 574, color: 'b89838-111111', sim: 1.0 },
};

/** 对话框选项文字查找区(选项内容不固定,由调用方传入) */
export const DIALOG_OPTIONS_ROI: DM_FIND_STR = {
  '1600*900': { x1: 450, y1: 109, x2: 1390, y2: 722, color: 'e8f0e8-111111', sim: 1.0 },
  // TODO(标定): 由 1600*900 缩放估算,需用户实测修正
  '1280*800': { x1: 360, y1: 97, x2: 1112, y2: 642, color: 'e8f0e8-111111', sim: 1.0 },
};
