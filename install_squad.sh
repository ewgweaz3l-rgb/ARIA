#!/usr/bin/env bash
# ARIA squad server installer for Linux (systemd).  bash install_squad.sh [name]
set -e
NAME="${1:-$(hostname)}"; PORT=8777; DEST="$HOME/aria-squad"
command -v python3 >/dev/null || { echo "python3 missing: sudo apt install python3"; exit 1; }
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DEST"; cp "$HERE/squad_server.py" "$HERE/squad.py" "$HERE/VERSION" "$DEST/"
UNIT="[Unit]
Description=ARIA squad server
After=network.target

[Service]
ExecStart=$(command -v python3) $DEST/squad_server.py --name \"$NAME\" --port $PORT
WorkingDirectory=$DEST
Restart=always
User=$USER

[Install]
WantedBy=multi-user.target"
echo "$UNIT" | sudo tee /etc/systemd/system/aria-squad.service >/dev/null
sudo systemctl daemon-reload && sudo systemctl enable --now aria-squad
command -v ufw >/dev/null && sudo ufw allow $PORT/tcp || true
sleep 1
echo "Running. Address: http://$(hostname -I 2>/dev/null | awk '{print $1}'):$PORT"
echo "Key: $(python3 -c "import json;print(json.load(open('$DEST/squad_config.json'))['key'])")"
echo "Everyone: ARIA → Settings → Squad → paste both → Test."
