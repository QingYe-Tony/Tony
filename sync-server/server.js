#!/usr/bin/env node
/*
 * 通用收银台 · 多端同步服务器
 * ---------------------------------------------------------------
 * 零依赖（只用 Node 内置模块），数据保存在本机 sync-server/data/db.json。
 * 账号密码用 PBKDF2-SHA512 + 随机盐存储，登录后发 30 天有效的令牌。
 *
 * 启动：node server.js            （默认端口 8787）
 *      PORT=9000 node server.js   （自定义端口）
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

const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const BODY_LIMIT = 32 * 1024 * 1024;   // 单次请求体上限 32MB（整店数据可能较大）
const TOKEN_DAYS = 30;

/* ------------------------------------------------------------------ 存储 */

const EMPTY_DB = () => ({ users: [], tokens: {}, shops: {}, orders: {} });
let DB = EMPTY_DB();
let dbReady = false;

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function loadDB() {
  ensureDir();
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      if (raw.trim()) {
        DB = Object.assign(EMPTY_DB(), JSON.parse(raw));
        ['users'].forEach(k => { if (!Array.isArray(DB[k])) DB[k] = []; });
        ['tokens', 'shops', 'orders'].forEach(k => { if (!DB[k] || typeof DB[k] !== 'object') DB[k] = {}; });
      }
    }
  } catch (e) {
    console.error('[warn] db.json 读取失败，已从空库开始：' + e.message);
    const bad = DB_FILE + '.broken-' + Date.now();
    try { fs.renameSync(DB_FILE, bad); console.error('[warn] 原文件已备份为 ' + bad); } catch (_) {}
    DB = EMPTY_DB();
  }
  dbReady = true;
}

let saveTimer = null;
function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; saveDB(); }, 120);
}
function saveDB() {
  if (!dbReady) return;
  ensureDir();
  const tmp = DB_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(DB), 'utf8');
    fs.renameSync(tmp, DB_FILE);            // 原子替换，避免断电写坏
  } catch (e) {
    console.error('[error] 数据写入失败：' + e.message);
  }
}
process.on('SIGINT', () => { saveDB(); console.log('\n已保存并退出。'); process.exit(0); });
process.on('SIGTERM', () => { saveDB(); process.exit(0); });

/* -------------------------------------------------------------- 账号与令牌 */

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(String(password), salt, 120000, 64, 'sha512').toString('hex');
}
function newSalt() { return crypto.randomBytes(16).toString('hex'); }
function newToken() { return crypto.randomBytes(24).toString('hex'); }

function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }

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
  return { id: u.id, email: u.email, createdAt: u.createdAt };
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
      ok: true, service: '通用收银台同步服务器', version: 1,
      users: DB.users.length,
      time: new Date().toISOString(),
    });
  }

  /* --- 注册 --- */
  if (p === '/api/register' && req.method === 'POST') {
    const b = await readBody(req);
    const email = normalizeEmail(b.email);
    const password = String(b.password || '');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return send(res, 400, { error: '请填写正确的邮箱' });
    if (password.length < 6) return send(res, 400, { error: '密码至少 6 位' });
    if (DB.users.some(u => u.email === email)) return send(res, 409, { error: '该邮箱已注册，请直接登录' });
    const salt = newSalt();
    const user = {
      id: 'u' + crypto.randomBytes(8).toString('hex'),
      email, salt, hash: hashPassword(password, salt),
      shopName: String(b.shopName || '').slice(0, 60),
      createdAt: new Date().toISOString(),
    };
    DB.users.push(user);
    const token = issueToken(user);
    saveDB();
    console.log('[注册] ' + email);
    return send(res, 200, { token, user: publicUser(user) });
  }

  /* --- 登录 --- */
  if (p === '/api/login' && req.method === 'POST') {
    const b = await readBody(req);
    const email = normalizeEmail(b.email);
    const password = String(b.password || '');
    const user = DB.users.find(u => u.email === email);
    if (!user || hashPassword(password, user.salt) !== user.hash) {
      return send(res, 401, { error: '邮箱或密码不正确' });
    }
    const token = issueToken(user);
    saveDB();
    console.log('[登录] ' + email);
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

/* ----------------------------------------------------------------- 启动 */

loadDB();

const server = http.createServer((req, res) => {
  let url;
  try { url = new URL(req.url, 'http://localhost'); } catch (e) { return send(res, 400, { error: '非法请求' }); }
  handle(req, res, url).catch(err => {
    console.error('[error] ' + (err && err.stack || err));
    send(res, 500, { error: String(err && err.message || err) });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const ifaces = os.networkInterfaces();
  const lan = [];
  Object.keys(ifaces).forEach(name => {
    (ifaces[name] || []).forEach(i => {
      if (i.family === 'IPv4' && !i.internal) lan.push(i.address);
    });
  });
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
  console.log('  保持这个窗口开着即可；关掉窗口 = 停止同步服务。');
  console.log('  按 Ctrl + C 退出。');
  console.log('');
});
