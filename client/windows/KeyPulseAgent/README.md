# KeyPulse（Windows）

Windows 版本地后台采集器，功能与 macOS 客户端一致：

- 系统托盘运行，手动开始/停止记录
- 停止时生成本地 JSON 报告（**不会自动上传**）
- 仅记录白名单物理键位，不保存字符内容、窗口或应用信息

## 运行方式

### 方式一：Python 直接运行（开发）

```powershell
cd client\windows\KeyPulseAgent
python -m pip install -r requirements.txt
python main.py
```

启动后在任务栏托盘区找到 **KP** 图标。

### 方式二：打包 exe（分发）

在 Windows 上执行：

```powershell
cd client\windows\KeyPulseAgent
powershell -ExecutionPolicy Bypass -File .\build-release.ps1
```

产物：`client\windows\release\KeyPulse.exe`

> 构建脚本优先使用 Windows `py -3` 启动器，并会跳过 WindowsApps 中的 Python
> 占位程序。请安装 Python 3.10+ 完整版（包含 Tcl/Tk）；任一步骤返回非 0
> 退出码或未生成有效 exe 时，脚本都会立即终止并报告失败。

## 首次使用

1. 启动 KeyPulse，按提示选择**报告存储文件夹**（未设置无法开始记录）
2. 托盘菜单 → **开始记录**
3. 使用键盘一段时间后 → **停止并生成报告**
4. 在本机启动分析服务：`npm run start`（默认 http://127.0.0.1:3011）
5. 停止记录后客户端会自动上传并删除本地 JSON，浏览器打开分析页
6. 在网页点击「导出 PNG」保存热力图

## 配置路径

- 配置文件：`%APPDATA%\KeyPulse\config.json`
- 报告文件：`{reportDirectory}\report-{timestamp}.json`

## 权限说明

Windows 使用低层键盘钩子（`WH_KEYBOARD_LL`）采集按键，通常无需像 macOS 那样单独授权。若无法记录，请检查安全软件是否拦截，并完全退出后重新启动 KeyPulse。

### 按键未被记录时的排查

1. 在 `KeyPulseAgent` 目录运行 `python test_hook.py`，确认 10 秒内能否看到按键输出
2. 若测试脚本也无输出，多半是钩子被安全软件拦截；将 KeyPulse 加入白名单后重试
3. 若测试脚本正常但托盘版不行，请重新打包 exe：`powershell -ExecutionPolicy Bypass -File .\build-release.ps1`
4. 确认托盘菜单显示「正在记录按键」后再输入，停止后检查报告 JSON 中 `events` 是否有数据

## 报告格式

与 macOS 客户端相同（schemaVersion 2）：

```json
{
  "schemaVersion": 2,
  "startedAt": "2026-09-03T09:00:00.000Z",
  "endedAt": "2026-09-03T09:23:45.123Z",
  "keyboardLayout": "ansi-75",
  "keyCounts": { "W": 100, "A": 42 },
  "events": [{ "key": "W", "timestampMs": 1725346825123 }],
  "totalKeyDowns": 142
}
```

键名与 macOS 客户端、网页热力图布局保持一致（如 `Space`、`NumEnter`、`Command`、`Option` 等）。

## 项目结构

```
client/windows/KeyPulseAgent/
├── main.py           # 托盘 UI 与应用逻辑
├── hook.py           # Windows 键盘钩子
├── keymap.py         # VK → 键名映射
├── recorder.py       # 会话聚合与 JSON 写出
├── storage.py        # 配置读写
├── requirements.txt
└── build-release.ps1
```
