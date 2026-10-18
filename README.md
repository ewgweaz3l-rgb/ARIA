# ARIA Quartermaster

A local Star Citizen assistant that runs on your own PC. Five rooms:

- **Make Me Rich** — type your ship and money, get ranked trade hauls from live UEX prices.
  `c2 hercules 750k from area18` · `cutlass black 150k` · `caterpillar 2m pyro`
- **Shipyard** — every ship from the game files (Star Citizen Wiki API), with in-game dealer
  prices and rentals from UEX. Star ships into **My Hangar**, compare up to 4 side by side.
- **Blueprint Room** — every crafting blueprint, its materials and the missions that drop it.
  Mark the ones you own, queue up what you want to build, and ARIA totals the materials and
  finds the cheapest terminal for each one.
- **Starmap** — every system, planet, moon, station and jump point from the game files. Click a
  body for its terminals and best trades. Plot a course across systems with quantum time for your
  ship. The ⌖ button on any haul shows that run on the map. Market overlay shows where one
  commodity is bought (green) and sold (red).
- **Voice Macros** — say a phrase, ARIA presses the keys in game and answers. Push-to-talk on any
  key, mouse button or HOTAS button, so Discord chatter is ignored. Find any game action by name
  ("bind center turret") and turn it into a voice command in one click.

**Manual:** the **?** in the header (or Settings → Open the manual, or HELP on the center MFD) opens
the built-in manual — every room, every key, what to type, troubleshooting — searchable, printable.

## Install it (once)

Double-click **install.bat**. If there's no Python 3.9+ on the PC it installs Python 3.12 for
you (winget if available, otherwise the official python.org installer, silently, for your user
only). Then it copies ARIA to
`%LOCALAPPDATA%\ARIA`, and puts an **ARIA** shortcut on your desktop and Start menu. From then on,
click the shortcut: ARIA checks GitHub for a newer version, updates itself, starts, and opens
on your chosen screen. No console window. Log in `aria.log` if something goes wrong.

(`start.bat` still works for running from the folder without installing.)

**Auto-update setup:** put ARIA in a GitHub repo and set the repo in Settings ⚙ → "Update from
GitHub repo" (e.g. `drew/aria`). Every launch compares the repo's `VERSION` file with yours.
Your settings, macros, voice clips, game files, cache and keybind backups are never overwritten.
Settings → **Check** / **Update & restart** does it by hand.

**Microphone & volume (Voice Macros room):** the **Mic** chip shows whether the browser has
microphone permission; **Allow microphone** asks for it (if it says blocked, click the mic/lock icon in
the address bar and allow 127.0.0.1). The picker lists your microphones and **Test level** shows a live
meter for the selected one. Chrome/Edge speech recognition always listens on the *Windows default*
input, so **Windows sound settings** opens the page where you set that. **ARIA volume** sets how loud
replies are (voice pack clips and the browser voice alike); **Say something** previews it.

## Cockpit mode & the Cougar MFDs

Press **▣** (or F9) for cockpit mode: the page rearranges itself around the two Cougar MFD
bezels on your monitor — left and right MFD screens, the command console between them, and the
job search / map / tabs in the band below. **ALGN** on the deck, the **⌗** button bottom-right,
or Settings → Calibrate opens the layout tool: every area (left MFD, right MFD, center MFD,
bottom band) is a free box with 8 crop handles — edge handles move one side, corners move two
(Ctrl = one side only, Shift = keep shape), drag the middle to move. Sliders and 1-px nudges in the
floating panel (drag it anywhere by its header). For the MFDs the panel also has button spacing,
inset and label size, and the MFD shows its button numbers while selected. Ctrl+Z undoes, Reset
this / Reset all recover, Esc finishes. What's inside each area scales to fit it. F9 turns cockpit
mode off entirely if you ever need the normal layout back.
Settings → **Open ARIA on** picks the monitor and full screen.

Each MFD runs F/A-18-style pages. The 20 buttons around the frame (OSBs) are the labels on screen;
the Cougar's real buttons drive them with no mouse and no focus change, so Star Citizen keeps
focus. Pages: **MENU · SHLD** (shield facing + reset) **· PWR** (weapons/shields/engines + reset)
**· NAV** (next leg, ETA, NEXT/PREV stop) **· JOB** (your stops, banked profit, DONE/BACK)
**· MACR** (your voice macros on buttons) **· VOICE · SYS**. Rockers: left pair = brightness, right
pair = page cycle, bottom = SOI. Any button that needs the game shows **NO BIND** until ARIA finds
the action in your keybinds (SYS → EDIT sets one by hand). SYS → TEST shows button numbers.

