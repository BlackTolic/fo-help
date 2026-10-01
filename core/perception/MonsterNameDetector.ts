// 定点识别的怪物名称识别器(OCR 优先)
//
// 与 MonsterRecognizer(找色→OCR,尚未实现)不同,本模块直接对应任务配置里的
// 「OCR 识别范围 + 怪名颜色」,链路参考 ffo-auto-tool 的 getMonsterName / findMonsterPos:
//   1) 配了关键字(白名单)→ 逐个 FindStrE,命中即返回名字 + 名字屏幕坐标(找字比 OCR 快,位置也精确)
//   2) 没配关键字 → Ocr 读出范围内文字 → 再用 FindStrE 反查该文字的坐标
//
// 对外能力:
//   detect()         识别范围内的一只怪物(名字 + 名字屏幕坐标,用于左键点击锁定/攻击;
//                    可选 isCorpse 钩子跳过刚击杀的尸体名字)
//   locate()         在范围内重新定位某个名字(怪会移动,每次点击/施法前重新定位)
//   isPresent()      名字当前是否还在「识别范围」内(找目标用;名字还在 ≠ 怪还活着,别拿来判死活)
//   readLockedName() 读「已锁定怪物名称」HUD 区域的文字(被锁定时游戏在此显示名字,未锁定为空)
//   isLocked()      当前是否有锁定的怪物(HUD 区域显示着名字)
//
// 坐标系:dm.Function(x1,y1,x2,y2,...) 用的是「窗口客户区相对坐标」,
// 与 farm.ts 的 view.roi、路径点换算出的屏幕坐标同一坐标系。

import { parseTextPos } from '../utils/parse';
import { dmApi } from '../platform/damoo/dm-api';
import type { Point, Rect } from '../platform/vision/IVisionProvider';

export interface MonsterNameDetectorConfig {
  /** OCR / 找字范围(客户区相对坐标,见 shared/types.ts 的 ScreenRect) */
  roi: Rect;
  /**
   * 怪名颜色(大漠颜色格式,如 'e85048-111111';可选值见 core/constant-ocr/color.ts)。
   * UI 上可多选,多色时是 '|' 拼成的一个颜色串(找一个就算命中)
   */
  color: string;
  /** 相似度 0-1 */
  similarity: number;
  /** 怪名关键字(可选白名单);非空 = 只认含关键字的怪名,空 = 纯 OCR */
  keywords?: string[];
  /**
   * 已锁定怪物名称的 HUD 区域(客户区相对坐标)。
   * 怪物被锁定后游戏在此显示它的名字,没锁定时为空 —— 用于判断锁定状态 / 怪是否已死。
   * 见 core/constant-ocr/position.ts 的 DEFAULT_LOCKED_MONSTER_NAME。
   */
  lockedRoi?: Rect;
  /** 已锁定怪物名称的颜色(不配 = 用 color) */
  lockedColor?: string;
}

/** 识别到的一只怪物 */
export interface DetectedMonster {
  /** 怪物名称 */
  name: string;
  /** 名称文字在屏幕上的坐标(用于左键点击:按一下怪名即锁定并开始攻击) */
  screenPos: Point;
}

export class MonsterNameDetector {
  constructor(private readonly cfg: MonsterNameDetectorConfig) {}

  /**
   * 识别范围内的一只怪物;找不到返回 null
   * @param isCorpse 可选:这个坐标上的名字是不是刚击杀的尸体 —— 是的话跳过这次命中、继续找下一个
   *   (尸体名和活怪名在识别范围里长得一模一样,不跳过它,重扫时又会把它当成新目标点一次)
   */
  detect(isCorpse?: (pos: Point) => boolean): DetectedMonster | null {
    const keywords = (this.cfg.keywords ?? []).map((k) => k.trim()).filter(Boolean);

    // 1) 配了关键字:按关键字找字定位(快,且坐标精确)
    if (keywords.length > 0) {
      for (const kw of keywords) {
        const pos = this.locate(kw);
        if (!pos || isCorpse?.(pos)) continue;
        return { name: kw, screenPos: pos };
      }
      return null;
    }

    // 2) 没配关键字:纯 OCR —— 读出文字后反查坐标,点上去(左键)锁定
    const text = this.ocrText();
    for (const candidate of this.candidates(text)) {
      const pos = this.locate(candidate);
      if (!pos || isCorpse?.(pos)) continue;
      return { name: candidate, screenPos: pos };
    }
    return null;
  }

  /** 在识别范围内查找指定名字,返回名字文字的屏幕坐标;找不到返回 null */
  locate(name: string): Point | null {
    const s = String(name ?? '').trim();
    if (!s) return null;
    const found = dmApi.findStrE(
      this.cfg.roi.x,
      this.cfg.roi.y,
      this.cfg.roi.x + this.cfg.roi.w,
      this.cfg.roi.y + this.cfg.roi.h,
      s,
      this.cfg.color,
      1,
    );
    const findPos = parseTextPos(found);
    if (!found) return null;
    return findPos;
  }

  /**
   * 名字当前是否还在识别范围内(找目标用)。
   * ⚠️ 别拿它判"怪还活着":怪死后尸体名还会留几秒,那几秒里它同样返回 true
   * (活/死只能看「已锁定怪物名称」HUD,见 farm.ts 的 isLockAlive)
   */
  isPresent(name: string): boolean {
    return this.locate(name) !== null;
  }

  /**
   * 读「已锁定怪物名称」HUD 区域的文字。
   * 怪物被锁定后游戏在此显示它的名字;没锁定时返回空字符串。
   */
  readLockedName(): string {
    const roi = this.cfg.lockedRoi;
    if (!roi || roi.w <= 0 || roi.h <= 0) return '';
    return this.ocrRoi(roi, this.cfg.lockedColor ?? this.cfg.color);
  }

  /** 当前是否有锁定的怪物(HUD 区域显示着名字) */
  isLocked(): boolean {
    return this.readLockedName() !== '';
  }

  /** OCR 识别范围内的文字(按配置的怪名颜色) */
  ocrText(): string {
    return this.ocrRoi(this.cfg.roi, this.cfg.color);
  }

  /** OCR 指定区域的文字 */
  private ocrRoi(roi: Rect, color: string): string {
    const text = this.ocrOnce(roi, color);
    if (text) return text;
    // 怪名颜色可以多选,多选时 color 是用 '|' 拼的。
    // 大漠的找字支持多色,但 Ocr 是否支持多色没实测过:拼串读不到东西时逐色再试一遍。
    // 单色配置(含所有旧配置)colors.length ≤ 1,走不到这里,不会有额外开销。
    const colors = color
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (colors.length <= 1) return text;
    for (const c of colors) {
      const one = this.ocrOnce(roi, c);
      if (one) return one;
    }
    return '';
  }

  private ocrOnce(roi: Rect, color: string): string {
    return String(dmApi.ocr(roi.x, roi.y, roi.x + roi.w, roi.y + roi.h, color, this.cfg.similarity) || '').trim();
  }

  /** OCR 结果 → 候选名字(整串优先,再按空白/分隔符拆;OCR 常把多个名字连在一起) */
  private candidates(text: string): string[] {
    const t = String(text ?? '').trim();
    if (!t) return [];
    const parts = t.split(/[\s|,，、]+/).filter(Boolean);
    return [t, ...parts];
  }
}
