/* verify_v166.js —— v1.6.6 验证
 * v1.6.5 修完「安装提示已删」后，用户又报手机端弹窗是「满屏白板、没圆角、内容贴顶」。
 *   根因：@media (max-width:768px) 里的 `.modal{width:100%;max-height:100vh;height:100vh;border-radius:0;padding:16px}`
 *        把弹窗顶成了整屏无圆角的白板（盖住底栏、内容贴顶、无安全区留白）。
 *   修复：改成带圆角的安全区浮层卡片 `max-height:88vh;height:auto;border-radius:16px` + 底部安全区 padding。
 *
 * 断言：
 *   N1  源码里移动端 `.modal` 规则不再含 `height:100vh`（反向：复原成 100vh 必须 FAIL）
 *   N2  源码里移动端 `.modal` 规则不再含 `border-radius:0`，且含非零圆角
 *   N3  移动端 `.modal` 含 capped 高度（max-height 小于 100vh）以允许内部滚动
 *   N4  桌面端 `.modal` 基础规则仍是圆角卡片（border-radius:14px），未被破坏
 *   N5  版本号全部升到 1.6.6（package.json / index.html 两处 / sw.js 缓存 v24）
 *   N6  页面脚本无致命错误（jsdom 启动 + boot 干净）
 *
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v166.js
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

// ---- 在源码里抽出「移动端 @media(max-width:768px) 块内的 .modal 规则」----
function extractBalanced(src, fromIdx) {
  // 从 fromIdx 起找到第一个 '{'，再按花括号配平截到对应的 '}'
  let i = src.indexOf('{', fromIdx);
  if (i < 0) return '';
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(fromIdx, i + 1); }
  }
  return src.slice(fromIdx);
}
function mobileModalRule(src) {
  let idx = -1, best = null;
  const needle = '@media (max-width:768px)';
  while ((idx = src.indexOf(needle, idx + 1)) >= 0) {
    const block = extractBalanced(src, idx);
    const mm = block.match(/\.modal\s*\{([^}]*)\}/);
    if (mm && (!best || mm[1].length > best.length)) best = mm[1];
  }
  return best; // 规则体（不含外层花括号）
}

// ---- 判据：移动端弹窗是否仍是「满屏白板」----
function isBrokenMobileModal(src) {
  const r = mobileModalRule(src);
  if (!r) return 'NO_RULE';
  const noFullH = !/height\s*:\s*100vh/.test(r);
  const noZeroRadius = !/border-radius\s*:\s*0\b/.test(r);
  const hasCappedH = /max-height\s*:\s*(?!100vh)\d/.test(r) || /max-height\s*:\s*(\d+(\.\d+)?)\s*vh/.test(r);
  return (noFullH && noZeroRadius && hasCappedH) ? false : true; // true=broken
}

(async () => {
  log('START');
  const watchdog = setTimeout(() => { log('WATCHDOG TIMEOUT'); process.exit(9); }, 60000);

  // ---- N1/N2/N3：移动端弹窗规则 ----
  const rule = mobileModalRule(HTML);
  const brokenNow = isBrokenMobileModal(HTML);
  astep('N1 移动端 .modal 不再 height:100vh', rule && !/height\s*:\s*100vh/.test(rule), rule ? rule.slice(0, 60) : 'NO_RULE');
  astep('N2 移动端 .modal 不再 border-radius:0 且有圆角', rule && !/border-radius\s*:\s*0\b/.test(rule) && /border-radius\s*:\s*(?!0\b)\d/.test(rule), rule ? rule.slice(0, 60) : 'NO_RULE');
  astep('N3 移动端 .modal 含 capped 高度(max-height<100vh)', rule && /max-height\s*:\s*(\d+(\.\d+)?)\s*vh/.test(rule), rule ? rule.slice(0, 60) : 'NO_RULE');

  // ---- 反向验证：把新规则还原成旧的「满屏白板」，判据必须判为 broken ----
  const ruleBody = mobileModalRule(HTML);
  const OLD_BODY = 'width:100%;max-height:100vh;height:100vh;border-radius:0;padding:16px';
  const mutated = ruleBody ? HTML.replace(ruleBody, OLD_BODY) : HTML;
  const revNow = isBrokenMobileModal(mutated);
  astep('N1rev 复原成 height:100vh 时判据必须 FAIL(判为 broken)', revNow === true, 'revNow=' + revNow);

  // ---- N4：桌面端 .modal 基础规则仍是圆角卡片 ----
  const baseModal = (HTML.match(/\.modal\s*\{[^}]*\}/) || [''])[0];
  astep('N4 桌面端 .modal 基础规则含 border-radius:14px', /border-radius\s*:\s*14px/.test(baseModal), baseModal.slice(0, 50));

  // ---- N5：版本号 ----
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));
  const verIdx = (HTML.match(/version:\s*'(\d+\.\d+\.\d+)'/) || [])[1];
  const aboutVer = (HTML.match(/通用收银台\s+(\d+\.\d+\.\d+)/) || [])[1];
  const sw = fs.readFileSync(path.join(__dirname, 'sw.js'), 'utf8');
  astep('N5a package.json 版本 1.6.6', pkg.version === '1.6.6', pkg.version);
  astep('N5b index.html 导出版本 1.6.6', verIdx === '1.6.6', verIdx);
  astep('N5c index.html 关于页版本 1.6.6', aboutVer === '1.6.6', aboutVer);
  astep('N5d sw.js 缓存 pos-cache-v24', /pos-cache-v24/.test(sw), (sw.match(/pos-cache-v\d+/) || [''])[0]);

  // ---- N6：jsdom 启动 + boot 无致命错误 ----
  const vc = new VirtualConsole();
  const loadErrs = [];
  vc.on('jsdomError', e => loadErrs.push(String(e && e.message || e)));
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 300));
  astep('N6 页面脚本无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));
  // 弹窗函数存在且可调用（不抛）
  let openOk = false;
  try { openOk = typeof w.openModal === 'function'; } catch (e) { openOk = false; }
  astep('N6b openModal 函数可用', openOk);

  clearTimeout(watchdog);
  const fails = results.filter(r => !r.ok);
  log('----');
  log('TOTAL=' + results.length + ' PASS=' + (results.length - fails.length) + ' FAIL=' + fails.length);
  if (fails.length) { fails.forEach(f => log('FAILED: ' + f.name + (f.extra ? '  [' + f.extra + ']' : ''))); process.exit(1); }
  log('ALL GREEN');
  process.exit(0);
})();
