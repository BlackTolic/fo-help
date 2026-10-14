// 小退回城(Alt+O → 选择角色界面 → 再上线)的点击坐标与判据区域常量
//
// 判据(用户实测):按 Alt+O → 点「选择角色」(640,374) → 停 3 秒 → 识别到 (325,726)-(468,773) 的
//   「保护未成年人健康」= 已进入选择角色界面 → 按 Enter 回到游戏 → 能读到地图名/坐标后点掉「游戏IP登录提示」。
// 流程见 electron/workers/game-worker/relogin.ts,文案检测见 core/perception/CharacterSelectDetector.ts。
//
// 坐标来源:用户没声明分辨率,(640,374) 与区域都按 1280*800 基准处理;
//   1600*900 = 按比例换算(x × 1600/1280,y × 900/800),⚠️ 未实测。
// 颜色:用户没说 → 用「不限颜色」FFFFFF-FFFFFF(主色白 + 偏色 FF = 每通道全容差,匹配任意颜色),
//   同 farm.ts 的 DEFAULT_MONSTER_COLOR / ItemNameDetector 的 ANY_COLOR。
// 字库:文案用到的字在默认字库 assets/font/0_ffo.txt 里都有(已核对),找字不必额外换字库。

import type { WindowSizeKey } from './popup';
import { DEFAULT_FUZZY_SIM, DEFAULT_SIM } from './sim';

/** 一个分辨率档位下的判据区域 + 相似度 */
export interface ReloginHintRoi {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 找字的相似度 */
  findSim: number;
  /** OCR 兜底的相似度(OCR 比找字松一点) */
  ocrSim: number;
}

/** 「保护未成年人健康」文案区域(选择角色界面;缺档位 = 检测不生效,由调用方报错/提示) */
export const RELOGIN_HINT_ROI: Partial<Record<WindowSizeKey, ReloginHintRoi>> = {
  '1280*800': { x1: 325, y1: 726, x2: 468, y2: 773, findSim: DEFAULT_SIM, ocrSim: DEFAULT_FUZZY_SIM },
  // 1600*900:按比例推算,未实测(见文件头)
  '1600*900': { x1: 406, y1: 817, x2: 585, y2: 870, findSim: DEFAULT_SIM, ocrSim: DEFAULT_FUZZY_SIM },
};

/** 找字文案(选择角色界面上的提示文字) */
export const RELOGIN_HINT_TEXT = '保护未成年人健康';

/** OCR 兜底片段(整串匹配不上时按片段判) */
export const RELOGIN_HINT_OCR_KEYWORDS = ['未成年人', '健康'];

/** 「选择角色」菜单项的点击坐标(Alt+O 打开的系统菜单里;缺档位 = 不知道该点哪里,调用方报错退出) */
export const RELOGIN_SELECT_CHAR_POS: Partial<Record<WindowSizeKey, { x: number; y: number }>> = {
  '1280*800': { x: 640, y: 374 },
  // 1600*900:按比例推算,未实测
  '1600*900': { x: 800, y: 421 },
};

/**
 * 上线后「游戏IP登录提示」的关闭点击坐标:回到游戏、能读到地图名/坐标之后点一下把它关掉。
 * 这条提示不是每次都有 —— 点不到也不影响后续(只记日志);缺档位 = 跳过这一步。
 */
export const RELOGIN_CLOSE_IP_TIP_POS: Partial<Record<WindowSizeKey, { x: number; y: number }>> = {
  '1280*800': { x: 644, y: 431 },
  // 1600*900:按比例推算,未实测
  '1600*900': { x: 805, y: 485 },
};
