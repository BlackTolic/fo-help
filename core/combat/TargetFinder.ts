// TargetFinder: 找怪物
// P4-B: 简化实现 - OCR 扫屏幕找怪名,匹配玩家配置的 mobFilter
//
// 真实实现可演进:
// - 用 FindStr 找特定字符串(快)
// - 用 FindColor 找血条颜色(中等)
// - 用 FindPic 找怪物模板(慢但最准)

import type { Point, Rect } from '../platform/vision/IVisionProvider';
import { dmApi } from '../platform/damoo/dm-api';

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
  /**
   * 找一个目标(直接用 dmApi,不再依赖 IVisionProvider)
   * @returns 第一个匹配,或 null
   */
  async find(filter: FindFilter): Promise<CombatTarget | null> {
    if (!filter.nameKeywords || filter.nameKeywords.length === 0) {
      return null;
    }

    const roi = this.getSearchRoi();

    for (const keyword of filter.nameKeywords) {
      try {
        const x = { value: 0, byref: true } as any;
        const y = { value: 0, byref: true } as any;
        const result = dmApi.findStrE(
          roi.x,
          roi.y,
          roi.x + roi.w,
          roi.y + roi.h,
          keyword,
          'FFFFFF-FFFFFF',
          0.85,
          x,
          y,
        );
        if (result === 1) {
          return {
            id: `${Math.floor(x.value)}-${Math.floor(y.value)}-${Date.now() % 100000}`,
            screenPos: { x: Math.floor(x.value), y: Math.floor(y.value) },
            name: keyword,
            confidence: 0.85,
          };
        }
      } catch {
        continue;
      }
    }
    return null;
  }

  private getSearchRoi(): Rect {
    return { x: 0, y: 0, w: 1920, h: 1080 };
  }
}
