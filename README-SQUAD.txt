ARIA squad server — for a box that only hosts (Thoth)
=====================================================

Hosts the squad leaderboards and the versus lobby (chess / tanks / fleet).
Nothing else: no browser, no game data, no Star Citizen bits. Python 3.9+, stdlib only.

WINDOWS:  double-click install_squad.bat
  - installs Python 3.12 if the box has none (winget or python.org, silent, user-only)
  - copies the server to %LOCALAPPDATA%\ARIA-Squad
  - asks for a name (shown on boards), opens port 8777 in Windows Firewall (one admin prompt)
  - adds a "run at logon" task so it comes back after a reboot, starts it, and prints
    the address + key to hand out. Status page: http://localhost:8777

LINUX:    bash install_squad.sh Thoth
  - systemd service "aria-squad", enabled and started; prints address + key

Then EVERYONE (you too): ARIA -> Settings -> Squad -> paste address + key -> Test.
Over the open internet, forward TCP 8777 on the router to this box; on a LAN or
Tailscale/Hamachi, nothing to forward.

Files kept on the box: squad_config.json (key, name), scores.json, lobbies.json.
Change the key: edit squad_config.json and restart (or rerun with --key).
Update later: copy a newer squad_server.py + squad.py over the old ones and restart.
