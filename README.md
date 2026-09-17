# Nexus Share / XferFlow

A fully peer-to-peer (P2P), browser-based file sharing application that utilizes WebRTC for direct data transfer and end-to-end encryption. The project consists of a modern Vite/TypeScript frontend and a lightweight PHP backend acting as a polling-based signaling server.

## Features

- **Peer-to-Peer Transfer**: Files are sent directly between browsers using WebRTC Data Channels. They do not pass through or sit on any central server.
- **End-to-End Encryption**: Leverages Web Crypto API (`crypto.ts`) to ensure payloads remain secure during transit.
- **Radar & Discovery**: Uses a built-in radar system (`api.php` radar endpoints) to easily discover other devices on the same network or session.
- **OTP-based Pairing**: Generate one-time passcodes (OTP) for secure out-of-band session handshakes.
- **Lightweight Backend**: A single `api.php` file manages signaling via JSON-based file polling, requiring zero WebSockets or complex database infrastructure. Ideal for shared hosting environments (like InfinityFree).

## Architecture

1. **Signaling Server (`api.php`)**
   - Handles `radar-join`, `radar-leave`, and `radar` updates to show active peers.
   - Handles `generate-otp` and `claim-otp` to securely link two peers.
   - Manages asynchronous SDP (Session Description Protocol) offer/answer exchanges and ICE candidates through a basic HTTP polling loop.

2. **Frontend (`/frontend`)**
   - Built with **Vite** and **TypeScript**.
   - `webrtc.ts`: Manages the RTCPeerConnection and RTCDataChannel lifecycle.
   - `crypto.ts`: Encrypts file chunks before transmission and decrypts them upon receipt.
   - Includes a Service Worker (`sw.js`) and Web Manifest (`manifest.json`) for potential PWA capabilities.

## Setup & Installation

### Backend
1. Deploy the root directory (`api.php`, `sessions/`) to any PHP 7.4+ capable web server.
2. Ensure the `sessions/` directory is writable by the web server (permissions `0777` or equivalent), as the server writes `.jsonl` files to manage active signals.

### Frontend
1. Navigate to the `frontend/` directory.
   ```bash
   cd frontend
   npm install
   ```
2. Start the development server:
   ```bash
   npm run dev
   ```
3. Build for production:
   ```bash
   npm run build
   ```
   *The built assets can then be hosted statically alongside the `api.php` file.*

## License

Proprietary. All rights reserved.
