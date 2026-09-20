# KeyPulseAgent（macOS）

这是给仪表盘提供数据的本地后台进程。它在 macOS **顶部菜单栏**显示 KeyPulse 图标：只有用户点击「开始记录」后才会采集，点击「停止并生成报告」后会把 JSON 保存到本地存储文件夹。**不会自动上传**——需在 KeyPulse 网页中手动选择报告文件上传分析。它只将**白名单物理键位的聚合计数**写成 JSON；不会保存字符序列、输入内容、剪贴板、窗口标题或正在使用的应用。

## 安装方式（双击，无需命令行）

1. 打开 `client/macos/release/Install KeyPulse.app`
2. **双击**运行，按提示完成安装
3. 在顶部菜单栏找到 **⌨ 键盘图标**，点击「开始记录」

若 `release` 目录不存在，开发者需先在本机执行一次 `build-release.sh` 生成安装包。

安装完成后，应用位于 `/Applications/KeyPulse.app`。**首次启动必须选择报告存储文件夹**，未设置时无法开始记录。

## 存储文件夹

- 菜单栏 → **设置存储文件夹…** 选择本机目录
- 配置保存在 `~/Library/Application Support/KeyPulse/config.json` 的 `reportDirectory` 字段
- 未设置或目录不可写时，「开始记录」不可用

## 权限

安装后请在「系统设置 → 隐私与安全性」中，为 **`/Applications/KeyPulse.app`** 开启：

- **辅助功能**
- **输入监控**

### 已开启仍提示未授权？

macOS 按**应用路径**记录权限。若之前授权给 `KeyPulseAgent`（位于 `~/Library/Application Support/KeyPulse/`），不会自动迁移到新应用。

1. 打开「系统设置 → 隐私与安全性 → 辅助功能 / 输入监控」
2. **删除** 旧的 KeyPulse / KeyPulseAgent 条目
3. 点击 **+**，选择 `/Applications/KeyPulse.app`
4. 完全退出 KeyPulse（菜单栏 → 退出 KeyPulse），再重新打开

KeyPulse 菜单中有「检查权限状态…」，可查看当前两项权限是否真正生效。

## 分析流程

1. 菜单栏停止记录后，客户端自动上传到本机分析服务并删除本地 JSON
2. 启动本机分析服务：`npm run start`（默认 <http://127.0.0.1:3011>）
3. 浏览器打开分析页，可导出热力图 PNG；也可手动上传 JSON

## 开发者打包

```zsh
cd client/macos/KeyPulseAgent
chmod +x build-release.sh
./build-release.sh
```

会在 `client/macos/release/` 生成可双击分发的 `Install KeyPulse.app`。
