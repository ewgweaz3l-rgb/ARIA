"""
ARIA desktop launcher — what the desktop shortcut runs (pythonw: no console window).

1. Checks GitHub for a newer ARIA and installs it (your settings and data are kept).
2. Starts ARIA and opens it on your chosen screen.
If ARIA is already running, it just brings up the window.
Log: aria.log next to this file.
"""
import os
import socket
import subprocess
import sys
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)
sys.path.insert(0, ROOT)
_log = open(os.path.join(ROOT, "aria.log"), "a", encoding="utf-8", buffering=1)
sys.stdout = sys.stderr = _log
print(f"\n--- ARIA launcher {time.strftime('%Y-%m-%d %H:%M:%S')} ---")

args = sys.argv[1:]
wait_pid = int(args[args.index("--wait-pid") + 1]) if "--wait-pid" in args else None
no_window = "--no-window" in args
PORT = 8777


def port_busy():
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex(("127.0.0.1", PORT)) == 0


# an in-app "Update & restart" hands over here: wait for the old ARIA to close
if wait_pid:
    for _ in range(100):
        if not port_busy():
            break
        time.sleep(0.1)

if port_busy():
    import server
    server.open_app_window(f"http://localhost:{PORT}/")
    sys.exit(0)


def update_with_window(info):
    """Show a small progress window while the update installs."""
    import updater
    try:
        import tkinter as tk
        from tkinter import ttk
    except Exception:
        tk = None
    if not tk:
        updater.apply()
        return
    root = tk.Tk()
    root.title("ARIA")
    root.configure(bg="#06090f")
    root.geometry("380x120")
    root.resizable(False, False)
    tk.Label(root, text=f"Updating ARIA  {info['current']} → {info['latest']}", fg="#f2a83b", bg="#06090f",
             font=("Segoe UI", 12, "bold")).pack(pady=(18, 6))
    msg = tk.Label(root, text="Starting…", fg="#8394ab", bg="#06090f", font=("Segoe UI", 10))
    msg.pack()
    bar = ttk.Progressbar(root, mode="indeterminate", length=300)
    bar.pack(pady=10)
    bar.start(12)
    result = {}

    def work():
        try:
            updater.apply(progress=lambda m: msg.config(text=m))
        except Exception as e:
            result["error"] = e
        root.after(0, root.destroy)

    import threading
    threading.Thread(target=work, daemon=True).start()
    root.mainloop()
    if result.get("error"):
        print("update failed:", result["error"])


try:
    import updater
    info = updater.check()
    print("update check:", info)
    if info.get("available"):
        update_with_window(info)
        # start fresh so the new code is the code that runs
        subprocess.Popen([sys.executable, os.path.join(ROOT, "launcher.pyw")] + (["--no-window"] if no_window else []), cwd=ROOT)
        sys.exit(0)
except SystemExit:
    raise
except Exception as e:
    print("update check failed:", e)

import server  # noqa: E402  (after updating, so new code loads)

server.main(["--no-browser"] if no_window else [])
