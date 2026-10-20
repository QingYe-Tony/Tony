/* verify_v171.js —— v1.7.1 验证
 * 用户反馈：登录后「不能同步电脑端的记录」，要求「登录就能同步记录」。
 * 根因：手机 App WebView 安全策略拦截了「https 页面 → 电脑 http 服务」的请求
 *      （Android 混合内容 allowMixedContent:false + 无 usesCleartextTraffic；
 *        iOS 无 ATS 例外、无本地网络权限），所以局域网同步在手机上根本连不上。
 * 修复：
 *   · Android：Manifest 加 usesCleartextTraffic=true；capacitor.config allowMixedContent=true
 *   · iOS：Info.plist 加 NSAppTransportSecurity(NSAllowsArbitraryLoads/NSAllowsLocalNetworking)
 *          + NSLocalNetworkUsageDescription（iOS14+ 本地网络权限）
 *   · index.html：登录时若没填同步地址，先自动发现电脑端（同 WiFi）再登录同步；
 *                登录后 syncNow 改为非静默（能看到「同步完成/失败」）；无地址时自动展开同步设置。
 *
 * 断言：
 *   R1 原生放行（Android 明文 + 混合内容；iOS ATS + 本地网络）；R1r 反向
 *   R2 登录自动发现 + 非静默同步 + 自动展开；R2r 反向
 *   R3 六处版本号 1.7.1
 *   R4 历史回归：v1.7.0 强制登录 / v1.6.9 底栏 / v1.6.8 Capacitor / v1.6.6 弹窗
 *   R5 jsdom：启动显登录门、requireLogin 语义、无致命错误
 *
 * 运行（后台）：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v171.js
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

// ---- R1：原生放行 ----
const mani = fs.readFileSync(path.join(__dirname, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
astep('R1a Android manifest usesCleartextTraffic=true', /android:usesCleartextTraffic="true"/.test(mani));
const capAsset = fs.readFileSync(path.join(__dirname, 'android/app/src/main/assets/capacitor.config.json'), 'utf8');
astep('R1b android 打包配置 allowMixedContent=true', /"allowMixedContent"\s*:\s*true/.test(capAsset));
const capRoot = fs.readFileSync(path.join(__dirname, 'capacitor.config.json'), 'utf8');
astep('R1c 根 capacitor.config allowMixedContent=true', /"allowMixedContent"\s*:\s*true/.test(capRoot));
const plist = fs.readFileSync(path.join(__dirname, 'ios/App/App/Info.plist'), 'utf8');
astep('R1d iOS ATS 放行 + 本地网络权限', /NSAppTransportSecurity/.test(plist) && /NSAllowsArbitraryLoads/.test(plist) && /NSAllowsLocalNetworking/.test(plist) && /NSLocalNetworkUsageDescription/.test(plist));
// 反向：把明文关掉，判据必须 broken
const maniBroken = mani.replace('android:usesCleartextTraffic="true"', '');
astep('R1r 反向：去掉明文放行后判据 broken', !/android:usesCleartextTraffic="true"/.test(maniBroken));

// ---- R2：登录自动发现 + 非静默同步 ----
astep('R2a 含 syncDiscover / _probeSync 定义', /function syncDiscover\(\)/.test(HTML) && /function _probeSync\(/.test(HTML));
const gsb = fnBody(HTML, 'gateSyncBind');
astep('R2b gateSyncBind 会调用 syncDiscover 自动找电脑端', /await syncDiscover\(\)/.test(gsb) && /SYNC\.base\s*=\s*base/.test(gsb));
astep('R2c 登录后非静默同步（能看到结果）', /syncNow\(\{silent:false\}\)/.test(gsb));
astep('R2d 无地址时自动展开 gateSyncDet', /gateSyncDet/.test(HTML) && /det\.open\s*=\s*true/.test(HTML));
// 反向：还原成「只看 base、不发现」
const gsbBroken = gsb.replace('try{base=await syncDiscover();}catch(e){base=\'\';}', '');
astep('R2r 反向：删掉自动发现后 R2b broken', !/await syncDiscover\(\)/.test(gsbBroken));

// ---- R3：六处版本号 1.7.1 ----
astep('R3a APP_VER=1.7.1', /const APP_VER='1\.7\.1'/.test(HTML));
astep('R3b package.json 1.7.1', /"version"\s*:\s*"1\.7\.1"/.test(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')));
astep('R3c sw.js 缓存 v29', /pos-cache-v29/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));
const gradle = fs.readFileSync(path.join(__dirname, 'android/app/build.gradle'), 'utf8');
astep('R3d gradle 37 + 1.7.1', /versionCode\s+37\b/.test(gradle) && /versionName\s+"1\.7\.1"/.test(gradle));
const pbx = fs.readFileSync(path.join(__dirname, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
astep('R3e pbxproj 1.7.1×2 + 37×2', (pbx.match(/MARKETING_VERSION = 1\.7\.1/g) || []).length === 2 && (pbx.match(/CURRENT_PROJECT_VERSION = 37/g) || []).length === 2);
astep('R3f 无残留 1.7.0 版本字面量', !/version\s*:\s*'1\.7\.0'/.test(HTML) && !/APP_VER='1\.7\.0'/.test(HTML));

// ---- R4：历史回归 ----
astep('R4a v1.7.0 强制登录', /function requireLogin\(\)\{return !SESSION;\}/.test(HTML) && /S\.shop\.loginRequired=true;/.test(HTML));
astep('R4b v1.6.9 底栏 flex-end', /justify-content:flex-end/.test(HTML));
astep('R4c v1.6.8 Capacitor 检查更新', /isNativePlatform/.test(fnBody(HTML, 'checkUpdates')));
astep('R4d v1.6.6 弹窗圆角', /border-radius:16px/.test(HTML));

// ---- R5：jsdom 启动 ----
const vc = new VirtualConsole();
const loadErrs = [];
vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/Not implemented/.test(m)) loadErrs.push(m); });
const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(60);
  const gate = w.document.getElementById('loginGate');
  astep('R5a 启动即显登录门', gate && !gate.classList.contains('hidden'));
  astep('R5b 未登录 requireLogin=true', w.eval('requireLogin()') === true);
  astep('R5c jsdom 无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));
  clearTimeout(watchdog);
  const P = results.filter(r => r.ok).length, F = results.length - P;
  log(`TOTAL=${results.length} PASS=${P} FAIL=${F} ${F === 0 ? 'ALL GREEN' : 'HAS FAIL'}`);
  process.exit(F === 0 ? 0 : 1);
})();
