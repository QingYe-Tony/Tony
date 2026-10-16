/* verify_v162.js —— v1.6.2 验证
 * 沿用 v1.6.0/v1.6.1 的全部断言（A~I），新增 J 组：滚动容器与底部留白
 *   J1 手机端 `main` 的 padding-bottom 不能被后面的 `padding:` 简写覆盖掉
 *      （v1.6.0 加了 `main{padding:12px}`，把给固定底栏留的 150px 冲成 12px，
 *        结果滚到底最后一块内容被底栏压住 —— 用户报的「底部上滑都看不到」）
 *   J2 留白要够放下「底栏 52px + 收银台购物车条 59px」
 *   J3 桌面端 main 不该带这种大留白
 *   J4 切标签页必须把真正的滚动容器（main）滚回顶部
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v162.js
 *
 * 原 verify_v158.js 说明（保留）：
 * 新增断言 G10：选中会员后，把搜索框里的尾号删掉只留姓名（或留「姓名 · 」），
 * 新增断言 G10：选中会员后，把搜索框里的尾号删掉只留姓名（或留「姓名 · 」），
 *   onCartQuery 必须【保持选中、不把框强行复原成「姓名 · 尾号」】—— 这正是 v1.5.7
 *   合并成单搜索框后的回归：删号码时输入仍能唯一匹配同一位会员，旧逻辑会把框填回去。
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

  // ---------- G10. 删会员号码不能自动复原（v1.5.7 回归修复） ----------
  await ev(`S.members=[{id:'mA',name:'张三',phone:'13800000001',no:'M001',points:10,balance:5}];
    save(); fillMemberSelect(); cart=[]; S.holds=[];
    document.getElementById('cartMember').value='mA';
    document.getElementById('cartSearch').value='张三 · 0001'; onCartQuery();`);
  let g10a = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    q:document.getElementById('cartSearch').value})`));
  astep('G10 起手：已选中 mA 且框为「张三 · 0001」', g10a.sel === 'mA' && g10a.q === '张三 · 0001', JSON.stringify(g10a));
  // 删掉尾号，只留姓名
  await ev(`document.getElementById('cartSearch').value='张三'; onCartQuery();`);
  let g10b = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    q:document.getElementById('cartSearch').value})`));
  astep('G10a 删尾号只留「张三」→ 会员仍选中(mA) 且框不被复原成「张三 · 0001」',
    g10b.sel === 'mA' && g10b.q === '张三', JSON.stringify(g10b));
  // 留「姓名 · 」（删了数字和空格边界）
  await ev(`document.getElementById('cartSearch').value='张三 · '; onCartQuery();`);
  let g10c = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    q:document.getElementById('cartSearch').value})`));
  astep('G10b 留「张三 · 」→ 会员仍选中 且框不被复原',
    g10c.sel === 'mA' && g10c.q === '张三 · ', JSON.stringify(g10c));
  // 彻底清空 → 回到散客
  await ev(`document.getElementById('cartSearch').value=''; onCartQuery();`);
  let g10d = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    nm:document.getElementById('cartName').value, ph:document.getElementById('cartPhone').value})`));
  astep('G10c 清空搜索框 → 回到散客（会员/姓名/手机号全空）',
    g10d.sel === '' && g10d.nm === '' && g10d.ph === '', JSON.stringify(g10d));
  // 换成另一位会员（输入别的唯一标识）→ 正常切换并回填
  await ev(`S.members.push({id:'mB',name:'张四',phone:'13800000002',no:'M002',points:0,balance:0});
    save(); fillMemberSelect(); document.getElementById('cartSearch').value='张四'; onCartQuery();`);
  let g10e = JSON.parse(await ev(`JSON.stringify({sel:document.getElementById('cartMember').value,
    q:document.getElementById('cartSearch').value})`));
  astep('G10d 输入另一位会员唯一标识「张四」→ 切到 mB 并回填「张四 · 0002」',
    g10e.sel === 'mB' && g10e.q === '张四 · 0002', JSON.stringify(g10e));

  /* ================= H. v1.6.0 UI 全套改版 ================= */
  // 说明：上面的 G9「取挂单」内部会 switchTab('pos')，所以运行时状态已不在工作台。
  // 「默认首页」用源码文本断言（不受运行时切换影响），再用 switchTab('dash') 验运行时行为。
  astep('H1 源码：工作台 #tab-dash 作为默认首页（不带 hidden），收银台默认 hidden',
    /<section id="tab-dash">/.test(HTML) && /<section id="tab-pos" class="hidden">/.test(HTML));
  await ev(`switchTab('dash')`);
  let h1 = JSON.parse(await ev(`JSON.stringify({
    dash: !!document.getElementById('tab-dash'),
    dashHidden: document.getElementById('tab-dash').classList.contains('hidden'),
    posHidden: document.getElementById('tab-pos').classList.contains('hidden')})`));
  astep('H1b 切回工作台：工作台显示、收银台隐藏',
    h1.dash && !h1.dashHidden && h1.posHidden, JSON.stringify(h1));

  // H2 底部 4 标签
  let h2 = JSON.parse(await ev(`JSON.stringify({
    tabs: [...document.querySelectorAll('#bottomNav button')].map(b=>b.dataset.tab),
    labels: [...document.querySelectorAll('#bottomNav button')].map(b=>b.textContent.trim())})`));
  astep('H2 底部标签栏改为 4 个（工作台/会员/报表/我的）',
    h2.tabs.join(',') === 'dash,members,reports,settings', JSON.stringify(h2.tabs));

  // H3 顶栏 7 标签，工作台高亮
  let h3 = JSON.parse(await ev(`JSON.stringify({
    tabs: [...document.querySelectorAll('#nav button')].map(b=>b.dataset.tab),
    active: document.querySelector('#nav button.active').dataset.tab})`));
  astep('H3 顶栏 7 个标签且停在工作台时「工作台」高亮',
    h3.tabs.join(',') === 'dash,pos,products,orders,members,reports,settings' && h3.active === 'dash',
    JSON.stringify(h3));

  // H4 顶栏查找框 + 扫一扫
  astep('H4 顶栏新增查找框 #hdrSearch 与「扫一扫」按钮',
    !!w.document.getElementById('hdrSearch') && /扫一扫/.test(w.document.querySelector('.hdr-search').textContent));

  // H5 新增函数
  astep('H5 renderDash / quickStartPos / hdrQuickSearch / hdrScan 均已定义',
    typeof w.renderDash === 'function' && typeof w.quickStartPos === 'function'
    && typeof w.hdrQuickSearch === 'function' && typeof w.hdrScan === 'function');

  // H6 工作台功能图标网格 = 8 个
  let h6 = JSON.parse(await ev(`JSON.stringify({
    tiles: document.querySelectorAll('#tab-dash .wb-tile').length,
    quick: document.querySelectorAll('#tab-dash .wb-quick button').length,
    cards: document.querySelectorAll('#tab-dash .wb-card').length})`));
  astep('H6 工作台：2 个快捷大按钮 + 8 个功能图标 + 4 张门店管理卡片',
    h6.tiles === 8 && h6.quick === 2 && h6.cards === 4, JSON.stringify(h6));

  // H7 今日概览数据
  await ev(`S.members=[{id:'x1'},{id:'x2'},{id:'x3'}];
    S.orders=[
      {id:'d1',time:todayStr()+'T10:00:00.000Z',total:12.5,refunded:false},
      {id:'d2',time:todayStr()+'T11:00:00.000Z',total:7.5,refunded:false},
      {id:'d3',time:'2000-01-01T00:00:00.000Z',total:99,refunded:false}];
    save(); switchTab('dash');`);
  let h7 = JSON.parse(await ev(`JSON.stringify({a:document.getElementById('dashAmt').textContent,
    o:document.getElementById('dashOrders').textContent, m:document.getElementById('dashMembers').textContent})`));
  astep('H7 今日概览：营收 20.00 / 今日 2 单 / 会员 3 位',
    h7.a === '¥20.00' && h7.o === '2' && h7.m === '3', JSON.stringify(h7));

  // H8 切换：从工作台 → 收银台，底部仍高亮「工作台」（收银是工作台的下级）
  await ev(`switchTab('pos')`);
  let h8 = JSON.parse(await ev(`JSON.stringify({
    posShown: !document.getElementById('tab-pos').classList.contains('hidden'),
    dashHidden: document.getElementById('tab-dash').classList.contains('hidden'),
    navActive: document.querySelector('#nav button.active').dataset.tab,
    bottomActive: document.querySelector('#bottomNav button.active').dataset.tab,
    cartBarShown: !document.getElementById('mobileCartBar').classList.contains('hidden')})`));
  astep('H8 切到收银台：收银台显示/工作台隐藏/底部仍高亮工作台/购物车条显示',
    h8.posShown && h8.dashHidden && h8.navActive === 'pos' && h8.bottomActive === 'dash' && h8.cartBarShown,
    JSON.stringify(h8));

  // H9 切到会员 → 两处导航同步高亮
  await ev(`switchTab('members')`);
  let h9 = JSON.parse(await ev(`JSON.stringify({
    shown: !document.getElementById('tab-members').classList.contains('hidden'),
    navActive: document.querySelector('#nav button.active').dataset.tab,
    bottomActive: document.querySelector('#bottomNav button.active').dataset.tab,
    cartBarHidden: document.getElementById('mobileCartBar').classList.contains('hidden')})`));
  astep('H9 切到会员：两处导航都高亮 members，购物车条隐藏',
    h9.shown && h9.navActive === 'members' && h9.bottomActive === 'members' && h9.cartBarHidden,
    JSON.stringify(h9));

  // H10 顶栏查找：精确命中会员 → 跳会员页并筛选
  await ev(`S.members=[{id:'hz',name:'韩梅梅',phone:'13512345678',no:'M100',points:0,balance:0}];
    S.products=[{id:'hp',name:'可乐',price:3,stock:10,barcode:'6901234567890'}]; save();
    switchTab('dash'); document.getElementById('memFilter').value='';`);
  await ev(`hdrQuickSearch('韩梅梅',true)`);
  let h10 = JSON.parse(await ev(`JSON.stringify({
    shown: !document.getElementById('tab-members').classList.contains('hidden'),
    filter: document.getElementById('memFilter').value})`));
  astep('H10 顶栏输入会员姓名回车 → 跳会员页并按该姓名筛选',
    h10.shown && h10.filter === '韩梅梅', JSON.stringify(h10));

  // H11 顶栏查找：精确命中商品 → 跳收银台并预填商品搜索
  await ev(`switchTab('dash'); document.getElementById('prodSearch').value='';`);
  await ev(`hdrQuickSearch('可乐',true)`);
  let h11 = JSON.parse(await ev(`JSON.stringify({
    shown: !document.getElementById('tab-pos').classList.contains('hidden'),
    filter: document.getElementById('prodSearch').value})`));
  astep('H11 顶栏输入商品名回车 → 跳收银台并预填商品搜索',
    h11.shown && h11.filter === '可乐', JSON.stringify(h11));

  // H12 顶栏查找：打字过程中不应跳页（非精确命中）
  await ev(`switchTab('dash'); hdrQuickSearch('可',false);`);
  let h12 = JSON.parse(await ev(`JSON.stringify({onDash:!document.getElementById('tab-dash').classList.contains('hidden')})`));
  astep('H12 打字过程中（非精确命中）不跳页，仍停在工作台', h12.onDash, JSON.stringify(h12));

  // H13 扫一扫 → 切收银台并聚焦扫码框
  await ev(`switchTab('dash'); hdrScan();`);
  let h13 = JSON.parse(await ev(`JSON.stringify({
    shown: !document.getElementById('tab-pos').classList.contains('hidden'),
    focus: (document.activeElement||{}).id||''})`));
  astep('H13 扫一扫 → 切到收银台并聚焦条码输入框',
    h13.shown && h13.focus === 'barcodeInput', JSON.stringify(h13));

  // H14 报表页顶部渐变数据块
  await ev(`S.orders=[
      {id:'r1',time:todayStr()+'T10:00:00.000Z',total:100,refunded:false,items:[{name:'A',price:100,qty:1}],method:'cash'},
      {id:'r2',time:todayStr()+'T11:00:00.000Z',total:60,refunded:false,items:[{name:'B',price:60,qty:1}],method:'cash'}];
    save(); document.getElementById('repFrom').value=''; document.getElementById('repTo').value='';
    switchTab('reports');`);
  let h14 = JSON.parse(await ev(`JSON.stringify({
    hero: !!document.querySelector('#tab-reports .rep-hero'),
    big: document.getElementById('rhBig').textContent,
    orders: document.getElementById('rhOrders').textContent,
    avg: document.getElementById('rhAvg').textContent,
    today: document.getElementById('rhToday').textContent,
    range: document.getElementById('rhRange').textContent})`));
  astep('H14 报表页渐变块：营业额 160.00 / 2 单 / 客单价 80.00 / 今日 160.00',
    h14.hero && h14.big === '¥160.00' && h14.orders === '2' && h14.avg === '¥80.00' && h14.today === '¥160.00',
    JSON.stringify(h14));

  // H15 版本号已升到 1.6.2
  astep('H15 导出与「关于」里的版本号都是 1.6.2',
    /version:'1\.6\.2'/.test(HTML) && /通用收银台 1\.6\.2/.test(HTML));
  astep('H15 是否还有旧的 1.6.x 版本串（只允许出现在注释里）',
    !/version:'1\.6\.[01]'/.test(HTML) && !/通用收银台 1\.6\.[01]/.test(HTML));

  // H16 界面美化不影响收银主流程：加购 + 结算仍可用
  await ev(`S.products=[{id:'pz',name:'测试商品',price:9.9,stock:10,emoji:'🧪'}];
    S.members=[]; S.orders=[]; save(); cart=[];
    switchTab('pos'); addToCart('pz');`);
  let h16 = JSON.parse(await ev(`JSON.stringify({n:cart.length,qty:cart[0]&&cart[0].qty})`));
  astep('H16 改版后收银台加购依旧正常', h16.n === 1 && h16.qty === 1, JSON.stringify(h16));

  /* ================= I. v1.6.1 手机端完善 ================= */
  astep('I1 decorateMobileTables / startMobileTableWatch 已定义',
    typeof w.decorateMobileTables === 'function' && typeof w.startMobileTableWatch === 'function');

  // I2 四张主表都卡片化，且列头都回填到了每个 td
  await ev(`S.products=[{id:'p1',name:'可乐',barcode:'6901',cat:'饮料',cost:2,price:3.5,stock:10,unit:'瓶'}];
    S.orders=[{id:'NO000001',time:todayStr()+'T10:00:00.000Z',total:7,payBreakdown:{cash:7},
      items:[{name:'可乐',price:3.5,qty:2}],method:'cash',memberName:'',refunded:false}];
    S.members=[{id:'m1',no:'M001',name:'张三',phone:'13800000001',points:5,balance:10,totalSpent:100}];
    S.shifts=[{id:'S001',time:todayStr()+'T12:00:00.000Z',count:1,total:7,bd:{cash:7,wx:0,ali:0,card:0,bal:0}}];
    save();
    /* 前面 H10 往会员筛选框里写过「韩梅梅」，先清掉，否则会员表只剩空行 */
    document.getElementById('memFilter').value='';
    document.getElementById('prodFilter').value='';
    document.getElementById('orderDate').value='';
    renderProductTable(); renderOrders(); renderMembers(); renderShift();
    decorateMobileTables(document);`);
  const MAIN = [['prodTable', 8], ['orderTable', 7], ['memTable', 7], ['shiftTable', 9]];
  let i2bad = [];
  for (const [id, ncol] of MAIN) {
    const r = JSON.parse(await ev(`(function(){
      const tb=document.getElementById('${id}');
      const table=tb.closest('table');
      const ths=[...table.querySelectorAll('thead th')].map(t=>t.textContent.trim());
      const rows=[...tb.querySelectorAll('tr')];
      const first=rows.find(tr=>!tr.classList.contains('mob-empty'));
      const labels=first?[...first.cells].map(td=>td.getAttribute('data-label')):[];
      return JSON.stringify({card:table.classList.contains('mob-card'),ths:ths.length,
        labels:labels.length,miss:labels.filter(x=>!x).length,plain:!!table.closest('.mob-plain'),
        rows:rows.length});})()`));
    if (!r.card || r.ths !== ncol || r.labels !== ncol || r.miss > 0 || !r.plain) i2bad.push(id + '=' + JSON.stringify(r));
  }
  astep('I2 商品/订单/会员/交班 四张宽表都卡片化，且每个 td 都带 data-label、外层卡壳已去掉',
    i2bad.length === 0, i2bad.join(' | '));

  // I3 空表例外：不卡片化、不写 data-label
  await ev(`S.orders=[]; S.members=[]; save(); renderOrders(); renderMembers(); decorateMobileTables(document);`);
  const i3 = JSON.parse(await ev(`JSON.stringify({
    orderEmpty:(function(){const tb=document.getElementById('orderTable');const tr=tb.rows[0];
      return tr.classList.contains('mob-empty')&&tr.cells.length===1&&!tr.cells[0].hasAttribute('data-label');})(),
    memEmpty:(function(){const tb=document.getElementById('memTable');const tr=tb.rows[0];
      return tr.classList.contains('mob-empty')&&!tr.cells[0].hasAttribute('data-label');})()})`));
  astep('I3 「暂无订单 / 暂无会员」空行标记为 mob-empty，不参与卡片化', i3.orderEmpty && i3.memEmpty, JSON.stringify(i3));

  // I4 窄表（3 列）不动 —— 报表页热销商品 / 会员消费历史
  await ev(`S.orders=[{id:'r1',time:todayStr()+'T10:00:00.000Z',total:10,refunded:false,
      items:[{name:'可乐',price:5,qty:2}],method:'cash'}]; save(); renderReports(); decorateMobileTables(document);`);
  const i4 = JSON.parse(await ev(`JSON.stringify({
    narrow:[...document.querySelectorAll('#reportBody table')].map(t=>t.classList.contains('mob-card'))})`));
  astep('I4 报表页 3 列的窄表（热销商品）不会被卡片化',
    i4.narrow.length > 0 && i4.narrow.every(v => v === false), JSON.stringify(i4));

  // I5 订单详情弹窗里的 4 列表也会卡片化
  await ev(`viewOrder('r1'); decorateMobileTables(document);`);
  const i5 = JSON.parse(await ev(`JSON.stringify({
    card:!!document.querySelector('#orderDetail table.mob-card'),
    labeled:(function(){const t=document.querySelector('#orderDetail table.mob-card');
      return t?!!t.querySelector('tbody td[data-label]'):false;})()})`));
  astep('I5 订单详情弹窗的明细表也走卡片（商品/单价/数量/小计）', i5.card && i5.labeled, JSON.stringify(i5));

  // I6 统计周期 / 订单日期：带中文标签的 rr-box
  const i6 = JSON.parse(await ev(`JSON.stringify({
    repBoxes:document.querySelectorAll('#tab-reports .rep-range .rr-box').length,
    repCaps:[...document.querySelectorAll('#tab-reports .rep-range .rr-box>span')].map(s=>s.textContent.trim()),
    repFrom:!!document.querySelector('#tab-reports .rep-range #repFrom'),
    repTo:!!document.querySelector('#tab-reports .rep-range #repTo'),
    ordBox:document.querySelectorAll('#tab-orders .rep-range .rr-box').length,
    ordCap:(function(){const s=document.querySelector('#tab-orders .rep-range .rr-box>span');return s?s.textContent.trim():'';})()})`));
  astep('I6 报表「统计周期」= 开始/结束 两个带标签的日期框，原来光秃秃的 date 框已包装',
    i6.repBoxes === 2 && i6.repCaps.join(',') === '开始,结束' && i6.repFrom && i6.repTo,
    JSON.stringify(i6));
  astep('I6 订单页日期筛选也包成「日期」标签框', i6.ordBox === 1 && i6.ordCap === '日期', 'ordBox=' + i6.ordBox + ' cap=' + i6.ordCap);

  // I7 日期框仍能正常驱动筛选（包装没打断 onchange）
  await ev(`document.getElementById('repFrom').value='2020-01-01';
    document.getElementById('repTo').value='2020-01-02'; renderReports();`);
  const i7 = JSON.parse(await ev(`JSON.stringify({range:document.getElementById('rhRange').textContent,
    big:document.getElementById('rhBig').textContent})`));
  astep('I7 改日期后报表仍在算（区间文字变成 2020-01-01 ~ 2020-01-02）',
    /2020-01-01/.test(i7.range) && /2020-01-02/.test(i7.range), JSON.stringify(i7));
  await ev(`clearRepDates()`);
  const i7b = JSON.parse(await ev(`JSON.stringify({f:document.getElementById('repFrom').value,
    t:document.getElementById('repTo').value,r:document.getElementById('rhRange').textContent})`));
  astep('I7 「清空」把两个日期框清掉并回到「全部数据」',
    i7b.f === '' && i7b.t === '' && i7b.r === '全部数据', JSON.stringify(i7b));

  // I8 店铺 Logo：原生的英文 file 控件藏起来，换成中文按钮
  await ev(`switchTab('settings')`);
  const i8 = JSON.parse(await ev(`JSON.stringify({
    hidden:(document.getElementById('setLogo').className||'').indexOf('hidden')>=0,
    btn:(function(){const b=document.querySelector('#setCard .file-pick button');return b?b.textContent.trim():''})(),
    name:!!document.getElementById('logoFileName'),
    nameTxt:(document.getElementById('logoFileName')||{}).textContent})`));
  astep('I8 店铺 Logo 的文件选择已换成「📷 选择图片」按钮（原生 Choose File 已隐藏）',
    i8.hidden && /选择图片/.test(i8.btn) && i8.name && /未选择图片/.test(i8.nameTxt || ''),
    JSON.stringify(i8));
  await ev(`S.shop.logo='data:image/png;base64,AAA'; renderLogoPreview();`);
  const i8b = JSON.parse(await ev(`JSON.stringify({pv:document.getElementById('logoPreview').innerHTML.length>0})`));
  astep('I8 已设置 Logo 时预览仍在', i8b.pv, JSON.stringify(i8b));

  // I9 报表页手机端隐藏重复的统计卡（DOM 仍在，靠 CSS 隐藏）
  await ev(`S.orders=[]; save(); switchTab('reports');`);
  const i9 = JSON.parse(await ev(`JSON.stringify({
    stats:document.querySelectorAll('#reportBody>.stats').length,
    cssHidden:/#reportBody>\\.stats\\{display:none\\}/.test(document.querySelector('style')?
      [...document.querySelectorAll('style')].map(s=>s.textContent).join(''):'')})`));
  astep('I9 报表 4 个统计卡仍渲染，但手机端由 CSS 隐藏（渐变块已含同样指标）',
    i9.stats === 1 && i9.cssHidden, JSON.stringify(i9));

  // I10 表格卡片化的 CSS 存在且只在手机端生效
  const styles = (w.document.querySelectorAll('style') ? [...w.document.querySelectorAll('style')].map(s => s.textContent).join('\n') : '');
  astep('I10 卡片化样式齐全（mob-card / td::before attr(data-label) / mob-empty / mob-plain）',
    /table\.mob-card\{display:block/.test(styles) && /content:attr\(data-label\)/.test(styles)
    && /mob-empty/.test(styles) && /\.mob-plain/.test(styles));
  const i10 = JSON.parse(await ev(`(function(){const css=[...document.querySelectorAll('style')].map(s=>s.textContent).join('\\n');
    const i=css.indexOf('table.mob-card{display:block');
    const pre=css.lastIndexOf('@media',i);
    const head=css.slice(pre,i).replace(/\\s+/g,'');
    return JSON.stringify({media:head});})()`));
  astep('I10 这些样式挂在 max-width:768px 的媒体查询里（桌面不受影响）',
    /max-width:768px/.test(i10.media), i10.media);

  // I11 顶栏按钮对比度提高（不再用 0.08 的透明底）
  astep('I11 顶栏 ghost 按钮底色/描边加深，蓝底上不再发灰',
    /header \.ghost\{background:rgba\(255,255,255,\.20\)/.test(styles));

  // I12 收银主流程未被影响
  await ev(`S.products=[{id:'pz',name:'测试商品',price:9.9,stock:10,emoji:'🧪'}];
    S.members=[]; S.orders=[]; save(); cart=[]; switchTab('pos'); addToCart('pz');`);
  const i12 = JSON.parse(await ev(`JSON.stringify({n:cart.length,qty:cart[0]&&cart[0].qty})`));
  astep('I12 改版后收银台加购依旧正常', i12.n === 1 && i12.qty === 1, JSON.stringify(i12));

  // ---------- J. 底部留白与滚动容器（v1.6.2 用户反馈「底部上滑都看不到」） ----------

  /* 把每条 main{...} 规则连同它所在的媒体查询一起抽出来。
     没有这一步就没法判断「后面那条简写有没有把前面的 padding-bottom 冲掉」——
     这正是 v1.6.0 引入的 bug。 */
  const mainRulesIn = (css) => {
    const out = [], re = /(^|[\s;}])main\{([^}]*)\}/g;
    let m;
    while ((m = re.exec(css))) {
      const idx = m.index, body = m[2].replace(/\s+/g, '');
      let media = '';
      const p = css.lastIndexOf('@media', idx);
      if (p >= 0) {
        const ob = css.indexOf('{', p);
        let depth = 0, close = -1;
        for (let i = ob; i < css.length; i++) {
          if (css[i] === '{') depth++;
          else if (css[i] === '}') { if (--depth === 0) { close = i; break; } }
        }
        if (close > idx) media = css.slice(p, ob).replace(/\s+/g, '');
      }
      out.push({ idx, media, body });
    }
    return out;
  };

  const mainRules = mainRulesIn(styles);
  const mobMains = mainRules.filter(r => /max-width:768px/.test(r.media));
  const lastMobMain = mobMains[mobMains.length - 1] || { body: '' };

  /* J1 —— 这是本次 bug 的核心回归点：
     级联里「后写的同特异性规则赢」，而 `padding:12px` 是简写，会连带重置 padding-bottom。 */
  astep('J1 手机端最后一条 main 规则仍带 padding-bottom（简写不会把底栏留白冲掉）',
    mobMains.length >= 1 && /padding-bottom:calc\(150px/.test(lastMobMain.body),
    'rules=' + mobMains.length + ' last=' + (lastMobMain.body || '(none)'));

  astep('J1 该规则同时保留了 12px 的常规内边距（没有为了留白丢掉基础间距）',
    /padding:12px;/.test(lastMobMain.body), lastMobMain.body);

  /* J2 —— 留白要真能放下「底栏 + 收银台购物车条」两截固定 UI。
     底栏按钮 ≈52px；购物车条 bottom:58px + 自身高度 ≈59px → 顶边在 117px 处。 */
  const reserve = Number((lastMobMain.body.match(/padding-bottom:calc\((\d+)px/) || [])[1] || 0);
  const needBottom = 52 + 59;
  astep('J2 手机端 main 的底部留白（' + reserve + 'px）≥ 底栏 52px + 购物车条 59px',
    reserve >= needBottom, 'reserve=' + reserve + ' need=' + needBottom);
  astep('J2 底栏与购物车条确实都是 fixed 定位（所以必须靠留白让位）',
    /#bottomNav\{display:flex;position:fixed/.test(styles.replace(/\s+/g, ''))
    && /#mobileCartBar\{display:flex;position:fixed/.test(styles.replace(/\s+/g, '')));

  /* J3 —— 桌面端不该背这个大留白（否则页面底部凭空多出 150px 空白）。 */
  const deskMain = mainRules.find(r => r.media === '') || { body: '' };
  astep('J3 桌面端基础 main 规则不含 150px 大留白',
    /padding:18px/.test(deskMain.body) && !/padding-bottom:calc\(150px/.test(deskMain.body),
    deskMain.body);

  /* J4 —— 滚动容器。.wrap 是 100% 高的 flex 列、main 有 flex:1;overflow:auto，
     所以滚动发生在 main 内部；只滚 documentElement 等于没滚。 */
  const j4 = JSON.parse(await ev(`(function(){
    var m=document.querySelector('main');
    var sc=document.scrollingElement||document.documentElement;
    m.scrollTop=137; sc.scrollTop=137;
    switchTab('reports');
    return JSON.stringify({main:m.scrollTop, doc:sc.scrollTop});
  })()`));
  astep('J4 切标签页时把真正的滚动容器 <main> 滚回顶部',
    j4.main === 0, 'main.scrollTop=' + j4.main);
  astep('J4 同时也重置 document 滚动位置（双保险）', j4.doc === 0, 'doc.scrollTop=' + j4.doc);
  astep('J4 源码里不再使用 window.scrollTo（jsdom 会记 Not implemented）',
    !/window\.scrollTo/.test(HTML));

  const failed = results.filter(r => !r.ok);
  log('\n==== 结果: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ====');
  clearTimeout(watchdog);
  if (failed.length) { log('失败项: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
  process.exit(0);
})().catch(e => { log('运行异常: ' + (e && e.stack || e)); process.exit(2); });
