#!/usr/bin/env python3
"""
拼多多商品采集服务 - 一键启动版

默认（扩展手动模式，推荐）：
    1. 启动 Web 管理后台
    2. 只打开本地管理后台
    3. 用户手动打开商品页，在扩展中点击保存（无需代理/证书）

--proxy（MITM 代理模式，备选）：
    1. 设置系统代理
    2. 启动 mitmproxy 监听
    3. 打开本地管理后台
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
import json
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

# 兼容 GBK 控制台（直接运行 start.py 而非经 start.bat 时）
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

if '| packaged by' in sys.version:
    _ver = sys.version
    _start = _ver.index('|')
    _end = _ver.index('|', _start + 1) + 1
    sys.version = (_ver[:_start].strip() + ' ' + _ver[_end:].strip()).strip()
    sys.version_info = tuple(sys.version_info)

# 配置
BASE_DIR = Path(__file__).resolve().parent
FRONTEND_DIR = BASE_DIR.parent / "frontend"
DIST_DIR = BASE_DIR / "frontend" / "dist"
CERTS_DIR = BASE_DIR / "certs"
PROXY_PORT = 8080
ADMIN_URL = "http://127.0.0.1:5000"
from paths import DATA_DIR
_PROXY_BACKUP_PATH = DATA_DIR / "proxy_backup.json"
_proxy_backup = None


# ==================== 系统代理设置 ====================

def get_os():
    return platform.system()


def set_system_proxy(port: int):
    """设置系统代理"""
    global _proxy_backup
    os_type = get_os()
    
    if os_type == "Windows":
        import winreg
        try:
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                0, winreg.KEY_SET_VALUE | winreg.KEY_READ)
            saved = {}
            for name in ("ProxyEnable", "ProxyServer"):
                try:
                    value, kind = winreg.QueryValueEx(key, name)
                    saved[name] = [value, kind]
                except FileNotFoundError:
                    saved[name] = None
            # Keep an earlier recovery record if the previous process was killed.
            if _PROXY_BACKUP_PATH.exists():
                saved = json.loads(_PROXY_BACKUP_PATH.read_text("utf-8"))["values"]
            _PROXY_BACKUP_PATH.parent.mkdir(parents=True, exist_ok=True)
            backup_tmp = _PROXY_BACKUP_PATH.with_suffix(".tmp")
            backup_tmp.write_text(json.dumps({"values": saved, "ours": f"127.0.0.1:{port}"}), encoding="utf-8")
            backup_tmp.replace(_PROXY_BACKUP_PATH)
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
            _proxy_backup = []
            result = subprocess.run(["networksetup", "-listallnetworkservices"], 
                                  capture_output=True, text=True)
            services = result.stdout.strip().split("\n")[1:]
            for service in services:
                service = service.strip()
                if service and "*" not in service:
                    for kind in ("webproxy", "securewebproxy"):
                        previous = subprocess.run(["networksetup", "-get" + kind, service], capture_output=True, text=True, check=True)
                        cfg = dict(line.split(": ", 1) for line in previous.stdout.splitlines() if ": " in line)
                        if cfg.get("Authenticated Proxy Enabled") == "1":
                            print(f"  [WARN] {service} 使用认证代理，请在浏览器中手动设置本地代理")
                            continue
                        _proxy_backup.append((service, kind, cfg))
                        subprocess.run(["networksetup", "-set" + kind, service, "127.0.0.1", str(port)], check=True)
            print(f"  [OK] macOS 系统代理已设置: 127.0.0.1:{port}")
            return True
        except Exception as e:
            print(f"  [FAIL] 设置代理失败: {e}")
            return False
    
    elif os_type == "Linux":
        _proxy_backup = {k: os.environ.get(k) for k in ("http_proxy", "https_proxy")}
        os.environ["http_proxy"] = f"http://127.0.0.1:{port}"
        os.environ["https_proxy"] = f"http://127.0.0.1:{port}"
        print(f"  [OK] Linux 代理环境变量已设置: 127.0.0.1:{port}")
        return True
    
    return False


def restore_system_proxy():
    """恢复系统代理"""
    global _proxy_backup
    os_type = get_os()
    
    if os_type == "Windows":
        if not _PROXY_BACKUP_PATH.exists():
            return
        try:
            import winreg
            saved = json.loads(_PROXY_BACKUP_PATH.read_text("utf-8"))
            key = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Internet Settings",
                0, winreg.KEY_SET_VALUE | winreg.KEY_READ)
            current, _ = winreg.QueryValueEx(key, "ProxyServer")
            if current == saved["ours"]:
                for name, previous in saved["values"].items():
                    if previous is None:
                        try:
                            winreg.DeleteValue(key, name)
                        except FileNotFoundError:
                            pass
                    else:
                        winreg.SetValueEx(key, name, 0, previous[1], previous[0])
            winreg.CloseKey(key)
            _PROXY_BACKUP_PATH.unlink()
            print("  [OK] Windows 系统代理已恢复")
        except Exception:
            pass
    
    elif os_type == "Darwin":
        try:
            for service, kind, cfg in (_proxy_backup or []):
                if cfg.get("Server") and cfg.get("Port"):
                    subprocess.run(["networksetup", "-set" + kind, service, cfg["Server"], cfg["Port"]], check=True)
                subprocess.run(["networksetup", "-set" + kind + "state", service, "on" if cfg.get("Enabled") == "Yes" else "off"], check=True)
            _proxy_backup = None
            print("  [OK] macOS 系统代理已恢复")
        except Exception:
            pass
    
    elif os_type == "Linux":
        for name, value in (_proxy_backup or {}).items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value
        _proxy_backup = None
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

EXTENSION_DIR = Path(__file__).resolve().parent.parent / "extension"


def _check_frontend_dist():
    if not DIST_DIR.is_dir() or not (DIST_DIR / "index.html").is_file():
        print("\n[0/4] 构建前端...")
        if FRONTEND_DIR.is_dir() and shutil.which("npm"):
            npm = shutil.which("npm.cmd") or shutil.which("npm")
            subprocess.run([npm, "run", "build"], cwd=str(FRONTEND_DIR), check=True)
            print("  [OK] 前端构建完成")
        else:
            print("  [WARN] 前端未构建，管理后台可能无法访问")


def _start_web_thread(web_port: int):
    from monitor_scheduler import start_scheduler
    from web.app import app
    from werkzeug.serving import make_server
    # Bind synchronously: a port conflict must fail before opening the browser.
    server = make_server("127.0.0.1", web_port, app, threaded=True)
    start_scheduler()
    atexit.register(server.shutdown)
    web_thread = threading.Thread(target=server.serve_forever, daemon=True)
    web_thread.start()
    return web_thread


async def run_server():
    """手动模式：启动并打开本地后台，商品页由用户自行打开。"""
    from storage import init_db
    init_db()

    print("\n" + "=" * 55)
    print("    拼多多商品采集服务（浏览器扩展手动模式）")
    print("=" * 55)

    _check_frontend_dist()

    web_port = 5000
    print(f"\n[1/3] 启动 Web 管理后台...")
    _start_web_thread(web_port)
    await asyncio.sleep(0.5)
    print(f"  [OK] 管理后台: http://127.0.0.1:{web_port}")

    print(f"\n[2/3] 打开本地管理后台...")
    open_browser(ADMIN_URL)

    print(f"\n[3/3] 就绪!")
    print(f"  管理后台: http://127.0.0.1:{web_port}")
    print(f"  数据目录: {DATA_DIR}")
    print(f"\n  {'='*45}")
    print(f"  首次使用请安装浏览器扩展（只需一次）：")
    print(f"  1. Chrome/Edge 打开 chrome://extensions")
    print(f"  2. 开启右上角「开发者模式」")
    print(f"  3. 点「加载已解压的扩展程序」，选择目录：")
    print(f"     {EXTENSION_DIR}")
    print(f"  4. 手动打开商品页，点击「读取并预览当前商品」，核对后「确认保存」")
    print(f"  列表自动记录默认关闭；未点击保存不会采集商品详情。")
    print(f"  {'='*45}")
    print(f"\n  按 Ctrl+C 停止服务\n")

    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass
    finally:
        print("服务已停止")


async def run_proxy(port: int):
    from mitmproxy.options import Options
    from mitmproxy.tools.dump import DumpMaster
    from service import init_db, PddInterceptor
    init_db()

    print("\n" + "=" * 55)
    print("    拼多多商品自动采集服务（代理模式）")
    print("=" * 55)

    _check_frontend_dist()

    # 注册退出时恢复代理
    atexit.register(restore_system_proxy)

    # Step 1: 启动 Web 管理后台
    web_port = 5000
    print(f"\n[1/5] 启动 Web 管理后台...")
    _start_web_thread(web_port)
    await asyncio.sleep(0.5)
    print(f"  [OK] 管理后台: http://127.0.0.1:{web_port}")
    
    # Step 2: 启动 mitmproxy
    print(f"\n[2/5] 启动代理监听...")
    print(f"  代理地址: 127.0.0.1:{port}")
    
    # 使用项目内证书目录作为 mitmproxy confdir；
    # 首次启动时 mitmproxy 会自动生成唯一的 CA 证书（私钥不随仓库分发）
    CERTS_DIR.mkdir(parents=True, exist_ok=True)
    opts_kwargs = dict(listen_port=port, listen_host="127.0.0.1", confdir=str(CERTS_DIR))
    
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
    print(f"\n[4/5] 打开本地管理后台...")
    open_browser(ADMIN_URL)
    
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
    if "--restore-proxy" in sys.argv:
        restore_system_proxy()
        return
    use_proxy = "--proxy" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    port = int(args[0]) if args else 8080

    if use_proxy:
        asyncio.run(run_proxy(port))
    else:
        asyncio.run(run_server())


if __name__ == "__main__":
    main()
