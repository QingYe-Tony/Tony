/* verify_v157.js —— v1.5.7 验证
 * 本版两件事：
 *  ① 清空弹窗加回「清空会员」可勾选项（默认不勾）—— 用户明确要求「不是给我🔒不能清理」；
 *  ② 收银台「选择会员 / 姓名 / 手机号」三个控件合并成一个搜索框。
 * 断言：
 *  A. 弹窗有 3 个勾选框（商品/订单/会员），勾选框在文字前面，会员默认不勾，不再写「始终保留」；
 *  B. 勾会员 → 会员清空 + 登记 members 墓碑 + 同步合入远端旧会员也不复活；
 *  C. 不勾会员 → 会员原样保留；
 *  D. 收银台只剩一个搜索框：姓名 / 尾号 / 全号唯一匹配自动选中，多匹配给点选，空值清空，
 *     取单回填搜索框。
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v157.js
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
const T = (p, ms, name) => Promise.race([Promise.resolve(p),
  new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT: ' + name)), ms))]);

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

  const ev = async (code, ms) => T(w.eval(code), ms || 8000, code.slice(0, 40));

  astep('页面脚本无致命错误', loadErrs.length === 0, loadErrs.slice(0, 2).join(' | '));
  astep('openClearData 已定义', typeof w.openClearData === 'function');
  astep('doClearData 已定义', typeof w.doClearData === 'function');
  astep('onCartQuery 已定义', typeof w.onCartQuery === 'function');
  astep('memberDisplay / pickMemberById 已定义',
    typeof w.memberDisplay === 'function' && typeof w.pickMemberById === 'function');

  // ---------- A. 弹窗 UI ----------
  const modal = w.document.getElementById('clearDataModal');
  astep('清空弹窗存在', !!modal);
  const boxes = modal ? [...modal.querySelectorAll('input[type=checkbox]')] : [];
  astep('弹窗里有 3 个勾选框（商品/订单/会员）',
    boxes.length === 3 && !!w.document.getElementById('cdProducts')
    && !!w.document.getElementById('cdOrders') && !!w.document.getElementById('cdMembers'),
    'checkbox数=' + boxes.length);
  const rowsOk = boxes.length === 3 && boxes.every(b => {
    const row = b.closest('.switch-row');
    if (!row) return false;
    const firstEl = [...row.childNodes].find(n => n.nodeType === 1 || (n.nodeType === 3 && n.textContent.trim()));
    return firstEl === b;
  });
  astep('三个勾选框都在文字前面（switch-row 首元素）', rowsOk);
  const memberTxt = modal ? modal.textContent : '';
  astep('会员写成可勾选项，不再是「🔒 始终保留」',
    /清空会员/.test(memberTxt) && !/始终保留/.test(memberTxt) && !/🔒/.test(memberTxt));

  await ev(`openClearData()`);
  let def = JSON.parse(await ev(`JSON.stringify({p:document.getElementById('cdProducts').checked,
     o:document.getElementById('cdOrders').checked, m:document.getElementById('cdMembers').checked})`));
  astep('打开弹窗：商品/订单默认勾，会员默认【不勾】',
    def.p === true && def.o === true && def.m === false, JSON.stringify(def));

  // ---------- 准备环境 ----------
  await ev(`acctCreate('13800000000','phone','secret123')`);
  await ev(`SYNC.account='13800000000'; SYNC.token='test-token';`);
  await ev(`window.__md=[];
    const _md=markDeleted;
    markDeleted=function(k,r){ window.__md.push(k); return _md(k,r); };
    syncReq=function(m,u,b){ return Promise.resolve({rev:1,applied:0,orders:[]}); };`);

  // ---------- B. 勾上会员 → 会员清空 ----------
  await ev(`S.products=[{id:'p1'},{id:'p2'}]; S.orders=[{id:'o1'}];
    S.members=[{id:'m1',name:'张三',phone:'13800000001'},{id:'m2',name:'李四',phone:'13900000002'}]; save();
    window.__md=[];
    openClearData(); document.getElementById('cdProducts').checked=true;
    document.getElementById('cdOrders').checked=true; document.getElementById('cdMembers').checked=true;
    document.getElementById('cdPass').value='secret123';`);
  await ev(`doClearData()`, 10000);
  await new Promise(r => setTimeout(r, 250));
  let s1 = JSON.parse(await ev(`JSON.stringify({p:S.products.length,o:S.orders.length,m:S.members.length,md:window.__md})`));
  astep('B1 商品清空', s1.p === 0, 'products=' + s1.p);
  astep('B1 订单清空', s1.o === 0, 'orders=' + s1.o);
  astep('B1 会员清空（勾选后能清）', s1.m === 0, 'members=' + s1.m);
  astep('B1 会员登记了墓碑（members×2）',
    s1.md.filter(k => k === 'members').length === 2, JSON.stringify(s1.md));

  // 远端又把旧会员推回来 → 墓碑必须拦住
  await ev(`syncMergePayload({shop:{},members:[{id:'m1',name:'张三',phone:'13800000001'},
    {id:'m2',name:'李四',phone:'13900000002'}]})`);
  await new Promise(r => setTimeout(r, 120));
  let s2 = JSON.parse(await ev(`JSON.stringify({m:S.members.length})`));
  astep('B2 远端回推旧会员也不会复活', s2.m === 0, 'members=' + s2.m);

  // ---------- C. 不勾会员 → 会员保留 ----------
  await ev(`S.products=[{id:'p3'}]; S.orders=[{id:'o3'}];
    S.members=[{id:'m3',name:'王五',phone:'13700000003'},{id:'m4',name:'赵六',phone:'13600000004'}]; save();
    window.__md=[];
    openClearData(); document.getElementById('cdProducts').checked=true;
    document.getElementById('cdOrders').checked=true;
    document.getElementById('cdPass').value='secret123';`);
  await ev(`doClearData()`, 10000);
  await new Promise(r => setTimeout(r, 250));
  let s3 = JSON.parse(await ev(`JSON.stringify({p:S.products.length,o:S.orders.length,m:S.members.length,
    mdM:window.__md.filter(k=>k==='members').length})`));
  astep('C 不勾会员：商品订单清空、会员完整保留(2)、无 members 墓碑',
    s3.p === 0 && s3.o === 0 && s3.m === 2 && s3.mdM === 0, JSON.stringify(s3));

  // ---------- 错密码 / 全不勾 ----------
  await ev(`S.products=[{id:'p5'}]; S.members=[{id:'m5'}]; save(); window.__md=[];
    openClearData(); document.getElementById('cdPass').value='wrong';
    document.getElementById('cdMembers').checked=true;`);
  await ev(`doClearData()`, 10000);
  await new Promise(r => setTimeout(r, 200));
  let s4 = JSON.parse(await ev(`JSON.stringify({p:S.products.length,m:S.members.length,md:window.__md.length})`));
  astep('D 错密码：一条不动（含会员）', s4.p === 1 && s4.m === 1 && s4.md === 0, JSON.stringify(s4));

  await ev(`openClearData(); document.getElementById('cdProducts').checked=false;
    document.getElementById('cdOrders').checked=false; document.getElementById('cdMembers').checked=false;
    document.getElementById('cdPass').value='secret123';`);
  await ev(`doClearData()`, 8000);
  await new Promise(r => setTimeout(r, 150));
  let s5 = JSON.parse(await ev(`JSON.stringify({p:S.products.length})`));
  astep('E 三项都不勾：不清任何数据', s5.p === 1, JSON.stringify(s5));

  // ---------- F. 核心回归（v1.5.6）：订单删完不复活 ----------
  await ev(`S.orders=[{id:'o8'},{id:'o9'}]; save(); window.__md=[];
    syncReq=function(m,u,b){
      if(m==='PUT'&&u==='/api/orders') return Promise.reject(new Error('network down'));
      if(m==='GET'&&String(u).indexOf('/api/orders')===0)
        return Promise.resolve({rev:99,orders:[{order_uid:'o8',deleted:false,payload:{id:'o8',time:'t'}},
                                               {order_uid:'o9',deleted:false,payload:{id:'o9',time:'t'}}]});
      return Promise.resolve({rev:1,applied:0,orders:[]});
    };
    openClearData(); document.getElementById('cdProducts').checked=false;
    document.getElementById('cdOrders').checked=true; document.getElementById('cdMembers').checked=false;
    document.getElementById('cdPass').value='secret123';`);
  await ev(`doClearData()`, 10000);
  await new Promise(r => setTimeout(r, 200));
  await ev(`syncPullOrders()`, 8000);
  await new Promise(r => setTimeout(r, 150));
  let s6 = JSON.parse(await ev(`JSON.stringify({o:S.orders.length,del:(S._del.orders||[])})`));
  astep('F 推送失败+云端说还在 → 订单仍为空（不复活）', s6.o === 0, 'orders=' + s6.o);
  astep('F 订单墓碑已登记(o8,o9)',
    (s6.del || []).indexOf('o8') >= 0 && (s6.del || []).indexOf('o9') >= 0, JSON.stringify(s6.del));

  // ---------- G. 收银台会员合并成一个搜索框 ----------
  await ev(`syncReq=function(){return Promise.resolve({rev:1,applied:0,orders:[]});};
    S.members=[
      {id:'mA',name:'张三',phone:'13800000001',no:'M001',points:10,balance:5},
      {id:'mB',name:'张四',phone:'13800000002',no:'M002',points:0,balance:0},
      {id:'mC',name:'李四',phone:'13900000001',no:'M003',points:3,balance:1}];
    save(); fillMemberSelect(); cart=[];`);
  const g = JSON.parse(await ev(`JSON.stringify({
    search: !!document.getElementById('cartSearch'),
    selHidden: (document.getElementById('cartMember').className||'').indexOf('hidden')>=0,
    nameHidden: (document.getElementById('cartName').type||'')==='hidden',
    phoneHidden: (document.getElementById('cartPhone').type||'')==='hidden'})`));
  astep('G1 界面上只有一个搜索框（旧的下拉/姓名/手机号已隐藏）',
    g.search && g.selHidden && g.nameHidden && g.phoneHidden, JSON.stringify(g));

  // 姓名唯一匹配
  await ev(`document.getElementById('cartSearch').value='张三'; onCartQuery();`);
  let g2 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    nm:document.getElementById('cartName').value, ph:document.getElementById('cartPhone').value,
    q:document.getElementById('cartSearch').value})`));
  astep('G2 输姓名「张三」→ 自动选中 mA 并回填隐藏域',
    g2.sel === 'mA' && g2.nm === '张三' && g2.ph === '13800000001', JSON.stringify(g2));
  astep('G2 搜索框回填成「张三 · 0001」', g2.q === '张三 · 0001', 'q=' + g2.q);

  // 手机尾号唯一
  await ev(`document.getElementById('cartSearch').value='0002'; onCartQuery();`);
  let g3 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value})`));
  astep('G3 输尾号「0002」→ 选中 mB', g3.sel === 'mB', JSON.stringify(g3));

  // 完整手机号唯一
  await ev(`document.getElementById('cartSearch').value='13900000001'; onCartQuery();`);
  let g4 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value})`));
  astep('G4 输完整手机号 → 选中 mC', g4.sel === 'mC', JSON.stringify(g4));

  // 多匹配 → 给点选按钮
  await ev(`document.getElementById('cartSearch').value='0001'; onCartQuery();`);
  let g5 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    tip:document.getElementById('cartPhoneTip').innerHTML})`));
  astep('G5 尾号「0001」匹配到 2 位 → 未自动选中，提示可点选',
    g5.sel === '' && /pickMemberById\('mA'\)/.test(g5.tip) && /pickMemberById\('mC'\)/.test(g5.tip),
    'sel=' + g5.sel);
  await ev(`pickMemberById('mA')`);
  let g6 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    q:document.getElementById('cartSearch').value})`));
  astep('G6 点选候选 → 选中 mA 且搜索框回填', g6.sel === 'mA' && g6.q === '张三 · 0001', JSON.stringify(g6));

  // 无匹配
  await ev(`document.getElementById('cartSearch').value='9999'; onCartQuery();`);
  let g7 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    ph:document.getElementById('cartPhone').value})`));
  astep('G7 没匹配到 → 不选会员，手机号暂存输入值', g7.sel === '' && g7.ph === '9999', JSON.stringify(g7));

  // 清空
  await ev(`document.getElementById('cartSearch').value=''; onCartQuery();`);
  let g8 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    nm:document.getElementById('cartName').value, ph:document.getElementById('cartPhone').value})`));
  astep('G8 搜索框清空 → 回到散客', g8.sel === '' && g8.nm === '' && g8.ph === '', JSON.stringify(g8));

  // 取单回填
  await ev(`cart=[]; S.holds=[{id:'h1',memberId:'mB',phone:'13800000002',items:[],note:'测试单',time:'t',discount:''}];
    save(); takeHold('h1');`);
  await new Promise(r => setTimeout(r, 120));
  let g9 = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    q:document.getElementById('cartSearch').value})`));
  astep('G9 取挂单 → 会员回填到搜索框（张四 · 0002）',
    g9.sel === 'mB' && g9.q === '张四 · 0002', JSON.stringify(g9));

  const failed = results.filter(r => !r.ok);
  log('\n==== 结果: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ====');
  clearTimeout(watchdog);
  if (failed.length) { log('失败项: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
  process.exit(0);
})().catch(e => { log('运行异常: ' + (e && e.stack || e)); process.exit(2); });
