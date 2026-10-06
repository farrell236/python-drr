from __future__ import annotations

import argparse
import socket
import threading
import time
import webbrowser


def _browser_host(host: str) -> str:
    return "127.0.0.1" if host in {"0.0.0.0", "::"} else host


def _open_when_ready(host: str, port: int) -> None:
    browser_host = _browser_host(host)
    url_host = f"[{browser_host}]" if ":" in browser_host else browser_host
    url = f"http://{url_host}:{port}/"
    deadline = time.monotonic() + 15.0
    while time.monotonic() < deadline:
        try:
            with socket.create_connection((browser_host, port), timeout=0.25):
                webbrowser.open(url)
                return
        except OSError:
            time.sleep(0.1)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local PyDRR Studio service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reload", action="store_true")
    parser.add_argument("--no-browser", action="store_true", help="Do not open Studio in a browser")
    args = parser.parse_args(argv)

    try:
        import fastapi  # noqa: F401
        import python_multipart  # noqa: F401
        import uvicorn
    except ImportError as exc:
        raise SystemExit(
            'PyDRR Studio dependencies are missing. Install them with: '
            'python -m pip install "python-drr[studio]"'
        ) from exc

    if not args.no_browser:
        threading.Thread(
            target=_open_when_ready,
            args=(args.host, args.port),
            daemon=True,
            name="pydrr-studio-browser",
        ).start()
    uvicorn.run("pydrr_studio.api:app", host=args.host, port=args.port, reload=args.reload)
    return 0
