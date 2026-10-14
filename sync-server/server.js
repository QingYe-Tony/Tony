#!/usr/bin/env node
/*
 * 通用收银台 · 多端同步服务器
 * ---------------------------------------------------------------
 * 零依赖（只用 Node 内置模块），账号密码用 PBKDF2-HMAC-SHA512 + 随机盐存储，
 * 登录后发 30 天有效的令牌。
 *
 * 账号标识：**手机号与邮箱等价**，同一个接口都能用。
 *   {account:'13800000000', password:'…'}   手机号（+86 / 空格 / 横线都会自动归一）
 *   {account:'you@example.com', password:'…'}  邮箱
 *   老客户端发 {email:'…'} 也照样认（向后兼容）。
 *
 * 两种用法：
 *
 * ① 命令行直接跑（独立部署）：
 *      node server.js                         默认端口 8787，数据存 ./data/db.json
 *      PORT=9000 node server.js               自定义端口
 *      DATA_DIR=/var/pos node server.js       自定义数据目录
 *
 * ② 被桌面端内嵌（require 调用，桌面版默认这样）：
 *      const { startServer } = require('./sync-server/server.js');
 *      const info = await startServer({ port: 8787, dataDir: '/path/to/userData/sync-data' });
 *      // info = { port, host, lan: [...], dataDir, dbFile, close() }
 *      内嵌模式下不会接管 SIGINT/SIGTERM，由宿主进程负责收尾。
 *
 * 所有端（Windows / macOS / Linux / 安卓 / iOS）在「设置 → 账号登录与多端同步」
 * 里填同一个服务器地址 + 同一个账号，即可看到同一份数据。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');

const DEFAULT_PORT = 8787;
const BODY_LIMIT = 32 * 1024 * 1024;   // 单次请求体上限 32MB（整店数据可能较大）
const TOKEN_DAYS = 30;
const SERVICE_NAME = '通用收银台同步服务器';
const SERVICE_TAG = 'merchant-pos-sync';   // /health 里用它做「是不是本程序的服务器」判定

/* -------------------------------------------------------------- 运行时状态 */

const EMPTY_DB = () => ({ users: [], tokens: {}, shops: {}, orders: {} });

let DB = EMPTY_DB();
let dbReady = false;
let DATA_DIR = '';
let DB_FILE = '';
let PORT = DEFAULT_PORT;
let saveTimer = null;
let started = false;

/* ------------------------------------------------------------------ 存储 */

function ensureDir() {
  if (DATA_DIR && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  ensureDir();
  let migrated = 0;
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      if (raw.trim()) {
        DB = Object.assign(EMPTY_DB(), JSON.parse(raw));
        ['users'].forEach(k => { if (!Array.isArray(DB[k])) DB[k] = []; });
        ['tokens', 'shops', 'orders'].forEach(k => { if (!DB[k] || typeof DB[k] !== 'object') DB[k] = {}; });
        // 兼容 v1.4.x 只有 email 字段的老账号：补齐 account / accountType
        DB.users.forEach(u => { if (!u.account && u.email) { accountKeyOf(u); migrated++; } });
      }
    }
  } catch (e) {
    console.error('[warn] db.json 读取失败，已从空库开始：' + e.message);
    const bad = DB_FILE + '.broken-' + Date.now();
    try { fs.renameSync(DB_FILE, bad); console.error('[warn] 原文件已备份为 ' + bad); } catch (_) {}
    DB = EMPTY_DB();
    migrated = 0;
  }
  dbReady = true;
  if (migrated) {
    console.log('[迁移] 已为 ' + migrated + ' 个旧账号补齐 account 字段（原邮箱登录方式不受影响）');
    saveDB();
  }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveDB(); }, 120);
}
function saveDB() {
  if (!dbReady || !DB_FILE) return;
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(DB), 'utf8');
    fs.renameSync(tmp, DB_FILE);            // 原子替换，避免断电写坏
  } catch (e) {
    console.error('[error] 数据写入失败：' + e.message);
  }
}

/* -------------------------------------------------------------- 账号与令牌 */

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }

function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }

/* 账号标识：手机号与邮箱等价，都归一到「一个字符串 key」。
 *   邮箱   → 小写去空格
 *   手机号 → 去掉空格、横线、括号、+；带 86 前缀的统一去掉
 * 返回 null 表示格式不合法。 */
function normalizeAccount(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (s.indexOf('@') >= 0) {
    const e = s.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return null;
    return { key: e, type: 'email' };
  }
  let d = s.replace(/[^\d]/g, '');
  if (d.length === 13 && d.slice(0, 2) === '86') d = d.slice(2);   // +86 138… / 86138…
  if (d.length === 11 && d[0] === '1') return { key: d, type: 'phone' };
  if (d.length >= 7 && d.length <= 15) return { key: d, type: 'phone' };   // 国际号码兜底
  return null;
}

