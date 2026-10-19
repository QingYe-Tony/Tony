/* verify_v169.js —— v1.6.9 验证
 * 用户装着手机 App 底栏「底部上下距离太远了」，经标注图指认选 C 段：
 *   文字 ↔ 屏幕底（home 条安全区）太远 → 文字太靠上、浮在栏里。
 * 根因：底栏按钮内容在 53.5px 高的栏里垂直居中（justify-content:center），
 *       文字离底栏底边浮着约 8px；而栏底下面还有 ~34px 是 iPhone home 条安全区
 *       （系统强制留白，内容不能压到手势区）。浮空 + 安全区叠加 → 文字看起来太靠上。
 * 修复：按钮内容改坐底（justify-content:flex-end），并把按钮底部内边距从 8px 收到 4px，
 *       文字贴到安全区上沿（iOS 标准 tab bar 最低合法位置）；#bottomNav 仍保留
 *       padding-bottom:env(safe-area-inset-bottom) 以预留 home 条安全区（不缩、不删）。
 *
 * 断言：
 *   Q1  v1.6.9 底栏：内容 flex-end（非 center）、按钮 padding-bottom 收到 4px、
 *       #bottomNav 仍预留安全区；反向：改回 center 后判据必须 broken
 *   Q2  APP_VER=1.6.9 + 引用≥5 + 无残留 1.6.8 版本串
 *   Q3  六处版本号 1.6.9（package.json / sw v27 / gradle 35+1.6.9 / pbxproj 1.6.9×2 + 35×2）
 *   Q4  v1.6.7 底栏居中 / v1.6.6 弹窗 / v1.6.8 Capacitor 检查更新 三项回归不回退
 *   Q5  jsdom 行为级：a)网页分支  b)同版本→已是最新  c)新版本→confirm  d)网络失败
 *
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v169.js（后台）
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

// ---- Q1：v1.6.9 底栏文字贴底 ----
function bottomNavBtnRule(src) {
  let idx = -1, best = null;
  const needle = '@media (max-width:768px)';
  while ((idx = src.indexOf(needle, idx + 1)) >= 0) {
    const block = extractBalanced(src, idx);
    const mm = block.match(/#bottomNav\s+button\s*\{([^}]*)\}/);
    if (mm && (!best || mm[1].length > best.length)) best = mm[1];
  }
  return best;
}
function bottomNavRule(src) {
  let idx = -1, best = null;
  const needle = '@media (max-width:768px)';
  while ((idx = src.indexOf(needle, idx + 1)) >= 0) {
    const block = extractBalanced(src, idx);
    const mm = block.match(/#bottomNav\s*(?=\{)/);
    // 取 #bottomNav{...} 整条（不带 button）
    const re = /#bottomNav\s*\{([^}]*)\}/;
    const m2 = block.match(re);
    if (m2 && (!best || m2[1].length > best.length)) best = m2[1];
  }
  return best;
}
const bnBtn = bottomNavBtnRule(HTML);
const bnNav = bottomNavRule(HTML);
astep('Q1a 底栏按钮内容 flex-end（非 center）', !!bnBtn && /justify-content\s*:\s*flex-end/.test(bnBtn) && !/justify-content\s*:\s*center/.test(bnBtn), bnBtn ? bnBtn.slice(0, 80) : 'no-rule');
astep('Q1b 按钮底部内边距收到 4px（padding:8px 2px 4px）', !!bnBtn && /padding\s*:\s*8px 2px 4px/.test(bnBtn));
astep('Q1c #bottomNav 仍预留安全区 padding-bottom:env(safe-area-inset-bottom)', !!bnNav && /padding-bottom\s*:\s*env\(safe-area-inset-bottom\)/.test(bnNav));
// 反向：把修复点还原成 center + 8px 对称内边距，判据应 broken
const mutated = HTML.replace('justify-content:flex-end', 'justify-content:center')
                    .replace('padding:8px 2px 4px', 'padding:8px 2px');
const mBtn = bottomNavBtnRule(mutated);
astep('Q1r 反向：还原 center 后 flex-end 判据 broken', !(mBtn && /justify-content\s*:\s*flex-end/.test(mBtn)) && (mBtn && /justify-content\s*:\s*center/.test(mBtn)));

// ---- Q2：APP_VER 常量与引用 ----
astep('Q2a APP_VER=1.6.9 定义', /const APP_VER='1\.6\.9'/.test(HTML));
const refs = (HTML.match(/APP_VER/g) || []).length;
astep('Q2b APP_VER 引用 ≥5（定义+导出+关于+更新+verText）', refs >= 5, 'refs=' + refs);
astep('Q2c 导出用 version:APP_VER', /version:APP_VER/.test(HTML));
astep('Q2d 关于页用 +APP_VER 拼接', /\['软件版本','通用收银台 '\+APP_VER\]/.test(HTML));
astep('Q2e 无残留 1.6.8 版本串（版本字面量）', !/version\s*:\s*'1\.6\.8'/.test(HTML) && !/通用收银台 1\.6\.8/.test(HTML) && !/APP_VER='1\.6\.8'/.test(HTML));

// ---- Q3：六处版本号 1.6.9 ----
astep('Q3a package.json 1.6.9', /"version"\s*:\s*"1\.6\.9"/.test(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')));
astep('Q3b sw.js 缓存 v27', /pos-cache-v27/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));
const gradle = fs.readFileSync(path.join(__dirname, 'android/app/build.gradle'), 'utf8');
astep('Q3c gradle 35 + 1.6.9', /versionCode\s+35\b/.test(gradle) && /versionName\s+"1\.6\.9"/.test(gradle));
const pbx = fs.readFileSync(path.join(__dirname, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
astep('Q3d pbxproj 1.6.9×2 + 35×2', (pbx.match(/MARKETING_VERSION = 1\.6\.9/g) || []).length === 2 && (pbx.match(/CURRENT_PROJECT_VERSION = 35/g) || []).length === 2);

// ---- Q4：历史回归 ----
astep('Q4a v1.6.7 底栏 display:flex 居中仍在', !!bnBtn && /display\s*:\s*flex/.test(bnBtn) && /align-items\s*:\s*center/.test(bnBtn));
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
const cu = fnBody(HTML, 'checkUpdates');
astep('Q4c v1.6.8 Capacitor 检查更新分支仍在', cu.includes('isNativePlatform') && /releases\/latest/.test(cu) && /latest===APP_VER/.test(cu));

// ---- Q5：jsdom 行为级 ----
const vc = new VirtualConsole();
const loadErrs = [];
vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/Not implemented/.test(m)) loadErrs.push(m); });
const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  const t = () => w.document.getElementById('toast').textContent;
  w.checkUpdates();
  astep('Q5a 网页环境提示「…桌面应用或手机 App…」', /网页版/.test(t()) && /手机 App/.test(t()), t());
  w.Capacitor = { isNativePlatform: () => true };
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ tag_name: 'v1.6.9' }) });
  w.checkUpdates();
  await wait(150);
  astep('Q5b App 同版本 → 已是最新版本', t() === '已是最新版本 v1.6.9', t());
  let confirmMsg = '';
  w.confirm = m => { confirmMsg = m; return false; };
  w.fetch = () => Promise.resolve({ json: () => Promise.resolve({ tag_name: 'v1.7.0' }) });
  w.checkUpdates();
  await wait(150);
  astep('Q5c App 新版本 → confirm 报新版号', /发现新版本 v1\.7\.0/.test(confirmMsg) && /当前 v1\.6\.9/.test(confirmMsg), confirmMsg.replace(/\n/g, ' '));
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
