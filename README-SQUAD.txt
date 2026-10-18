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

RAILWAY (cloud, always on, HTTPS, no port forwarding)
  1. railway.com -> New Project -> Deploy from GitHub repo -> ewgweaz3l-rgb/ARIA.
     The repo's Dockerfile + railway.json build ONLY the squad server (not the desktop app).
  2. Service -> Variables:  SQUAD_KEY = <pick a key>   SQUAD_NAME = <name on the boards>
  3. Service -> right-click -> Attach Volume, mount path /data  (without it, scores reset
     on every deploy; the status page warns you in amber).
  4. Settings -> Networking -> Generate Domain. That https://….up.railway.app address +
     the key go into everyone's ARIA -> Settings -> Squad -> Test.
  Auto-update: Railway redeploys on every push to main, but railway.json's watchPatterns
  limit that to pushes that touch the squad server files, so app updates don't bounce it.
