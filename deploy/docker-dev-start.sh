#!/usr/bin/env bash
set -euo pipefail

root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$root"

if [[ ! -f .env ]]; then
    echo 'The local .env is missing. Run bash deploy/docker-dev-setup.sh first.' >&2
    exit 1
fi

if command -v docker >/dev/null 2>&1; then
    docker_cmd=docker
elif command -v docker.exe >/dev/null 2>&1; then
    docker_cmd=docker.exe
else
    echo 'Docker Compose is required to start the local development stack.' >&2
    exit 1
fi

compose=("$docker_cmd" compose --project-directory . -p devices -f deploy/docker/compose.yaml)
if [[ -f deploy/docker/compose.override.yaml ]]; then
    compose+=(-f deploy/docker/compose.override.yaml)
fi

exec "${compose[@]}" up --build -d
