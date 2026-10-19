/* verify_v167.js —— v1.6.7 验证
 * v1.6.6 修完弹窗白板后，用户发截图报「底部不规整，左右距离太远」。
 *   像素实测（1170px 截图 ÷3）：四个项间距均匀(≈97.5px=390/4)，但内容整体左移——
 *   「工作台」图标/文字被左边缘裁掉，「我的」右侧空一大截。
 *   根因：#bottomNav button 写了 `flex:1;flex-direction:column` 却漏了 display:flex，
 *        flex-direction 形同虚设；svg 是 display:block 靠左、文字也不居中
 *        → 每格内容贴左，首项被裁、末格留白。
 *   修复：补 `display:flex;align-items:center;justify-content:center;text-align:center`。
 *   Electron 实测修复后（390px 宽）：图标中心 47.3/145.8/244.3/342.8，与理论四等分中心
 *   48.75/146.25/243.75/341.25 误差 ≤1.5px；iconL=36.8 不再贴边。
 *
 * 断言：
 *   O1  移动端 #bottomNav button 规则含 display:flex + align-items:center + justify-content:center
 *   O2  （反向）把 display:flex 从该规则删掉 → 判据必须变 broken，否则恒真
 *   O3  版本号全部升到 1.6.7（index.html 两处 / package.json / sw.js v25 / gradle 33 / pbxproj 1.6.7+33）
 *   O4  v1.6.6 的弹窗修复仍在（回归不回退）：移动端 .modal 不再 height:100vh / border-radius:0
 *   O5  页面脚本无致命错误（jsdom 启动 + boot 干净，bottomNav 4 个按钮）
 *
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v167.js
 */
const fs = require('fs');
const path = require('path');
const { JSDOM, VirtualConsole } = require('jsdom');
const HTML = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const results = [];
function log(s) { fs.writeSync(1, s + '\n'); }
function astep(name, cond, extra) {
  results.push({ name, ok: !!cond, extra: extra || '' });
  log((cond ? 'PASS ' : 'FAIL ') + name + (extra ? '  [' + extra + ']' : ''));
}

