<div align="center">
  <img src="frontend/public/favicon.svg" alt="Nexus Share Logo" width="120" />

  # ⚡️ Nexus Share 
  
  **Blazing-fast, peer-to-peer file sharing right from your browser.**

  [![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Vite](https://img.shields.io/badge/Vite-B73BFE?style=for-the-badge&logo=vite&logoColor=FFD62E)](https://vitejs.dev/)
  [![WebRTC](https://img.shields.io/badge/WebRTC-333333?style=for-the-badge&logo=webrtc&logoColor=white)](https://webrtc.org/)
  [![PHP](https://img.shields.io/badge/PHP-777BB4?style=for-the-badge&logo=php&logoColor=white)](https://php.net/)

  <i>Secure. Limitless. Effortless.</i>
</div>

---

## 🚀 Why Nexus Share?

Forget clunky cloud drives and artificial file limits. **Nexus Share** connects devices directly using **WebRTC Data Channels**, ensuring that your files go exactly where they need to—without ever touching a middleman server. 

Whether you're sharing gigabytes of video or a single sensitive document, Nexus Share keeps it completely peer-to-peer and mathematically secure.

## ✨ Supercharged Features

- 🔗 **True Peer-to-Peer**: Direct device-to-device transfers. No servers, no storage limits, no bottlenecks.
- 🔒 **End-to-End Encrypted**: Files are sealed using the powerful Web Crypto API (`crypto.ts`) before they even leave your browser. 
- 📡 **Local Radar**: Instantly discover other devices on the same network using our intuitive Radar system.
- 🔑 **Secure OTP Handshakes**: Connecting across the internet? Generate a unique code to securely pair devices anywhere on the globe.
- 🛠 **Zero-Config Backend**: Powered by a hyper-lightweight PHP polling architecture (`api.php`). No websockets, no databases—just drop it into any shared hosting environment and you're live.

---

## 🏗 System Architecture

Nexus Share is beautifully split into a lightning-fast modern frontend and a rock-solid, minimalist backend.

### 🎨 The Frontend (`/frontend`)
Crafted with **Vite** and **TypeScript** for an ultra-fast developer experience.
- **`webrtc.ts`**: The engine. Handles the complex NAT-traversal and RTCPeerConnection magic.
- **`crypto.ts`**: The vault. Ensures absolute privacy with chunk-based encryption.
- **PWA Ready**: Equipped with a Service Worker (`sw.js`) and web manifest.

### ⚙️ The Backend
A singular, incredibly efficient `api.php` file acts as the ultimate traffic controller.
- Facilitates the initial SDP Offer/Answer and ICE candidate exchanges.
- Powers the Radar system to broadcast local presences.
- Manages secure OTP generation for global pairing.

---

## 🚦 Get Up and Running

Ready to host your own file-sharing nexus? It only takes a minute.

### 1️⃣ The Backend
Got shared hosting? You're already done.
- Upload `api.php` and the `sessions/` folder to your PHP 7.4+ web server.
- **Crucial:** Make sure the `sessions/` directory is writable (`chmod 777`).

### 2️⃣ The Frontend
1. Dive into the frontend folder:
   ```bash
   cd frontend
   npm install
   ```
2. Start the Vite dev server to see it in action:
   ```bash
   npm run dev
   ```
3. When you're ready for production:
   ```bash
   npm run build
   ```
   *Simply host the generated static assets on any CDN, Vercel, Netlify, or alongside your PHP backend!*

---

<div align="center">
  <b>Built for a faster, decentralized web.</b> <br>
  <i>Proprietary software. All rights reserved.</i>
</div>
