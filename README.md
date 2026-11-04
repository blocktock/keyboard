# KeyPulse

## 运行单元

- **后台采集器**：macOS / Windows 托盘应用，手动开始/停止记录。仅在停止时生成本地 JSON 报告。
- **分析服务与网页**：`node server.js` 提供网页、报告上传 API 和分析 API。

## 本机网页

```zsh
cd /Users/gaoyue/ai/keyboard
npm run start
```

打开 <http://127.0.0.1:3011>。分析结果保存在浏览器 localStorage，刷新后仅本机可见；服务端不保留全局最近报告。

需在 `.env` 中配置 `DEEPSEEK_API_KEY`，上传报告后由 DeepSeek 官方 `deepseek-v4-flash` 生成分析结论与逐键轴体推荐。

布局推荐独立于 AI，依据本次数字小键盘、F 区、导航键和方向键的使用统计，提供首选、备选与取舍说明。旧报告也可直接展示，不需要重新调用 AI。热力图配列用于还原键位分布，不会随推荐布局切换。

分享标题默认结合使用场景、高频键与按键总量生成，可手动修改。旧分享使用统一默认标题时，会在展示时生成新标题，保留自定义标题，无需修改数据库。

运行 `npm test` 可检查 AI 响应处理、分享标题、布局规则及旧分享兼容性；测试使用模拟响应，不会调用 AI 或写入真实数据库。

## 报告分享与 MySQL

用户的分析默认只保存在浏览器 `localStorage`。只有用户在分享确认弹窗中主动同意，脱敏后的分析快照才会写入 MySQL 并展示在报告广场。公开数据不包含原始 `events`、按键顺序、精确开始时间、本地路径或设备信息。

先创建数据库：

```sql
CREATE DATABASE keypulse CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
```

然后在 `.env` 配置：

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=your_mysql_password
MYSQL_DATABASE=keypulse
```

服务会在第一次访问报告广场或执行分享时自动创建 `shared_reports` 表。公开部署时设置 `HOST=0.0.0.0`，并通过 HTTPS 反向代理暴露服务。

## 后台采集器

### macOS

安装入口在 `client/macos/release/Install KeyPulse.app`。**双击安装**，无需命令行。安装后在顶部菜单栏找到键盘图标。

若 `release` 目录不存在，开发者可在 `client/macos/KeyPulseAgent` 运行 `build-release.sh` 生成安装包。

### Windows

源码与说明见 `client/windows/KeyPulseAgent/README.md`。

开发运行：

```powershell
cd client\windows\KeyPulseAgent
python -m pip install -r requirements.txt
python main.py
```

打包 exe（在 Windows 上）：

```powershell
powershell -ExecutionPolicy Bypass -File .\build-release.ps1
```

产物：`client\windows\release\KeyPulse.exe`

### 分析上传

采集器停止记录后会自动上传到本机分析服务；上传失败时保留 JSON，可在网页 <http://127.0.0.1:3011> 手动上传。分析成功后会询问是否分享，默认不公开。

安装后若顶部菜单栏看不到 KeyPulse 键盘图标，请重新双击 `Install KeyPulse.app`，或从「应用程序」打开 `KeyPulse.app`。
