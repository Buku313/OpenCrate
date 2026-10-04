#!/bin/zsh
set -e
TASK_DIR=${0:A:h}
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd "$TASK_DIR"
node launch.mjs &
TASK_PID=$!
trap 'kill "$TASK_PID" 2>/dev/null || true' EXIT INT TERM
for TASK_ATTEMPT in {1..30}; do
  if curl -fsS 'http://127.0.0.1:4783/api/status' >/dev/null 2>&1; then break; fi
  sleep .1
done
open 'http://127.0.0.1:4783'
wait "$TASK_PID"
