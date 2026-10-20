/* verify_v172.js —— v1.7.2 验证
 * 用户反馈：「还是不能同步电脑端」（截图里地址填的是 http://192.1b1.9:9797）。
 *
 * 实测这台电脑：局域网 IP = 192.168.31.223，同步服务在 8787 正常监听；
 * 服务器库里只有一个账号 a970005426@qq.com（店名「艾哩造型美发SALON」，
 * 4 商品 / 2 会员 / 14 订单）；而手机本机账号是 q9**@qq.com —— 不是同一个。
 *
 * 两个根因：
 *   ① 自动发现只扫 .2~.30，可 DHCP 把电脑分到 .223 → 永远扫不到，且完全静默；
 *   ② 地址填错也只回一句「已保存」，用户以为配好了；账号不同更是毫无提示。
 *
 * 修复：
 *   · syncDiscover 扫整段 1~254（并发 128 / 400ms 超时 / 9s 硬截止）+ 新增「扫描局域网」按钮
 *   · 地址保存即规范化（补 http://）并当场探测，连不上/端口不对/不是 IP 都明确说
 *   · 设置页摊开「服务器 N 商品/M 会员/K 订单 vs 本机」，空店时直指「账号不是同一个」
 *   · 设置页自报版本 + 运行环境（用户能确认装的是哪一版）
 *   · 登录时把 401 / 404(新建空店) 分开提示；syncNow 结果带上传/下载条数
 *
 * 断言：
 *   S1 自动发现扫整段（含 .223 这种高端地址）；S1r 反向
 *   S2 地址规范化 + 保存即测 + 端口提示；S2r 反向
 *   S3 服务器/本机数据对比 + 空店告警；S3r 反向
 *   S4 版本与环境自报
 *   S5 登录提示区分 401/404；S5r 反向
 *   S6 syncNow 结果带条数
 *   S7 六处版本号 1.7.2
 *   S8 历史回归（v1.7.1 原生放行 / v1.7.0 强制登录 / v1.6.9 底栏 / v1.6.8）
 *   S9 jsdom：启动登录门 + 设置页渲染 + 无致命错误
 *
 * 运行（后台）：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v172.js
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

// ---- S1：自动发现扫整段（修 .223 扫不到的 bug） ----
const disc = fnBody(HTML, 'syncDiscover');
astep('S1a syncDiscover 扫满整段 1~254', /for\(let i=1;i<=254;i\+\+\)/.test(disc));
astep('S1b 不再只扫 .2~.30', !/i<=30;/.test(disc) && !/i=2;i<=30/.test(disc));
astep('S1c 有 9s 硬截止 + 高并发', /Date\.now\(\)\+9000/.test(disc) && /i<128/.test(disc));
astep('S1d 网段表含 192.168.31（用户实际网段）', /'192\.168\.31'/.test(disc));
// 反向：把整段改回 .2~.30，S1a 必须 broken
const discBroken = disc.replace('for(let i=1;i<=254;i++)', 'for(let i=2;i<=30;i++)');
astep('S1r 反向：改回 .2~.30 后 S1a broken', !/for\(let i=1;i<=254;i\+\+\)/.test(discBroken));

// ---- S2：地址规范化 + 保存即测 ----
astep('S2a 有 syncNormBase 且会自动补 http://', /function syncNormBase\(/.test(HTML)
  && /if\(!\/\^\[a-z\]\[a-z0-9\+\.-\]\*:\\\/\\\/\/i\.test\(s\)\)s='http:\/\/'\+s;/.test(HTML));
const setb = fnBody(HTML, 'syncSetBase');
astep('S2b 保存后立刻探测（不再只弹「已保存」）', /_probeSync\(v,/.test(setb));
astep('S2c 连不上时点名端口 8787（不是 9797/8080）', /8797|9797/.test(setb) && /8787/.test(setb));
astep('S2d 非 IP 形式有明确告警', /不是 IP 形式/.test(setb));
// 反向：删掉探测，S2b broken
astep('S2r 反向：去掉探测后 S2b broken', !/_probeSync\(v,/.test(setb.replace(/const ok=await _probeSync\(v,1800\);/, '')));

// ---- S3：服务器 / 本机数据对比（账号不同一眼可见） ----
const stat = fnBody(HTML, 'refreshSyncStat');
astep('S3a refreshSyncStat 读 /api/me 与 /api/shop', /'\/api\/me'/.test(stat) && /'\/api\/shop'/.test(stat));
astep('S3b 同时显示服务器与本机条数', /服务器：/.test(stat) && /本机：/.test(stat));
astep('S3c 服务器为空而本机有数据 → 指针账号不一致', /这个账号在服务器上还是空的/.test(stat));
astep('S3d renderSyncBox 末尾会刷新该统计', /refreshSyncStat\(\);/.test(fnBody(HTML, 'renderSyncBox')));
astep('S3e 已登录分支有 #syncStat 容器', /id="syncStat"/.test(HTML));
// 反向：去掉空店告警，S3c broken
astep('S3r 反向：删掉空店告警后 S3c broken', !/这个账号在服务器上还是空的/.test(
  stat.replace('这个账号在服务器上还是空的', '')));

// ---- S4：版本与环境自报 ----
const env = fnBody(HTML, 'envLabel');
astep('S4a envLabel 区分桌面/手机App/网页', /桌面版/.test(env) && /手机 App/.test(env) && /网页版/.test(env));
astep('S4b 设置页显示当前版本号', /当前版本 <b>v'\+esc\(APP_VER\)/.test(HTML));

// ---- S5：登录提示区分 401 / 404 ----
const gsb = fnBody(HTML, 'gateSyncBind');
astep('S5a 401（密码不同）有明确提示', /密码不同/.test(gsb));
astep('S5b 404 新建空店有明确提示', /created/.test(gsb) && /已新建（空店）/.test(gsb));
astep('S5c 网络错误不再误触发注册', !/e\.status===404\|\|!e\.status/.test(gsb));
// 反向：把提示删掉，S5a broken
astep('S5r 反向：删掉 401 提示后 S5a broken', !/密码不同/.test(gsb.replace(/密码不同/g, '')));

// ---- S6：syncNow 结果带条数 ----
const now = fnBody(HTML, 'syncNow');
astep('S6a 完成提示带上传/下载条数', /上传 '\+upOrders\+' 笔、下载 '\+downOrders\+' 笔订单/.test(now));
astep('S6b 本机无订单时给出解释', /这个账号名下还没有订单/.test(now));

// ---- S7：六处版本号 1.7.2 ----
astep('S7a APP_VER=1.7.2', /const APP_VER='1\.7\.2'/.test(HTML));
astep('S7b package.json 1.7.2', /"version"\s*:\s*"1\.7\.2"/.test(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')));
astep('S7c sw.js pos-cache-v30', /pos-cache-v30/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));
const gradle = fs.readFileSync(path.join(__dirname, 'android/app/build.gradle'), 'utf8');
astep('S7d gradle versionCode 38 + 1.7.2', /versionCode\s+38\b/.test(gradle) && /versionName\s+"1\.7\.2"/.test(gradle));
const pbx = fs.readFileSync(path.join(__dirname, 'ios/App/App.xcodeproj/project.pbxproj'), 'utf8');
astep('S7e pbxproj 1.7.2×2 + 38×2',
  (pbx.match(/MARKETING_VERSION = 1\.7\.2/g) || []).length === 2 &&
  (pbx.match(/CURRENT_PROJECT_VERSION = 38/g) || []).length === 2);
astep('S7f 无残留 1.7.1 版本字面量', !/APP_VER='1\.7\.1'/.test(HTML) && !/pos-cache-v29/.test(fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8')));

// ---- S8：历史回归 ----
astep('S8a v1.7.1 Android 明文放行仍在', /android:usesCleartextTraffic="true"/.test(
  fs.readFileSync(path.join(__dirname, 'android/app/src/main/AndroidManifest.xml'), 'utf8')));
astep('S8b v1.7.1 iOS ATS 仍在', /NSAllowsLocalNetworking/.test(
  fs.readFileSync(path.join(__dirname, 'ios/App/App/Info.plist'), 'utf8')));
astep('S8c v1.7.0 强制登录', /function requireLogin\(\)\{return !SESSION;\}/.test(HTML)
  && /S\.shop\.loginRequired=true;/.test(HTML));
astep('S8d v1.6.9 底栏 flex-end', /justify-content:flex-end/.test(HTML));
astep('S8e v1.6.8 Capacitor 检查更新', /isNativePlatform/.test(fnBody(HTML, 'checkUpdates')));

// ---- S9：jsdom ----
const vc = new VirtualConsole();
const loadErrs = [];
vc.on('jsdomError', e => { const m = String(e && e.message || e); if (!/Not implemented/.test(m)) loadErrs.push(m); });
const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
const w = dom.window;
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(60);
  const gate = w.document.getElementById('loginGate');
  astep('S9a 启动即显登录门', gate && !gate.classList.contains('hidden'));
  astep('S9b 未登录 requireLogin=true', w.eval('requireLogin()') === true);
  // 渲染设置页同步区（未登录分支）：必须能自报版本、且不抛错
  let renderOk = false, boxHtml = '';
  try {
    w.eval("renderSyncBox()");
    const box = w.document.getElementById('syncBox');
    boxHtml = box ? box.innerHTML : '';
    renderOk = boxHtml.indexOf('v1.7.2') >= 0;
  } catch (e) { renderOk = false; boxHtml = String(e && e.message || e); }
  astep('S9c 设置页渲染并自报 v1.7.2', renderOk, renderOk ? '' : boxHtml.slice(0, 80));
  astep('S9d jsdom 无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));
  clearTimeout(watchdog);
  const P = results.filter(r => r.ok).length, F = results.length - P;
  log(`TOTAL=${results.length} PASS=${P} FAIL=${F} ${F === 0 ? 'ALL GREEN' : 'HAS FAIL'}`);
  process.exit(F === 0 ? 0 : 1);
})();
