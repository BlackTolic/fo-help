// 感知层数据类型:把屏幕上的像素信息结构化成游戏实体
//
// 分层位置:
//   platform/vision(截屏/找色/OCR 原语) → perception(本层,识别出"这是什么") → combat/navigation(决策)

import type { Point, Rect } from '../platform/vision/IVisionProvider';

/** 游戏内地图坐标(逻辑坐标,不是屏幕像素坐标) */
export interface MapPosition {
  /** 地图名(OCR 识别;识别不到为 null) */
  map: string | null;
  x: number;
  y: number;
}

export type EntityKind = 'monster' | 'npc';

/** 屏幕上识别出的一个实体(怪物/NPC 的公共字段) */
export interface RecognizedEntity {
  kind: EntityKind;
  /** OCR 识别出的名字(可能为空字符串) */
  name: string;
  /** 实体在屏幕上的像素坐标(用于点击) */
  screenPos: Point;
  /** 血条百分比 0-100;怪才有,NPC 为 null;读不到也为 null */
  hpPercent: number | null;
  /** 识别信心度 0-1(找色/OCR 相似度) */
  confidence: number;
}

export interface MonsterInfo extends RecognizedEntity {
  kind: 'monster';
}

export interface NpcInfo extends RecognizedEntity {
  kind: 'npc';
}

// ===== 识别配置 =====
// 所有屏幕区域/颜色都来自外部配置(profile 或任务配置),不写死在代码里

/** 怪物识别配置 */
export interface MonsterRecognizeConfig {
  /** 搜索区域(一般是游戏画面区,排除 UI) */
  searchRoi: Rect;
  /** 怪物名字颜色列表(hex,如 'FF0000';白名/黄名/红名怪分开配) */
  nameColors: string[];
  /** 找色相似度 0-1 */
  similarity?: number;
  /** 血条颜色(用于读血量;不配则跳过血量) */
  hpBarColor?: string;
  /** 名字命中点 → 血条区域的偏移(相对名字点) */
  hpBarOffset?: Rect;
}

/** NPC 识别配置 */
export interface NpcRecognizeConfig {
  searchRoi: Rect;
  /** NPC 名字颜色(通常和怪物不同,如绿色/黄色) */
  nameColors: string[];
  similarity?: number;
}

/** 地图坐标读取配置 */
export interface MapCoordConfig {
  /** 坐标文字所在区域(如小地图旁的 "123, 456") */
  coordRoi: Rect;
  /** 坐标文字颜色 */
  coordColor: string;
  /** 地图名区域(可选;不配则 map 恒为 null) */
  mapNameRoi?: Rect;
  mapNameColor?: string;
  similarity?: number;
}
