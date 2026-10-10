// 死亡检测器:判断角色是否死亡 + 定位「原地复活」按钮
//
// 两个信号(命中其一即算死亡,区域常量见 core/constant-ocr/death.ts):
//   1) 找字「原地复活」(主判据) → 命中即死亡,顺带给出按钮坐标(可直接点击复活)
//      移植自 ffo-auto-tool 的 utils/ocr-check/base.ts isDeadCYPos
//   2) OCR「死亡」标题(兜底)   → 只在字库含「死/亡」时才可能命中,拿不到按钮坐标
//      移植自同文件的 isDeadPos
// 默认字库(assets/font/0_ffo.txt)没有「死」「亡」,所以真正起作用的是信号 1;详见 death.ts 的文件头注释。
//
// ⚠️ 坐标解析:dm 的 FindStrFastE 返回 "序号|x|y"、FindStrFastEx 返回 "序号,x,y|序号,x,y"(见 dm-api),
//    坐标都在第 2、3 个数上 → 必须用 parseTextPos,不能和找色的 "x|y" 混用 parseFindColor。
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import { DEAD_TEXT_ROI, DEAD_TITLE_TEXT, REVIVE_TEXT, REVIVE_TEXT_ROI } from '../constant-ocr/death';
import type { WindowSizeKey } from '../constant-ocr/popup';
import type { DamooClient } from '../platform/damoo/dm-api';
import type { Point } from '../platform/vision/IVisionProvider';
import { parseTextPos } from '../utils/parse';

/** 命中的是哪个信号(日志/排错用) */
export type DeathSignal = 'revive-text' | 'dead-title';

export interface DeathDetection {
  dead: boolean;
  /** 死亡时:「原地复活」按钮坐标;只有 OCR 兜底命中(信号 2)时拿不到,为 undefined */
  revive?: Point;
  /** 命中的信号;没死时为 null */
  via: DeathSignal | null;
}

/**
 * 一次判定死亡并(尽量)拿到复活按钮坐标:
 *   先找字「原地复活」(命中即有坐标)→ 没命中再 OCR「死亡」标题兜底。
 * 调用方(打怪循环 / 回城补给)只需要这一个入口,不用先判死再单独找按钮。
 */
export function detectDeath(client: DamooClient, size: WindowSizeKey): DeathDetection {
  // 1) 主判据:找字「原地复活」。坐标解析成功才算命中 —— dm 没找到时返回空串(或 "-1|-1|-1"),两种都解析成 null
  const find = REVIVE_TEXT_ROI[size];
  const revive = parseTextPos(client.findStrE(find.x1, find.y1, find.x2, find.y2, REVIVE_TEXT, find.color, find.sim));
  if (revive) return { dead: true, revive, via: 'revive-text' };

  // 2) 兜底:标题 OCR(默认字库读不出「死亡」,换字库后才有意义)
  const title = DEAD_TEXT_ROI[size];
  const text = String(client.ocr(title.x1, title.y1, title.x2, title.y2, title.color, title.sim) || '');
  if (text.includes(DEAD_TITLE_TEXT)) return { dead: true, via: 'dead-title' };

  return { dead: false, via: null };
}

/** 角色是否已死亡(两个信号命中其一即算;打怪循环的退出条件用) */
export function isDead(client: DamooClient, size: WindowSizeKey): boolean {
  return detectDeath(client, size).dead;
}
