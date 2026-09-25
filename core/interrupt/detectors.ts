// 内置弹框检测器(大漠找字/OCR,同步快调用)
// 坐标常量见 core/constant-ocr/popup.ts(移植自 ffo-auto-tool 实测值)

import { dmApi } from '../platform/damoo/dm-api';
import type { Point } from '../platform/vision/IVisionProvider';
import { VERIFY_CODE_TITLE, INVITE_TEAM_ROI, type WindowSizeKey } from '../constant-ocr/popup';
import type { PopupDetector, PopupMatch } from './types';
// ⚠️ 必须用相对路径:worker/core 是 tsc 直出 CommonJS,没有打包器改写别名,
//   写成 '@core/utils/parse' 会在 worker require 阶段直接 MODULE_NOT_FOUND 崩掉(code=1)
import { parseTextPos } from '../utils/parse';

/**
 * 神医验证码弹框检测
 * 在窗口中下部区域找红色标题「神医问题来啦」,命中即返回锚点
 */
export function createVerifyCodeDetector(sizeKey: WindowSizeKey): PopupDetector {
  const conf = VERIFY_CODE_TITLE[sizeKey];
  return {
    detect(): PopupMatch | null {
      const result = dmApi.findStrFastE(
        conf.x1,
        conf.y1,
        conf.x2,
        conf.y2,
        conf.text,
        conf.color,
        conf.sim,
      );
      const anchor = parseTextPos(result);
      if (!anchor) return null;
      return { type: 'verify-code', anchor };
    },
  };
}

/**
 * 队伍邀请弹框检测
 * OCR 邀请弹框标题区域,文本同时含「邀」「伍」即认为有组队邀请
 */
export function createTeamInviteDetector(sizeKey: WindowSizeKey): PopupDetector {
  const conf = INVITE_TEAM_ROI[sizeKey];
  return {
    detect(): PopupMatch | null {
      const text = dmApi.ocr(conf.x1, conf.y1, conf.x2, conf.y2, conf.color, conf.sim);
      if (!text || !text.includes('邀') || !text.includes('伍')) return null;
      return {
        type: 'team-invite',
        anchor: { x: Math.round((conf.x1 + conf.x2) / 2), y: Math.round((conf.y1 + conf.y2) / 2) },
      };
    },
  };
}
