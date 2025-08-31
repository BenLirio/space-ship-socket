#!/usr/bin/env bash
set -euo pipefail
echo "[user-data] Starting bootstrap" | systemd-cat -p info -t user-data

# Update & install dependencies (Amazon Linux 2023)
dnf update -y
dnf install -y nodejs git

APP_DIR=/opt/space-ship-socket
mkdir -p "$APP_DIR"
chown ec2-user:ec2-user "$APP_DIR"

cat >/etc/systemd/system/space-ship-socket.service <<'SERVICE'
[Unit]
Description=Space Ship Socket WebSocket Server
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/space-ship-socket
Environment=NODE_ENV=production
ExecStart=/usr/bin/node dist/src/server.js
Restart=on-failure
User=ec2-user
Group=ec2-user

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable space-ship-socket.service

echo "[user-data] Bootstrap complete" | systemd-cat -p info -t user-data
