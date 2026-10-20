#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")" || exit 1
termux-wake-lock 2>/dev/null || true
exec node server.js
