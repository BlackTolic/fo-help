// MapCoordReader: 读取游戏内当前地图坐标
//
// 原理:坐标一般以文字形式显示在固定位置(如小地图旁 "123, 456"),
// 用 vision.ocr 对该区域做 OCR,再解析出 x/y。
// 区域和文字颜色全部来自 MapCoordConfig(profile 里配置)。

import type { IVisionProvider } from '../platform/vision/IVisionProvider';
import { MAP_NAME_ROI } from '../constant-ocr/position';
import type { WindowSizeKey } from '../constant-ocr/popup';
import { createLogger } from '../logger';
import type { MapCoordConfig, MapPosition } from './types';

const log = createLogger('perception.map-coord');

export class MapCoordReader {
  constructor(
    private vision: IVisionProvider,
    private config: MapCoordConfig,
    /**
     * 窗口分辨率档位(可选):配置里没配 mapNameRoi 时,按档位取内置常量
     * MAP_NAME_ROI(见 core/constant-ocr/position.ts)作为地图名识别区域。
     */
    private size?: WindowSizeKey,
  ) {}

  /** 读当前地图坐标;OCR 失败或解析不出数字时返回 null */
  async read(): Promise<MapPosition | null> {
    const { coordRoi, coordColor, similarity } = this.config;
    const coordResult = await this.vision.ocr(coordRoi, {
      color: coordColor,
      similarity: similarity ?? 0.8,
    });
    const xy = this.parseCoord(coordResult.text);
    if (!xy) {
      log.warn(`坐标 OCR 解析失败: "${coordResult.text}"`);
      return null;
    }

    const map = await this.readMapName();
    return { map: map || null, x: xy.x, y: xy.y };
  }

  /**
   * 读当前地图名(OCR);读不到返回空字符串。
   * 识别区域优先用配置里的 mapNameRoi/mapNameColor;没配且构造时给了分辨率档位时,
   * 按档位取内置常量 MAP_NAME_ROI。
   */
  async readMapName(): Promise<string> {
    const { mapNameRoi, mapNameColor, similarity } = this.config;
    const fallback = this.size ? MAP_NAME_ROI[this.size] : undefined;
    const roi =
      mapNameRoi ?? (fallback ? { x: fallback.x1, y: fallback.y1, w: fallback.x2 - fallback.x1, h: fallback.y2 - fallback.y1 } : undefined);
    const color = mapNameColor ?? fallback?.color;
    if (!roi || !color) return '';

    const nameResult = await this.vision.ocr(roi, {
      color,
      similarity: similarity ?? fallback?.sim ?? 0.8,
    });
    return nameResult.text.trim();
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
