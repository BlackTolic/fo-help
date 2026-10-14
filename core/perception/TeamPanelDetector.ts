// 交友面板状态检测器:Alt+Q 打开面板后,在区域里找「组队」/「解散」两个字
//
// 两个信号(区域/颜色/相似度见 core/constant-ocr/team.ts):
//   ① 找字「组队」→ join:    当前未组队(这两个字就是建队入口)
//   ② 找字「解散」→ disband: 已经在队伍里
//   ③ 都没命中 → OCR 读该区域原文做兜底(整串匹配不上多半是字库缺字/颜色不匹配),
//      原文一并带出便于排查;state 仍是 unknown,调用方按"没看清"处理。
//
// ⚠️ 找字与 OCR 都依赖字库(SetDict 加载的 assets/font/*.txt):字库里没有「组」「队」「解」「散」
//    就会静默不命中(参考 core/constant-ocr/death.ts 顶部关于默认字库缺字的说明),所以不能只留找字一路。
//    颜色描述符是用户实测的 b@282420-141414(b@ = 背景色识别,大漠的 Ocr / FindStr 都支持),原样透传。
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,与 MonsterNameDetector 一致。

import path from 'path';
import type { WindowSizeKey } from '../constant-ocr/popup';
import { TEAM_DISBAND_TEXT, TEAM_JOIN_TEXT, TEAM_PANEL_ROI } from '../constant-ocr/team';
import type { DamooClient } from '../platform/damoo/dm-api';
import type { Point } from '../platform/vision/IVisionProvider';
import { parseTextPos } from '../utils/parse';

/**
 * 交友面板当前状态:
 *   join      = 面板显示「组队」= 未组队,要建队
 *   disband   = 面板显示「解散」= 已在队伍,不用建队
 *   unknown   = 两个字都没看清(找字与 OCR 兜底都没命中)
 */
export type TeamPanelState = 'join' | 'disband' | 'unknown';

export interface TeamPanelDetection {
  state: TeamPanelState;
  /** 命中的文案(找字命中 = 常量文案;OCR 命中 = OCR 原文);unknown 时是 OCR 原文,可能为空串 */
  text: string;
  /** 「组队」的命中坐标(点它建队);只有找字命中才有,OCR 兜底/未命中为 undefined */
  pos?: Point;
  /** 该分辨率档位没有检测区域常量 = 检测不生效(调用方提示一次并跳过,不阻断流程) */
  unsupported: boolean;
}

/**
 * 一次检测:先找字「组队」→ 再找字「解散」→ 都没命中用 OCR 读原文兜底。
 * 返回对象而不是枚举值:把 OCR 原文带出来,实测"为什么一直没命中"时先看它。
 */
export function detectTeamPanelState(client: DamooClient, size: WindowSizeKey): TeamPanelDetection {
  const roi = TEAM_PANEL_ROI[size];
  if (!roi) return { state: 'unknown', text: '', unsupported: true };

  // 截图测试
  client.capturePng(roi.x1, roi.y1, roi.x2, roi.y2, `${path.join(process.cwd(), '/logs')}/team-panel.png`);

  const join = parseTextPos(client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, TEAM_JOIN_TEXT, roi.color, roi.findSim));
  if (join) return { state: 'join', text: TEAM_JOIN_TEXT, pos: join, unsupported: false };

  const disband = parseTextPos(client.findStrE(roi.x1, roi.y1, roi.x2, roi.y2, TEAM_DISBAND_TEXT, roi.color, roi.findSim));
  if (disband) return { state: 'disband', text: TEAM_DISBAND_TEXT, unsupported: false };

  // 兜底:OCR 用同一份颜色描述符读原文,按片段判(找字失败可能是字库缺字)
  const ocr = String(client.ocr(roi.x1, roi.y1, roi.x2, roi.y2, roi.color, roi.ocrSim) || '').trim();
  if (ocr.includes(TEAM_JOIN_TEXT)) return { state: 'join', text: ocr, unsupported: false };
  if (ocr.includes(TEAM_DISBAND_TEXT)) return { state: 'disband', text: ocr, unsupported: false };
  return { state: 'unknown', text: ocr, unsupported: false };
}
