// 视觉识别接口(所有实现都必须满足)

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Direction = 'leftTop' | 'leftBottom' | 'rightTop' | 'rightBottom' | 'center';

export interface FindOpts {
  similarity?: number; // 0-1, 默认 0.8
  direction?: Direction;
  maxResults?: number;
}

export interface OcrOpts {
  /** 字体颜色(hex,比如 "FFFFFF") */
  color?: string;
  /** 相似度 0-1,默认 0.8 */
  similarity?: number;
}

export interface OcrResult {
  text: string;
  confidence: number;
}

/** 视觉识别接口 */
export interface IVisionProvider {
  /** 截取屏幕区域(不传则截全屏) */
  captureScreen(roi?: Rect): Promise<Buffer>;

  /** 在 ROI 中查找单张图,返回第一个匹配点 */
  findImage(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point | null>;

  /** 在 ROI 中查找多张图,返回所有匹配点 */
  findImages(roi: Rect, template: Buffer, opts?: FindOpts): Promise<Point[]>;

  /** 在 ROI 中查找颜色 */
  findColor(roi: Rect, color: string, opts?: FindOpts): Promise<Point | null>;

  /** OCR 文字识别 */
  ocr(roi: Rect, opts?: OcrOpts): Promise<OcrResult>;

  /** 绑定到具体窗口 hwnd(某些实现需要) */
  bind(hwnd: number): void;

  /** 释放资源 */
  destroy(): void;
}
