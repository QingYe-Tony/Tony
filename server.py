#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
跨平台启动器：启动本地服务器并自动打开浏览器。
用法：
  macOS / Linux :  python3 server.py
  Windows       :  py server.py   或   python server.py
然后浏览器访问终端里显示的地址（通常是 http://localhost:8000）。
说明：用 http 方式打开后，系统可「安装」为 App（PWA），并支持离线使用。
"""
import http.server
import socketserver
import webbrowser
import os
import sys
import socket

PORTS = [8000, 8080, 8888, 9000]


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # 关闭缓存，避免改完代码还显示旧页面
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass  # 静默访问日志


def find_free_port():
    for p in PORTS:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
                s.bind(('', p))
            return p
        except OSError:
            continue
    return 8000


def main():
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    port = find_free_port()
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('', port), Handler) as httpd:
        url = f'http://localhost:{port}'
        print('\n  通用商户收银系统已启动')
        print(f'  ➜  请在浏览器打开：{url}')
        print('  （按 Ctrl+C 停止服务）\n')
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print('\n  已停止服务。')


if __name__ == '__main__':
    main()
