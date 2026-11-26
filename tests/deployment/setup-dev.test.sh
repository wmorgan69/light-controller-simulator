#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
test_root=$(mktemp -d)
trap 'rm -rf -- "$test_root"' EXIT
mkdir -p "$test_root/work/deploy" "$test_root/bin"
cp -- "$repo/deploy/docker-dev-setup.sh" "$test_root/work/deploy/docker-dev-setup.sh"
for command in bash dirname rm grep cut sort wc stat cmp cp openssl; do
    ln -s "$(command -v "$command")" "$test_root/bin/$command"
done
export PATH="$test_root/bin"
work="$test_root/work"

bash "$work/deploy/docker-dev-setup.sh" > "$test_root/output" 2>&1
[[ $(wc -l < "$work/.env") -eq 6 ]]
for key in POSTGRES_PASSWORD CONTROL_DB_PASSWORD TELEMETRY_DB_PASSWORD MQTT_CONTROL_PASSWORD MQTT_TELEMETRY_PASSWORD DEV_PROXY_SECRET; do
    grep -Eq "^${key}=[0-9a-f]{64}$" "$work/.env"
done
[[ $(cut -d= -f2 "$work/.env" | sort -u | wc -l) -eq 6 ]]
[[ $(stat -c '%a' "$work/.env") == 600 ]]
[[ ! -e "$work/.secrets" ]]
cp "$work/.env" "$test_root/original.env"
if bash "$work/deploy/docker-dev-setup.sh" > "$test_root/output" 2>&1; then
    echo 'Existing credentials overwritten' >&2
    exit 1
fi
cmp "$work/.env" "$test_root/original.env"
rm -- "$work/.env"
rm -- "$test_root/bin/openssl"
if bash "$work/deploy/docker-dev-setup.sh" > "$test_root/output" 2>&1; then
    echo 'Missing OpenSSL ignored' >&2
    exit 1
fi
[[ ! -e "$work/.env" ]]
echo 'Linux credential setup tests passed'
