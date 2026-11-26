#!/usr/bin/env bash
set -euo pipefail

repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
test_root=$(mktemp -d)
work="$test_root/work"
bin="$test_root/bin"
rm_cmd=$(command -v rm)
rmdir_cmd=$(command -v rmdir)
mv_cmd=$(command -v mv)
cleanup() {
    "$rm_cmd" -f -- "$work/deploy/docker-dev-start.sh" "$work/deploy/docker/compose.override.yaml" \
        "$work/.env" "$bin/docker" "$bin/docker.exe" "$bin/bash" "$bin/dirname" "$test_root/args" "$test_root/pwd" "$test_root/output"
    "$rmdir_cmd" -- "$work/deploy/docker" "$work/deploy" "$work" "$bin" "$test_root"
}
trap cleanup EXIT
mkdir -p "$work/deploy/docker" "$bin"
cp -- "$repo/deploy/docker-dev-start.sh" "$work/deploy/docker-dev-start.sh"
for command in bash dirname; do
    ln -s "$(command -v "$command")" "$bin/$command"
done
cat > "$bin/docker" <<'SCRIPT'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$TEST_ARGS"
pwd > "$TEST_PWD"
exit "${TEST_DOCKER_EXIT:-0}"
SCRIPT
chmod +x "$bin/docker"
export PATH="$bin" TEST_ARGS="$test_root/args" TEST_PWD="$test_root/pwd"

if bash "$work/deploy/docker-dev-start.sh" > "$test_root/output" 2>&1; then
    echo 'Missing credentials were ignored' >&2
    exit 1
fi
[[ ! -e "$test_root/args" ]]

: > "$work/.env"
bash "$work/deploy/docker-dev-start.sh"
[[ $(< "$test_root/pwd") == "$work" ]]
expected=$'compose\n--project-directory\n.\n-p\ndevices\n-f\ndeploy/docker/compose.yaml\nup\n--build\n-d'
[[ $(< "$test_root/args") == "$expected" ]]

: > "$work/deploy/docker/compose.override.yaml"
bash "$work/deploy/docker-dev-start.sh"
expected=$'compose\n--project-directory\n.\n-p\ndevices\n-f\ndeploy/docker/compose.yaml\n-f\ndeploy/docker/compose.override.yaml\nup\n--build\n-d'
[[ $(< "$test_root/args") == "$expected" ]]

export TEST_DOCKER_EXIT=42
status=0
bash "$work/deploy/docker-dev-start.sh" || status=$?
[[ $status -eq 42 ]]
unset TEST_DOCKER_EXIT
"$mv_cmd" "$bin/docker" "$bin/docker.exe"
bash "$work/deploy/docker-dev-start.sh"
[[ $(< "$test_root/args") == "$expected" ]]
"$rm_cmd" -f -- "$bin/docker.exe"
if bash "$work/deploy/docker-dev-start.sh" > "$test_root/output" 2>&1; then
    echo 'Missing Docker was ignored' >&2
    exit 1
fi
echo 'Docker development start tests passed'
