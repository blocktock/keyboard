from __future__ import annotations

import ctypes
import sys
import threading
import time
from ctypes import wintypes
from typing import Callable

from keymap import resolve_key

user32 = ctypes.WinDLL("user32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

WH_KEYBOARD_LL = 13
WM_KEYDOWN = 0x0100
WM_SYSKEYDOWN = 0x0104
WM_QUIT = 0x0012
LLKHF_INJECTED = 0x10

LowLevelKeyboardProc = ctypes.WINFUNCTYPE(
    ctypes.c_longlong,
    ctypes.c_int,
    wintypes.WPARAM,
    wintypes.LPARAM,
)


class KBDLLHOOKSTRUCT(ctypes.Structure):
    _fields_ = [
        ("vkCode", wintypes.DWORD),
        ("scanCode", wintypes.DWORD),
        ("flags", wintypes.DWORD),
        ("time", wintypes.DWORD),
        ("dwExtraInfo", ctypes.c_size_t),
    ]


user32.SetWindowsHookExW.argtypes = [
    ctypes.c_int,
    LowLevelKeyboardProc,
    wintypes.HINSTANCE,
    wintypes.DWORD,
]
user32.SetWindowsHookExW.restype = wintypes.HHOOK

user32.CallNextHookEx.argtypes = [
    wintypes.HHOOK,
    ctypes.c_int,
    wintypes.WPARAM,
    wintypes.LPARAM,
]
user32.CallNextHookEx.restype = ctypes.c_longlong

user32.UnhookWindowsHookEx.argtypes = [wintypes.HHOOK]
user32.UnhookWindowsHookEx.restype = wintypes.BOOL

user32.GetMessageW.argtypes = [
    ctypes.POINTER(wintypes.MSG),
    wintypes.HWND,
    wintypes.UINT,
    wintypes.UINT,
]
user32.GetMessageW.restype = wintypes.BOOL

user32.TranslateMessage.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.TranslateMessage.restype = wintypes.BOOL

user32.DispatchMessageW.argtypes = [ctypes.POINTER(wintypes.MSG)]
user32.DispatchMessageW.restype = ctypes.c_longlong

user32.PostThreadMessageW.argtypes = [wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM]
user32.PostThreadMessageW.restype = wintypes.BOOL

kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = wintypes.HMODULE

kernel32.GetCurrentThreadId.restype = wintypes.DWORD


def _module_handle() -> wintypes.HINSTANCE:
    # WH_KEYBOARD_LL 需要传入包含钩子过程的模块句柄，不能传 NULL。
    return kernel32.GetModuleHandleW(None)


def _format_win_error(code: int) -> str:
    if not code:
        return "未知错误"
    buffer = ctypes.create_unicode_buffer(512)
    kernel32.FormatMessageW(
        0x00001000,
        None,
        code,
        0,
        buffer,
        len(buffer),
        None,
    )
    return buffer.value.strip() or f"error {code}"


class KeyboardHook:
    def __init__(self, on_key_down: Callable[[str, int], None]) -> None:
        self._on_key_down = on_key_down
        self._hook_id: wintypes.HHOOK | None = None
        self._proc = LowLevelKeyboardProc(self._callback)
        self._thread: threading.Thread | None = None
        self._thread_id: int | None = None
        self._ready = threading.Event()
        self._failed = threading.Event()
        self._failure_message = ""

    @property
    def failure_message(self) -> str:
        return self._failure_message

    def _callback(self, n_code: int, w_param: wintypes.WPARAM, l_param: wintypes.LPARAM) -> ctypes.c_longlong:
        if n_code >= 0 and w_param in (WM_KEYDOWN, WM_SYSKEYDOWN):
            event = ctypes.cast(l_param, ctypes.POINTER(KBDLLHOOKSTRUCT)).contents
            if not (event.flags & LLKHF_INJECTED):
                key = resolve_key(event.vkCode, event.flags)
                if key:
                    timestamp_ms = int(time.time() * 1000)
                    try:
                        self._on_key_down(key, timestamp_ms)
                    except Exception:
                        # 钩子回调里不能抛异常，否则 Windows 可能禁用钩子。
                        pass
        hook_id = self._hook_id or wintypes.HHOOK(0)
        return user32.CallNextHookEx(hook_id, n_code, w_param, l_param)

    def _thread_main(self) -> None:
        self._thread_id = kernel32.GetCurrentThreadId()
        self._hook_id = user32.SetWindowsHookExW(
            WH_KEYBOARD_LL,
            self._proc,
            _module_handle(),
            0,
        )
        if not self._hook_id:
            error_code = ctypes.get_last_error()
            self._failure_message = (
                "键盘钩子安装失败，请确认 KeyPulse 未被安全软件拦截。"
                f"（{_format_win_error(error_code)}）"
            )
            self._failed.set()
            return

        self._ready.set()
        msg = wintypes.MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

        if self._hook_id:
            user32.UnhookWindowsHookEx(self._hook_id)
            self._hook_id = None

    def start(self, timeout: float = 3.0) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._ready.clear()
        self._failed.clear()
        self._failure_message = ""
        self._thread = threading.Thread(target=self._thread_main, name="KeyPulseHook", daemon=True)
        self._thread.start()
        if self._failed.wait(timeout):
            raise RuntimeError(self._failure_message or "键盘钩子启动失败。")
        if not self._ready.wait(timeout):
            raise RuntimeError("键盘钩子启动超时。")

    def stop(self) -> None:
        thread_id = self._thread_id
        thread = self._thread
        if thread_id:
            user32.PostThreadMessageW(thread_id, WM_QUIT, 0, 0)
        if thread:
            thread.join(timeout=2.0)
        self._thread = None
        self._thread_id = None
        self._hook_id = None
