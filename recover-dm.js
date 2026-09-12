// 重新复制 dm.dll(被 Defender 隔离删了,这次排除项已生效)
const fs = require('fs');
const path = require('path');

const src = 'F:\\Code\\Project\\10DAMO\\ffo-auto-script\\src\\lib\\dm.dll';
const dstDir = path.join(__dirname, 'assets', 'dll');
const dst = path.join(dstDir, 'dm.dll');

if (!fs.existsSync(src)) {
  console.log('源文件不存在:', src);
  process.exit(1);
}

if (!fs.existsSync(dstDir)) fs.mkdirSync(dstDir, { recursive: true });

fs.copyFileSync(src, dst);
console.log('✓ 复制成功');
console.log('  源:', src, fs.statSync(src).size, 'bytes');
console.log('  目标:', dst, fs.statSync(dst).size, 'bytes');
