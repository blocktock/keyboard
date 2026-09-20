#!/bin/zsh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
INSTALLER="$ROOT/../release/Install KeyPulse.app"
if [[ ! -d "$INSTALLER" ]]; then
  "$ROOT/build-release.sh"
fi
open "$INSTALLER"
