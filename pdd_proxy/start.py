#!/usr/bin/env python3
"""
拼多多商品采集服务 - 一键启动版

双击运行，自动完成：
    1. 设置系统代理
    2. 启动 mitmproxy 监听
    3. 自动打开浏览器访问拼多多
    4. 用户登录后浏览商品，自动采集
    5. 退出时自动恢复代理设置
"""

import asyncio
import os
import platform
import subprocess
import sys
import signal
import atexit
import shutil
import socket
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

if '| packaged by' in sys.version:
    _ver = sys.version
    _start = _ver.index('|')
    _end = _ver.index('|', _start + 1) + 1
    sys.version = (_ver[:_start].strip() + ' ' + _ver[_end:].strip()).strip()
    sys.version_info = tuple(sys.version_info)

from mitmproxy.options import Options
from mitmproxy.tools.dump import DumpMaster


# 配置
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR / "frontend"
DIST_DIR = FRONTEND_DIR / "dist"
CERTS_DIR = BASE_DIR / "certs"
PROXY_PORT = 8080
PDD_URL = "https://mobile.yangkeduo.com"


# ==================== 系统代理设置 ====================

def get_os():
    return platform.system()


def set_system_proxy(port: int):
    """设置系统代理"""
    os_type = get_os()
    
    if os_type == "Windows":
        import winreg
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                0, winreg.KEY_SET_VALUE)
            winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 1)
            winreg.SetValueEx(key, "ProxyServer", 0, winreg.REG_SZ, f"127.0.0.1:{port}")
            winreg.CloseKey(key)
            print(f"  [OK] Windows 系统代理已设置: 127.0.0.1:{port}")
            return True
        except Exception as e:
            print(f"  [FAIL] 设置代理失败: {e}")
            return False
    
    elif os_type == "Darwin":
        try:
            result = subprocess.run(["networksetup", "-listallnetworkservices"], 
                                  capture_output=True, text=True)
            services = result.stdout.strip().split("\n")[1:]
            for service in services:
                service = service.strip()
                if service and "*" not in service:
                    subprocess.run(["networksetup", "-setwebproxy", service, "127.0.0.1", str(port)])
                    subprocess.run(["networksetup", "-setsecurewebproxy", service, "127.0.0.1", str(port)])
            print(f"  [OK] macOS 系统代理已设置: 127.0.0.1:{port}")
            return True
        except Exception as e:
            print(f"  [FAIL] 设置代理失败: {e}")
            return False
    
    elif os_type == "Linux":
        os.environ["http_proxy"] = f"http://127.0.0.1:{port}"
        os.environ["https_proxy"] = f"http://127.0.0.1:{port}"
        print(f"  [OK] Linux 代理环境变量已设置: 127.0.0.1:{port}")
        return True
    
    return False


def restore_system_proxy():
    """恢复系统代理"""
    os_type = get_os()
    
    if os_type == "Windows":
        try:
            import winreg
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                0, winreg.KEY_SET_VALUE)
            winreg.SetValueEx(key, "ProxyEnable", 0, winreg.REG_DWORD, 0)
            winreg.CloseKey(key)
            print("  [OK] Windows 系统代理已恢复")
        except Exception:
            pass
    
    elif os_type == "Darwin":
        try:
            result = subprocess.run(["networksetup", "-listallnetworkservices"], 
                                  capture_output=True, text=True)
            services = result.stdout.strip().split("\n")[1:]
            for service in services:
                service = service.strip()
                if service and "*" not in service:
                    subprocess.run(["networksetup", "-setwebproxystate", service, "off"])
                    subprocess.run(["networksetup", "-setsecurewebproxystate", service, "off"])
            print("  [OK] macOS 系统代理已恢复")
        except Exception:
            pass
    
    elif os_type == "Linux":
        os.environ.pop("http_proxy", None)
        os.environ.pop("https_proxy", None)
        print("  [OK] Linux 代理环境变量已清除")


def open_browser(url: str):
    """自动打开浏览器"""
    os_type = get_os()
    try:
        if os_type == "Windows":
            os.startfile(url)
        elif os_type == "Darwin":
            subprocess.run(["open", url])
        else:
            subprocess.run(["xdg-open", url])
        print(f"  [OK] 浏览器已打开: {url}")
    except Exception as e:
        print(f"  [WARN] 无法自动打开浏览器，请手动访问: {url}")


