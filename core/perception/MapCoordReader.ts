// MapCoordReader: 读取游戏内当前地图坐标
//
// 原理:坐标一般以文字形式显示在固定位置(如小地图旁 "123, 456"),
// 用 vision.ocr 对该区域做 OCR,再解析出 x/y。
// 区域和文字颜色全部来自 MapCoordConfig(profile 里配置)。

import type { IVisionProvider } from '../platform/vision/IVisionProvider';
import { createLogger } from '../logger';
import type { MapCoordConfig, MapPosition } from './types';

const log = createLogger('perception.map-coord');

export class MapCoordReader {
  constructor(
    private vision: IVisionProvider,
    private config: MapCoordConfig,
  ) {}

  /** 读当前地图坐标;OCR 失败或解析不出数字时返回 null */
  async read(): Promise<MapPosition | null> {
    const { coordRoi, coordColor, mapNameRoi, mapNameColor, similarity } = this.config;
    const coordResult = await this.vision.ocr(coordRoi, {
      color: coordColor,
      similarity: similarity ?? 0.8,
    });
    const xy = this.parseCoord(coordResult.text);
    if (!xy) {
      log.warn(`坐标 OCR 解析失败: "${coordResult.text}"`);
      return null;
    }

    let map: string | null = null;
    if (mapNameRoi && mapNameColor) {
      const nameResult = await this.vision.ocr(mapNameRoi, {
        color: mapNameColor,
        similarity: similarity ?? 0.8,
      });
      map = nameResult.text.trim() || null;
    }

    return { map, x: xy.x, y: xy.y };
  }

  /**
   * 解析坐标文本,容错常见形式:
   *   "123, 456" / "123,456" / "123,456" / "(123, 456)" / "X:123 Y:456" / "123/456"
   */
  private parseCoord(text: string): { x: number; y: number } | null {
    if (!text) return null;
    const m = text.replace(/[()]/g, '').match(/(\d{1,5})\s*[/,,\s:：]\s*(\d{1,5})/);
    if (!m) return null;
    const x = parseInt(m[1], 10);
    const y = parseInt(m[2], 10);
    if (isNaN(x) || isNaN(y)) return null;
    return { x, y };
  }
}
