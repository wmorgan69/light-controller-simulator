#!/bin/sh
set -eu

test -n "${MQTT_CONTROL_PASSWORD:?MQTT_CONTROL_PASSWORD is required}"
test -n "${MQTT_TELEMETRY_PASSWORD:?MQTT_TELEMETRY_PASSWORD is required}"
mkdir -p /tmp/mosquitto
rm -f /tmp/mosquitto/passwords
mosquitto_passwd -b -c /tmp/mosquitto/passwords control "$MQTT_CONTROL_PASSWORD"
mosquitto_passwd -b /tmp/mosquitto/passwords telemetry "$MQTT_TELEMETRY_PASSWORD"
cat > /tmp/mosquitto/acl <<'EOF'
user control
topic read building/controllers/+/commands
topic write building/controllers/+/telemetry
topic write building/controllers/+/commands/+/ack
topic write building/controllers/lwt

user telemetry
topic read building/controllers/+/telemetry
EOF
cat > /tmp/mosquitto/mosquitto.conf <<'EOF'
listener 1883
allow_anonymous false
password_file /tmp/mosquitto/passwords
acl_file /tmp/mosquitto/acl
max_packet_size 8388608
persistence true
persistence_location /mosquitto/data/
EOF
chown -R mosquitto:mosquitto /tmp/mosquitto
chmod 600 /tmp/mosquitto/passwords /tmp/mosquitto/acl
exec mosquitto -c /tmp/mosquitto/mosquitto.conf