**Center MFD:** the screen between the Cougars is a third MFD — same pages as the other two
(MENU, SHLD, PWR, NAV, JOB, MACR, VOICE, SYS, GAME), mouse/VR-driven since there's no bezel, and its
own **UFC** page: the route summary (cash / time / stops / jumps / dist / fuel) with the mini starmap,
soft keys on the OSBs — ACPT (make it a job), NEXT (reinvest leg), RTB, MAP, SAY, LOG, ALGN, DIM, VR,
SET, HOME. Shield reroutes from the SHLD page animate here; LOG keeps the last 60 key presses ARIA
sent. It can be the SOI like the others, so games and the keyboard work on it too.

**The deck strip:** what ARIA says prints teletype-style in the bottom band, right under the header
and above the ask bar, with her status lamp (keys live / practice, PTT / open mic) and SAY / RTB /
MAP keys. The ask bar and the job bar stay visible in cockpit mode whatever tab is open.

**Skins:** Settings ⚙ → Cockpit skin. Pick a manufacturer (ARIA stock, Drake, RSI, Anvil, Origin,
Aegis, MISC, Crusader) or change any colour for your own mix. Brightness slider (also the DIM soft
key on the deck and the MFD rockers), bloom/glow, and scanline strength. The main app takes the
skin's accent colours too.

Each skin has a **personality** (Settings → Personality, with a strength slider): **Analog**
(ARIA, Anvil, Aegis) — a radar sweep with phosphor persistence and needle-style bars; **Smooth**
(RSI, Origin, MISC, Crusader) — soft fades, no scanlines, no flicker; **Glitch** (Drake) — CRT
static, a rolling bar, occasional tears and jitter.

## VR (WebXR)

**VR** on the deck (or SYS → VR, or Settings → Enter VR) puts the two MFDs, the deck and the app
band in a floating arc in your headset. Point a controller and pull the trigger to click anything
on them; squeeze the grip to recenter. Cougar buttons, voice and push-to-talk keep working.
Settings → VR has distance, height, spread, panel size and tilt, live while you're in.

Needs Chrome or Edge (the ARIA app window is Edge/Chrome already) and a running OpenXR runtime:
SteamVR, Pimax Play, Oculus/Meta. Windows Mixed Reality headsets work only on Windows builds
before 24H2 (Microsoft removed WMR).

**Important — it is not an overlay.** A WebXR session is exclusive: the browser takes the headset
from whatever has it. Enter ARIA VR only when no game is running in the headset (Star Citizen on
your monitor is fine). If a game *is* in the headset, it loses the HMD — the SteamVR/Pimax grey void —
and it can crash (NVIDIA driver errors included). ARIA asks once before the first entry. To see ARIA
*inside* a VR game, pin the ARIA window with an overlay tool: **XSOverlay**, **Desktop+** (free,
SteamVR) or **OVR Toolkit** — all of them show any desktop window as a panel you can grab in-game,
and ARIA's cockpit mode is built to be pinned that way. A native SteamVR-overlay mode for ARIA is on
the list.

**GAME page — the arcade.** Something to do in quantum. MENU → GAME. Pick a game on the side OSBs;
the rockers are the d-pad (left pair up/down, right pair left/right), the lower rockers are A and
B. Keyboard arrows / space / shift work when that MFD is the SOI. NEW, PAUSE, TOP10 on the top row.
Every game has a top-10 leaderboard under your pilot name (Settings → Pilot name).
- **CHESS** vs ARIA — rockers move the cursor, legal moves land on the OSBs; four levels; UNDO.
- **CARGO** — tetris. A rotates, B hard-drops, down soft-drops.
- **RUNNER** — the dino. A/up jumps, down ducks.
- **ROIDS** — asteroids. Left/right turn, up thrusts, A fires, B hyperspace.
- **TANKS** — artillery vs ARIA or a squad mate. Up/down angle, left/right power (hold to sweep), A fires, B arms the nuke.
- **FLEET** — battleship vs ARIA or a squad mate. SHUF reshuffles your ships, READY locks in, d-pad aims, A fires.
More games land one or two per version.

**Squad leaderboards.** One of you hosts: Settings ⚙ → Squad → "Host the squad board on this PC",
restart ARIA once, and give friends the address and key it shows. Friends paste both into their
Settings → Squad → Test. From then on every score posts to the host and every game's TOP10 is the
whole squad, your own entries marked ◀. Same LAN or a VPN (Tailscale, Hamachi) works as is; over
the open internet the host forwards port 8777. The board lives in the host's `scores.json`.

**Squad server on its own box.** A machine that just hosts (a home server, a Pi, a spare PC) doesn't
need the whole app: copy `squad_server.py`, `squad.py` and `VERSION` anywhere Python 3.9+ lives and run
`python squad_server.py --name Thoth` (or double-click `squad_server.bat`). It prints the key on the
first run and keeps it in `squad_config.json`; the board and open lobbies are visible at
`http://<that box>:8777` in any browser. `--systemd` prints a Linux service unit; on Windows, Task
Scheduler → "At startup" → `pythonw squad_server.py`. Everyone, including you, then joins it from
Settings → Squad as usual.

