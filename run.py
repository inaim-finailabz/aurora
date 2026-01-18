import subprocess
import sys

import uvicorn


def ensure_deps() -> None:
    try:
        import yaml  # noqa: F401
        return
    except ImportError:
        pass

    print("[aurora] Installing PyYAML (missing dependency)...", flush=True)
    try:
        subprocess.run([sys.executable, "-m", "ensurepip", "--upgrade"], check=False)
    except Exception:
        pass

    try:
        subprocess.check_call([sys.executable, "-m", "pip", "install", "PyYAML==6.0.2"])
        import yaml  # noqa: F401  # revalidate after install
        return
    except subprocess.CalledProcessError as exc:
        print(f"[aurora] Failed to install PyYAML automatically (exit {exc.returncode}).", flush=True)
        print("[aurora] Please install manually: pip install PyYAML==6.0.2", flush=True)
        raise


def main() -> None:
    ensure_deps()
    from app.config import load_config
    config = load_config()
    uvicorn.run("app.main:app", host=config.host, port=config.port, reload=False)


if __name__ == "__main__":
    main()
