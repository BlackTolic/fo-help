// MonsterRecognizer: 识别屏幕上的怪物
//
// 典型识别链路(按你的游戏实际情况取舍):
//   1. 按名字颜色找色(vision.findColor)拿到怪物名字的屏幕位置
//      —— 白名/黄名/红名怪颜色不同,可分开多次找色
//   2. 以命中点为中心扩一个小区域做 OCR,读出怪物名字
//   3. (可选)按 hpBarOffset 找到血条区域,读血量百分比
//
// 参考实现:core/combat/TargetFinder.ts(现有找怪,用 dmApi.findStrE 按关键字找字)

import type { IVisionProvider } from '../platform/vision/IVisionProvider';
import { createLogger } from '../logger';
import type { MonsterInfo, MonsterRecognizeConfig } from './types';

const log = createLogger('perception.monster');

export class MonsterRecognizer {
  constructor(
    private vision: IVisionProvider,
    private config: MonsterRecognizeConfig,
  ) {}

  /**
   * 扫描搜索区域,返回识别到的所有怪物
   * TODO: 按文件头部的识别链路实现;找色多点可用 dmApi.findColorEx / findStrEx
   */
  async recognizeAll(): Promise<MonsterInfo[]> {
    void this.vision;
    void this.config;
    log.debug('MonsterRecognizer.recognizeAll 待实现');
    return [];
  }

  /** 按名字关键字过滤(recognizeAll 之后用,如只打"小野猪") */
  filterByKeywords(monsters: MonsterInfo[], keywords: string[]): MonsterInfo[] {
    if (keywords.length === 0) return monsters;
    return monsters.filter((m) => keywords.some((k) => m.name.includes(k)));
  }
}
