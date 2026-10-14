const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');
const syncSrv = require('./sync-server/server.js');

/* 读取部署/安装时预置的店铺配置（store.json）
 * 优先级：用户数据目录 → 可执行文件所在目录 */
function readDeployConfig() {
  const candidates = [
    path.join(app.getPath('userData'), 'store.json'),
    path.join(path.dirname(app.getPath('exe')), 'store.json'),
  ];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
    } catch (e) { /* ignore */ }
  }
  return null;
}

/* ================= 内嵌同步服务器 =================
 * 桌面版启动时自动在后台跑一个同步服务，各端（含手机）连过来即可共享数据。
 * 用户不需要再手动去双击「启动同步服务器」。
 *
 * - 数据写在用户数据目录（不在程序目录里）：
 *     macOS   ~/Library/Application Support/通用收银台/sync-data/db.json
 *     Windows %APPDATA%\通用收银台\sync-data\db.json
 *     Linux   ~/.config/通用收银台/sync-data/db.json
 * - 端口从 8787 起，被占用就往后顺延（8788、8789…）；
 *   若占用者本身就是本程序的同步服务，则直接复用它，不再另起一个。
 * ================================================ */

const SYNC_PORTS = [8787, 8788, 8789, 8790, 8791, 8792];

let SYNC_INFO = { ok: false, starting: true, error: '', port: 0, base: '', lan: [], dataDir: '', reused: false };
let syncReadyResolve = null;
const syncReady = new Promise(res => { syncReadyResolve = res; });

async function bootSyncServer() {
  const dataDir = path.join(app.getPath('userData'), 'sync-data');
  let closeFn = null;

  // ① 先探测：默认端口上是不是已经跑着本程序的同步服务（比如上次没退干净 / 用户手动起过）
  for (const p of SYNC_PORTS) {
    const probe = await syncSrv.probeServer(p, '127.0.0.1', 600);
    if (probe.ok) {
      SYNC_INFO = {
        ok: true, starting: false, reused: true, port: p,
        base: 'http://localhost:' + p,
        lan: (probe.lan || []).map(a => 'http://' + a + ':' + p),
        dataDir, users: probe.users || 0, error: '',
      };
      console.log('[sync] 复用已在运行的服务 :' + p);
      syncReadyResolve(SYNC_INFO);
      return SYNC_INFO;
    }
  }

  // ② 没探测到，自己起一个；端口冲突就顺延
  let lastErr = null;
  for (const p of SYNC_PORTS) {
    try {
      const info = await syncSrv.startServer({
        port: p, dataDir, host: '0.0.0.0', embedded: true, silent: true,
      });
      closeFn = info.close;
      SYNC_INFO = {
        ok: true, starting: false, reused: false, port: info.port,
        base: 'http://localhost:' + info.port,
        lan: (info.lan || []).map(a => 'http://' + a + ':' + info.port),
        dataDir: info.dataDir, dbFile: info.dbFile, error: '',
        _close: closeFn,
      };
      console.log('[sync] 已启动内嵌同步服务 :' + info.port + '  数据目录 ' + info.dataDir);
      if (SYNC_INFO.lan.length) console.log('[sync] 手机/其他电脑请填：' + SYNC_INFO.lan.join('  '));
      syncReadyResolve(SYNC_INFO);
      return SYNC_INFO;
    } catch (e) {
      lastErr = e;
      if (e && e.code === 'EADDRINUSE') continue;   // 换个端口再试
      break;
    }
  }

  SYNC_INFO = {
    ok: false, starting: false, reused: false, port: 0, base: '', lan: [], dataDir,
    error: (lastErr && lastErr.code === 'EADDRINUSE')
      ? ('端口 ' + SYNC_PORTS[0] + '–' + SYNC_PORTS[SYNC_PORTS.length - 1] + ' 都被占用')
      : String((lastErr && lastErr.message) || lastErr || '未知错误'),
  };
  console.error('[sync] 启动失败：' + SYNC_INFO.error);
  syncReadyResolve(SYNC_INFO);
  return SYNC_INFO;
}

