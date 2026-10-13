// 将 Web 资源复制到 www/（Capacitor 的 webDir），供原生 App 打包使用。
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const files = [
  'index.html',
  'manifest.webmanifest',
  'sw.js',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
];

let copied = 0;
for (const f of files) {
  const src = path.join(root, f);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(out, f));
    copied++;
  } else {
    console.warn('警告：缺少文件 ' + f);
  }
}
console.log('已复制 ' + copied + '/' + files.length + ' 个文件到 www/');
