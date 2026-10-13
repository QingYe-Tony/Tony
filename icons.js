// 由 build/icon.png 生成 build/icon.ico 与（macOS 上）build/icon.icns
// 用法：先准备好 build/icon.png（如 macOS 用 `qlmanage -t -s 512 -o build icon.svg` 后改名），再 `node icons.js`
const fs = require('fs');
const { execSync } = require('child_process');

if (!fs.existsSync('build/icon.png')) {
  console.error('缺少 build/icon.png，请先生成 512x512 PNG');
  process.exit(1);
}
const png = fs.readFileSync('build/icon.png');

function pngToIco(pngBuf) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type=icon
  header.writeUInt16LE(1, 4); // count
  const entry = Buffer.alloc(16);
  entry.writeUInt8(0, 0);     // width (0 => >=256)
  entry.writeUInt8(0, 1);     // height
  entry.writeUInt8(0, 2);     // colors
  entry.writeUInt8(0, 3);     // reserved
  entry.writeUInt16LE(1, 4);  // color planes
  entry.writeUInt16LE(32, 6); // bpp
  entry.writeUInt32LE(pngBuf.length, 8); // data size
  entry.writeUInt32LE(22, 12);           // data offset
  return Buffer.concat([header, entry, pngBuf]);
}

fs.writeFileSync('build/icon.ico', pngToIco(png));
console.log('build/icon.ico 已生成');

if (process.platform === 'darwin') {
  try {
    execSync('sips -s format icns build/icon.png --out build/icon.icns');
    console.log('build/icon.icns 已生成');
  } catch (e) {
    console.warn('icns 生成失败，macOS 包将回退到默认图标');
  }
}