**Versus — GAME → SQUAD.** Play a squad mate on the same host: **CHESS**, **TANKS** (turn-based
artillery: angle, power, wind, craters, one nuke each) and **FLEET** (battleship on a 10×10 grid).
One of you hosts a lobby, the other sees it under SQUAD and joins; the game opens on both MFDs the
moment the second seat fills. Moves travel through the host, so it works wherever the leaderboard
works. Flip the MFD to another page mid-game and the match waits; SQUAD → PLAY replays it back. RESGN
resigns. The winner's score lands on that game's board with "vs NAME". No credits, no wagers, no
IOUs — bragging rights only. TANKS and FLEET also play solo against ARIA from the GAME menu.

The Cougars are detected by their USB id. If the SYS page says NOT FOUND, use SYS → SET L / SET R
(or Settings ⚙ → Set left/right MFD) and press any button on that MFD.

Run Star Citizen **borderless windowed**: exclusive fullscreen minimizes when you click another
screen. When you do click something in ARIA, it hands focus back to the game before sending keys.

## Where the data comes from

| Source | What it gives | Refresh |
|---|---|---|
| UEX Corp API 2.0 (`api.uexcorp.uk`) | Commodity prices & stock per terminal, terminals, ship buy/rent prices, route distances | prices every 30 min, the rest every 6–12 h |
| Star Citizen Wiki API (`api.star-citizen.wiki`) | Ships (game-file stats, images), crafting blueprints, mission sources | daily |

Every response is cached in `cache/`. If a source goes down, ARIA keeps working from the last
copy and the status pills in the top bar turn amber (stale) or red (offline). The ⟳ button
forces a fresh pull.

**UEX token (optional):** the endpoints ARIA uses are public today. If UEX tightens access or
you want a bigger quota, make a free app at uexcorp.space → API → My Apps and paste the token
in Settings ⚙. It is saved to `config.json` next to `server.py`.

## Ships, SCU and custom ships

Every ship box has a dropdown: click it for an A–Z letter strip, or just type. Your hangar ships
come first.

- **Your own SCU:** type a number in Cargo SCU and ARIA remembers it for that ship (marked * in
  the dropdown). Type the listed number again to go back.
- **Missing ship** (new variant, data not caught up): dropdown → **+ Add a ship that's missing**.
  Give it a name, SCU and optionally quantum speed. It works everywhere — dropdowns, hangar chips,
  typed and spoken commands, quantum times.

## How the haul math works

For every commodity, ARIA pairs each terminal that sells it with each terminal that buys it and
loads the smallest of: your hold, what your budget can buy, the terminal's reported stock, and
the destination's reported demand. It ranks by total profit (or profit per GM / ROI), keeps the
list varied, then asks UEX for the travel distance on the top 20.

- **Legal cargo only** is on by default. **Avoid volatile** drops quantum-volatile and explosive cargo.
- **Stay in one system** keeps you out of cross-jump runs.
- **Hide prices older than N days** keeps stale reports out. The Data column shows how old each one is.
- **Next leg ↻** starts the next search from your sell terminal with the profit added to your budget.

Prices are community-reported. Glance at the terminal before you commit a full hold.

## Starmap & navigation

**Job view** (the JOB tab on the map): systems as cards linked by their jump points, with your
route running through them stop by stop — where you buy, where you sell, each quantum hop, each
jump with its fuel. Pick a commodity in the Market overlay to see its price at every stop and in
every system. Click a stop to jump to it on the system map.

Get a job into it three ways:
- **⌖** on any haul in Make Me Rich — that one run.
- **+ Job** on several hauls (or **Next leg ↻**, which adds as it goes) — then **View job on map**.
- **Plot course** in Navigation — opens in Job view whenever the route crosses systems.

**Home base & RTB:** set your spawn point with the **⌂ Home** chip (Navigation panel, the job bar,
or Settings) and change it whenever you move your spawn. Jobs can start at home (**⌂ Start home**)
and finish back there (**RTB**) — both are toggles on the job bar. The **RTB ⌂** button in
Navigation, or typing/saying `rtb`, `return to base` or `take me home`, plots from where your last
job ended back home. The **⌂** button next to "Starting from" in Make Me Rich searches from home.

Routes are the **fastest by time**, not just fewest jumps: when a system has more than one gateway,
ARIA picks whichever gets you there soonest. Jump transit time isn't in the game data, so it's an
estimate (2.5 min, `JUMP_SECS` in index.html).

Type or say `nav from area18 to ruin station`, `take me to daymar`, `how far is port tressler`.
Distances are straight lines between bodies (planets in the way add detours). Quantum time uses
your ship's drive speed from the game files, or a typical 150,000 km/s if unknown — set your own in
the QT km/s box.

