#!/usr/bin/env python3
"""Serve this Ray Optics Lab directory locally and open its browser UI.

Python 3.9+, standard library only. Does not install or change app files.
"""
import argparse
import errno
import functools
from http.client import HTTPConnection, HTTPException
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import re
import sys
import threading
import webbrowser

ROOT = Path(__file__).resolve().parent / "app"
HOST = "127.0.0.1"
DEFAULT_PORT = 8765
PORT_ATTEMPTS = 20


class AppHandler(SimpleHTTPRequestHandler):
    extensions_map = {**SimpleHTTPRequestHandler.extensions_map,
                      ".js": "text/javascript", ".wgsl": "text/plain"}

    def end_headers(self):
        # A new launch should show the files currently on disk.
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def log_message(self, format, *args):
        # Keep the launcher terminal readable; show failed HTTP requests only.
        if len(args) > 1 and str(args[1]).isdigit() and int(args[1]) >= 400:
            super().log_message(format, *args)


class AppServer(ThreadingHTTPServer):
    daemon_threads = True
    # On Windows, SO_REUSEADDR can let two processes bind the same port.
    allow_reuse_address = os.name != "nt"


def probe_server(port, root):
    """Return same/other/absent, including a WSL-forwarded local server."""
    expected = (root / "index.html").read_bytes()
    connection = HTTPConnection(HOST, port, timeout=0.5)
    try:
        connection.connect()
    except OSError:
        # On Windows a refused local connection may time out before ECONNREFUSED.
        # Binding below still checks whether the operating system owns the port.
        connection.close()
        return "absent"
    try:
        # HTTPConnection uses neither environment proxies nor redirects.
        connection.request("GET", "/index.html", headers={"Cache-Control": "no-cache"})
        response = connection.getresponse()
        return "same" if response.status == 200 and response.read(len(expected) + 1) == expected else "other"
    except (OSError, HTTPException, ValueError):
        return "other"
    finally:
        connection.close()


def choose_server(root, first_port):
    handler = functools.partial(AppHandler, directory=str(root))
    for port in range(first_port, min(first_port + PORT_ATTEMPTS, 65536)):
        existing = probe_server(port, root)
        if existing == "same":
            return None, port
        if existing == "other":
            continue
        try:
            server = AppServer((HOST, port), handler)
            return server, port
        except OSError as exc:
            occupied = exc.errno in (errno.EADDRINUSE, errno.EACCES) or getattr(exc, "winerror", None) in (10048, 10013)
            if not occupied:
                raise
            # Another launcher may have started between the probe and bind.
            if probe_server(port, root) == "same":
                return None, port
    raise OSError("Ports %d–%d are unavailable. Try --port 8800." %
                  (first_port, min(first_port + PORT_ATTEMPTS - 1, 65535)))


def app_url(root, port):
    # Match the build currently present, without pinning a launcher release.
    source = (root / "app.js").read_text(encoding="utf-8-sig")
    match = re.search(r"const\s+APP_BUILD\s*=\s*['\"]([A-Za-z0-9_-]+)['\"]", source)
    return "http://localhost:%d/" % port + ("?v=" + match.group(1) if match else "")


def open_browser(url, disabled):
    if disabled:
        return
    try:
        if webbrowser.open(url, new=2):
            return
    except (webbrowser.Error, OSError):
        pass
    print("ブラウザを自動で開けませんでした。上のURLをブラウザで開いてください。", flush=True)


def main(argv=None):
    parser = argparse.ArgumentParser(description="Ray Optics Lab の起動（Python 3.9以降）")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT,
                        help="最初に試すポート（既定: 8765）")
    parser.add_argument("--no-browser", action="store_true",
                        help="サーバーだけ起動し、ブラウザは自動で開かない")
    args = parser.parse_args(argv)
    if not 1024 <= args.port <= 65535:
        parser.error("--port は1024〜65535を指定してください")
    if not all((ROOT / file).is_file() for file in ("index.html", "app.js", "worker.js")):
        print("app フォルダが見つかりません。配布ZIPをフォルダごと展開してから起動してください。", file=sys.stderr)
        return 1
    try:
        server, port = choose_server(ROOT, args.port)
        url = app_url(ROOT, port)
    except OSError as exc:
        print("起動できませんでした: %s" % exc, file=sys.stderr)
        return 1
    print("Ray Optics Lab\n" + url, flush=True)
    if server is None:
        print("同じアプリが起動済みです。その画面を開きます。", flush=True)
        open_browser(url, args.no_browser)
        return 0
    if port != args.port:
        print("指定ポートは使用中のため、ポート%dを使います。" % port, flush=True)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print("起動中はこのウィンドウを開いたままにしてください。終了: Ctrl+C", flush=True)
    try:
        open_browser(url, args.no_browser)
        while thread.is_alive():
            thread.join(0.5)
    except KeyboardInterrupt:
        print("\nサーバーを終了します。", flush=True)
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
