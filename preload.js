// 仅暴露最小、必要的能力给渲染进程（contextIsolation 下安全桥接）
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // 主进程推送的部署配置（store.json）
  onDeployConfig: (cb) => ipcRenderer.on('deploy-config', (e, cfg) => cb(cfg)),
  // 手动检查更新
  checkForUpdates: () => ipcRenderer.invoke('check-for-updates'),
  // 获取应用版本号
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),

  // ---- 内嵌同步服务 ----
  // 查询状态：{ ok, starting, reused, port, base, lan[], dataDir, error, embedded }
  getSyncServerInfo: () => ipcRenderer.invoke('sync-server-info'),
  // 主进程主动推送状态变化（启动完成时）
  onSyncServerInfo: (cb) => ipcRenderer.on('sync-server-info', (e, info) => cb(info)),
  // 打开同步数据目录
  openSyncDataDir: () => ipcRenderer.invoke('sync-server-open-data'),
});
