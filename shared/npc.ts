// NPC 名称唯一数据源
//
// 约定:
// - 每个 NPC 的中文名只在下面的 NPC 表里写一次,其它地方一律引用它,不要再写字面量。
// - 城镇档案里 NPC 的 name 取这张表的值,例如「道具商人」。
// - 新增 NPC:在 NPC 表加一行即可;界面下拉(NPC_OPTIONS)会自动带上它。
// - 旧配置里的英文 id 由 normalizeNpcName() 在读取时归一到中文名,老数据不会失效。

export const NPC = {
  /** 修理装备 / 买药:回城补给最常用的目标 */
  ITEM_MERCHANT: '道具商人',
  /** 买卖宠物 */
  PET_MERCHANT: '宠物商人',
  /** 存 / 取物品 */
  WAREHOUSE_KEEPER: '仓库管理员',
  /** 卖日用杂货(回城卷轴之类) */
  GENERAL_MERCHANT: '杂货商人',
  /** 飞空艇(载具 / 传送) */
  AIRSHIP_FAIRY: '飞空艇仙子',
  /** 杨戬(游戏内 NPC 名) */
  YANG_JIAN: '杨戬',
  /** 荣光使者(游戏内 NPC 名) */
  GLORY_ENVOY: '荣光使者',
} as const;

/** 全部 NPC 名称 */
export type NpcName = (typeof NPC)[keyof typeof NPC];

/** NPC 下拉选项(值即中文名) */
export const NPC_OPTIONS: readonly NpcName[] = Object.values(NPC);

/** 历史英文 id → 当前中文名(只用于读取旧配置) */
const LEGACY_NPC_ALIASES: Record<string, NpcName> = {
  'item-merchant': NPC.ITEM_MERCHANT,
};

/**
 * 把配置里的 NPC 值归一到当前中文名:
 * - 认得的旧 id → 中文名
 * - 已是中文名 / 表里没有的自定义值 → 原样返回(不丢用户数据)
 */
export function normalizeNpcName(raw: unknown): string {
  const v = typeof raw === 'string' ? raw.trim() : '';
  return LEGACY_NPC_ALIASES[v] ?? v;
}

/** 下拉选项:表里的全部 NPC;当前值不在表里时补在末尾,避免下拉把旧数据悄悄改掉 */
export function npcSelectOptions(current?: unknown): string[] {
  const v = normalizeNpcName(current);
  const options: string[] = [...NPC_OPTIONS];
  if (v && !options.includes(v)) options.push(v);
  return options;
}
