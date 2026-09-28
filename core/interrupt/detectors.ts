// 内置检测器(大漠找字/找色/OCR,同步快调用)
// 坐标常量:弹框见 core/constant-ocr/popup.ts,血条/经验条见 core/constant-ocr/status.ts
// (均移植自 ffo-auto-tool 实测值)

import { dmApi } from '../platform/damoo/dm-api';
import type { Point } from '../platform/vision/IVisionProvider';
import { VERIFY_CODE_TITLE, INVITE_TEAM_ROI, type WindowSizeKey } from '../constant-ocr/popup';
import { BLOOD_STATUS_ROI, EXP_BAR_ROI, FIND_COLOR_DIR } from '../constant-ocr/status';
import type { PopupDetector, PopupMatch } from './types';
// ⚠️ 必须用相对路径:worker/core 是 tsc 直出 CommonJS,没有打包器改写别名,
//   写成 '@core/utils/parse' 会在 worker require 阶段直接 MODULE_NOT_FOUND 崩掉(code=1)
import { parseFindColor, parseTextPos } from '../utils/parse';

/**
 * 验证码弹框出现后等待动画结束的时间(毫秒)
 * 弹框刚弹出时标题还在移动,此时的命中坐标不能用于截图/点击,必须等它停下来
 */
const VERIFY_CODE_SETTLE_MS = 5000;

/**
 * 连续未命中的容忍次数:弹框动画期间标题可能短暂找不到,
 * 连续这么多次都没命中才认为弹框已消失,放弃本次等待
 */
const VERIFY_CODE_MISS_TOLERANCE = 2;

/**
 * 神医验证码弹框检测
 * 在窗口中下部区域找红色标题「神医问题来啦」。
 *
 * 弹框刚弹出时整体在移动,所以首次命中不直接返回:
 *   命中 → 记下等待起点并返回 null(看门狗继续按 intervalMs 轮询)
 *   → 等待 VERIFY_CODE_SETTLE_MS 后重新找一次字,以这一次的坐标为锚点返回。
 * 等待期间弹框消失(连续未命中)则清空等待状态,下次出现重新计时。
 *
 * detect() 是同步调用,这里只比对时间戳、不 sleep:等待不阻塞看门狗轮询,
 * 也不阻塞任务主循环。因此实际稳定时间 = 5s + 最多一个轮询间隔(默认 700ms)。
 */
export function createVerifyCodeDetector(sizeKey: WindowSizeKey): PopupDetector {
  const conf = VERIFY_CODE_TITLE[sizeKey];
  const findTitle = (): Point | null =>
    parseTextPos(dmApi.findStrFastE(conf.x1, conf.y1, conf.x2, conf.y2, conf.text, conf.color, conf.sim));

  /** 本次等待弹框稳定的起点;null = 当前没有在等待 */
  let settleSince: number | null = null;
  /** 等待期间连续未命中的次数 */
  let missCount = 0;

  return {
    detect(): PopupMatch | null {
      const hit = findTitle();
      if (!hit) {
        // 已在等待中且持续找不到 → 弹框已经关了,重置等待状态
        if (settleSince !== null && ++missCount >= VERIFY_CODE_MISS_TOLERANCE) {
          settleSince = null;
          missCount = 0;
        }
        return null;
      }
      missCount = 0;

      const now = Date.now();
      if (settleSince === null) {
        // 首次命中:弹框还在移动,先记下起点,等它稳定
        settleSince = now;
        return null;
      }
      if (now - settleSince < VERIFY_CODE_SETTLE_MS) return null;

      // 稳定时间到:重新识别一次,以这次的坐标为锚点(弹框动画结束后的最终位置)
      settleSince = null;
      const settled = findTitle();
      if (!settled) {
        // 重新识别时又没找到,当作一次新出现,从头等待
        settleSince = now;
        return null;
      }
      return { type: 'verify-code', anchor: settled };
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

/** 找色区域的中心(作为 match 锚点;血条/经验条不点击弹框,锚点只用于日志) */
function roiCenter(x1: number, y1: number, x2: number, y2: number): Point {
  return { x: Math.round((x1 + x2) / 2), y: Math.round((y1 + y2) / 2) };
}

/**
 * 血条见底检测(生命回复用)
 * 区域内找不到黄/绿色 = 血量进入危险状态 → 返回匹配
 *
 * @param isHealReady 可选:判断"是否还有 CD 就绪的回血物品";返回 false 时本次不触发,
 *   避免物品全在冷却中还反复触发 handler(handler 里仍会再判断一次)
 */
export function createBloodStatusDetector(sizeKey: WindowSizeKey, isHealReady?: () => boolean): PopupDetector {
  const conf = BLOOD_STATUS_ROI[sizeKey];
  return {
    detect(): PopupMatch | null {
      // 找到黄/绿色 = 血量安全(findColor 返回 'x|y',没找到返回空串)
      const found = dmApi.findColorE(conf.x1, conf.y1, conf.x2, conf.y2, conf.color, conf.sim);
      const pos = parseFindColor(found);
      // pos有值，代表血量安全
      if (pos) return null;
      // 没有CD就绪的回血物品
      if (isHealReady && !isHealReady()) return null;
      // 有CD就绪的回血物品且血量不安全
      return {
        type: 'heal',
        anchor: roiCenter(conf.x1, conf.y1, conf.x2, conf.y2),
      };
    },
  };
}

/**
 * 经验条快满检测(角色停级用)
 * 区域内找到绿色 = 经验条快满(即将升级)→ 返回匹配,由 handler 停止自动打怪
 */
export function createExpBarDetector(sizeKey: WindowSizeKey): PopupDetector {
  const conf = EXP_BAR_ROI[sizeKey];
  return {
    detect(): PopupMatch | null {
      const found = dmApi.findColorE(conf.x1, conf.y1, conf.x2, conf.y2, conf.color, conf.sim);
      const pos = parseFindColor(found);
      if (!pos) return null;
      return { type: 'stop-level-up', anchor: pos };
    },
  };
}