/* 取客户端传来的账号：优先 account，其次 email / phone（兼容老客户端） */
function pickAccountInput(b) {
  if (b.account != null && String(b.account).trim() !== '') return b.account;
  if (b.email != null && String(b.email).trim() !== '') return b.email;
  if (b.phone != null && String(b.phone).trim() !== '') return b.phone;
  return '';
}

/* 老数据只有 email 字段，这里就地补齐 account / accountType（内存迁移，首次存盘即固化） */
function accountKeyOf(u) {
  if (u.account) return u.account;
  if (u.email) {
    u.account = normalizeEmail(u.email);
    u.accountType = 'email';
    return u.account;
  }
  return '';
}

function issueToken(user) {
  const token = newToken();
  DB.tokens[token] = { userId: user.id, expiresAt: Date.now() + TOKEN_DAYS * 86400000 };
  return token;
}
function userOfToken(token) {
  if (!token) return null;
  const t = DB.tokens[token];
  if (!t) return null;
  if (t.expiresAt && t.expiresAt < Date.now()) { delete DB.tokens[token]; saveSoon(); return null; }
  return DB.users.find(u => u.id === t.userId) || null;
}
function publicUser(u) {
  const key = accountKeyOf(u);
  return {
    id: u.id,
    account: key,
    accountType: u.accountType || 'email',
    email: u.email || '',
    phone: u.phone || '',
    createdAt: u.createdAt,
  };
}

function shopRec(userId) {
  if (!DB.shops[userId]) DB.shops[userId] = { rev: 0, updatedAt: null, payload: null };
  return DB.shops[userId];
}
function orderRecs(userId) {
  if (!DB.orders[userId]) DB.orders[userId] = [];
  return DB.orders[userId];
}

/* ------------------------------------------------------------------ HTTP */

function send(res, code, obj) {
  const body = JSON.stringify(obj == null ? {} : obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > BODY_LIMIT) { reject(new Error('请求体过大')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (e) { reject(new Error('JSON 解析失败')); }
    });
    req.on('error', reject);
  });
}

function bearer(req) {
  const h = String(req.headers.authorization || '');
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : '';
}

/* --------------------------------------------------------------- 业务路由 */

