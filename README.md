# 通用商户收银系统（跨平台版）v1.5.0

一套用纯前端（HTML/CSS/JS，零依赖、可离线）实现的商户收银系统，**覆盖 Windows / macOS / Linux / Android / iOS / 平板 / 手机**，对标「商户收银宝」类软件的核心功能。

> 说明：本系统为功能等价的原创实现，未使用任何第三方专有代码或素材。

---

## 一、怎么用（三种方式，任选其一）

### 方式 A：直接双击（最简单）
双击 `index.html` 用浏览器打开即可使用。零安装、零依赖。
- 适合：临时收银、演示、单台设备。
- 注意：`file://` 方式下个别浏览器可能对本地数据持久化有限制，**重要数据请务必用「设置 → 导出全部数据」做备份**。

### 方式 B：本地服务器（推荐，可安装为 App / 离线）
在本文件夹执行：

```bash
# macOS / Linux
python3 server.py

# Windows
py server.py
```

终端会打印访问地址（默认 `http://localhost:8000`），浏览器自动打开。
- 用 http 方式打开后，地址栏会出现「安装 / 添加到主屏幕」按钮，可**像原生 App 一样固定到桌面或开始菜单**。
- 安装后支持**断网离线使用**（PWA 缓存）。

### 方式 C：部署到内网 / 公网
把本文件夹作为静态站点托管即可（Nginx、GitHub Pages、对象存储等）。
所有逻辑均在浏览器本地，无需后端服务器，数据不出本机。

---

## 二、功能清单

| 模块 | 功能 |
|------|------|
| 收银台 | 商品点选 / 条码扫码加购；改数量；整单优惠；现金（带找零）、微信、支付宝、银行卡收款；**组合支付 / 拆分收款**；**现场消费开卡**；自动小票 + 打印 |
| 促销引擎 | 满减 → 会员等级折扣 → 整单优惠 → 抹零；逐行显示优惠构成 |
| 挂单 | 整单暂存 / 备注 / 取单恢复，支持多单并行 |
| 商品与库存 | 名称 / 条码 / 分类 / 售价 / **进价** / 库存 / **安全库存** / 单位 / 图标；入库、出库报损、盘点、流水、低库存预警；批量导入导出 |
| 会员 | 卡号自动生成、等级与折扣、积分累计、余额抵扣、充值扣减 |
| 短信通知 | 开卡 / 消费 / 充值自动通知；本地记录或 Webhook 网关双通道；模板自定义、记录可重发导出 |
| 员工与权限 | 员工账号 + PIN 登录门；店长 / 收银员角色；限制收银员改折扣 |
| 订单 | 按日期查询；查看明细；退货（自动回补库存、冲回积分与累计消费、写退货流水） |
| 报表 | 营业额、订单数、客单价、支付方式占比、热销商品 TOP（支持日期区间） |
| 交班 | 本班营收汇总、一键交班打单、交班记录留痕 |
| 数据备份 | **五格式导出**（JSON / Excel / CSV / ZIP / SQL）+ **自动识别导入**（拖拽即可，支持真实 Excel 文件）；合并去重或覆盖还原 |
| **账号与多端同步** | **v1.3.1 新增**：注册 / 登录 / 退出；商品·会员·订单在手机·平板·收银机·电脑之间自动同步；订单走幂等增量通道，整店数据用版本号做乐观并发并以「本机优先」合并；改动后 4 秒自动同步，也可手动「立即同步」；同步状态、上次同步时间、错误提示一目了然 |
| **手机号账号** | **v1.5.0 新增**：手机号与邮箱**完全等价**，都能当账号注册 / 登录；`13800001234`、`+8613800001234`、`138-0000-1234` 归一为同一个账号；旧版本只用邮箱注册的账号自动兼容，原登录方式不变 |
| **登录门双入口** | **v1.5.0 新增**：收银员登录界面新增「账号登录」页签（手机号 / 邮箱 + 密码 + 注册），不必先进设置页；手机端可在同一页填服务器地址；账号登录后本机自动以店长身份开工；页签与上次选的收银员都会被记住 |
| 设置 | 店铺名 / Logo / 货币符号 / 税率；促销与等级配置；短信设置；账号登录与多端同步；备份与恢复中心；清空；演示数据 |

