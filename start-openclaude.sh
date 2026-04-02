#!/usr/bin/env bash
set -euo pipefail

cd /opt/openclaude

if command -v openclaude >/dev/null 2>&1; then
  exec openclaude "$@"
else
  exec node dist/cli.mjs "$@"
fi
