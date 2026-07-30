#!/usr/bin/env bash
# benchmark/mqtt-source/profile-stub.sh
#
# Captures a V8 CPU profile of the stub harness under unthrottled load.
# Load the resulting .cpuprofile in Chrome DevTools (Performance tab →
# Load profile, or Memory → Load for heap snapshots).
#
# Usage:
#   bash benchmark/mqtt-source/profile-stub.sh [payload_bytes] [duration_s]

set -euo pipefail

PAYLOAD=${1:-1024}
DURATION=${2:-15}

HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$HERE/../.."

OUT_DIR="benchmark/mqtt-source/results/cpu-profile"
mkdir -p "$OUT_DIR"

echo "Capturing CPU profile: payload=${PAYLOAD}B duration=${DURATION}s unthrottled"
echo "Output dir: $OUT_DIR"

node --cpu-prof \
    --cpu-prof-dir="$OUT_DIR" \
    --cpu-prof-name="stub-unthrottled-${PAYLOAD}B.cpuprofile" \
    --cpu-prof-interval=100 \
    benchmark/mqtt-source/harness-stub.js \
        --payload "$PAYLOAD" \
        --rate 0 \
        --duration "$DURATION" \
        --warmup 3

echo ""
echo "Profile written. Load in Chrome DevTools:"
ls -la "$OUT_DIR"/*.cpuprofile
