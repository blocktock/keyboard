from __future__ import annotations

import json
import threading
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


@dataclass
class KeyEvent:
    key: str
    timestampMs: int


@dataclass
class EventReport:
    schemaVersion: int
    startedAt: str
    endedAt: str
    keyboardLayout: str
    keyCounts: dict[str, int]
    events: list[KeyEvent]
    totalKeyDowns: int


class EmptySessionError(Exception):
    def __str__(self) -> str:
        return "这次会话没有收集到有效按键，因此未生成报告。"


class KeyPulseRecorder:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counts: dict[str, int] = {}
        self._events: list[KeyEvent] = []
        self._total = 0
        self._session_started_at = datetime.now(timezone.utc)

    def reset_session(self) -> None:
        with self._lock:
            self._counts.clear()
            self._events.clear()
            self._total = 0
            self._session_started_at = datetime.now(timezone.utc)

    def record(self, key: str, timestamp_ms: int) -> None:
        with self._lock:
            self._counts[key] = self._counts.get(key, 0) + 1
            self._events.append(KeyEvent(key=key, timestampMs=timestamp_ms))
            self._total += 1

    def write_report(self, report_directory: Path) -> Path:
        with self._lock:
            if self._total <= 0:
                raise EmptySessionError()

            report_directory.mkdir(parents=True, exist_ok=True)
            ended_at = datetime.now(timezone.utc)
            report = EventReport(
                schemaVersion=2,
                startedAt=self._session_started_at.isoformat().replace("+00:00", "Z"),
                endedAt=ended_at.isoformat().replace("+00:00", "Z"),
                keyboardLayout="ansi-75",
                keyCounts=dict(sorted(self._counts.items())),
                events=list(self._events),
                totalKeyDowns=self._total,
            )

            payload = {
                "schemaVersion": report.schemaVersion,
                "startedAt": report.startedAt,
                "endedAt": report.endedAt,
                "keyboardLayout": report.keyboardLayout,
                "keyCounts": report.keyCounts,
                "events": [
                    {"key": event.key, "timestampMs": event.timestampMs}
                    for event in report.events
                ],
                "totalKeyDowns": report.totalKeyDowns,
            }

            filename = f"report-{int(time.time())}.json"
            target = report_directory / filename
            temp = target.with_suffix(".json.tmp")
            temp.write_text(
                json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True),
                encoding="utf-8",
            )
            temp.replace(target)
            return target
