#!/usr/bin/env bash
# benchmark/mqtt-source/run-all.sh
#
# Full baseline sweep: stub and broker harnesses across three payload sizes
# and two rate regimes (steady-state + unthrottled). Results accumulate in
# results/*.csv.
#
# Assumes Mosquitto is reachable at mqtt://localhost:1883.
#
# Usage:
#   bash benchmark/mqtt-source/run-all.sh            # default: 30s per cell
#   DURATION=60 bash benchmark/mqtt-source/run-all.sh
#   bash benchmark/mqtt-source/run-all.sh --quick    # 10s per cell

set -euo pipefail

DURATION=${DURATION:-30}
WARMUP=${WARMUP:-5}
if [[ "${1:-}" == "--quick" ]]; then
    DURATION=10
    WARMUP=2
fi

HERE="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$HERE/../.."

PAYLOADS=(100 1024 10240)
RATES=(10000 0)        # 0 = unthrottled

echo ""
echo "===== MQTT source baseline sweep ====="
echo "duration: ${DURATION}s per cell, warmup: ${WARMUP}s, node: $(node --version)"
echo "payloads: ${PAYLOADS[*]}"
echo "rates   : ${RATES[*]} (0 = unthrottled)"
echo ""

for harness in stub broker; do
    for payload in "${PAYLOADS[@]}"; do
        for rate in "${RATES[@]}"; do
            echo "--- ${harness} payload=${payload} rate=${rate} ---"
            node "benchmark/mqtt-source/harness-${harness}.js" \
                --payload "$payload" \
                --rate "$rate" \
                --duration "$DURATION" \
                --warmup "$WARMUP"
        done
    done
done

echo ""
echo "===== Sweep complete ====="
echo "Results in: benchmark/mqtt-source/results/"