# ==================== 主流程 ====================

async def run_proxy(port: int):
    from service import init_db, PddInterceptor
    init_db()
    
    print("\n" + "=" * 55)
    print("    拼多多商品自动采集服务")
    print("=" * 55)
    
    # 检查前端构建产物
    if not DIST_DIR.is_dir() or not (DIST_DIR / "index.html").is_file():
        print("\n[0/4] 构建前端...")
        if FRONTEND_DIR.is_dir() and shutil.which("npm"):
            subprocess.run(["npm", "run", "build"], cwd=str(FRONTEND_DIR), check=True, shell=True)
            print("  [OK] 前端构建完成")
        else:
            print("  [WARN] 前端未构建，管理后台可能无法访问")
    
    # 注册退出时恢复代理
    atexit.register(restore_system_proxy)
    
    # Step 1: 启动 Web 管理后台
    web_port = 5000
    print(f"\n[1/5] 启动 Web 管理后台...")
    def run_web():
        from web.app import app
        app.run(host="127.0.0.1", port=web_port, debug=False, use_reloader=False)
    web_thread = threading.Thread(target=run_web, daemon=True)
    web_thread.start()
    await asyncio.sleep(0.5)
    print(f"  [OK] 管理后台: http://127.0.0.1:{web_port}")
    
    # Step 2: 启动 mitmproxy
    print(f"\n[2/5] 启动代理监听...")
    print(f"  代理地址: 127.0.0.1:{port}")
    
    # 便携模式：如果存在 bundled certs 目录，使用它作为 confdir
    opts_kwargs = dict(listen_port=port, listen_host="127.0.0.1")
    if CERTS_DIR.is_dir():
        opts_kwargs["confdir"] = str(CERTS_DIR)
        print(f"  [OK] 使用内置证书目录: {CERTS_DIR}")
    
    opts = Options(**opts_kwargs)
    master = DumpMaster(opts)
    master.addons.add(PddInterceptor())
    loop = asyncio.get_event_loop()
    master_task = loop.create_task(master.run())
    
    # 等待端口就绪
    print(f"  等待端口 {port} 就绪...")
    deadline = time.time() + 15.0
    port_ready = False
    while time.time() < deadline:
        try:
            with socket.create_connection(("127.0.0.1", port), timeout=1):
                port_ready = True
                break
        except OSError:
            await asyncio.sleep(0.3)
    
    if not port_ready:
        print(f"  [FAIL] 代理端口 {port} 启动超时，未设置系统代理")
        master.shutdown()
        return
    print(f"  [OK] 代理已监听 127.0.0.1:{port}")
    
    # Step 3: 配置系统代理
    print(f"\n[3/5] 配置系统代理...")
    set_system_proxy(port)
    
    # Step 4: 打开浏览器
    print(f"\n[4/5] 打开浏览器...")
    open_browser(PDD_URL)
    
    # Step 5: 就绪
    print(f"\n[5/5] 全部就绪!")
    print(f"  管理后台: http://127.0.0.1:{web_port}")
    print(f"  数据目录: {Path(__file__).resolve().parent / 'data'}")
    print(f"\n  {'='*45}")
    print(f"  请在浏览器中登录拼多多，然后浏览商品。")
    print(f"  数据会自动采集到 data/goods.db")
    print(f"  打开管理后台查看采集结果并导出数据")
    print(f"  {'='*45}")
    print(f"\n  按 Ctrl+C 停止服务并恢复代理\n")
    
    try:
        await master_task
    except KeyboardInterrupt:
        pass
    finally:
        print("\n正在恢复系统代理...")
        restore_system_proxy()
        master.shutdown()
        print("服务已停止")


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    
    # 检查是否以管理员权限运行（Windows）
    if get_os() == "Windows":
        try:
            import ctypes
            if not ctypes.windll.shell32.IsUserAnAdmin():
                print("  [WARN] 建议以管理员身份运行，以便自动设置系统代理")
                print("  右键点击 -> 以管理员身份运行\n")
        except Exception:
            pass
    
    asyncio.run(run_proxy(port))


if __name__ == "__main__":
    main()