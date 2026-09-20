from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path


@dataclass
class AgentConfiguration:
    reportDirectory: str | None = None


class StorageError(Exception):
    pass


def config_path() -> Path:
    appdata = os.environ.get("APPDATA")
    if not appdata:
        raise StorageError("无法定位 APPDATA 目录。")
    return Path(appdata) / "KeyPulse" / "config.json"


def ensure_support_directory() -> Path:
    path = config_path()
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
    except OSError as error:
        raise StorageError(f"无法创建配置目录：{path.parent}") from error
    if not path.exists():
        _write_config(path, AgentConfiguration(reportDirectory=None))
    return path


def load_config() -> AgentConfiguration:
    path = config_path()
    if not path.exists():
        return AgentConfiguration()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return AgentConfiguration(reportDirectory=data.get("reportDirectory"))
    except (OSError, json.JSONDecodeError):
        return AgentConfiguration()


def _write_config(path: Path, config: AgentConfiguration) -> None:
    payload = {"reportDirectory": config.reportDirectory}
    temp = path.with_suffix(".json.tmp")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        temp.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
            encoding="utf-8",
        )
        temp.replace(path)
    except OSError as error:
        raise StorageError(f"无法写入配置文件：{path}") from error


def save_config(config: AgentConfiguration) -> None:
    _write_config(config_path(), config)


def is_valid_directory(path: str) -> bool:
    target = Path(path)
    return target.is_dir() and os.access(target, os.W_OK)


def ensure_directory(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    if not os.access(path, os.W_OK):
        raise StorageError("所选文件夹不可写入，请重新选择。")
