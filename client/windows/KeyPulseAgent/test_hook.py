"""Windows-only smoke test for the low-level keyboard hook."""

from __future__ import annotations

import sys
import time

if sys.platform != "win32":
    raise SystemExit("请在 Windows 上运行：python test_hook.py")

from hook import KeyboardHook

captured: list[tuple[str, int]] = []


def on_key_down(key: str, timestamp_ms: int) -> None:
    captured.append((key, timestamp_ms))
    print(f"{key} @ {timestamp_ms}")


def main() -> None:
    hook = KeyboardHook(on_key_down)
    hook.start()
    print("钩子已启动，请在 10 秒内按几个键…")
    try:
        time.sleep(10)
    finally:
        hook.stop()
    print(f"共捕获 {len(captured)} 次按键")
    if not captured:
        print("未捕获任何按键，请检查安全软件拦截或重新以管理员身份运行。")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
