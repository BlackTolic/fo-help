// 挂机地图表(id → 游戏内中文地图名)
//
// 从 TaskConfigDialog 抽出来单独放:
//   - TaskConfigDialog 用它渲染「地图」下拉
//   - WindowCard 启动 farm 时要用它解析 auxConfigs.farmMapName(回城补给靠它找城镇出口)
//     —— WindowCard 不能静态 import TaskConfigDialog(那是 100KB 的懒加载组件)

export interface FarmMapOption {
  id: string;
  /** 游戏内 OCR 读到的中文地图名(custom 除外,它的名字由用户填) */
  name: string;
}

export const FARM_MAPS: FarmMapOption[] = [
  { id: 'long-cheng', name: '龙城' },
  { id: 'yun-huang-bu-luo', name: '云荒部落' },
  { id: 'bi-yi-cheng', name: '比翼城' },
  { id: 'lou-lan-cheng', name: '楼兰城' },
  { id: 'chu-yun-cheng', name: '出云城' },
  { id: 'tian-du', name: '天都' },
  { id: 'wu-lei-cheng', name: '无泪城' },
  { id: 'tao-yuan-dong-cun', name: '桃源东村' },
  { id: 'tao-yuan-xi-cun', name: '桃源西村' },
  { id: 'chang-le-dong-cun', name: '长乐东村' },
  { id: 'chang-le-xi-cun', name: '长乐西村' },
  { id: 'flow-path', name: ' 流花径' },
  { id: 'tian-yuan', name: '桃源村' },
  { id: 'custom', name: '自定义...' },
];

/**
 * 解析 farm 配置对应的"游戏内中文地图名"(回城补给用它匹配城镇档案的 exits[].toMap):
 *   - 预置地图:取表里的名字(去掉表里的前导/尾随空格,OCR 比对是全等比较,多余空格会永远对不上)
 *   - custom:用用户填的 customMapName
 *   - 其它(表里没有的旧 id,如 'hu-ya-shan')→ null,调用方应阻止启动并提示用户重新选地图
 */
export function resolveFarmMapName(mapId: string, customMapName?: string): string | null {
  if (mapId === 'custom') return String(customMapName ?? '').trim() || null;
  const hit = FARM_MAPS.find((m) => m.id === mapId);
  return hit ? hit.name.trim() : null;
}
