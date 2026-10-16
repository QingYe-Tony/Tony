/* verify_v160.js —— v1.6.0 验证
 * 前半段沿用 v1.5.8 的全部回归（清空数据 / 订单墓碑 / 会员搜索框），
 * 后半段新增 H 组：UI 全套改版（工作台首页 + 底部4标签 + 顶栏查找 + 报表渐变块）。
 * 运行：NODE_PATH=/Users/qingye/.workbuddy/binaries/node/workspace/node_modules node verify_v160.js
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

  // H15 版本号已升到 1.6.0（源码内 2 处）
  const verHits = (HTML.match(/1\.6\.0/g) || []).length;
  astep('H15 index.html 内版本号已升为 1.6.0（≥2 处）', verHits >= 2, '出现 ' + verHits + ' 次');
  astep('H15 旧版本号 1.5.9 已无残留', !/1\.5\.9/.test(HTML));

  // H16 界面美化不影响收银主流程：加购 + 结算仍可用
  await ev(`S.products=[{id:'pz',name:'测试商品',price:9.9,stock:10,emoji:'🧪'}];
    S.members=[]; S.orders=[]; save(); cart=[];
    switchTab('pos'); addToCart('pz');`);
  let h16 = JSON.parse(await ev(`JSON.stringify({n:cart.length,qty:cart[0]&&cart[0].qty})`));
  astep('H16 改版后收银台加购依旧正常', h16.n === 1 && h16.qty === 1, JSON.stringify(h16));

  const failed = results.filter(r => !r.ok);
  log('\n==== 结果: ' + (results.length - failed.length) + '/' + results.length + ' 通过 ====');
  clearTimeout(watchdog);
  if (failed.length) { log('失败项: ' + failed.map(f => f.name).join('; ')); process.exit(1); }
  process.exit(0);
})().catch(e => { log('运行异常: ' + (e && e.stack || e)); process.exit(2); });