// ---- 花括号配平抽取（BSD/嵌套 @media 都安全）----
function extractBalanced(src, fromIdx) {
  let i = src.indexOf('{', fromIdx);
  if (i < 0) return '';
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  return src.slice(fromIdx);
}
// ---- 抽「移动端 @media(max-width:768px) 块内 #bottomNav button{...} 规则体」----
function bottomNavRule(src) {
  let idx = -1, best = null;
  const needle = '@media (max-width:768px)';
  while ((idx = src.indexOf(needle, idx + 1)) >= 0) {
    const block = extractBalanced(src, idx);
    const mm = block.match(/#bottomNav\s+button\s*\{([^}]*)\}/);
    if (mm && (!best || mm[1].length > best.length)) best = mm[1];
  }
  return best;
}
// ---- 判据：底栏按钮是否仍是「内容贴左」布局 ----
function isBrokenBottomNav(src) {
  const r = bottomNavRule(src);
  if (!r) return 'NO_RULE';
  const hasFlex = /(^|[^-])display\s*:\s*flex/.test(r);
  const hasCenter = /align-items\s*:\s*center/.test(r) && /justify-content\s*:\s*center/.test(r);
  return (hasFlex && hasCenter) ? false : true; // true=broken
}

// ---- O1：修复在源码里 ----
const rule = bottomNavRule(HTML);
astep('O1a 抽到移动端 #bottomNav button 规则', !!rule, rule ? rule.slice(0, 60) + '…' : 'NO_RULE');
astep('O1b 规则含 display:flex', !!rule && /(^|[^-])display\s*:\s*flex/.test(rule));
astep('O1c 规则含 align-items/justify-content:center', !!rule &&
  /align-items\s*:\s*center/.test(rule) && /justify-content\s*:\s*center/.test(rule));

// ---- O2：反向验证（删掉 display:flex 必须判 broken）----
const revSrc = rule ? HTML.replace(rule, rule.replace(/(^|[^-])display\s*:\s*flex;?/, '$1')) : HTML;
const revNow = isBrokenBottomNav(revSrc);
astep('O2 反向：删 display:flex 后判据变 broken', revNow === true, 'revNow=' + revNow);
// 再反向一次：把 align-items:center 删掉也必须 broken（判据不是只盯一个词）
const revSrc2 = rule ? HTML.replace(rule, rule.replace(/align-items\s*:\s*center;?/, '')) : HTML;
astep('O2b 反向：删 align-items:center 后判据变 broken', isBrokenBottomNav(revSrc2) === true);

// ---- O3：6 处版本号 → 1.6.7 ----
astep('O3a index.html 导出 version 1.6.7', /version:'1\.6\.7'/.test(HTML));
astep('O3b index.html 关于页 1.6.7', HTML.includes('通用收银台 1.6.7'));
astep('O3c package.json 1.6.7', /"version"\s*:\s*"1\.6\.7"/.test(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')));
astep('O3d sw.js 缓存 v25', /pos-cache-v25/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));
const gradle = fs.readFileSync(path.join(__dirname, 'android/app/build.gradle'), 'utf8');
astep('O3e gradle versionCode 33 + versionName 1.6.7', /versionCode\s+33\b/.test(gradle) && /versionName\s+"1\.6\.7"/.test(gradle));
const pbx = fs.readFileSync(path.join(__dirname, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
const mv = (pbx.match(/MARKETING_VERSION = ([^;]+);/g) || []).join(',');
const cv = (pbx.match(/CURRENT_PROJECT_VERSION = ([^;]+);/g) || []).join(',');
astep('O3f pbxproj 1.6.7×2 + build 33×2', /MARKETING_VERSION = 1\.6\.7/.test(pbx) && (pbx.match(/MARKETING_VERSION = 1\.6\.7/g) || []).length === 2 &&
  /CURRENT_PROJECT_VERSION = 33/.test(pbx) && (pbx.match(/CURRENT_PROJECT_VERSION = 33/g) || []).length === 2,
  'MV=' + mv + ' CV=' + cv);

// ---- O4：v1.6.6 弹窗修复不回退 ----
function mobileModalRule(src) {
  let idx = -1, best = null;
  const needle = '@media (max-width:768px)';
  while ((idx = src.indexOf(needle, idx + 1)) >= 0) {
    const block = extractBalanced(src, idx);
    const mm = block.match(/\.modal\s*\{([^}]*)\}/);
    if (mm && (!best || mm[1].length > best.length)) best = mm[1];
  }
  return best;
}
const mod = mobileModalRule(HTML);
astep('O4 v1.6.6 弹窗修复仍在（无 100vh/无 radius:0）', !!mod &&
  !/height\s*:\s*100vh/.test(mod) && !/border-radius\s*:\s*0\b/.test(mod) &&
  /border-radius\s*:\s*16px/.test(mod));

// ---- O5：jsdom 启动无致命错误（照抄 verify_v166 已跑通写法：无 resources:'usable'，300ms 等待，60s 看门狗）----
const watchdog = setTimeout(() => { log('WATCHDOG TIMEOUT'); process.exit(9); }, 60000);
const vc = new VirtualConsole();
const loadErrs = [];
vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/Not implemented/.test(m)) loadErrs.push(m); });
const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
setTimeout(() => {
  let n = 0;
  try { n = w.document.querySelectorAll('#bottomNav button').length; } catch (e) { loadErrs.push(String(e)); }
  astep('O5 jsdom 启动无致命错误 + bottomNav 4 按钮', loadErrs.length === 0 && n === 4,
    'errors=' + loadErrs.length + ' btns=' + n + (loadErrs[0] ? ' first=' + loadErrs[0].slice(0, 80) : ''));
  clearTimeout(watchdog);
  const P = results.filter(r => r.ok).length, F = results.length - P;
  log(`TOTAL=${results.length} PASS=${P} FAIL=${F} ${F === 0 ? 'ALL GREEN' : 'HAS FAIL'}`);
  process.exit(F === 0 ? 0 : 1);
}, 300);
