#!/usr/bin/env bash
# Shared test server for tools/shot.mjs (port 5199, no HMR, localhost only).
# Starts it only if nothing is listening on 5199 yet.
cd "$(dirname "$0")/.."
if curl -s -o /dev/null http://127.0.0.1:5199/; then
  echo "test server already running on :5199"
  exit 0
fi
NO_HMR=1 PORT=5199 nohup npx vite > /tmp/o-universe-test-server.log 2>&1 &
for i in $(seq 1 30); do
  sleep 0.5
  if curl -s -o /dev/null http://127.0.0.1:5199/; then echo "test server started on :5199"; exit 0; fi
done
echo "test server failed to start; see /tmp/o-universe-test-server.log"
exit 1
