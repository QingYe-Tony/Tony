/* verify_v156.js —— v1.5.6 验证（在 v1.5.5 基础上加固「删完了又出现」+ 弹窗 UI 修正）
 * 新增断言：
 *  A. UI：弹窗里只有 商品/订单 两个勾选框（勾选框在文字前面），【没有】清空会员的勾选框；
 *  B. 核心回归：清空订单时即使向云端推送失败（断网/服务器没开），
 *     本机墓碑也要拦住同步拉取 —— 订单不会被拉回（旧版就是这里「删完了又出现」）。
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v156.js
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
  const dom = new JSDOM(HTML, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'http://localhost/', virtualConsole: vc });
  const w = dom.window;
  log('JSDOM created');
  await new Promise(r => setTimeout(r, 300));

  astep('页面脚本无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));
  astep('openClearData 已定义', typeof w.openClearData === 'function');
  astep('doClearData 已定义', typeof w.doClearData === 'function');
  astep('pushOrderDeletes 已定义', typeof w.pushOrderDeletes === 'function');
  astep('wipeData 已移除', typeof w.wipeData === 'undefined');

  // ---- A. 弹窗 UI ----
  const modal = w.document.getElementById('clearDataModal');
  astep('清空弹窗存在', !!modal);
  const boxes = modal ? [...modal.querySelectorAll('input[type=checkbox]')] : [];
  astep('弹窗里只有 2 个勾选框（商品/订单），没有清空会员的勾选框',
    boxes.length === 2 && !!w.document.getElementById('cdProducts') && !!w.document.getElementById('cdOrders'),
    'checkbox数=' + boxes.length);
  const rowsOk = boxes.length === 2 && boxes.every(b => {
    const row = b.closest('.switch-row');
    if (!row) return false;
    const firstEl = [...row.childNodes].find(n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    return firstEl === b;   // 勾选框必须是行里第一个元素（在文字前面）
  });
  astep('勾选框在文字前面（switch-row 首元素）', rowsOk);
  const memberTxt = modal ? modal.textContent : '';
  astep('会员行明确写「始终保留」且无勾选框', /始终保留/.test(memberTxt) && !/会员（.*）/.test(memberTxt));

  // ---- 准备环境 ----
  await w.eval(`acctCreate('13800000000','phone','secret123')`);
  await w.eval(`SYNC.account='13800000000'; SYNC.token='test-token';`);
  await w.eval(`window.__reqs=[]; window.__md=[];
    const _md=markDeleted;
    markDeleted=function(k,r){ window.__md.push(k); return _md(k,r); };
    syncReq=function(m,u,b){ window.__reqs.push({m:m,u:u,b:b}); return Promise.resolve({rev:1,applied:0,orders:[]}); };`);

  // ---- 场景1：密码正确，商品+订单都清 ----
  await w.eval(`S.products=[{id:'p1'},{id:'p2'}]; S.orders=[{id:'o1'},{id:'o2'}];
    S.members=[{id:'m1'},{id:'m2'}]; save();`);
  await w.eval(`openClearData();
    document.getElementById('cdProducts').checked=true;
    document.getElementById('cdOrders').checked=true;
    document.getElementById('cdPass').value='secret123';`);
  await w.eval(`doClearData()`);
  await new Promise(r => setTimeout(r, 200));
  let s1 = JSON.parse(await w.eval(`JSON.stringify({p:S.products.length,o:S.orders.length,m:S.members.length,md:window.__md})`));
  astep('场景1 商品清空', s1.p === 0, 'products=' + s1.p);
  astep('场景1 订单清空', s1.o === 0, 'orders=' + s1.o);
  astep('场景1 会员保留(2)', s1.m === 2, 'members=' + s1.m);
  astep('场景1 商品+订单都登记了墓碑', s1.md.filter(k => k === 'products').length === 2 && s1.md.filter(k => k === 'orders').length === 2, JSON.stringify(s1.md));

  // ---- 场景2：错密码拦截 ----
  await w.eval(`S.products=[{id:'p3'}]; S.orders=[{id:'o3'}]; save(); window.__md=[];
    openClearData(); document.getElementById('cdPass').value='wrong';`);
  await w.eval(`doClearData()`);
  await new Promise(r => setTimeout(r, 150));
  let s2 = JSON.parse(await w.eval(`JSON.stringify({p:S.products.length,o:S.orders.length,md:window.__md.length})`));
  astep('场景2 错密码：数据一条不动', s2.p === 1 && s2.o === 1 && s2.md === 0, JSON.stringify(s2));

  // ---- 场景3：只清订单，商品保留 ----
  await w.eval(`S.products=[{id:'p4'},{id:'p5'}]; S.orders=[{id:'o4'},{id:'o5'}]; save(); window.__md=[];
    openClearData(); document.getElementById('cdProducts').checked=false;
    document.getElementById('cdOrders').checked=true; document.getElementById('cdPass').value='secret123';`);
  await w.eval(`doClearData()`);
  await new Promise(r => setTimeout(r, 150));
  let s3 = JSON.parse(await w.eval(`JSON.stringify({p:S.products.length,o:S.orders.length})`));
  astep('场景3 只清订单：商品保留(2) 订单清空', s3.p === 2 && s3.o === 0, JSON.stringify(s3));

  // ---- 场景4（核心回归）：云端推送失败，同步把旧订单推回来也必须拦住 ----
  await w.eval(`S.orders=[{id:'o6'},{id:'o7'}]; save(); window.__md=[]; window.__reqs=[];
    syncReq=function(m,u,b){
      if(m==='PUT'&&u==='/api/orders') return Promise.reject(new Error('network down'));  // 云端删除失败
      if(m==='GET'&&String(u).indexOf('/api/orders')===0)
        return Promise.resolve({rev:99,orders:[{order_uid:'o6',deleted:false,payload:{id:'o6',time:'t'}},
                                               {order_uid:'o7',deleted:false,payload:{id:'o7',time:'t'}}]}); // 云端还当它们存在
      return Promise.resolve({rev:1,applied:0,orders:[]});
    };
    openClearData(); document.getElementById('cdProducts').checked=false;
    document.getElementById('cdOrders').checked=true; document.getElementById('cdPass').value='secret123';`);
  await w.eval(`doClearData()`);            // 清空（推送失败但本机墓碑已登记）
  await new Promise(r => setTimeout(r, 200));
  await w.eval(`syncPullOrders()`);         // 再拉一次：云端说这两单还在(deleted:false)
  await new Promise(r => setTimeout(r, 150));
  let s4 = JSON.parse(await w.eval(`JSON.stringify({o:S.orders.length, del:(S._del.orders||[])})`));
  astep('场景4 推送失败后订单仍为空（不再「删完了又出现」）', s4.o === 0, 'orders=' + s4.o);
  astep('场景4 订单墓碑已登记(o6,o7)', (s4.del || []).indexOf('o6') >= 0 && (s4.del || []).indexOf('o7') >= 0, JSON.stringify(s4.del));
  astep('场景4 墓碑上限提到 5000', /_del\[key\]\.length>5000/.test(HTML), '');

  const failed = results.filter(r => !r.ok);
  log('\n==== 结果: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ====');
  clearTimeout(watchdog);
  if (failed.length) { log('失败项: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
  process.exit(0);
})().catch(e => { log('运行异常: ' + (e && e.stack || e)); process.exit(2); });
