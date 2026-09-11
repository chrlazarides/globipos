# GlobiPOS Terminal — Windows Build & Setup Guide

This guide walks you through building the Tauri POS app on Windows and connecting it to your GlobiPOS server.

---

## Prerequisites

Install these tools **once** on the Windows machine:

| Tool | Download |
|------|----------|
| **Node.js 20 LTS** | https://nodejs.org |
| **Rust (stable)** | https://rustup.rs — run `rustup-init.exe`, choose default |
| **WebView2 Runtime** | Usually pre-installed on Windows 10/11. If missing: https://developer.microsoft.com/en-us/microsoft-edge/webview2/ |
| **Visual Studio Build Tools** | https://aka.ms/vs/17/release/vs_BuildTools.exe — install **"Desktop development with C++"** workload |

> **After installing Rust**, open a new terminal and run:
> ```
> rustup target add x86_64-pc-windows-msvc
> ```

---

## Step 1: Get the Code

Clone or copy the `pos-app` folder from the GlobiPOS repo to your Windows machine.

```
git clone <your-repo-url>
cd pos-app
```

Or copy just the `pos-app` directory to the Windows machine via USB/network share.

---

## Step 2: Install Node Dependencies

```cmd
cd pos-app
npm install
```

---

## Step 3: Build the Windows Installer

```cmd
npm run tauri build
```

> First build takes **10–20 minutes** — Rust compiles everything from scratch.  
> Subsequent builds take ~2 minutes.

The installer will be at:
```
pos-app\src-tauri\target\release\bundle\msi\GlobiPOS Terminal_1.0.0_x64_en-US.msi
```

Or the portable `.exe`:
```
pos-app\src-tauri\target\release\globipos-terminal.exe
```

---

## Step 4: Run the Seed Script (on the server)

Before connecting the terminal, run the supermarket test data seed on the server machine:

```bash
node supermarket-test-seed.mjs
```

This creates:
- Location: **Fresh Market Supermarket** (code: `MKTMAIN`)
- Terminal: **Checkout 1** (code: **T001**)
- 10 product categories + 45 products with barcodes
- 4 cashiers with PINs

---

## Step 5: Find Your Server IP Address

On the server machine, run:

- **Linux/Mac**: `ip addr` or `hostname -I`
- **Windows**: `ipconfig`

Note the local IP (e.g. `192.168.1.50`). Both the server and the Windows POS terminal **must be on the same network**.

Make sure GlobiPOS server is running on port **5000**.

---

## Step 6: First Launch — Terminal Setup

1. Double-click the `.exe` or run the installed app.
2. The **Terminal Setup** screen appears.
3. Enter:
   - **Server URL**: `http://192.168.1.50:5000` *(replace with your server IP)*
   - **Terminal Code**: `T001`
4. Click **Register Terminal**.
5. The app downloads the catalog, layout, and cashier PINs automatically.

---

## Step 7: Login with a Cashier PIN

After setup, the PIN pad appears.

| Cashier | Role | PIN |
|---------|------|-----|
| Maria Georgiou | Manager | **1234** |
| Yiannis Petrou | Supervisor | **2222** |
| Andreas Nicolaou | Cashier | **3333** |
| Eleni Stavrou | Cashier | **4444** |

Enter any 4-digit PIN — the POS loads immediately.

---

## Step 8: Test a Sale

1. Browse categories or tap a product button.
2. Tap items to add them to the order ticket on the right.
3. Tap **Pay Cash** or **Pay Card** to complete the sale.
4. The receipt can be printed (if a receipt printer is configured).

---

## Running in Dev Mode (no installer needed)

If you just want to test without building an installer:

```cmd
cd pos-app
npm run tauri dev
```

The app opens in a window connected to `http://localhost:1420` (Vite dev server).  
Change `devUrl` in `src-tauri/tauri.conf.json` if your Vite port differs.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `Terminal 'T001' not found` | Run the seed script first; check server is reachable |
| `Network error` on setup | Check server IP, firewall allows port 5000, same Wi-Fi/LAN |
| Build fails — `link.exe not found` | Install Visual Studio Build Tools (C++ workload) |
| Build fails — `WebView2 not found` | Install WebView2 Runtime from Microsoft |
| White screen on launch | Check that server is running; Tauri opens a WebView |
| PIN not accepted | Cashiers must be created on server and synced during registration |

---

## Adding More Terminals

1. In GlobiPOS Admin → **POS → Terminals**, create a new terminal (e.g. `T002`).
2. Assign it to the `MKTMAIN` location and the `Supermarket Standard` layout.
3. On the second Windows machine, enter the same server URL but use code `T002`.

---

## Updating the App

When the server-side catalog, prices, or promotions change, the terminal syncs automatically every 5 minutes while online. You can also trigger a manual sync from the POS header bar.