// 对外只暴露可序列化的字段
function publicSyncInfo() {
  return {
    ok: !!SYNC_INFO.ok,
    starting: !!SYNC_INFO.starting,
    reused: !!SYNC_INFO.reused,
    port: SYNC_INFO.port || 0,
    base: SYNC_INFO.base || '',
    lan: Array.isArray(SYNC_INFO.lan) ? SYNC_INFO.lan : [],
    dataDir: SYNC_INFO.dataDir || '',
    error: SYNC_INFO.error || '',
    embedded: true,
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: '通用收银台',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 非 macOS 隐藏菜单栏，更贴近收银机体验
  if (process.platform !== 'darwin') {
    win.removeMenu();
  }

  win.loadFile(path.join(__dirname, 'index.html'));

  // 页面加载完成后，把部署配置和内嵌同步服务状态推给前端
  win.webContents.on('did-finish-load', () => {
    const cfg = readDeployConfig();
    if (cfg) win.webContents.send('deploy-config', cfg);
    win.webContents.send('sync-server-info', publicSyncInfo());
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.key === 'F12') {
      win.webContents.openDevTools();
      e.preventDefault();
    }
  });
}

/* ============ 自动更新 ============ */
autoUpdater.autoDownload = false;
autoUpdater.on('update-available', (info) => {
  dialog.showMessageBox({
    type: 'info',
    title: '发现新版本',
    message: `检测到新版本 v${info.version}，是否现在下载并更新？`,
    buttons: ['立即更新', '稍后'],
    defaultId: 0,
  }).then(({ response }) => {
    if (response === 0) autoUpdater.downloadUpdate();
  });
});
autoUpdater.on('update-not-available', () => { /* 已是最新 */ });
autoUpdater.on('error', () => { /* 静默：无网络/未配置发布地址时不影响使用 */ });
autoUpdater.on('update-downloaded', () => {
  dialog.showMessageBox({
    type: 'info',
    title: '更新就绪',
    message: '新版本已下载完成，点击确定后应用将重启并安装更新。',
    buttons: ['重启安装'],
    defaultId: 0,
  }).then(() => autoUpdater.quitAndInstall());
});

ipcMain.handle('check-for-updates', async () => {
  try {
    await autoUpdater.checkForUpdates();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
});
ipcMain.handle('get-app-version', () => app.getVersion());

/* 前端查询内嵌同步服务状态（启动尚未完成时会等它完成） */
ipcMain.handle('sync-server-info', async () => {
  if (SYNC_INFO.starting) { await syncReady; }
  return publicSyncInfo();
});

/* 打开同步数据所在目录，方便用户备份 */
ipcMain.handle('sync-server-open-data', async () => {
  const dir = SYNC_INFO.dataDir || path.join(app.getPath('userData'), 'sync-data');
  try { fs.mkdirSync(dir, { recursive: true }); } catch (e) { /* ignore */ }
  const err = await shell.openPath(dir);
  return err ? { ok: false, error: err } : { ok: true, dir };
});

app.whenReady().then(() => {
  createWindow();
  // 后台起同步服务，不阻塞窗口显示
  bootSyncServer().then(info => {
    BrowserWindow.getAllWindows().forEach(w => {
      if (!w.isDestroyed()) w.webContents.send('sync-server-info', publicSyncInfo());
    });
    void info;
  });
  // 启动后静默检查更新（无发布地址时自动忽略）
  autoUpdater.checkForUpdates().catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// 退出前把同步数据落盘（close() 内部先同步写盘再关连接）
app.on('before-quit', () => {
  if (SYNC_INFO && typeof SYNC_INFO._close === 'function') {
    try { SYNC_INFO._close(); } catch (e) { /* ignore */ }
  }
});
