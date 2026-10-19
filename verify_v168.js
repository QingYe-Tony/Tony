/* verify_v168.js —— v1.6.8 验证
 * 用户装着 APK 点「检查更新」被提示「当前为网页版，更新功能需在桌面应用中使用」
 * （用户原话：怎么是网页版不是app吗）。
 *   根因：checkUpdates() 只认桌面 Electron（window.electron.checkForUpdates），
 *        Capacitor 手机 App 里没有 window.electron → 走了网页版分支。
 *   修复：新增 Capacitor 原生分支——fetch GitHub releases/latest 比对 APP_VER，
 *        相同→「已是最新版本」；不同→confirm 后跳 releases 下载页（外部域名导航
 *        在 Capacitor 默认转系统浏览器）；失败→提示网络问题。
 *   顺带：新增全站唯一版本常量 APP_VER（导出/关于页/verText/检查更新共用）；
 *        verText 在手机端不再空白；网页版提示文案改为「…桌面应用或手机 App…」。
 *
 * 断言：
 *   Q1  checkUpdates 含 Capacitor 原生分支（isNativePlatform + releases/latest + APP_VER 比对）
 *   Q1r 反向：删掉 Capacitor 分支后判据必须变 broken
 *   Q2  APP_VER 常量 1.6.8 且被 ≥4 处引用（导出/关于页/检查更新/verText）
 *   Q3  六处版本号（APP_VER / package.json / sw v26 / gradle 34+1.6.8 / pbxproj 1.6.8×2 34×2）
 *   Q4  v1.6.7 底栏 + v1.6.6 弹窗修复回归不回退
 *   Q5  jsdom 行为级：a)网页分支 toast  b)同版本→已是最新  c)新版本→confirm  d)网络失败 toast
 *
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v168.js（后台）
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
function fnBody(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) return '';
  const braceStart = src.indexOf('{', i);
  let depth = 0;
  for (let j = braceStart; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(i, j + 1); }
  }
  return '';
}
const watchdog = setTimeout(() => { log('WATCHDOG TIMEOUT'); process.exit(9); }, 90000);

// ---- Q1：Capacitor 原生分支 ----
const cu = fnBody(HTML, 'checkUpdates');
astep('Q1a 抽到 checkUpdates 函数体', cu.length > 100, String(cu.length));
const hasCap = cu.includes('isNativePlatform');
const hasFetch = /releases\/latest/.test(cu) && /api\.github\.com\/repos\/QingYe-Tony\/Tony/.test(cu);
const hasCmp = /latest===APP_VER/.test(cu);
astep('Q1b 含 Capacitor isNativePlatform 分支', hasCap);
astep('Q1c 含 GitHub releases/latest 比对', hasFetch && hasCmp);
// 反向：把 Capacitor 分支整段删掉（从注释行到该 return;）
const mutated = cu.replace(/[\s\S]*?if\(window\.Capacitor&&window\.Capacitor\.isNativePlatform[\s\S]*?return;\s*\n  \}/, '/*cap-branch-removed*/');
astep('Q1r 反向：删分支后判据 broken', !(mutated.includes('isNativePlatform') && /releases\/latest/.test(mutated)));

// ---- Q2：APP_VER 常量与引用 ----
astep('Q2a APP_VER=1.6.8 定义', /const APP_VER='1\.6\.8'/.test(HTML));
const refs = (HTML.match(/APP_VER/g) || []).length;
astep('Q2b APP_VER 引用 ≥5（定义+导出+关于+更新+verText）', refs >= 5, 'refs=' + refs);
astep('Q2c 导出用 version:APP_VER', /version:APP_VER/.test(HTML));
astep('Q2d 关于页用 +APP_VER 拼接', /\['软件版本','通用收银台 '\+APP_VER\]/.test(HTML));
astep('Q2e 无残留 1.6.7 版本串（注释里的 v1.6.7 历史说明不算）', !/version\s*:\s*'1\.6\.7'/.test(HTML) && !/通用收银台 1\.6\.7/.test(HTML) && !/APP_VER='1\.6\.7'/.test(HTML));

// ---- Q3：六处版本号 1.6.8 ----
astep('Q3a package.json 1.6.8', /"version"\s*:\s*"1\.6\.8"/.test(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')));
astep('Q3b sw.js 缓存 v26', /pos-cache-v26/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));
const gradle = fs.readFileSync(path.join(__dirname, 'android/app/build.gradle'), 'utf8');
astep('Q3c gradle 34 + 1.6.8', /versionCode\s+34\b/.test(gradle) && /versionName\s+"1\.6\.8"/.test(gradle));
const pbx = fs.readFileSync(path.join(__dirname, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
astep('Q3d pbxproj 1.6.8×2 + 34×2', (pbx.match(/MARKETING_VERSION = 1\.6\.8/g) || []).length === 2 && (pbx.match(/CURRENT_PROJECT_VERSION = 34/g) || []).length === 2);

// ---- Q4：v1.6.7 / v1.6.6 回归 ----
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
const bn = bottomNavRule(HTML);
astep('Q4a v1.6.7 底栏 display:flex 居中仍在', !!bn && /display\s*:\s*flex/.test(bn) && /align-items\s*:\s*center/.test(bn));
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
astep('Q4b v1.6.6 弹窗修复仍在', !!mod && !/height\s*:\s*100vh/.test(mod) && !/border-radius\s*:\s*0\b/.test(mod) && /border-radius\s*:\s*16px/.test(mod));

// ---- Q5：jsdom 行为级 ----
const vc = new VirtualConsole();
const loadErrs = [];
vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/Not implemented/.test(m)) loadErrs.push(m); });
const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const t = () => w.document.getElementById('toast').textContent;
  // a) 网页分支（同步 toast）
  w.checkUpdates();
  astep('Q5a 网页环境提示改为「…桌面应用或手机 App…」', /网页版/.test(t()) && /手机 App/.test(t()), t());
  // b) 手机 App + 同版本
  w.Capacitor = { isNativePlatform: () => true };
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ tag_name: 'v1.6.8' }) });
  w.checkUpdates();
  await wait(150);
  astep('Q5b App 同版本 → 已是最新版本', t() === '已是最新版本 v1.6.8', t());
  // c) 手机 App + 新版本（confirm 桩记录参数，返回 false 不触发导航）
  let confirmMsg = '';
  w.confirm = m => { confirmMsg = m; return false; };
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ tag_name: 'v1.7.0' }) });
  w.checkUpdates();
  await wait(150);
  astep('Q5c App 新版本 → confirm 报新版号', /发现新版本 v1\.7\.0/.test(confirmMsg) && /当前 v1\.6\.8/.test(confirmMsg), confirmMsg.replace(/\n/g, ' '));
  // d) 网络失败
  w.fetch = () => Promise.reject(new Error('offline'));
  w.checkUpdates();
  await wait(150);
  astep('Q5d 网络失败 → 提示检查网络', /检查更新失败/.test(t()), t());
  astep('Q5e jsdom 启动无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));
  clearTimeout(watchdog);
  const P = results.filter(r => r.ok).length, F = results.length - P;
  log(`TOTAL=${results.length} PASS=${P} FAIL=${F} ${F === 0 ? 'ALL GREEN' : 'HAS FAIL'}`);
  process.exit(F === 0 ? 0 : 1);
})();
