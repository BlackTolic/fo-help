// 游戏主城名单(角色所在野外图回城后可能落到这些主城;主城之间可坐飞空艇互传)
//
// 用途(farm 启动时决定怎么去「出发城镇」,见 electron/workers/game-worker/tasks/farm.ts 的 recoverToDepartureTown):
//   - 当前地图就在某个主城 → 不用回城卷轴,直接在该主城坐飞空艇去出发城镇(走城镇档案的「其它主城中转」)
//   - 当前地图在主城之外的野外 → 先用回城卷轴回主城,再坐飞空艇去出发城镇
// 名单取 renderer/farm-maps.ts 里除野外图(流花径/桃源村/云泽秘径)与「自定义」之外的那些主城。

export const MAIN_CITIES: readonly string[] = [
  '龙城',
  '云荒部落',
  '比翼城',
  '楼兰城',
  '出云城',
  '天都',
  '无泪城',
  '桃源东村',
  '桃源西村',
  '长乐东村',
  '长乐西村',
];

/** 地图名是否是一个主城(去空白后全等比较,和 OCR 地图名的匹配方式一致) */
export function isMainCity(mapName: string | null | undefined): boolean {
  const name = String(mapName ?? '').trim();
  return name !== '' && MAIN_CITIES.includes(name);
}
