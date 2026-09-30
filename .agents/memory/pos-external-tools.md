---
name: POS external launch boundary
description: Separate web-frame and registered-app links from dangerous arbitrary server process execution.
---

Only send external destinations to POS devices when both the function setup and the exact target have separate approval and the button is assigned to that device's layout. A server-hosted tool needs a reachable web interface for embedding; a native app link relies on a device-installed URI handler and opens outside the journal. Do not treat a URL configuration as permission to run arbitrary server or device commands.

**Why:** A routine edit to an approved function must not silently approve a new URL or app handler. Web POS clients cannot launch arbitrary local executables, and letting terminal requests name server commands would turn a layout button into remote code execution.

**How to apply:** Recheck exact target approval at the server boundary and when the Terminal initiates a launch; changing or cloning a destination requires fresh target approval. When adding more external integration types, keep server-side allowlisting and stronger execution authentication separate from the general button settings and terminal layout sync.