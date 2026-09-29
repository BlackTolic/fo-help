// 物品名称识别器(物品拾取用)
//
// 一条拾取规则(rule)=「颜色(可多选)+ 物品名(可空)」,规则之间是「或」,按顺序找,先命中的先捡:
//   1) 只勾颜色、名称留空   = 这个颜色的所有物品都要
//      → 找色(FindColorE)拿坐标,不读文字(需求就是"只根据颜色查坐标")
//   2) 勾了颜色 + 填了名称  = 只捡这些颜色的文字里叫这些名字的
//      → 找字(FindStrFastEx):大漠的找字本来就是「在指定颜色的像素上匹配文字」,
//        一条调用同时约束「颜色 + 文字」,坐标也直接给
//   3) 没勾颜色 + 填了名称  = 不限颜色,按名称找字(颜色用 ANY_COLOR)
//   例:所有紫色装备 + 蓝色里只捡「无极剑」
//       = [{ colors: [紫] }, { colors: [蓝], nameKeywords: ['无极剑'] }]
//
// ⚠️ 大漠的 Ocr(x1,y1,x2,y2,color,sim) 只返回文字、不返回坐标,而且中文同样依赖字库(SetDict)——
//   所以"拿坐标"这件事只能靠找字/找色,OCR 拿不到坐标。
//
// 「物品名字消失 = 拾取完成」的判定见 isStillThereNear():只看点击点周围一小块,
// 而且用命中的那条规则去查(旁边那件紫色装备还在,不代表蓝色无极剑没捡走)。

import { parseFindColor, parseTextPos } from '../utils/parse';
import { dmApi } from '../platform/damoo/dm-api';
import type { Point, Rect } from '../platform/vision/IVisionProvider';

/** 「不限颜色」用的大漠颜色串:主色白 + 偏色 FF(每通道全容差)= 匹配任意颜色 */
const ANY_COLOR = 'FFFFFF-FFFFFF';

/** 大漠颜色串:多色用 '|' 拼(任一颜色命中即算);空数组 = 任意色 */
function colorSpec(colors: string[]): string {
  const list = colors.map((c) => String(c ?? '').trim()).filter(Boolean);
  return list.length > 0 ? list.join('|') : ANY_COLOR;
}

/** 一条拾取规则(解析后的形态,字段必有) */
export interface ItemPickupRule {
  /** 这条规则的颜色(大漠颜色格式;空 = 不限颜色) */
  colors: string[];
  /** 这条规则的物品名(空 = 这个颜色的所有物品都要,不匹配文字) */
  nameKeywords: string[];
}

export interface ItemDetectorConfig {
  /** 拾取范围(窗口客户区相对坐标) */
  roi: Rect;
  /** 拾取规则(按顺序找,先命中的先捡) */
  rules: ItemPickupRule[];
  /** 找字 / 找色的相似度 0-1 */
  similarity: number;
  /** 「名字还在不在」判定的局部区域半径(px,以点击点为中心) */
  nearRadiusPx: number;
}

/** 识别到的一件可拾取物品 */
export interface DetectedItem {
  /** 命中的物品名(只按颜色找时为空 —— 那条路径不读文字) */
  name: string;
  /** 物品名字在屏幕上的坐标(用于左键点击) */
  screenPos: Point;
  /** 命中的规则下标(判「还在不在」时要用同一条规则查) */
  ruleIndex: number;
}

/** 一条规则内的命中结果(还没标是哪条规则) */
interface RuleHit {
  name: string;
  screenPos: Point;
}

export class ItemNameDetector {
  constructor(private readonly cfg: ItemDetectorConfig) {}

  /**
   * 找一件可拾取物品;找不到返回 null
   * @param isAbandoned 可选:这个坐标是不是刚被放弃过 —— 是的话跳过这次命中,继续看后面的规则
   *   (单点找色只能拿到第一个命中,不给这个钩子的话一件捡不动的物品会挡住后面所有物品)
   */
  detect(isAbandoned?: (pos: Point) => boolean): DetectedItem | null {
    const roi = this.cfg.roi;
    if (roi.w <= 0 || roi.h <= 0) return null;

    for (let ruleIndex = 0; ruleIndex < this.cfg.rules.length; ruleIndex++) {
      const hit = this.findByRule(this.cfg.rules[ruleIndex]);
      if (!hit) continue;
      if (isAbandoned?.(hit.screenPos)) continue;
      return { ...hit, ruleIndex };
    }
    return null;
  }

  /**
   * 点击点附近是否还能看到这件物品(按它命中的那条规则查:名字 / 颜色)。
   * 判「拾取完成」用它:看不到了 = 捡走了(没捡走就由调用方的点击次数上限兜底放弃)。
   */
  isStillThereNear(item: DetectedItem): boolean {
    const rule = this.cfg.rules[item.ruleIndex];
    if (!rule) return false;
    const roi = this.nearRoi(item.screenPos);
    if (roi.w <= 0 || roi.h <= 0) return false;
    const color = colorSpec(rule.colors);
    if (rule.nameKeywords.length > 0) return rule.nameKeywords.some((n) => this.findStr(n, roi, color) !== null);
    return this.findColor(color, roi) !== null;
  }

  /** 按一条规则找:有名字就逐个找字,没名字就找色 */
  private findByRule(rule: ItemPickupRule): RuleHit | null {
    const roi = this.cfg.roi;
    const color = colorSpec(rule.colors);

    if (rule.nameKeywords.length > 0) {
      for (const name of rule.nameKeywords) {
        const screenPos = this.findStr(name, roi, color);
        if (screenPos) return { name, screenPos };
      }
      return null; // 配了名称却没找到 = 这条规则范围内没有目标物品
    }

    const screenPos = this.findColor(color, roi);
    return screenPos ? { name: '', screenPos } : null;
  }

  /** 找字,返回名字的屏幕坐标 */
  private findStr(text: string, roi: Rect, color: string): Point | null {
    const found = dmApi.findStrE(roi.x, roi.y, roi.x + roi.w, roi.y + roi.h, text, color, this.cfg.similarity);
    return found ? parseTextPos(found) : null;
  }

  /** 找色,返回命中点的屏幕坐标(只取第一个命中) */
  private findColor(color: string, roi: Rect): Point | null {
    const found = dmApi.findColorE(roi.x, roi.y, roi.x + roi.w, roi.y + roi.h, color, this.cfg.similarity);
    return found ? parseFindColor(found) : null;
  }

  /** 以 pos 为中心的局部区域(夹在拾取范围内,越界不出范围) */
  private nearRoi(pos: Point): Rect {
    const r = Math.max(1, this.cfg.nearRadiusPx);
    const outer = this.cfg.roi;
    const x1 = Math.max(outer.x, pos.x - r);
    const y1 = Math.max(outer.y, pos.y - r);
    const x2 = Math.min(outer.x + outer.w, pos.x + r);
    const y2 = Math.min(outer.y + outer.h, pos.y + r);
    return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  }
}
