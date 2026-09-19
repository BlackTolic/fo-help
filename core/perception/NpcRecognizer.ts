// NpcRecognizer: 识别屏幕上的 NPC
//
// 与怪物的差异:
//   - NPC 名字颜色一般和怪物不同(配置里分开)
//   - NPC 没有血条,不需要读血量
//   - 通常按名字精确匹配目标 NPC(交任务/买东西),而不是"扫到什么算什么"

import type { IVisionProvider } from '../platform/vision/IVisionProvider';
import { createLogger } from '../logger';
import type { NpcInfo, NpcRecognizeConfig } from './types';

const log = createLogger('perception.npc');

export class NpcRecognizer {
  constructor(
    private vision: IVisionProvider,
    private config: NpcRecognizeConfig,
  ) {}

  /**
   * 扫描搜索区域,返回识别到的所有 NPC
   * TODO: 实现,链路同 MonsterRecognizer(找色 → OCR 名字)
   */
  async recognizeAll(): Promise<NpcInfo[]> {
    void this.vision;
    void this.config;
    log.debug('NpcRecognizer.recognizeAll 待实现');
    return [];
  }

  /**
   * 按名字找指定 NPC(交任务场景:"找到仓库管理员并点击它")
   * TODO: 内部可调 recognizeAll 后按名字匹配,或用 dmApi.findStrE 直接找字(更快)
   */
  async findByName(_name: string): Promise<NpcInfo | null> {
    void this.vision;
    log.debug('NpcRecognizer.findByName 待实现');
    return null;
  }
}
