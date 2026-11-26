#!/bin/sh
set -eu

case "${DEV_PROXY_SECRET:-}" in
    *[!0-9a-f]*|'') echo "DEV_PROXY_SECRET must be a 64-character lowercase hex value" >&2; exit 1 ;;
esac
if [ "${#DEV_PROXY_SECRET}" -ne 64 ]; then
    echo "DEV_PROXY_SECRET must be a 64-character lowercase hex value" >&2
    exit 1
fi
for port in "${DEV_CONTROL_PORT:-}" "${DEV_INSTRUMENTATION_PORT:-}"; do
    case "$port" in
        *[!0-9]*|'') echo "Development ports must be numbers" >&2; exit 1 ;;
    esac
    if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        echo "Development ports must be between 1 and 65535" >&2
        exit 1
    fi
done
