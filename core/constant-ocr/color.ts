export const COLOR_WHITE = 'e8f0e8-111111'; // 白色识别，常见地图坐标 875分辨率时
export const COLOR_RED = 'e85048-111111'; // 红色识别，常见系统提示、怪物名称
export const COLOR_YELLOW = 'e8c020-111111'; // 黄色识别，常见怪物名称
export const COLOR_GREEN = '40bc00-111111'; // 绿色识别，常见怪物名称、NPC名称
export const COLOR_VERIFY_CODE = 'd8e4d8-111111'; // 神医验证码（白色部分）
export const COLOR_YELLOW_WHITE = 'e0e4a8-111111'; // 黄白色（常见地上无等级物品）
export const COLOR_GREY_WHITE = 'e8f0e8-111111'; // 灰白色（最低级的怪物颜色）

// ---- 物品品质色（物品拾取用；格式同上面几个，主色-偏色）----
// 蓝/紫 = 装备品质色
// ⚠️ 改了这里的值以后:新建 / 重新勾选过的任务立即生效;
//    已经保存过的旧任务存的是"当时的色值",要把标签删掉重新勾一次
export const COLOR_BLUE = '4890e8-111111'; // 蓝色（装备颜色）
export const COLOR_PURPLE = 'd82ce8-111111'; // 紫色（装备颜色）
