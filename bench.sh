#!/usr/bin/env bash
#
# bench.sh — runs a command n times, extracts a numerical value from output
# of the form "Total time         : 16363.0 ms ..."
# and returns the arithmetic mean of all captured values.
#
# Usage
#   ./bench.sh -n 10 -d 2 -- your command with args
#
# Example
#   ./bench.sh -n 5 -d 1.5 -- ./mein_benchmark --flag value
#
set -euo pipefail

RUNS=10
DELAY=10

usage() {
    echo "Usage: $0 [-n ANZAHL_LAEUFE] [-d DELAY_SEKUNDEN] -- KOMMANDO [ARGS...]"
    echo "  -n   Number of repeats (Standard: 10)"
    echo "  -d   Sleeptime between runs in seconds, e.g. 1 or 0.5 (Standard: 10)"
    exit 1
}

# Parse options
while [[ $# -gt 0 ]]; do
    case "$1" in
        -n)
            RUNS="$2"
            shift 2
            ;;
        -d)
            DELAY="$2"
            shift 2
            ;;
        --)
            shift
            break
            ;;
        -h|--help)
            usage
            ;;
        *)
            break
            ;;
    esac
done

if [[ $# -eq 0 ]]; then
    echo "Error: No command given." >&2
    usage
fi

if ! [[ "$RUNS" =~ ^[0-9]+$ ]] || [[ "$RUNS" -lt 1 ]]; then
    echo "Error: -n must be a positive integer." >&2
    exit 1
fi

if ! [[ "$DELAY" =~ ^[0-9]+([.][0-9]+)?$ ]]; then
    echo "Error: -d must be a non negative integer (e.g. 0, 1, 1.5)." >&2
    exit 1
fi

declare -a values=()

echo "Run command ${RUNS}x : $*"
echo "---------------------------------------------"

for ((i = 1; i <= RUNS; i++)); do
    # Run command, capture output
    output="$("$@" 2>&1)" || {
        echo "Warning: Run $i failed with error code." >&2
    }

    # Extract numerical value (field 4, when line "Total time ... : <value> ms ..." matches)
    value="$(echo "$output" | awk '/Total time/{print $4}')"

    if [[ -z "$value" ]]; then
        echo "Run $i: No value found!" >&2
        continue
    fi

    echo "Run $i: $value ms"
    values+=("$value")

    # Insert delay except for the last run
    if [[ "$i" -lt "$RUNS" ]] && awk "BEGIN{exit !($DELAY > 0)}"; then
        sleep "$DELAY"
    fi
done

echo "---------------------------------------------"

count="${#values[@]}"
if [[ "$count" -eq 0 ]]; then
    echo "Error: Couldn't capture valid values." >&2
    exit 1
fi

# Calculate arithmetic mean via awk
avg="$(printf '%s\n' "${values[@]}" | awk '{sum+=$1} END {printf "%.3f", sum/NR}')"

echo "Number of valid runs : $count / $RUNS"
echo "Arithmetic mean      : $avg ms"
