; installer.nsh —— 让 Windows 安装包（NSIS）支持简体中文界面
; electron-builder 会把本文件插入到生成的 NSIS 脚本中（MUI 已初始化），
; 通过再注册一种语言即可让简体中文系统的用户看到中文向导。
; 配合 package.json 中 nsis.displayLanguageSelector=true，可在多语言环境下手动选择。

!insertmacro MUI_LANGUAGE "SimpChinese"
