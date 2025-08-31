#!/usr/bin/env bash
set -euo pipefail
echo "[user-data] Starting bootstrap" | systemd-cat -p info -t user-data

# Update & install dependencies (Amazon Linux 2023)
dnf update -y
dnf install -y nodejs git

APP_DIR=/opt/space-ship-socket
mkdir -p "$APP_DIR"
chown ec2-user:ec2-user "$APP_DIR"

# Prepare certificate directory (you can later place certs via deploy or use certbot)
CERT_DIR=/etc/space-ship-socket/certs
mkdir -p "$CERT_DIR"
chmod 750 /etc/space-ship-socket || true

ENV_FILE=/etc/space-ship-socket/env
if [[ ! -f "$ENV_FILE" ]]; then
	cat >"$ENV_FILE" <<'ENV'
# Environment overrides for space-ship-socket
# Uncomment and set if you provide custom cert locations
# TLS_CERT_PATH=/etc/space-ship-socket/certs/fullchain.pem
# TLS_KEY_PATH=/etc/space-ship-socket/certs/privkey.pem
PORT=443
REQUIRE_TLS=1
ENV
fi

cat >/etc/systemd/system/space-ship-socket.service <<'SERVICE'
[Unit]
Description=Space Ship Socket WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/space-ship-socket
Environment=NODE_ENV=production
EnvironmentFile=-/etc/space-ship-socket/env
ExecStart=/usr/bin/node dist/src/server.js
Restart=on-failure
User=ec2-user
Group=ec2-user
# Allow binding to privileged port 443 without running as root
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable space-ship-socket.service

echo "[user-data] Bootstrap complete" | systemd-cat -p info -t user-data
