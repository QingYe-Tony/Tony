const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// 读取部署/安装时预置的店铺配置（store.json）
// 优先级：用户数据目录 → 可执行文件所在目录
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

  // 页面加载完成后，把部署配置推给前端
  win.webContents.on('did-finish-load', () => {
    const cfg = readDeployConfig();
    if (cfg) win.webContents.send('deploy-config', cfg);
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

app.whenReady().then(() => {
  createWindow();
  // 启动后静默检查更新（无发布地址时自动忽略）
  autoUpdater.checkForUpdates().catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
