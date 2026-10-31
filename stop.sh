#!/usr/bin/env bash
#
# Stop whatever ./run.sh starts for TradeBot.
#
# run.sh here is `npm install && npm run dev` — but package.json has no "dev"
# script (only start/bot/bot:live/bot:banknifty/ui/login/orders/positions), so
# run.sh as literally written fails immediately with "Missing script: dev" and
# never starts anything. The real long-running entry points for this project,
# per package.json/README.md, are:
#
#   npm run ui        -> node src/server.js   (Express + WebSocket dashboard,
#                         PORT env or 3000 by default; auto-increments up to
#                         PORT+10 if busy — see src/server.js's tryListen())
#   npm run bot[:live] -> node src/bot.js      (the orchestrator/strategy loop;
#                         no HTTP port, just a long-running Node process)
#
# This script kills whichever of those is actually running: it scans a small
# port range around 3000 for the dashboard, and pattern-matches Node processes
# running src/bot.js / src/server.js / src/app.js from this project directory
# for the CLI/bot case.
#
# Usage: ./stop.sh [-h|--help]
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

for arg in "$@"; do
  case "$arg" in
    -h|--help)
      echo "Usage: ./stop.sh"
      echo "  Stops the TradeBot UI server (node src/server.js, port 3000-3010,"
      echo "  \$PORT env overrides the base) and/or the bot process (node src/bot.js"
      echo "  or src/app.js), whichever is actually running for this project."
      exit 0
      ;;
    *)
      echo "Unknown option: $arg (try --help)" >&2
      exit 1
      ;;
  esac
done

BASE_PORT="${PORT:-3000}"
MAX_PORT=$((BASE_PORT + 10))

is_our_process() {
  local pid="$1"
  local cmd
  cmd="$(ps -ww -p "$pid" -o command= 2>/dev/null || true)"
  [[ -z "$cmd" ]] && return 1
  [[ "$cmd" == *"$ROOT"* ]] && return 0
  [[ "$cmd" == *"src/server.js"* ]] && return 0
  [[ "$cmd" == *"src/bot.js"* ]] && return 0
  [[ "$cmd" == *"src/app.js"* ]] && return 0
  [[ "$cmd" == *"TradeBot"* ]] && return 0
  return 1
}

kill_pid_gracefully() {
  local pid="$1"
  local label="$2"
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  echo "  stopping $label (pid $pid)"
  kill -TERM "$pid" 2>/dev/null || true
}

wait_pid_gone() {
  local pid="$1"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10; do
    kill -0 "$pid" 2>/dev/null || return 0
    sleep 0.3
  done
  echo "  pid $pid still alive, sending SIGKILL"
  kill -KILL "$pid" 2>/dev/null || true
}

kill_port() {
  local port="$1"
  local label="$2"
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  local pids
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  local killed=0
  for pid in $pids; do
    if is_our_process "$pid"; then
      kill_pid_gracefully "$pid" "$label :$port"
      wait_pid_gone "$pid"
      killed=1
    fi
  done
  if [ "$killed" = 0 ] && [ -n "$pids" ]; then
    echo "  port $port in use by non-TradeBot process(es); left running"
  fi
}

kill_by_pattern() {
  local pattern="$1"
  local label="$2"
  local pids
  pids="$(pgrep -f "$pattern" 2>/dev/null || true)"
  [ -z "$pids" ] && return 0
  for pid in $pids; do
    if is_our_process "$pid"; then
      kill_pid_gracefully "$pid" "$label"
      wait_pid_gone "$pid"
    fi
  done
}

echo "================================================="
echo "Stopping TradeBot"
echo "================================================="

echo "UI server (node src/server.js, ports $BASE_PORT-$MAX_PORT)..."
port=$BASE_PORT
while [ "$port" -le "$MAX_PORT" ]; do
  kill_port "$port" "node src/server.js"
  port=$((port + 1))
done

echo "Bot / CLI process (node src/bot.js, src/app.js)..."
kill_by_pattern "${ROOT}.*src/bot\.js" "node src/bot.js"
kill_by_pattern "${ROOT}.*src/app\.js" "node src/app.js"

# Second pass — catch a slow-to-exit child
sleep 0.5
kill_port "$BASE_PORT" "node (cleanup)"

echo ""
echo "Done. TradeBot processes should be stopped."
if command -v lsof >/dev/null 2>&1 && lsof -ti ":$BASE_PORT" >/dev/null 2>&1; then
  echo "Note: port $BASE_PORT still in use (may be another app)."
fi