## Voice macros (VoiceAttack-style)

1. Voice Macros room → **Set button** → press the key, mouse side button or HOTAS button you want
   for push-to-talk. (Joysticks: first 32 buttons per device.)
2. Tick **Press keys in game**. Leave it off to practise: ARIA says what it *would* press.
3. **Start listening.** Hold your button, say "call ATC", let go.

Keys are sent as hardware scan codes (like VoiceAttack), so the game sees real key presses. They
go to whatever window has focus. If Star Citizen runs as administrator, run start.bat as
administrator too or Windows blocks the presses.

Macro keys: `lctrl+n` together · `b:1.5` hold 1.5 s · `f1; wait 0.5; f2` sequence · `mouse1`.
The starter macros are guesses at default binds — match them to yours. Your profile is saved in
`macros.json`.

**Bind by name:** say or type `bind center turret`. ARIA finds the exact action or the closest
ones (or tells you there's none), shows which key it's on, and makes the voice command. It reads
your own changed binds from the game install automatically. For every action with its default
key and real name, add two files from the game (see `scdata/README.txt`).

## Auto-binding with virtual buttons (vJoy)

Say `bind hail target`. If the action has no key, ARIA gives it a **virtual joystick button**,
writes that into your Star Citizen keybinds and makes the voice command. Your keyboard and HOTAS
are never touched, and it can't type into an open chat box the way keyboard macros can.

One-time setup:
1. Install vJoy (Windows 10/11: github.com/BrunnerInnovation/vJoy).
2. Open **Configure vJoy**, enable device 1, set **Number of Buttons** to 128, Apply.
3. Start Star Citizen once so it registers the new device, then quit.

Voice Macros → Keybinds shows "vJoy ready · Joystick N in game" when it's all set.

How the bind gets in: Star Citizen only reads its keybind file at launch and rewrites it on exit.
- **Game closed:** ARIA backs up the file (to `backups/`) and writes the bind. Live next launch.
- **Game running:** ARIA queues the bind and writes it the moment you quit. Live next launch.

So the best habit is binding what you want before a session. Actions that already have a key can
also be moved to a virtual button ("Use virtual button") so voice never sends keyboard presses.
No vJoy? ARIA offers a spare keyboard combo instead (needs the game files in `scdata/`).

To undo a bind, copy a file from `backups/` back over `actionmaps.xml` with the game closed.

Voice recognition uses the browser's speech service (Edge or Chrome), which sends audio to that
service while you hold the button. A fully local option (speech-to-text on your own machine) is the
natural next upgrade.

## Your own ARIA voice (voice pack)

Voice Macros → **Export voice lines** gives you every line ARIA says with the file name for it.
Render them in ComfyUI with your cloned voice, drop them in `web/voice/`, done — see
`web/voice/README.txt`. Lines with live numbers (hauls, distances) still use the browser voice
unless you pick "Voice pack only".

## Rename it

Settings ⚙ → Name. "MAX" changes the header and the wake word.

## Your saved stuff

Hangar, owned blueprints and the fabrication queue live in your browser. Settings ⚙ → Export
backup to save them or move them to another PC.

## Files

```
server.py        local server: serves the page, proxies + caches the APIs, macros, push-to-talk
launcher.pyw     what the desktop shortcut runs: update check, then start (no console)
install.bat      one-time install: Python if needed, copy to %LOCALAPPDATA%\ARIA, shortcuts
updater.py       self-update from your GitHub repo
mfd.py           Thrustmaster Cougar MFD buttons
winsys.py        monitors, window placement, hand focus back to the game
keys.py          key presses for macros (Windows SendInput, scan codes)
ptt.py           push-to-talk watcher (keyboard, mouse, joystick/HOTAS)
vjoy.py          virtual joystick buttons (vJoy driver)
scbinds.py       reads Star Citizen keybinds
web/index.html   the whole app (HTML, CSS, JS in one file)
web/voice/       your voice pack clips
scdata/          optional game files for the full keybind list
cache/           saved API responses (safe to delete)
backups/         copies of your keybind file from before each ARIA bind
macros.json      your voice macro profile (created when you save)
config.json      UEX token, push-to-talk button, game folder, vJoy number, queued binds
browser-profile/ the app window's own browser profile (mic permission lives here)
VERSION          current version (the updater compares this with the repo)
update.json      default update repo/branch (Settings overrides it)
aria.ico         shortcut icon
start.bat        run from the folder without installing
start.sh         Mac/Linux launcher (data rooms only; keys and push-to-talk need Windows)
```

Fan-made tool. Not affiliated with Cloud Imperium Games. Data © UEX Corp and the Star Citizen Wiki contributors.
