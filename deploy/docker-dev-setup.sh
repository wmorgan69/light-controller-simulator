#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
env_path="$root/.env"
if [[ -e "$env_path" || -L "$env_path" ]]; then
    echo 'The local .env already exists. Back it up and remove it explicitly before provisioning new credentials.' >&2
    exit 1
fi
if ! command -v openssl >/dev/null 2>&1; then
    echo 'OpenSSL is required to provision local development credentials.' >&2
    exit 1
fi

secrets=()
for key in POSTGRES_PASSWORD CONTROL_DB_PASSWORD TELEMETRY_DB_PASSWORD MQTT_CONTROL_PASSWORD MQTT_TELEMETRY_PASSWORD DEV_PROXY_SECRET; do
    value=$(openssl rand -hex 32)
    if [[ ! "$value" =~ ^[0-9a-f]{64}$ ]]; then
        echo "Could not generate $key." >&2
        exit 1
    fi
    secrets+=("$key=$value")
done

umask 077
created_env=0
cleanup() {
    if [[ $created_env == 1 ]]; then rm -f -- "$env_path"; fi
}
trap cleanup EXIT
set -o noclobber
: > "$env_path"
created_env=1
printf '%s\n' "${secrets[@]}" >| "$env_path"
trap - EXIT
echo 'Created local development credentials. Keep .env private and out of source control.'
