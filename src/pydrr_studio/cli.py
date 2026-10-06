from __future__ import annotations

import argparse


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the local PyDRR Studio service")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--reload", action="store_true")
    args = parser.parse_args(argv)

    try:
        import uvicorn
    except ImportError as exc:
        raise SystemExit(
            'PyDRR Studio dependencies are missing. Install them with: '
            'pip install "python-drr[studio] @ git+https://github.com/farrell236/python-drr.git"'
        ) from exc

    uvicorn.run("pydrr_studio.api:app", host=args.host, port=args.port, reload=args.reload)
    return 0
