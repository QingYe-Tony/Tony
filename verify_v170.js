/* verify_v170.js —— v1.7.0 验证
 * 需求：取消「离线也能用（不登录直接收银）」，改成**所有端必须登录账号**。
 * 做法：
 *   · DEF_S.loginRequired 默认 true；normalize() 强制迁移为 true（老数据也强制）
 *   · requireLogin() 改为 return !SESSION（只要没会话就必须登录，不再看开关）
 *   · 设置页「要求登录」开关改成 checked+disabled（强制，不可关闭）；saveStaff 恒置 true
 *   · 启动时未登录不 switchTab('dash')（主界面不渲染，登录门覆盖全屏）
 * 说明：登录仍用本机账号（离线登录），即「必须登录」而非「必须联网」——
 *      登录后断网照常收银；这是 POS 的合理取向。
 *
 * 断言：
 *   P1  requireLogin 恒真 / DEF_S 默认 true / normalize 强制 / 启动守卫；P1r 反向
 *   P2  APP_VER=1.7.0 + 引用≥5 + 无残留 1.6.9 版本串
 *   P3  六处版本号（package.json / sw v28 / gradle 36+1.7.0 / pbxproj 1.7.0×2 + 36×2）
 *   P4  历史回归：v1.6.9 底栏 flex-end、v1.6.8 Capacitor、v1.6.7 display:flex、v1.6.6 弹窗
 *   P5  jsdom 行为级：a)启动即显登录门 b)未登录 requireLogin=true
 *       c)设会话后 false d)退出后门再现 e)saveStaff 强制 true f)无致命错误
 *
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v170.js（后台）
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

// ---- P1：强制登录核心逻辑 ----
const reqBody = fnBody(HTML, 'requireLogin');
astep('P1a requireLogin 只在无会话时拦截（return !SESSION）', /return\s*!\s*SESSION/.test(reqBody), reqBody.slice(0, 80));
astep('P1b DEF_S 默认 loginRequired:true', /loginRequired:true/.test(HTML));
astep('P1c normalize 强制 S.shop.loginRequired=true', /S\.shop\.loginRequired\s*=\s*true;/.test(HTML));
astep('P1d 启动守卫：未登录不 switchTab(dash)', /if\(!requireLogin\(\)\)switchTab\('dash'\)/.test(HTML));
// 反向：还原成旧的「看开关」逻辑，P1a 判据必须 broken
const p1aRe = /return\s*!\s*SESSION\s*;?/;
const mutatedReq = reqBody.replace('return !SESSION;', 'return !!(S.shop.loginRequired&&!SESSION);');
astep('P1r 反向：还原旧开关逻辑后 P1a broken',
  /return\s*!\s*SESSION\s*;?/.test(reqBody) && !p1aRe.test(mutatedReq) && /S\.shop\.loginRequired&&!SESSION/.test(mutatedReq));

// ---- P2：APP_VER 1.7.0 ----
astep('P2a APP_VER=1.7.0 定义', /const APP_VER='1\.7\.0'/.test(HTML));
const refs = (HTML.match(/APP_VER/g) || []).length;
astep('P2b APP_VER 引用 ≥5', refs >= 5, 'refs=' + refs);
astep('P2c 导出用 version:APP_VER', /version:APP_VER/.test(HTML));
astep('P2d 无残留 1.6.9 版本字面量', !/version\s*:\s*'1\.6\.9'/.test(HTML) && !/通用收银台 1\.6\.9/.test(HTML) && !/APP_VER='1\.6\.9'/.test(HTML));

// ---- P3：六处版本号 1.7.0 ----
astep('P3a package.json 1.7.0', /"version"\s*:\s*"1\.7\.0"/.test(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')));
astep('P3b sw.js 缓存 v28', /pos-cache-v28/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));
const gradle = fs.readFileSync(path.join(__dirname, 'android/app/build.gradle'), 'utf8');
astep('P3c gradle 36 + 1.7.0', /versionCode\s+36\b/.test(gradle) && /versionName\s+"1\.7\.0"/.test(gradle));
const pbx = fs.readFileSync(path.join(__dirname, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
astep('P3d pbxproj 1.7.0×2 + 36×2', (pbx.match(/MARKETING_VERSION = 1\.7\.0/g) || []).length === 2 && (pbx.match(/CURRENT_PROJECT_VERSION = 36/g) || []).length === 2);

// ---- P4：历史回归 ----
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
const bnBtn = bottomNavBtnRule(HTML);
astep('P4a v1.6.9 底栏 flex-end 仍在', !!bnBtn && /justify-content\s*:\s*flex-end/.test(bnBtn) && /display\s*:\s*flex/.test(bnBtn));
const cu = fnBody(HTML, 'checkUpdates');
astep('P4b v1.6.8 Capacitor 检查更新分支仍在', cu.includes('isNativePlatform') && /releases\/latest/.test(cu) && /latest===APP_VER/.test(cu));
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
astep('P4c v1.6.6 弹窗修复仍在', !!mod && !/height\s*:\s*100vh/.test(mod) && /border-radius\s*:\s*16px/.test(mod));
astep('P4d 设置开关已强制（checked disabled）', /id="stEnable" checked disabled/.test(HTML));

// ---- P5：jsdom 行为级 ----
const vc = new VirtualConsole();
const loadErrs = [];
vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/Not implemented/.test(m)) loadErrs.push(m); });
const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(60); // 让 boot 内的 setTimeout(focus) 等跑完
  const gate = () => w.document.getElementById('loginGate');
  const gateVisible = () => gate() && !gate().classList.contains('hidden');
  astep('P5a 启动即显示登录门（未登录不可进主界面）', gateVisible());
  astep('P5b 未登录 requireLogin()=true', w.eval('requireLogin()') === true);
  // 模拟登录：直接置会话（登录门内部就是置 SESSION）
  w.eval('SESSION={staffId:"owner"}');
  astep('P5c 登录后 requireLogin()=false', w.eval('requireLogin()') === false);
  // 退出登录 → 门再现
  w.eval('doAppLogout()');
  await wait(30);
  astep('P5d 退出后登录门再现 + requireLogin=true', gateVisible() && w.eval('requireLogin()') === true);
  // 设置里试图关掉开关，saveStaff 仍强制 true
  w.eval('S.shop.loginRequired=false');
  const st = w.document.getElementById('stEnable'); if (st) st.checked = false;
  w.eval('saveStaff()');
  astep('P5e saveStaff 强制 loginRequired=true（开关无法关闭）', w.eval('S.shop.loginRequired') === true);
  astep('P5f jsdom 无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));

  clearTimeout(watchdog);
  const P = results.filter(r => r.ok).length, F = results.length - P;
  log(`TOTAL=${results.length} PASS=${P} FAIL=${F} ${F === 0 ? 'ALL GREEN' : 'HAS FAIL'}`);
  process.exit(F === 0 ? 0 : 1);
})();