async function handle(req, res, url) {
  const p = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') return send(res, 204, {});

  if (p === '/' || p === '/health') {
    return send(res, 200, {
      ok: true,
      service: SERVICE_NAME,
      tag: SERVICE_TAG,          // 供客户端确认「是本程序的同步服务器」
      version: 1,
      port: PORT,
      lan: lanAddresses(),
      users: DB.users.length,
      time: new Date().toISOString(),
    });
  }

  /* --- 注册（账号可以是手机号或邮箱） --- */
  if (p === '/api/register' && req.method === 'POST') {
    const b = await readBody(req);
    const acc = normalizeAccount(pickAccountInput(b));
    const password = String(b.password || '');
    if (!acc) return send(res, 400, { error: '请填写正确的手机号或邮箱' });
    if (password.length < 6) return send(res, 400, { error: '密码至少 6 位' });
    if (DB.users.some(u => accountKeyOf(u) === acc.key)) {
      return send(res, 409, { error: (acc.type === 'phone' ? '该手机号' : '该邮箱') + '已注册，请直接登录' });
    }
    const salt = newSalt();
    const user = {
      id: 'u' + crypto.randomBytes(8).toString('hex'),
      account: acc.key,
      accountType: acc.type,
      email: acc.type === 'email' ? acc.key : '',
      phone: acc.type === 'phone' ? acc.key : '',
      salt, hash: hashPassword(password, salt),
      shopName: String(b.shopName || '').slice(0, 60),
      createdAt: new Date().toISOString(),
    };
    DB.users.push(user);
    const token = issueToken(user);
    saveDB();
    console.log('[注册] ' + acc.type + ' ' + acc.key);
    return send(res, 200, { token, user: publicUser(user) });
  }

  /* --- 登录（手机号或邮箱都行） --- */
  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    const acc = normalizeAccount(pickAccountInput(b));
    const password = String(b.password || '');
    if (!acc) return send(res, 400, { error: '请填写正确的手机号或邮箱' });
    const user = DB.users.find(u => accountKeyOf(u) === acc.key);
    // 「账号不存在」(404) 与「密码错误」(401) 分开返回：
    // 客户端据此决定是提示密码错，还是在本机新开一个同名账号
    if (!user) {
      return send(res, 404, {
        error: (acc.type === 'phone' ? '该手机号' : '该邮箱') + '尚未注册',
        notFound: true,
      });
    }
    if (hashPassword(password, user.salt) !== user.hash) {
      return send(res, 401, { error: '账号或密码不正确' });
    }
    const token = issueToken(user);
    saveDB();
    console.log('[登录] ' + acc.type + ' ' + acc.key);
    return send(res, 200, { token, user: publicUser(user) });
  }

  /* --- 退出 --- */
  if (p === '/api/logout' && req.method === 'POST') {
    const token = bearer(req);
    if (token && DB.tokens[token]) { delete DB.tokens[token]; saveDB(); }
    return send(res, 200, { ok: true });
  }

  /* ---------------------------- 以下均需登录 ---------------------------- */
  const user = userOfToken(bearer(req));
  if (!user) return send(res, 401, { error: '未登录或登录已过期，请重新登录' });

  /* --- 当前账号状态（App 启动时用它判断本地是否落后） --- */
  if (p === '/api/me' && req.method === 'GET') {
    const s = shopRec(user.id);
    return send(res, 200, {
      user: publicUser(user),
      shop: { rev: s.rev, updatedAt: s.updatedAt },
      orderCount: orderRecs(user.id).length,
    });
  }

  /* --- 整店数据：拉取 --- */
  if (p === '/api/shop' && req.method === 'GET') {
    const s = shopRec(user.id);
    return send(res, 200, { rev: s.rev, updatedAt: s.updatedAt, payload: s.payload });
  }

  /* --- 整店数据：推送 ---
   * 客户端带上它这次改动所基于的 rev。若服务器 rev 更大，说明别的端也改过，
   * 默认拒绝（409 + conflict），让客户端先合并再重推；force:true 表示明确要覆盖。 */
  if (p === '/api/shop' && req.method === 'PUT') {
    const b = await readBody(req);
    const s = shopRec(user.id);
    const baseRev = Number(b.rev || 0);
    if (!b.force && baseRev < s.rev) {
      return send(res, 409, {
        error: '服务器上有更新的数据', conflict: true,
        server: { rev: s.rev, updatedAt: s.updatedAt, payload: s.payload },
      });
    }
    s.rev = s.rev + 1;
    s.updatedAt = new Date().toISOString();
    s.payload = b.payload == null ? null : b.payload;
    saveSoon();
    return send(res, 200, { rev: s.rev, updatedAt: s.updatedAt });
  }

  /* --- 订单：增量拉取（since=本地已知的最大版本号） --- */
  if (p === '/api/orders' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const list = orderRecs(user.id).filter(o => Number(o.rev || 0) > since);
    const maxRev = orderRecs(user.id).reduce((m, o) => Math.max(m, Number(o.rev || 0)), 0);
    return send(res, 200, { rev: maxRev, orders: list });
  }

  /* --- 订单：批量上推 --- */
  if (p === '/api/orders' && req.method === 'PUT') {
    const b = await readBody(req);
    const upserts = Array.isArray(b.upserts) ? b.upserts : [];
    const list = orderRecs(user.id);
    let rev = list.reduce((m, o) => Math.max(m, Number(o.rev || 0)), 0);
    let applied = 0;
    upserts.forEach(u => {
      const uid = String(u.order_uid || '').trim();
      if (!uid) return;
      rev += 1;
      const hit = list.find(o => o.order_uid === uid);
      const rec = {
        order_uid: uid,
        payload: u.payload == null ? null : u.payload,
        deleted: !!u.deleted,
        clientUpdatedAt: u.clientUpdatedAt || null,
        rev,
        updatedAt: new Date().toISOString(),
      };
      if (hit) Object.assign(hit, rec); else list.push(rec);
      applied++;
    });
    if (applied) saveSoon();
    return send(res, 200, { rev, applied });
  }

  return send(res, 404, { error: '接口不存在' });
}

/* ------------------------------------------------------------------ 工具 */

function lanAddresses() {
  const ifaces = os.networkInterfaces();
  const out = [];
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) out.push(i.address);
    });
  });
  return out;
}

/* ----------------------------------------------------------------- 启动 */

/**
 * 启动同步服务器。
 * @param {object} [opts]
 * @param {number}  [opts.port=8787]           监听端口
 * @param {string}  [opts.dataDir]             数据目录（默认 ./data）
 * @param {string}  [opts.host='0.0.0.0']      监听地址
 * @param {boolean} [opts.embedded=false]      内嵌模式：不接管进程信号、不打印横幅
 * @param {boolean} [opts.silent=false]        不打印任何日志
 * @returns {Promise<{port:number,host:string,lan:string[],dataDir:string,dbFile:string,close:Function}>}
 */
