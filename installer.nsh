; installer.nsh —— 由 electron-builder 插入到生成的 NSIS 脚本中（MUI 已初始化）。
; 简体中文界面由 package.json 的 nsis.language="zh_CN" 驱动（electron-builder
; 会自行插入 MUI_LANGUAGE "SimpChinese" 并使用其内置中文翻译），因此此处不再重复插入。
; 如需额外自定义安装行为，可在此追加 NSIS 指令。
