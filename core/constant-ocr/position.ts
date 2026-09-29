export const DEFAULT_SIM = 1.0;

// 角色坐标
export const DEFAULT_ROLE_POSITION = {
  '1600*900': { x: 1487, y: 39, w: 64, h: 20 },
  '1280*800': { x: 1167, y: 39, w: 51, h: 17 },
};

// 已锁定怪物名称(怪物被锁定后,HUD 会在该区域显示它的名字;没锁定时为空)
// 大漠绑定窗口客户区相对坐标,各分辨率同一位置(实测 x1:95,y1:109,x2:200,y2:144)
export const DEFAULT_LOCKED_MONSTER_NAME = { x: 95, y: 109, w: 105, h: 35 };
