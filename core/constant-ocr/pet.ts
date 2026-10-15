// 宠物相关的大漠识别区域常量(骑乘 + 宠物带练)
// 坐标来源:骑乘部分移植自 ffo-auto-tool 的 constant/OCR-pos.ts(DEFAULT_PET_ACTIVE,实测值);
// 带练部分的宠物列表区域为用户在 1280*800 上实测,1600*900 未实测(见各常量上的 ⚠️)
// 按窗口客户区分辨率分档,与 DEFAULT_ROLE_POSITION 同风格

import { DEFAULT_FUZZY_SIM, DEFAULT_SIM } from './sim';
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

// ===== 宠物带练(在宠物面板里看宠物列表 / 读当前宠物等级) =====
// 面板开关走游戏快捷键 Alt+P(见 shared/game-hotkeys.ts 的 openPetPanel),不用点击坐标。
// 下面的区域/颜色/找字字串:1280*800 为用户实测值;1600*900 未实测 —— 缺档位时调用方
// (electron/workers/game-worker/pet-training.ts)按"提示一次并跳过"处理,不猜坐标。

/**
 * 宠物列表的识别区域(客户区相对坐标):每只宠物在这里显示名字,名字旁边带状态字。
 * 找字结果按 y 再 x 排序 = 列表从上到下 / 从左到右的顺序。
 * 来源:用户实测(1280*800:453,428→653,507,即 200×79)
 */
export const PET_LIST_ROI: Partial<Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number }>> = {
  '1280*800': { x1: 453, y1: 428, x2: 653, y2: 507 },
};

/**
 * 宠物列表里的状态找字:已出战(激活)= 醒,睡眠 = 睡。
 * 规则(实测):同一时刻最多只有 1 只宠物是醒的 —— 双击睡眠的那只会让它醒、原来醒的那只自动变睡眠;
 * 所以「第 k 只是醒的」= 前 k-1 只都已经练好了(出战序号本身就是带练进度,见 pet-training.ts)。
 *
 * ⚠️ 两个串都带 @ —— 这是实测能命中的写法。仓库字库(assets/font/0_ffo.txt)里「醒」那条的标签
 * 没带 @,但别照字库标签改回来(实测按带 @ 的串找得到)。换宠物要用大漠综合工具重新抓字并在这里改名字。
 */
export const PET_LIST_AWAKE = { color: '08fcf8-111111', text: '@魂之精醒' };
export const PET_LIST_ASLEEP = { color: '0098e0-111111', text: '@魂之精睡' };

/** 宠物列表找字的相似度 */
export const PET_LIST_SIM = DEFAULT_FUZZY_SIM;

/**
 * 双击切换宠物时的落点偏移(加在找字命中的「宠物名字」位置上)。
 * 默认 0,0 = 直接点在识别到的名字文字上;若实测发现要点宠物头像/名字左边,在这里补偏移 ⚠️ 待实测
 */
export const PET_LIST_CLICK_OFFSET: Record<WindowSizeKey, { x: number; y: number }> = {
  '1600*900': { x: 0, y: 0 },
  '1280*800': { x: 0, y: 0 },
};

/**
 * 宠物信息(等级 / 饥渴 / 信赖)的 OCR 区域 + 颜色(客户区相对坐标)
 * 来源:移植 ffo-auto-tool 的 DEFAULT_PET_INFO ⚠️ 本工程未实测
 */
export const PET_INFO_ROI: Partial<Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>> =
  {
    '1600*900': { x1: 714, y1: 148, x2: 800, y2: 206, color: 'c09438-111111|c09418-111111|e8f0e8-111111', sim: DEFAULT_SIM },
    '1280*800': { x1: 558, y1: 147, x2: 652, y2: 211, color: 'c09438-111111|c09418-111111|e8f0e8-111111', sim: DEFAULT_SIM },
  };

/**
 * 宠物技能名显示的区域(用于「带练到学会某个技能就换下一只」的判据)⚠️ 未实测,暂时留空:
 * 配了「目标技能」但这里没有当前分辨率的档位时,pet-training 会提示一次并只按等级判据处理
 */
export const PET_SKILL_ROI: Partial<Record<WindowSizeKey, { x1: number; y1: number; x2: number; y2: number; color: string; sim: number }>> =
  {};

/** 宠物带练的等待(ms):打开面板后等它渲染 / 切换宠物后等它生效 */
export const PET_TRAINING_TIMING = {
  /** 按下 Alt+P 后等面板出现 */
  panelSettleMs: 1000,
  /** 切换宠物(双击)后等它切过去 */
  switchSettleMs: 800,
  /** 每次找字/OCR 之间的间隔 */
  pollMs: 300,
};
