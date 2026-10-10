// 死亡判定的识别区域常量(两个信号,判定流程见 core/perception/DeathDetector.ts)
//
// 信号 1 = 找字「原地复活」(主判据):移植自 ffo-auto-tool 的 DEFAULT_DEAD_CY + isDeadCYPos。
//   命中即算死亡,命中坐标就是复活按钮位置(可直接点)。
//   ⚠️ 为什么不用「死亡」标题当主判据:大漠找字只比对待查字符串里出现过的那些字,
//      而 QQ幻想 默认字库(assets/font/0_ffo.txt)里有「原地复活」四个字、没有「死」「亡」——
//      标题 OCR 读出来永远不含「死亡」二字,找字「原地复活」才判得出来。
// 信号 2 = OCR「死亡」标题(兜底):移植自 ffo-auto-tool 的 DEFAULT_DEAD + isDeadPos。
//   只在字库含「死/亡」(例如把字库换成 assets/font/1_cn.txt)时才可能命中,命中时拿不到按钮坐标。
//
// 坐标来源:
//   1600*900 = ffo-auto-tool 实测值。
//   1280*800 = 本工程实测:死亡弹框落在 (454,331)-(827,471)。
//     (两个档位弹框尺寸基本相同、且都居中 —— 1600*900 中心 (806,455)、1280*800 中心 (640,401) 都是窗口中心,
//      所以这块弹框区在两档之间不能用等比缩放换算,必须各自实测。)
//     两个信号都用这一块:左右各留 15px、上下各留 10px 余量,防量出来的边界贴着按钮文字。
//     ⚠️ 别照抄旧工程的 1280*800 数值(DEFAULT_DEAD / DEFAULT_DEAD_CY):那是另一套弹框布局,与本工程窗口对不上。

import type { WindowSizeKey } from './popup';
import type { FarmReviveMode } from '../../shared/types';

type DM_OCR = Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>;

/** 死亡弹框上的「原地复活」按钮文字(找字用) */
export const REVIVE_TEXT = '原地复活';

/**
 * 「原地复活」按钮文字的找字区域:findStr 命中即角色死亡,命中坐标(文字左上角)就是按钮位置
 */
export const REVIVE_TEXT_ROI: DM_OCR = {
  '1600*900': { x1: 622, y1: 373, x2: 990, y2: 537, color: 'e8f0e8-111111', sim: 1.0 },
  '1280*800': { x1: 439, y1: 321, x2: 842, y2: 481, color: 'e8f0e8-111111', sim: 1.0 },
};

/** 死亡弹框标题文字(OCR 兜底用) */
export const DEAD_TITLE_TEXT = '死亡';

/**
 * 死亡弹框「死亡」标题的 OCR 区域(兜底信号:默认字库读不出这两个字,主判据是上面的找字)
 */
export const DEAD_TEXT_ROI: DM_OCR = {
  '1600*900': { x1: 707, y1: 377, x2: 891, y2: 541, color: 'a8a8b0-111111', sim: 1.0 },
  // 1280*800:标题在弹框里的位置没实测,就直接 OCR 整块弹框找「死亡」二字(区域只有百来像素高,OCR 不吃力)
  '1280*800': { x1: 439, y1: 321, x2: 842, y2: 481, color: 'a8a8b0-111111', sim: 1.0 },
};

/** 复活方式的中文名(日志/UI 展示用) */
export const REVIVE_MODE_LABEL: Record<FarmReviveMode, string> = {
  immediate: '立即复活',
  huihun: '回魂娃娃',
  tishen: '替身娃娃',
};

/**
 * 复活按钮的点击坐标(窗口客户区相对坐标,三个按钮在弹框里竖直排列)
 *
 * ⚠️ 1600*900 未实测:弹框虽居中但两档尺寸"基本相同"、不能等比缩放(见文件头),所以这里不填 ——
 *    调用方(reviveCharacter)读不到当前分辨率就报错结束,而不是拿别的档位的坐标乱点
 *    (点错可能触发「彩玉复活」这类消耗付费道具的按钮)。
 *    用到 1600*900 时按 ffo-auto-tool / 实测补齐这一项即可。
 */
export const REVIVE_BUTTON_POS: Partial<Record<WindowSizeKey, Record<FarmReviveMode, { x: number; y: number }>>> = {
  // 1280*800 实测:三个按钮都在 x≈635,从上到下 y = 365 / 402 / 437
  '1280*800': {
    immediate: { x: 635, y: 365 },
    tishen: { x: 635, y: 402 },
    huihun: { x: 635, y: 437 },
  },
};

/**
 * 点复活按钮前先点掉的「彩玉」勾选(客户区相对坐标):
 * 不点掉的话默认会用彩玉复活(消耗付费道具),所以每个复活方式都先点这里再点对应按钮
 */
export const REVIVE_CANCEL_CASH_POS: Partial<Record<WindowSizeKey, { x: number; y: number }>> = {
  '1280*800': { x: 735, y: 442 },
};
