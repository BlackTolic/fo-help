// 这个东西不能乱改，否则识别会失效，现在只将坐标改为0.9（90%相似度），其他都保持1（完全识别）
export const DEFAULT_SIM = 1.0;
// 模糊识别相似度(90%),主要用于坐标识别
export const DEFAULT_FUZZY_SIM = 0.9;
