from __future__ import annotations

import os
import sys
import threading
import tkinter as tk
import webbrowser
from pathlib import Path
from tkinter import filedialog, messagebox

import pystray
from PIL import Image, ImageDraw, ImageFont

from hook import KeyboardHook
from recorder import EmptySessionError, KeyPulseRecorder
from storage import (
    AgentConfiguration,
    StorageError,
    ensure_directory,
    ensure_support_directory,
    is_valid_directory,
    load_config,
    save_config,
)
from upload import upload_report

APP_NAME = "KeyPulse"
LAUNCH_HINT_KEY = "launch_hint_shown_v1"


class KeyPulseApp:
    def __init__(self) -> None:
        ensure_support_directory()
        self._recorder = KeyPulseRecorder()
        self._hook = KeyboardHook(self._recorder.record)
        self._is_recording = False
        self._status_text = "尚未开始记录"
        self._storage_summary = "存储：未设置"
        self._icon: pystray.Icon | None = None
        self._tk_root = tk.Tk()
        self._tk_root.withdraw()
        self._reload_storage_summary()
        self._show_launch_hint_if_needed()
        self._prompt_storage_folder_if_needed()

    def _call_on_ui(self, callback):
        if threading.current_thread() is threading.main_thread():
            return callback()
        done = threading.Event()
        result = {"value": None, "error": None}

        def runner() -> None:
            try:
                result["value"] = callback()
            except Exception as error:  # noqa: BLE001
                result["error"] = error
            finally:
                done.set()

        self._tk_root.after(0, runner)
        done.wait()
        if result["error"]:
            raise result["error"]
        return result["value"]

    @property
    def configured_report_directory(self) -> Path | None:
        path = load_config().reportDirectory
        if not path or not is_valid_directory(path):
            return None
        return Path(path)

    @property
    def has_configured_storage(self) -> bool:
        return self.configured_report_directory is not None

    def _reload_storage_summary(self) -> None:
        directory = self.configured_report_directory
        if directory:
            self._storage_summary = f"存储：{directory}"
            if not self._is_recording:
                self._status_text = "存储目录已就绪"
        else:
            self._storage_summary = "存储：未设置"
            if not self._is_recording:
                self._status_text = "请先设置存储文件夹"

    def _show_launch_hint_if_needed(self) -> None:
        hint_file = Path(os.environ.get("APPDATA", "")) / "KeyPulse" / LAUNCH_HINT_KEY
        if hint_file.exists():
            return
        hint_file.parent.mkdir(parents=True, exist_ok=True)
        hint_file.write_text("1", encoding="utf-8")
        self._tk_root.after(
            500,
            lambda: messagebox.showinfo(
                "KeyPulse 已启动",
                "首次使用前请先设置报告存储文件夹，然后才能在托盘菜单中开始记录。\n\n"
                "报告仅保存在本地，需在网页中手动上传分析。",
                parent=self._tk_root,
            ),
        )

    def _prompt_storage_folder_if_needed(self) -> None:
        if self.has_configured_storage:
            return
        self._tk_root.after(
            800,
            lambda: self.configure_report_directory(
                "首次使用 KeyPulse 前，请选择报告 JSON 的存储文件夹。"
            ),
        )

    def configure_report_directory(self, prompt: str | None = None) -> bool:
        def action() -> bool:
            initial = str(self.configured_report_directory or Path.home() / "Documents")
            selected = filedialog.askdirectory(
                title=prompt or "选择 KeyPulse 报告存储文件夹",
                initialdir=initial,
                parent=self._tk_root,
            )
            if not selected:
                return False
            try:
                ensure_directory(Path(selected))
                save_config(AgentConfiguration(reportDirectory=selected))
                self._reload_storage_summary()
                self._refresh_menu()
                return True
            except StorageError as error:
                messagebox.showerror("无法使用该文件夹", str(error), parent=self._tk_root)
                return False

        return self._call_on_ui(action)

    def _ensure_report_directory_configured(self) -> bool:
        def action() -> bool:
            if self.has_configured_storage:
                return True
            if not messagebox.askokcancel(
                "请先设置存储文件夹",
                "开始记录前必须指定报告保存位置。请选择本机上的一个文件夹。",
                parent=self._tk_root,
            ):
                return False
            return self.configure_report_directory("请选择报告 JSON 的存储文件夹。")

        return self._call_on_ui(action)

    def check_permissions(self) -> None:
        self._call_on_ui(
            lambda: messagebox.showinfo(
                "KeyPulse 权限说明",
                "Windows 版 KeyPulse 使用系统键盘钩子采集按键。\n\n"
                "通常无需额外授权；若无法开始记录，请确认：\n"
                "1. 未被安全软件拦截\n"
                "2. 以当前用户正常登录运行\n"
                "3. 完全退出后重新启动 KeyPulse",
                parent=self._tk_root,
            )
        )

    def open_reports_folder(self) -> None:
        if not self._ensure_report_directory_configured():
            return
        directory = self.configured_report_directory
        if directory:
            os.startfile(directory)

    def toggle_recording(self, _icon: pystray.Icon | None = None, _item=None) -> None:
        if self._is_recording:
            self.stop_and_generate_report()
        else:
            self.start_recording()

    def start_recording(self) -> None:
        if self._is_recording:
            return
        if not self._ensure_report_directory_configured():
            return
        directory = self.configured_report_directory
        if not directory:
            return

        try:
            ensure_directory(directory)
            self._recorder.reset_session()
            self._hook.start()
        except RuntimeError as error:
            self._call_on_ui(
                lambda: messagebox.showerror("无法启动记录", str(error), parent=self._tk_root)
            )
            return
        except Exception as error:  # noqa: BLE001
            self._call_on_ui(
                lambda: messagebox.showerror(
                    "无法启动记录",
                    f"事件监听创建失败。\n\n{error}",
                    parent=self._tk_root,
                )
            )
            return

        self._is_recording = True
        self._status_text = "正在记录按键"
        self._refresh_menu()

    def stop_and_generate_report(self) -> None:
        if not self._is_recording:
            return
        self._hook.stop()
        self._is_recording = False
        self._reload_storage_summary()

        directory = self.configured_report_directory
        if not directory:
            self._call_on_ui(
                lambda: messagebox.showerror(
                    "存储文件夹未设置",
                    "请先设置报告存储文件夹后再生成报告。",
                    parent=self._tk_root,
                )
            )
            self._refresh_menu()
            return

        try:
            report_file = self._recorder.write_report(directory)
        except EmptySessionError as error:
            self._call_on_ui(
                lambda: messagebox.showerror("生成报告失败", str(error), parent=self._tk_root)
            )
            self._refresh_menu()
            return
        except OSError as error:
            self._call_on_ui(
                lambda: messagebox.showerror("生成报告失败", str(error), parent=self._tk_root)
            )
            self._refresh_menu()
            return

        self._status_text = "正在上传报告…"
        self._refresh_menu()
        threading.Thread(
            target=self._upload_and_cleanup,
            args=(report_file,),
            name="KeyPulseUpload",
            daemon=True,
        ).start()

    def _upload_and_cleanup(self, report_file: Path) -> None:
        try:
            result = upload_report(report_file)
            report_file.unlink(missing_ok=True)
            import_token = result.get("importToken")
            page = (
                f"http://127.0.0.1:3011/analyze?importToken={import_token}"
                if import_token
                else "http://127.0.0.1:3011/analyze"
            )
            webbrowser.open(page)

            def notify_success() -> None:
                messagebox.showinfo(
                    "报告已上传",
                    "本地 JSON 已删除。\n\n浏览器将打开分析页面，可在网页导出热力图 PNG。",
                    parent=self._tk_root,
                )

            self._call_on_ui(notify_success)
        except Exception as error:  # noqa: BLE001
            def notify_failure() -> None:
                messagebox.showerror(
                    "上传失败",
                    f"{error}\n\n本地报告仍保留在：\n{report_file}\n\n"
                    "请确认已运行 npm run start，或在网页手动上传。",
                    parent=self._tk_root,
                )

            self._call_on_ui(notify_failure)
        finally:
            self._reload_storage_summary()
            self._refresh_menu()

    def quit_app(self, _icon: pystray.Icon | None = None, _item=None) -> None:
        if self._is_recording:
            self._hook.stop()
            self._is_recording = False
        if self._icon:
            self._icon.stop()
        self._tk_root.after(0, self._tk_root.destroy)

    def _make_icon_image(self, recording: bool) -> Image.Image:
        size = 64
        image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        draw = ImageDraw.Draw(image)
        fill = (116, 87, 234, 255) if recording else (64, 64, 82, 255)
        draw.rounded_rectangle((4, 4, 60, 60), radius=14, fill=fill)
        text = "KP●" if recording else "KP"
        try:
            font = ImageFont.truetype("arial.ttf", 18)
        except OSError:
            font = ImageFont.load_default()
        bbox = draw.textbbox((0, 0), text, font=font)
        x = (size - (bbox[2] - bbox[0])) / 2
        y = (size - (bbox[3] - bbox[1])) / 2 - 2
        draw.text((x, y), text, fill="white", font=font)
        return image

    def _build_menu(self) -> pystray.Menu:
        return pystray.Menu(
            pystray.MenuItem(lambda _item: self._status_text, None, enabled=False),
            pystray.MenuItem(lambda _item: self._storage_summary, None, enabled=False),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem(
                lambda _item: "停止并生成报告" if self._is_recording else "开始记录",
                self.toggle_recording,
                enabled=lambda _item: self._is_recording or self.has_configured_storage,
            ),
            pystray.MenuItem("设置存储文件夹…", lambda *_: self.configure_report_directory()),
            pystray.MenuItem("检查权限状态…", lambda *_: self.check_permissions()),
            pystray.MenuItem(
                "打开报告文件夹",
                lambda *_: self.open_reports_folder(),
                enabled=lambda _item: self.has_configured_storage,
            ),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("退出 KeyPulse", self.quit_app),
        )

    def _refresh_menu(self) -> None:
        if not self._icon:
            return
        self._icon.icon = self._make_icon_image(self._is_recording)
        self._icon.title = "KeyPulse ●" if self._is_recording else "KeyPulse"
        self._icon.menu = self._build_menu()
        self._icon.update_menu()

    def run(self) -> None:
        self._icon = pystray.Icon(
            APP_NAME,
            self._make_icon_image(False),
            "KeyPulse",
            menu=self._build_menu(),
        )
        threading.Thread(target=self._icon.run, name="KeyPulseTray", daemon=False).start()
        self._tk_root.mainloop()


def main() -> None:
    if sys.platform != "win32":
        raise SystemExit("KeyPulse Windows 客户端仅支持 Windows。")
    app = KeyPulseApp()
    app.run()


if __name__ == "__main__":
    main()