### 键盘快捷键（收银台）
- `F1` 现金 · `F2` 微信 · `F3` 支付宝 · `F4` 银行卡 · `F9` 组合支付
- 在「扫码」框输入条码后按 `Enter` 直接加购

---

## 二·五、多端同步（v1.3.1 新增，v1.4.0 桌面版免手动启动，v1.5.0 支持手机号）

内置一个**零依赖的同步服务器**（`sync-server/server.js`，只用 Node 内置模块：`http`/`fs`/`path`/`crypto`/`os`），
数据存在你自己的电脑上，不经过任何第三方云。

**桌面版（Windows / macOS / Linux）**：应用启动时自动在后台拉起同步服务，用户什么都不用做 ——
`main.js` 会依次探测 8787–8792，遇到端口占用自动顺延，若占用者是本程序的实例则直接复用；
数据写到用户数据目录（`…/通用收银台/sync-data/db.json`），不会写进只读的 asar 包内。

**手机 / 网页版 / 独立部署**：本身跑不了 Node，需要连到同一 WiFi 下那台跑着同步服务的电脑：

```bash
# 在一台电脑上启动（Windows 双击「启动同步服务器.bat」）
node sync-server/server.js              # 默认 8787
PORT=9000 DATA_DIR=/var/pos node server.js   # 自定义端口 / 数据目录
```

也可以把它当模块内嵌到别的 Node 程序里：

```js
const { startServer } = require('./sync-server/server.js');
const info = await startServer({ port: 8787, dataDir: '/path/to/data', embedded: true, silent: true });
// info = { port, host, lan: [...], dataDir, dbFile, close() }
```

然后在每台设备的「设置 → 账号登录与多端同步」里填**同一个服务器地址 + 同一个账号**即可。
桌面版面板顶部会显示绿色状态卡（本机地址 / 手机该填的局域网地址 / 数据目录），地址自动填好，点「复制」即可发到手机。
收银员登录界面上也有「账号登录」页签，可以直接建号并登录，不用先进设置页。

- **账号**：手机号或邮箱注册，两者等价；密码用 PBKDF2-HMAC-SHA512 + 随机盐（12 万次迭代）存储，库里没有明文；登录发 30 天有效令牌。
  `normalizeAccount()` 负责归一：邮箱转小写；手机号去掉 `+86` / 空格 / 横线；老库只有 `email` 字段时启动自动补齐 `account`（不影响原登录方式）。
- **整店数据**（店铺设置 / 商品 / 会员 / 库存流水 / 短信 / 交班 / 挂单）走 `rev` 版本号乐观并发，
  拉取时按「本机优先」合并 —— 本机改过的记录不会被覆盖，云端独有的记录会追加进来。
- **订单**走独立增量通道，按 `order_uid` 幂等 upsert，只增不改，不会把别端刚开的单冲掉。
- **账号隔离**：每个接口都强制校验归属，任何账号都读不到别人的数据。
- **不登录也能收银**：同步是纯增强项，没网、没登录都不影响任何原有功能。

详见 `sync-server/使用说明.md`。

---

## 三、数据说明
- 数据默认保存在浏览器 **localStorage**（按网站/域名隔离）。
- **换设备、清缓存、重装 App 前，请到「设置 → 备份与恢复中心」导出备份。**
- 支持的导出格式与恢复方式：

| 格式 | 说明 |
|------|------|
| JSON | 完整数据，原样恢复（推荐做定期备份） |
| Excel (xlsx) | 8 个工作表，可用 Excel / WPS 打开查看或交给会计 |
| ZIP | 打包完整 JSON + 各表 CSV + 说明文件 |
| CSV | 按表导出，带 BOM，Excel 打开不乱码 |
| SQL | `DROP/CREATE/INSERT` 脚本，可灌入 MySQL / SQLite / PostgreSQL |

