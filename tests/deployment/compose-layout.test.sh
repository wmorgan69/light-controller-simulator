#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$root"
docker_cmd=$(command -v docker || command -v docker.exe)
expected_root=$root
if [[ "$docker_cmd" == *.exe ]]; then
    expected_root=$(wslpath -w "$root")
fi

export POSTGRES_PASSWORD=test CONTROL_DB_PASSWORD=test TELEMETRY_DB_PASSWORD=test
export MQTT_CONTROL_PASSWORD=test MQTT_TELEMETRY_PASSWORD=test DEV_PROXY_SECRET=test
export DEV_CONTROL_PORT=5080 DEV_INSTRUMENTATION_PORT=5081

override=$(mktemp "$root/tests/.compose-layout.XXXXXXXX.yaml")
base_model=$(mktemp)
dev_model=$(mktemp)
cleanup() { rm -f -- "$override" "$base_model" "$dev_model"; }
trap cleanup EXIT
printf 'services:\n  postgres:\n    ports:\n      - "127.0.0.1:5432:5432"\n' > "$override"
compose=("$docker_cmd" compose --project-directory . -p devices -f deploy/docker/compose.yaml)
"${compose[@]}" config --format json > "$base_model"
"${compose[@]}" -f deploy/docker/compose.dev.yaml -f "tests/${override##*/}" config --format json > "$dev_model"

python3 - "$base_model" "$dev_model" "$expected_root" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as file:
    base = json.load(file)
with open(sys.argv[2], encoding="utf-8") as file:
    dev = json.load(file)

def normalize(value):
    return value.replace("\\", "/").rstrip("/").lower()

root = normalize(sys.argv[3])
assert base["name"] == "devices"
assert base["volumes"]["postgres-data"]["name"] == "devices_postgres-data"
assert base["volumes"]["mqtt-data"]["name"] == "devices_mqtt-data"
assert normalize(base["services"]["simulator"]["build"]["context"]) == root
for service, filename in [
    ("postgres", "postgres-init.sql"),
    ("mqtt", "mosquitto-start.sh"),
    ("nginx", "nginx.conf.template"),
]:
    assert any(
        volume["type"] == "bind"
        and normalize(volume["source"]) == f"{root}/deploy/docker/dev/{filename}"
        for volume in base["services"][service]["volumes"]
    )
assert "ports" not in base["services"]["postgres"]
assert [(port["host_ip"], str(port["published"])) for port in base["services"]["nginx"]["ports"]] == [
    ("127.0.0.1", "5080"), ("127.0.0.1", "5081")
]
assert any(
    volume["type"] == "bind" and normalize(volume["source"]) == f"{root}/src"
    for volume in dev["services"]["simulator"]["volumes"]
)
assert [(port["host_ip"], str(port["published"])) for port in dev["services"]["postgres"]["ports"]] == [
    ("127.0.0.1", "5432")
]
print("Compose layout tests passed")
PY