function startServer(opts) {
  opts = opts || {};
  if (started) return Promise.reject(new Error('本进程已经启动过同步服务器'));
  started = true;

  PORT = Number(opts.port || process.env.PORT || DEFAULT_PORT);
  DATA_DIR = opts.dataDir
    ? path.resolve(opts.dataDir)
    : (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data'));
  DB_FILE = path.join(DATA_DIR, 'db.json');

  const HOST = opts.host || '0.0.0.0';
  const embedded = !!opts.embedded;
  const silent = !!opts.silent;

  loadDB();

  // 独立运行时才接管信号，内嵌时由宿主进程负责收尾
  if (!embedded) {
    process.on('SIGINT', () => { saveDB(); console.log('\n已保存并退出。'); process.exit(0); });
    process.on('SIGTERM', () => { saveDB(); process.exit(0); });
  }

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      let url;
      try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, { error: '非法请求' }); }
      handle(req, res, url).catch(err => {
        console.error('[error] ' + (err && err.stack || err));
        send(res, 500, { error: String(err && err.message || err) });
      });
    });

    server.on('error', err => {
      started = false;
      reject(err);
    });

    server.listen(PORT, HOST, () => {
      const lan = lanAddresses();
      const info = {
        port: PORT,
        host: HOST,
        lan,
        dataDir: DATA_DIR,
        dbFile: DB_FILE,
        close: () => new Promise(r => { saveDB(); server.close(() => r()); }),
      };

      if (!silent) {
        console.log('');
        console.log('  ╔══════════════════════════════════════════════════════╗');
        console.log('  ║        通用收银台 · 多端同步服务器 已启动            ║');
        console.log('  ╚══════════════════════════════════════════════════════╝');
        console.log('');
        console.log('  本机地址（这台电脑上打开收银台就填这个）：');
        console.log('      http://localhost:' + PORT);
        console.log('');
        if (lan.length) {
          console.log('  局域网地址（手机 / 其他电脑连同一个 WiFi 就填这个）：');
          lan.forEach(a => console.log('      http://' + a + ':' + PORT));
          console.log('');
        } else {
          console.log('  （没检测到局域网地址，手机同步需先连上 WiFi 或做端口映射）');
          console.log('');
        }
        console.log('  数据文件：' + DB_FILE);
        console.log('  已注册账号：' + DB.users.length + ' 个');
        console.log('');
        if (!embedded) {
          console.log('  保持这个窗口开着即可；关掉窗口 = 停止同步服务。');
          console.log('  按 Ctrl + C 退出。');
          console.log('');
        }
      }

      resolve(info);
    });
  });
}

/** 探测某个地址上是不是本程序的同步服务器（用于端口占用时复用已有实例） */
function probeServer(port, host, timeoutMs) {
  const base = 'http://' + (host || '127.0.0.1') + ':' + port;
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    let req;
    try {
      req = http.get(base + '/health', res => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', c => { raw += c; if (raw.length > 65536) req.destroy(); });
        res.on('end', () => {
          try {
            const d = JSON.parse(raw);
            finish(d && d.tag === SERVICE_TAG
              ? { ok: true, base, port, lan: Array.isArray(d.lan) ? d.lan : [], users: d.users || 0 }
              : { ok: false, reason: 'not-ours' });
          } catch (e) { finish({ ok: false, reason: 'bad-json' }); }
        });
      });
    } catch (e) { return finish({ ok: false, reason: 'error' }); }
    req.setTimeout(timeoutMs || 900, () => { try { req.destroy(); } catch (e) {} finish({ ok: false, reason: 'timeout' }); });
    req.on('error', () => finish({ ok: false, reason: 'error' }));
  });
}

/* ------------------------------------------------------------ 命令行入口 */

if (require.main === module) {
  startServer({ port: Number(process.env.PORT || DEFAULT_PORT) })
    .catch(err => {
      if (err && err.code === 'EADDRINUSE') {
        console.error('');
        console.error('  ❌ 端口 ' + (process.env.PORT || DEFAULT_PORT) + ' 已被占用。');
        console.error('     可能已经有一个同步服务器在跑了；或者换个端口：');
        console.error('       PORT=9000 node server.js');
        console.error('');
      } else {
        console.error('[error] 启动失败：' + (err && err.message || err));
      }
      process.exit(1);
    });
}

module.exports = {
  startServer,
  probeServer,
  lanAddresses,
  normalizeAccount,
  SERVICE_TAG,
  SERVICE_NAME,
  DEFAULT_PORT,
};
