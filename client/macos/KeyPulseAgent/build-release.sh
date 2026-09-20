#!/bin/zsh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
RELEASE="$ROOT/../release"
APP="$RELEASE/KeyPulse.app"
INSTALLER="$RELEASE/Install KeyPulse.app"
INSTALLER_BIN="$INSTALLER/Contents/MacOS/install"
INSTALLER_RES="$INSTALLER/Contents/Resources"

rm -rf "$RELEASE"
mkdir -p "$APP/Contents/MacOS" "$INSTALLER/Contents/MacOS" "$INSTALLER_RES"

swiftc -parse-as-library "$ROOT/main.swift" -o "$APP/Contents/MacOS/KeyPulse" \
  -framework SwiftUI -framework AppKit -framework ApplicationServices -framework Combine
cp "$ROOT/Info.plist" "$APP/Contents/Info.plist"
codesign --force --deep --sign - --identifier io.keypulse.app --entitlements "$ROOT/entitlements.plist" "$APP"
ditto "$APP" "$INSTALLER_RES/KeyPulse.app"

cat > "$INSTALLER/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleDevelopmentRegion</key><string>zh_CN</string>
  <key>CFBundleDisplayName</key><string>安装 KeyPulse</string>
  <key>CFBundleExecutable</key><string>install</string>
  <key>CFBundleIdentifier</key><string>io.keypulse.installer</string>
  <key>CFBundleName</key><string>Install KeyPulse</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>0.1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>
EOF

cat > "$INSTALLER_BIN" <<'EOF'
#!/bin/bash
set -euo pipefail

RESOURCE_DIR="$(cd "$(dirname "$0")/../Resources" && pwd)"
SOURCE_APP="$RESOURCE_DIR/KeyPulse.app"
TARGET_APP="/Applications/KeyPulse.app"
SUPPORT_DIR="$HOME/Library/Application Support/KeyPulse"
PLIST="$HOME/Library/LaunchAgents/io.keypulse.agent.plist"

if [[ ! -d "$SOURCE_APP" ]]; then
  osascript -e 'display alert "安装失败" message "未找到 KeyPulse 应用包。" buttons {"好的"} default button 1' >&2
  exit 1
fi

launchctl bootout "gui/$(id -u)/io.keypulse.agent" 2>/dev/null || launchctl unload -w "$PLIST" 2>/dev/null || true
rm -f "$PLIST"
killall KeyPulse 2>/dev/null || true
killall KeyPulseAgent 2>/dev/null || true

mkdir -p "$SUPPORT_DIR"
if [[ ! -f "$SUPPORT_DIR/config.json" ]]; then
  printf '%s\n' '{}' > "$SUPPORT_DIR/config.json"
fi

rm -rf "$TARGET_APP"
ditto "$SOURCE_APP" "$TARGET_APP"
open "$TARGET_APP"

osascript <<'APPLESCRIPT'
display alert "KeyPulse 已安装" message "请在菜单栏找到 KP 图标。\n\n若之前授权给 KeyPulseAgent，请先在「隐私与安全性」里删除旧条目，再为 /Applications/KeyPulse.app 重新开启「辅助功能」和「输入监控」。" buttons {"好的"} default button 1
APPLESCRIPT
EOF

chmod +x "$INSTALLER_BIN"
xattr -cr "$RELEASE" 2>/dev/null || true

echo "已生成："
echo "  $INSTALLER"
echo "  $APP"
echo "请双击 Install KeyPulse.app 完成安装。"
