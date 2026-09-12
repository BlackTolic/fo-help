// TargetFinder: 找怪物
// P4-B: 简化实现 - OCR 扫屏幕找怪名,匹配玩家配置的 mobFilter
//
// 真实实现可演进:
// - 用 FindStr 找特定字符串(快)
// - 用 FindColor 找血条颜色(中等)
// - 用 FindPic 找怪物模板(慢但最准)

import type { IVisionProvider, Point, Rect } from '../platform/vision/IVisionProvider';

export interface CombatTarget {
  /** 临时 ID(基于位置 hash) */
  id: string;
  /** 屏幕坐标 */
  screenPos: Point;
  /** OCR 出来的怪名(可能为空) */
  name: string;
  /** 信心度 0-1 */
  confidence: number;
}

export interface FindFilter {
  /** 怪名关键字列表(任一匹配) */
  nameKeywords?: string[];
  /** 怪名正则 */
  namePattern?: string;
  /** 等级范围 */
  levelRange?: [number, number];
  /** 名字颜色 (white/yellow/red) */
  colorFilter?: ('white' | 'yellow' | 'red')[];
}

export class TargetFinder {
  constructor(
    private vision: IVisionProvider,
  ) {}

  /**
   * 找一个目标
   * @returns 第一个匹配,或 null
   */
  async find(filter: FindFilter): Promise<CombatTarget | null> {
    // P4-B 简化:用 FindStr 找怪名关键字
    // 大漠的 FindStr 找的是字符串,返回"x|y"
    if (!filter.nameKeywords || filter.nameKeywords.length === 0) {
      return null;
    }

    // 扫描区域:默认全屏(实际可以限制到游戏区域)
    const roi = this.getSearchRoi();

    // 用大漠 FindStr 直接找(大漠内置 OCR + 找字)
    // 返回"x|y",失败返回空字符串
    const dm = (this.vision as any).dm;  // 访问底层 dm(只读)
    if (!dm || typeof dm.FindStr !== 'function') {
      // 没有大漠,降级:返回 null
      return null;
    }

    for (const keyword of filter.nameKeywords) {
      try {
        const x = { value: 0, byref: true } as any;
        const y = { value: 0, byref: true } as any;
        // FindStrE 是返回坐标的版本
        // 签名: FindStrE(x1, y1, x2, y2, str, color, sim, x, y) -> int (找到返回 1)
        const result = dm.FindStrE(
          roi.x, roi.y, roi.x + roi.w, roi.y + roi.h,
          keyword, 'FFFFFF-FFFFFF', 0.85,
          x, y,
        );
        if (result === 1) {
          return {
            id: `${Math.floor(x.value)}-${Math.floor(y.value)}-${Date.now() % 100000}`,
            screenPos: { x: Math.floor(x.value), y: Math.floor(y.value) },
            name: keyword,
            confidence: 0.85,
          };
        }
      } catch (e) {
        // 单个关键字失败,继续
        continue;
      }
    }
    return null;
  }

  /** 扫描区域:默认整个游戏画面(可从 profile 配) */
  private getSearchRoi(): Rect {
    // 简化:用全屏(实际应该只扫游戏区)
    return { x: 0, y: 0, w: 1920, h: 1080 };
  }
}
