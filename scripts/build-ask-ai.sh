#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../extensions/ask-ai"
npm run build
echo "Restarting vicinae..."
vicinae server --replace >/tmp/opencode/vicinae.log 2>&1 &
sleep 6
vicinae ping