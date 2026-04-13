import os
import signal
import subprocess
import sys
import time


TRUTHY = {"1", "true", "yes", "on"}


def _is_enabled(env_name: str) -> bool:
    return (os.getenv(env_name) or "").strip().lower() in TRUTHY


def _run_blocking(command: list[str], *, env: dict[str, str] | None = None) -> None:
    print(f"INFO runtime: running {' '.join(command)}")
    subprocess.run(command, env=env, check=True)


def _terminate_process(proc: subprocess.Popen | None, label: str) -> None:
    if not proc or proc.poll() is not None:
        return
    print(f"INFO runtime: stopping {label} pid={proc.pid}")
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except subprocess.TimeoutExpired:
        proc.kill()


def main() -> int:
    base_env = os.environ.copy()
    port = (base_env.get("PORT") or "8000").strip() or "8000"
    python_bin = "venv/bin/python"
    alembic_bin = "venv/bin/alembic"
    run_worker_inline = _is_enabled("ENABLE_EMBEDDED_SCHEDULER")

    _run_blocking([alembic_bin, "upgrade", "head"], env=base_env)

    worker_proc: subprocess.Popen | None = None
    web_proc: subprocess.Popen | None = None

    def _shutdown(_signum=None, _frame=None):
        _terminate_process(web_proc, "web")
        _terminate_process(worker_proc, "worker")

    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    try:
        if run_worker_inline:
            worker_env = dict(base_env)
            worker_env["ENABLE_EMBEDDED_SCHEDULER"] = "false"
            print("INFO runtime: starting dedicated background worker for scheduler-enabled deployment")
            worker_proc = subprocess.Popen([python_bin, "-m", "app.worker"], env=worker_env)

        web_env = dict(base_env)
        if worker_proc is not None:
            web_env["ENABLE_EMBEDDED_SCHEDULER"] = "false"
        print(f"INFO runtime: starting web server on port {port}")
        web_proc = subprocess.Popen(
            [python_bin, "-m", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", port],
            env=web_env,
        )

        while True:
            if web_proc.poll() is not None:
                return int(web_proc.returncode or 0)
            if worker_proc is not None and worker_proc.poll() is not None:
                print(
                    "ERROR runtime: background worker exited unexpectedly "
                    f"code={worker_proc.returncode}"
                )
                _terminate_process(web_proc, "web")
                return int(worker_proc.returncode or 1) or 1
            time.sleep(1)
    finally:
        _shutdown()


if __name__ == "__main__":
    sys.exit(main())
