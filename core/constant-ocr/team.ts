// 交友面板(Alt+Q)的检测区域 / 找字文案 / 建队点击坐标常量
// (城镇档案「回城检查项 → 创建队伍」用,配置字段见 shared/types.ts 的 TownProfileConfig.createTeam)
//
// 判据(用户实测):回城后按 Alt+Q 打开交友面板(见 shared/game-hotkeys.ts 的 openFriendPanel),
//   在 TEAM_PANEL_ROI 里找字:
//     「组队」= 当前未组队(那两个字就是"创建队伍"的入口)→ 点它 → 再点 TEAM_CREATE_POS 完成建队;
//     「解散」= 已经在队伍里 → 什么也不用做,直接按 Alt+Q 关掉面板。
//   判定见 core/perception/TeamPanelDetector.ts,补给流程里的用法见
//   electron/workers/game-worker/resupply/team-check.ts。
//
// 坐标来源:1280*800 = 用户实测(区域 1129,697 → 1266,727,宽 137 高 30;建队确认坐标 551,451);
//   1600*900 = 按比例换算(x × 1600/1280,y × 900/800,与 core/constant-ocr/relogin.ts 同一套算法),⚠️ 未实测。
//
// 颜色:用户实测 b@282420-141414,整串原样传给大漠(不要在代码里自己解析)。
//   ⚠️ 前缀 b@ 是大漠的「背景色识别」描述符:在 color_format 最前面加 b@ 表示后面的颜色描述的是
//      文字的背景色,而不是字本身的颜色(见大漠 Ocr 文档示例 "b@ffffff-000000")。用户说的「反选」
//      就是这个意思 —— 这里描述的是这两行文字背后的深色底。b@ 在 Ocr 与 FindStr 系列上都是支持的
//      (FindStr 的颜色说明写的是"多色/差色查找同 Ocr 接口")。
//
// 相似度:用户要求 0.9 → 用 core/constant-ocr/sim.ts 的 DEFAULT_FUZZY_SIM。
// 字库:找字依赖 SetDict 加载的字库文件(worker 默认加载 assets/font/0_ffo.txt,见 bootstrap.ts 的 fontLib),
//   缺字会静默不命中(参考 core/constant-ocr/death.ts 顶部说明)。「组」「队」「解」「散」四个字在默认字库里
//   都有(已核对),但字库可以在设置里换掉,所以检测器仍留了一路 OCR 兜底。

import type { WindowSizeKey } from './popup';
import { DEFAULT_FUZZY_SIM } from './sim';

/** 交友面板里那两个字所在的颜色描述符(用户实测;b@ = 背景色识别,见文件头) */
export const TEAM_PANEL_COLOR = 'b@282420-141414';

/** 一个分辨率档位下的检测区域 + 颜色 + 相似度 */
export interface TeamPanelRoi {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 文字颜色描述符(大漠颜色串) */
  color: string;
  /** 找字的相似度 */
  findSim: number;
  /** OCR 兜底的相似度 */
  ocrSim: number;
}

/**
 * 交友面板上「组队 / 解散」两个字所在的区域(按分辨率档位)
 * 缺档位 = 该分辨率没有实测值,检测不生效,由调用方提示一次并跳过(不阻断补给流程)
 */
export const TEAM_PANEL_ROI: Partial<Record<WindowSizeKey, TeamPanelRoi>> = {
  '1280*800': { x1: 1129, y1: 697, x2: 1266, y2: 727, color: TEAM_PANEL_COLOR, findSim: DEFAULT_FUZZY_SIM, ocrSim: DEFAULT_FUZZY_SIM },
  // 1600*900:按比例推算,未实测(见文件头)
  '1600*900': { x1: 1411, y1: 784, x2: 1583, y2: 818, color: TEAM_PANEL_COLOR, findSim: DEFAULT_FUZZY_SIM, ocrSim: DEFAULT_FUZZY_SIM },
};

/** 面板上「组队」二字:找到它 = 当前未组队(点它建队) */
export const TEAM_JOIN_TEXT = '组队|组|队';

/** 面板上「解散」二字:找到它 = 已经在队伍里(不用建队) */
export const TEAM_DISBAND_TEXT = '解散|解|散';

/**
 * 点掉「组队」之后要点的确认坐标(建队按钮;客户区相对坐标)
 * 缺档位 = 不知道该点哪里,调用方报错并跳过(不阻断补给流程)
 */
export const TEAM_CREATE_POS: Partial<Record<WindowSizeKey, { x: number; y: number }>> = {
  '1280*800': { x: 551, y: 451 },
  // 1600*900:按比例推算,未实测(见文件头)
  '1600*900': { x: 689, y: 507 },
};

/** 面板打开/点击/关闭的等待时间(ms):给面板展开动画、点击生效、面板收起留时间 */
export const TEAM_PANEL_TIMING = {
  /** 按 Alt+Q 打开后等面板展开:用户要求停 2 秒再开始识别 */
  openMs: 2500,
  /** 「点组队」与「点建队确认」这两次点击前后的稳定等待(移到坐标后 / 点完之后):用户要求 500ms */
  clickMs: 500,
  /** 按 Alt+Q 关闭后等面板收起 */
  closeMs: 200,
  /**
   * 一次检查里最多"按 Alt+Q + 扫描"几次:网速慢时按了快捷键可能没能立刻生效(面板还没出来),
   * 没读到任何文案就隔 retryOpenMs 再按一次重扫 —— 用户要求:2 秒后重试,一共 3 次
   */
  detectAttempts: 3,
  /** 上一条里"重按 Alt+Q 并重扫"之前的间隔(ms):用户要求 2 秒 */
  retryOpenMs: 2000,
};
