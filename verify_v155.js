/* verify_v155.js —— v1.5.5 清空数据重构验证
 * 校验：① 清空按钮改走 openClearData 弹窗；② 按模块分别清空（商品/订单）；
 *       ③ 会员始终保留；④ 需密码授权（错密码拦截）；⑤ 修复「清空不生效」——
 *          清商品走墓碑 markDeleted、清订单推 deleted:true 上云（两端同步删）。
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules \
 *       node verify_v155.js
 * 注意：用 fs.writeSync(1,...) 直接写 fd1，避免管道缓冲导致进程退出时丢输出。
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

(async () => {
  log('START');
  const watchdog = setTimeout(() => { log('WATCHDOG TIMEOUT'); process.exit(9); }, 25000);
  const vc = new VirtualConsole();
  const loadErrs = [];
  vc.on('jsdomError', e => loadErrs.push(String(e && e.message || e)));
  const dom = new JSDOM(HTML, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: 'http://localhost/',
    virtualConsole: vc,
  });
  const w = dom.window;
  log('JSDOM created');
  await new Promise(r => setTimeout(r, 300));
  log('script settled');

  astep('页面脚本无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));

  astep('openClearData 已定义', typeof w.openClearData === 'function');
  astep('doClearData 已定义', typeof w.doClearData === 'function');
  astep('pushOrderDeletes 已定义', typeof w.pushOrderDeletes === 'function');
  astep('wipeData 已移除', typeof w.wipeData === 'undefined');
  astep('清空弹窗存在', !!w.document.getElementById('clearDataModal'));
  astep('商品勾选框存在', !!w.document.getElementById('cdProducts'));
  astep('订单勾选框存在', !!w.document.getElementById('cdOrders'));
  astep('密码输入框存在', !!w.document.getElementById('cdPass'));
  const btns = [...w.document.querySelectorAll('button')].filter(b => b.textContent.trim() === '清空全部数据');
  astep('两处清空按钮都指向 openClearData', btns.length === 2 && btns.every(b => /openClearData\(\)/.test(b.getAttribute('onclick') || '')), '按钮数=' + btns.length);

  await w.eval(`acctCreate('13800000000','phone','secret123')`);
  await w.eval(`SYNC.account='13800000000'; SYNC.token='test-token';`);
  await w.eval(`window.__reqs=[]; window.__md=[];
    const _md=markDeleted;
    markDeleted=function(k,r){ window.__md.push(k); return _md(k,r); };
    syncReq=function(m,u,b){ window.__reqs.push({m:m,u:u,b:b}); return Promise.resolve({rev:1,applied:0,orders:[]}); };`);

  // ---- 场景1：密码正确，商品+订单都勾选 ----
  await w.eval(`S.products=[{id:'p1',name:'A'},{id:'p2',name:'B'}];
    S.orders=[{id:'o1'},{id:'o2'}];
    S.members=[{id:'m1',name:'会员1'},{id:'m2',name:'会员2'}];
    save();`);
  await w.eval(`openClearData();
    document.getElementById('cdProducts').checked=true;
    document.getElementById('cdOrders').checked=true;
    document.getElementById('cdPass').value='secret123';`);
  await w.eval(`doClearData()`);
  await new Promise(r => setTimeout(r, 200));
  let st = JSON.parse(await w.eval(`JSON.stringify({
    products:S.products.length, orders:S.orders.length, members:S.members.length,
    md:window.__md, reqs:window.__reqs.map(x=>({m:x.m,u:x.u,del:(x.b&&x.b.upserts)?x.b.upserts.map(u=>u.deleted+'|'+u.order_uid):null}))
  })`));
  astep('场景1 商品被清空', st.products === 0, 'products=' + st.products);
  astep('场景1 订单被清空', st.orders === 0, 'orders=' + st.orders);
  astep('场景1 会员被保留(2条)', st.members === 2, 'members=' + st.members);
  astep('场景1 未对会员登记墓碑', !st.md.includes('members'), 'md=' + JSON.stringify(st.md));
  astep('场景1 商品走墓碑', st.md.filter(k => k === 'products').length === 2, 'md=' + JSON.stringify(st.md));
  const orderPush = (st.reqs || []).find(r => r.u === '/api/orders' && r.m === 'PUT');
  astep('场景1 订单删除已上推云端(deleted:true)', !!orderPush && orderPush.del && orderPush.del.every(d => d.startsWith('true|')), JSON.stringify(orderPush && orderPush.del));

  // ---- 场景2：密码错误应被拦截 ----
  await w.eval(`S.products=[{id:'p3',name:'C'}]; S.orders=[{id:'o3'}]; S.members=[{id:'m3',name:'M3'}]; save();
    window.__md=[]; window.__reqs=[];
    openClearData();
    document.getElementById('cdProducts').checked=true; document.getElementById('cdOrders').checked=true;
    document.getElementById('cdPass').value='wrong-pass';`);
  await w.eval(`doClearData()`);
  await new Promise(r => setTimeout(r, 150));
  let st2 = JSON.parse(await w.eval(`JSON.stringify({products:S.products.length, orders:S.orders.length, members:S.members.length, md:window.__md, reqs:window.__reqs.length})`));
  astep('场景2 错密码不清除商品', st2.products === 1, 'products=' + st2.products);
  astep('场景2 错密码不清除订单', st2.orders === 1, 'orders=' + st2.orders);
  astep('场景2 错密码未触发任何墓碑/上推', st2.md.length === 0 && st2.reqs === 0, 'md=' + JSON.stringify(st2.md) + ' reqs=' + st2.reqs);

  // ---- 场景3：只清订单（商品保留） ----
  await w.eval(`S.products=[{id:'p4'},{id:'p5'}]; S.orders=[{id:'o4'},{id:'o5'}]; S.members=[{id:'m4'}]; save();
    window.__md=[]; window.__reqs=[];
    openClearData();
    document.getElementById('cdProducts').checked=false; document.getElementById('cdOrders').checked=true;
    document.getElementById('cdPass').value='secret123';`);
  await w.eval(`doClearData()`);
  await new Promise(r => setTimeout(r, 150));
  let st3 = JSON.parse(await w.eval(`JSON.stringify({products:S.products.length, orders:S.orders.length, md:window.__md})`));
  astep('场景3 只清订单→商品保留(2)', st3.products === 2, 'products=' + st3.products);
  astep('场景3 只清订单→订单清空', st3.orders === 0, 'orders=' + st3.orders);
  astep('场景3 未对商品登记墓碑', !st3.md.includes('products'), 'md=' + JSON.stringify(st3.md));

  const failed = results.filter(r => !r.ok);
  log('\n==== 结果: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ====');
  clearTimeout(watchdog);
  if (failed.length) { log('失败项: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
  process.exit(0);
})().catch(e => { log('运行异常: ' + (e && e.stack || e)); process.exit(2); });
