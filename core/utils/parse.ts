/** 大漠 findStr 结果 "x|y" → 坐标;失败返回 null */
export const parseTextPos = (text: string) => {
  const s = String(text || '').trim();
  if (!s) return null;
  // 中文注释：找出文本中的两个整数或浮点数（允许逗号/空格/分隔符）
  const numbers = s.match(/[-+]?\d+(?:\.\d+)?/g);
  if (!numbers || numbers.length < 2) return null;
  const x = Math.round(Number(numbers[1]) || 0);
  const y = Math.round(Number(numbers[2]) || 0);
  if (x < 0 || y < 0 || x === 0 || y === 0) return null;
  return { x, y, text: s };
};
