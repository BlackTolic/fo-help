// CoordinateReader: 读取游戏内的各种数值
// 当前实现:读 HP/MP 数字和目标血条百分比
// 未来可扩展:读玩家位置、读小地图等

import type { IVisionProvider } from '../platform/vision/IVisionProvider';

export class CoordinateReader {
  readonly profile: any;

  constructor(
    private vision: IVisionProvider,
    profile: any,
  ) {
    this.profile = profile;
  }

  /** 读自己的 HP 百分比(0-100),OCR 数字 + 总血量计算 */
  async readSelfHpPercent(): Promise<number | null> {
    const r = this.profile.regions.selfHp;
    const result = await this.vision.ocr(r, { color: 'FF0000', similarity: 0.8 });
    return this.parsePercent(result.text);
  }

  /** 读自己的 MP 百分比 */
  async readSelfMpPercent(): Promise<number | null> {
    const r = this.profile.regions.selfMp;
    const result = await this.vision.ocr(r, { color: '0000FF', similarity: 0.8 });
    return this.parsePercent(result.text);
  }

  /** 读目标血条百分比(0-100) */
  async readTargetHpPercent(): Promise<number | null> {
    const r = this.profile.regions.targetHp;
    const result = await this.vision.ocr(r, { color: 'FF0000', similarity: 0.8 });
    return this.parsePercent(result.text);
  }

  /**
   * 解析 OCR 结果中的百分比,容错:支持 "78%" / "78/100" / "78"
   */
  private parsePercent(text: string): number | null {
    if (!text) return null;
    // 优先匹配 "78%" 形式
    const pctMatch = text.match(/(\d{1,3})\s*%/);
    if (pctMatch) {
      const v = parseInt(pctMatch[1], 10);
      if (!isNaN(v) && v >= 0 && v <= 100) return v;
    }
    // 匹配 "78/100" 形式
    const fracMatch = text.match(/(\d{1,3})\s*\/\s*(\d{1,3})/);
    if (fracMatch) {
      const num = parseInt(fracMatch[1], 10);
      const den = parseInt(fracMatch[2], 10);
      if (den > 0) return Math.round((num / den) * 100);
    }
    // 兜底:只取第一个数字
    const numMatch = text.match(/(\d{1,3})/);
    if (numMatch) {
      const v = parseInt(numMatch[1], 10);
      if (!isNaN(v) && v >= 0 && v <= 100) return v;
    }
    return null;
  }
}
