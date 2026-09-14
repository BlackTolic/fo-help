// CoordinateReader: 读取游戏内的各种坐标和数值
// P4-A: OCR 读角色坐标(从屏幕 UI 区域)
// P4-A: OCR 读自己 HP/MP 数字
// 后续: 小地图找怪、读目标血条

import type { IVisionProvider } from '../platform/vision/IVisionProvider';

export interface WorldPoint {
  x: number;
  y: number;
}

export class CoordinateReader {
  /** 暴露给 MovementEngine 用,这样它能拿到小地图区域 */
  readonly profile: any;

  constructor(
    private vision: IVisionProvider,
    profile: any,
  ) {
    this.profile = profile;
  }

  /**
   * 读取角色当前世界坐标
   * 方法:OCR Profile.regions.minimap 或自定义 coord 区域
   *
   * 优先级:
   * 1. 如果 Profile.regions.coordDisplay 有配置,从那里 OCR
   * 2. 否则用小地图 + player_arrow 模板
   * 3. 否则降级到默认小地图 OCR
   */
  async readPlayerPosition(): Promise<WorldPoint | null> {
    // P4-A 默认:读小地图上的坐标数字
    // 实际上 QQ 幻想的小地图上可能没有数字,我们走"读小地图中心附近的'我'标记"路线
    // 简化:返回 Profile 里的 farmSpot 假设已经在农场点
    // TODO: 真实实现
    return null;
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

  /** 解析 OCR 结果中的百分比,容错:支持 "78%" / "78/100" / "78" */
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
