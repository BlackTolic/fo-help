// 弹框(验证码 / 组队邀请等)的大漠识别区域常量
// 坐标来源:移植自 ffo-auto-tool 的 constant/OCR-pos.ts(实测值)
// 按窗口客户区分辨率分档,与 DEFAULT_ROLE_POSITION 同风格

import { DEFAULT_SIM } from './position';

/** 支持的游戏窗口客户区分辨率 */
export type WindowSizeKey = '1280*800' | '1600*900';

/**
 * 神医验证码弹框标题「神医问题来啦」的搜索区域(找字,红色)
 * findStr 命中即说明验证码弹框出现,命中坐标作为后续截图/点击的锚点
 */
export const VERIFY_CODE_TITLE: Record<
  WindowSizeKey,
  {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    text: string;
    color: string;
    sim: number;
  }
> = {
  '1600*900': {
    x1: 0,
    y1: 113,
    x2: 1598,
    y2: 835,
    text: '神医问题来啦',
    color: 'e80000-111111',
    sim: DEFAULT_SIM,
  },
  '1280*800': {
    x1: 12,
    y1: 116,
    x2: 1267,
    y2: 730,
    text: '神医问题来啦',
    color: 'e80000-111111',
    sim: DEFAULT_SIM,
  },
};

/**
 * 验证码问题/选项截图区域(相对标题锚点的偏移)
 * 问题 = 算术/常识题文本;选项 = 上中下三个候选答案
 */
export const VERIFY_CODE_CAPTURE = {
  /** 问题区(相对锚点) */
  question: { dx1: 0, dy1: 60, dx2: 100, dy2: 130 },
  /** 选项区(相对锚点) */
  options: { dx1: 200, dy1: 30, dx2: 250, dy2: 110 },
};

/** 三个选项(I/II/III,从上到下)的点击位置(相对标题锚点的偏移) */
export const VERIFY_CODE_OPTION_CLICK_OFFSET: Record<'I' | 'II' | 'III', { x: number; y: number }> =
  {
    I: { x: 182, y: 45 },
    II: { x: 182, y: 65 },
    III: { x: 182, y: 85 },
  };

/** 队伍邀请弹框的 OCR 区域(识别「邀请组队」类文案) */
export const INVITE_TEAM_ROI: Record<
  WindowSizeKey,
  {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    color: string;
    sim: number;
  }
> = {
  '1600*900': {
    x1: 726,
    y1: 343,
    x2: 856,
    y2: 366,
    color: 'b89868-111111|806430-111111|a08040-111111',
    sim: DEFAULT_SIM,
  },
  // 参考工程两个分辨率用的是同一组坐标(弹框位置不随窗口尺寸变化),先用同一组;不对再实测改
  '1280*800': {
    x1: 726,
    y1: 343,
    x2: 856,
    y2: 366,
    color: 'b89868-111111|806430-111111|a08040-111111',
    sim: DEFAULT_SIM,
  },
};

/** 邀请组队弹框的「拒绝」按钮位置(绝对屏幕坐标,关闭弹框用) */
export const INVITE_TEAM_REJECT_POS: Record<WindowSizeKey, { x: number; y: number }> = {
  '1600*900': { x: 870, y: 573 },
  '1280*800': { x: 870, y: 573 },
};

/** 邀请组队弹框的「同意」按钮位置(绝对屏幕坐标,预留:以后要自动进队时直接用) */
export const INVITE_TEAM_AGREE_POS: Record<WindowSizeKey, { x: number; y: number }> = {
  '1600*900': { x: 738, y: 573 },
  '1280*800': { x: 738, y: 573 },
};