- 导入时**不挑格式**：把文件拖进导入区即可，系统自动识别 JSON / Excel / CSV / TSV / ZIP / SQL，
  支持真实 MS Excel 导出文件的共享字符串表；中文列名（如「商品名称」「零售价」）自动映射到系统字段。
- 两种恢复方式：**合并**（保留现有数据，重复项跳过）或**覆盖**（清空后按备份原样还原）。

---

## 四、文件结构
```
pos-system/
├── index.html            # 主程序（单文件，含全部界面与逻辑）
├── manifest.webmanifest  # PWA 清单（可安装 / 离线）
├── sw.js                 # Service Worker（离线缓存）
├── icon.svg              # 应用图标源码
├── server.py             # 跨平台本地启动器（PWA 模式用）
├── main.js               # Electron 主进程（含自动更新、部署配置读取）
├── preload.js            # 渲染进程安全桥接（更新检查 / 版本 / 部署配置）
├── package.json          # Electron 打包配置（含 publish 自动更新地址）
├── icons.js              # 图标生成脚本（png/ico/icns）
├── installer.nsh         # Windows 安装包简体中文语言包
├── build/                # 生成的应用图标（icon.png/icon.ico/icon.icns）
├── .github/workflows/    # 一键构建 Windows / macOS / Linux 安装包的 CI
├── sync-server/          # 多端同步服务器（零依赖 Node 程序 + 三平台启动脚本 + 使用说明）
├── 使用手册.md            # 最终用户使用手册
└── README.md             # 本说明
```

---

## 五、打包成桌面 App（Electron）

同一套前端代码，可产出 **macOS / Windows / Linux** 三种原生安装包。

### 本地构建（在目标系统上）
```bash
cd pos-system
npm install            # 安装 electron + electron-builder
npm run dist:mac       # macOS  → .app + .dmg + .zip
npm run dist:win       # Windows → .exe(NSIS) + 绿色便携版
npm run dist:linux     # Linux  → .AppImage + .deb
```
> 说明：各平台安装包需在**对应系统**上构建（Windows 无法在 macOS 上产出，反之亦然）。
> macOS 未签名，首次打开若被拦截：右键「打开」一次，或执行 `xattr -cr "通用收银台.app"`。
>
> 打包细节：
> - `asar: true`：前端代码已打包进 `app.asar`（推荐，体积小、源码受保护）。
> - **Windows 安装包为中文界面**：`installer.nsh` 注册了简体中文语言包，`nsis.displayLanguageSelector=true` 可在多语言环境手动选择，`nsis.messages` 把安装向导文案汉化（下一步/完成/创建桌面快捷方式等）。
> - **自动更新**：已集成 `electron-updater`，启动静默检查 + 设置页手动检查；需在 `build.publish` 填写发布地址（默认占位 `https://REPLACE-THIS.example.com/releases/`）并托管构建产物。
> - **店铺名/Logo 可配置**：设置页可上传 Logo（显示在页头与小票）；亦可在程序目录放 `store.json`（`{"name":"店名","logo":"data:image/png;base64,..."}`）于部署/安装时一次性预置。
> - 最终用户图文手册见 `使用手册.md`。

### 一键出全平台（GitHub Actions）
仓库已内置 `.github/workflows/build.yml`：推送 `v*` 标签或在 Actions 页点 **Run workflow**，
CI 会在 Windows / macOS / Ubuntu 三个 runner 上**分别**构建，产物以 Artifact 形式下载，包含：
- `pos-win`：Windows 安装包（`.exe`）
- `pos-mac`：macOS 安装包（`.dmg`/`.zip`）
- `pos-linux`：Linux 安装包（`.AppImage`/`.deb`）

即无需本地装环境，也能拿到全部三个系统的安装包。

### 沙箱 / CI 加速（国内网络）
若下载 electron 慢，可先设置镜像再安装：
```bash
export ELECTRON_MIRROR="https://registry.npmmirror.com/-/binary/electron/"
export ELECTRON_BUILDER_BINARIES_MIRROR="https://registry.npmmirror.com/-/binary/electron-builder-binaries/"
npm install
```

