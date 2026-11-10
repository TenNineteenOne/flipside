#!/bin/bash
# Design-lab helper: headless Chrome screenshot. usage: lab-shot.sh <url> <out.png> [width,height]
# Chrome doesn't exit on its own here, so run it in the background, wait for the file, then kill it.
url="$1"; out="$2"; size="${3:-1440,900}"
d=$(mktemp -d); rm -f "$out"
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --disable-gpu --hide-scrollbars \
  --no-first-run --user-data-dir="$d" --window-size="$size" --timeout=9000 --screenshot="$out" "$url" >/dev/null 2>&1 &
for _ in $(seq 1 30); do sleep 1; [ -s "$out" ] && break; done
sleep 1; pkill -f "user-data-dir=$d" >/dev/null 2>&1; rm -rf "$d"
[ -s "$out" ] && echo "saved $out" || { echo "screenshot failed" >&2; exit 1; }
