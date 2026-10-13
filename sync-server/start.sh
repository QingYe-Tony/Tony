#!/bin/bash
# 通用收银台 · 同步服务器（macOS / Linux 双击运行）
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
  echo ""
  echo "  没找到 Node.js。请先安装（任选其一）："
  echo "    · 官网下载：https://nodejs.org  选 LTS 版本，一路下一步即可"
  echo "    · 或用 Homebrew：brew install node"
  echo ""
  echo "  装好后把这个窗口关掉，重新双击本文件。"
  echo ""
  read -n 1 -s -r -p "  按任意键关闭…"
  exit 1
fi

echo ""
echo "  正在启动同步服务器…"
echo ""
node server.js

echo ""
read -n 1 -s -r -p "  服务器已停止，按任意键关闭…"
