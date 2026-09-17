import './style.css';
import { connectToSignaling, getDataChannel, sendSignal, localClientId } from './webrtc.ts';
import { encryptChunk } from './crypto.ts';
import { startRadar, stopRadar, type RadarPeer } from './radar.ts';

// Session ID for signaling (4-digit code as requested)
export const mySessionId = Math.floor(1000 + Math.random() * 9000).toString();
export const myDeviceName = 'XferFlow User';


const CHUNK_SIZE = 64 * 1024; // 64KB (Maximum safe size for all browsers)

let pendingFiles: { file: File; relativePath: string }[] = [];
let currentRole: 'send' | 'receive' | null = null;
let targetPeerId: string | null = null;
let requestPollInterval: ReturnType<typeof setInterval> | null = null;
let lastMsgId = '';

document.addEventListener('DOMContentLoaded', () => {
    // --- All views ---
    const viewLanding = document.getElementById('view-landing')!;
    const appWrapper = document.getElementById('app-wrapper')!;
    const viewHome = document.getElementById('view-home')!;
    const viewFileSelect = document.getElementById('view-file-select')!;
    const viewMethod = document.getElementById('view-method')!;
    const viewOtp = document.getElementById('view-otp')!;
    const viewTransfer = document.getElementById('view-transfer')!;
    const viewRadar = document.getElementById('view-radar')!;
    const allAppViews = [viewHome, viewFileSelect, viewMethod, viewOtp, viewTransfer, viewRadar];

    // --- Buttons ---
    const btnNavLaunch = document.getElementById('btn-nav-launch')!;
    const btnHeroLaunch = document.getElementById('btn-hero-launch')!;
    const btnRoleSend = document.getElementById('btn-role-send')!;
    const btnRoleReceive = document.getElementById('btn-role-receive')!;
    const btnSelectFile = document.getElementById('btn-select-file')!;
    const btnSelectFolder = document.getElementById('btn-select-folder')!;
    const btnCancelSend = document.getElementById('btn-cancel-send')!;
    const btnNextMethod = document.getElementById('btn-next-method')!;
    const btnMethodRadar = document.getElementById('btn-method-radar')!;
    const btnMethodOtp = document.getElementById('btn-method-otp')!;
    const btnBackMethod = document.getElementById('btn-back-method')!;
    const btnCancelRadar = document.getElementById('btn-cancel-radar')!;
    const btnCancelOtp = document.getElementById('btn-cancel-otp')!;
    const btnConnectOtp = document.getElementById('btn-connect-otp') as HTMLButtonElement;
    const btnAccept = document.getElementById('btn-accept')!;
    const btnDecline = document.getElementById('btn-decline')!;
    const btnTransferDone = document.getElementById('btn-transfer-done')!;

    // --- Other DOM ---
    const fileDropArea = document.getElementById('file-drop-area')!;
    const fileInput = document.getElementById('file-input') as HTMLInputElement;
    const folderInput = document.getElementById('folder-input') as HTMLInputElement;
    const selectedFilesList = document.getElementById('selected-files-list')!;

    const otpStatus = document.getElementById('otp-status')!;
    const otpSenderView = document.getElementById('otp-sender-view')!;
    const otpReceiverView = document.getElementById('otp-receiver-view')!;
    const otpDisplay = document.getElementById('otp-display')!;
    const otpInput = document.getElementById('otp-input') as HTMLInputElement;

    const radarHeading = document.getElementById('radar-heading')!;
    const radarStatus = document.getElementById('radar-status')!;
    const radarPeersContainer = document.getElementById('radar-peers-container')!;

    const permissionModal = document.getElementById('permission-modal')!;
    const permissionText = document.getElementById('permission-text')!;
    const transferFilename = document.getElementById('transfer-filename')!;
    const transferPercentage = document.getElementById('transfer-percentage')!;
    const progressRingCircle = document.getElementById('progress-ring-circle') as unknown as SVGCircleElement;
    const transferSpeed = document.getElementById('transfer-speed')!;
    const transferEta = document.getElementById('transfer-eta')!;

    const circumference = 2 * Math.PI * 60;

    // --- Helpers ---
    function switchView(view: HTMLElement) {
        allAppViews.forEach(v => v.classList.add('hidden'));
        view.classList.remove('hidden');
    }

    function launchApp() {
        viewLanding.classList.add('hidden');
        appWrapper.classList.remove('hidden');
        switchView(viewHome);
    }

    let isDataChannelOpen = false;
    let isSecureChannelEstablished = false;
    let isTransferring = false;

    function cleanup() {
        stopRadar();
        if (requestPollInterval) {
            clearInterval(requestPollInterval);
            requestPollInterval = null;
        } lastMsgId = '';
        isDataChannelOpen = false;
        isSecureChannelEstablished = false;
        isTransferring = false;
    }

    // ==========================================
    // VIEW 0: LANDING
    // ==========================================
    btnNavLaunch.addEventListener('click', launchApp);
    btnHeroLaunch.addEventListener('click', launchApp);

    // ==========================================
    // VIEW 1: HOME
    // ==========================================
    btnRoleSend.addEventListener('click', () => {
        currentRole = 'send';
        pendingFiles = [];
        updateSelectedFilesUI();
        switchView(viewFileSelect);
    });

    btnRoleReceive.addEventListener('click', () => {
        currentRole = 'receive';
        cleanup();
        switchView(viewMethod);
    });

    // ==========================================
    // VIEW 2: FILE SELECTION (SENDER)
    // ==========================================
    btnSelectFile.addEventListener('click', () => fileInput.click());
    btnSelectFolder.addEventListener('click', () => folderInput.click());
    btnCancelSend.addEventListener('click', () => { cleanup(); switchView(viewHome); });

    function addFiles(files: FileList) {
        Array.from(files).forEach((file: File) => {
            pendingFiles.push({ file, relativePath: (file as any).webkitRelativePath || file.name });
        });
        updateSelectedFilesUI();
    }

    fileInput.addEventListener('change', (e: Event) => { const t = e.target as HTMLInputElement; if (t.files) addFiles(t.files); });
    folderInput.addEventListener('change', (e: Event) => { const t = e.target as HTMLInputElement; if (t.files) addFiles(t.files); });

    function updateSelectedFilesUI() {
        if (pendingFiles.length === 0) {
            selectedFilesList.textContent = '';
            btnNextMethod.classList.add('hidden');
        } else {
            const mb = (pendingFiles.reduce((a, f) => a + f.file.size, 0) / (1024 * 1024)).toFixed(2);
            selectedFilesList.textContent = `${pendingFiles.length} file(s) selected (${mb} MB)`;
            btnNextMethod.classList.remove('hidden');
        }
    }

    // Drag and drop
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(n => fileDropArea.addEventListener(n, e => { e.preventDefault(); e.stopPropagation(); }, false));
    ['dragenter', 'dragover'].forEach(n => fileDropArea.addEventListener(n, () => fileDropArea.classList.add('dragover'), false));
    ['dragleave', 'drop'].forEach(n => fileDropArea.addEventListener(n, () => fileDropArea.classList.remove('dragover'), false));
    fileDropArea.addEventListener('drop', async (e: DragEvent) => {
        if (!e.dataTransfer) return;
        for (let i = 0; i < e.dataTransfer.items.length; i++) {
            const item = e.dataTransfer.items[i];
            if (item.kind === 'file') {
                const entry = item.webkitGetAsEntry?.();
                if (entry) await traverseFileTree(entry, '');
                else { const f = item.getAsFile(); if (f) pendingFiles.push({ file: f, relativePath: f.name }); }
            }
        }
        updateSelectedFilesUI();
    });

    async function traverseFileTree(item: any, path: string): Promise<void> {
        return new Promise(resolve => {
            if (item.isFile) {
                item.file((file: File) => { pendingFiles.push({ file, relativePath: path + file.name }); updateSelectedFilesUI(); resolve(); });
            } else if (item.isDirectory) {
                const dirReader = item.createReader();
                const readAllEntries = () => {
                    dirReader.readEntries(async (entries: any[]) => {
                        if (entries.length === 0) {
                            resolve();
                        } else {
                            for (const entry of entries) await traverseFileTree(entry, path + item.name + '/');
                            readAllEntries(); // Loop to get >100 files
                        }
                    });
                };
                readAllEntries();
            } else resolve();
        });
    }

    // Next → choose method
    btnNextMethod.addEventListener('click', () => switchView(viewMethod));

    // ==========================================
    // VIEW 3: CHOOSE METHOD
    // ==========================================
    btnBackMethod.addEventListener('click', () => {
        if (currentRole === 'send') switchView(viewFileSelect);
        else switchView(viewHome);
    });


    btnMethodRadar.addEventListener('click', () => {
        startRadarFlow();
    });

    // --- OTP Web Code ---
    btnMethodOtp.addEventListener('click', () => {
        startOtpFlow();
    });

    // ==========================================
    // RADAR FLOW (Local Network)
    // ==========================================
    function startRadarFlow() {
        cleanup();
        switchView(viewRadar);

        if (currentRole === 'send') {
            radarHeading.textContent = 'Scanning for Receivers';
            radarStatus.textContent = 'Looking for people on your Wi-Fi...';
            startListeningForRequests(mySessionId);
        } else {
            radarHeading.textContent = 'Scanning for Senders';
            radarStatus.textContent = 'Looking for people on your Wi-Fi...';
        }

        radarPeersContainer.innerHTML = '';

        startRadar(mySessionId, myDeviceName, (peers: RadarPeer[]) => {
            radarPeersContainer.innerHTML = '';
            if (peers.length === 0) {
                radarPeersContainer.innerHTML = '<p style="color:var(--text-secondary)">No one found yet...</p>';
            }
            peers.forEach(peer => {
                const initial = peer.deviceName ? peer.deviceName.charAt(0).toUpperCase() : '?';
                const btn = document.createElement('div');
                btn.className = 'peer-card';
                btn.innerHTML = `
                    <div class="peer-avatar">${initial}</div>
                `;
                btn.title = peer.deviceName; // Add a tooltip with the name instead
                btn.onclick = () => {
                    targetPeerId = peer.radarId;
                    radarStatus.textContent = 'Connecting...';
                    stopRadar();

                    if (currentRole === 'receive') {
                        // Request transfer from sender
                        sendSignal(targetPeerId, { type: 'request-transfer', sessionId: mySessionId }, localClientId);
                    } else {
                        // Sender initiating directly to receiver
                        alert("Please wait for the receiver to request the transfer.");
                    }
                };
                radarPeersContainer.appendChild(btn);
            });
        });
    }

    btnCancelRadar.addEventListener('click', () => {
        cleanup();
        switchView(viewMethod);
    });

    // ==========================================
    // VIEW 4c: OTP FLOW (WEB CODE)
    // ==========================================
    async function startOtpFlow() {
        cleanup();
        switchView(viewOtp);

        if (currentRole === 'send') {
            otpSenderView.classList.remove('hidden');
            otpReceiverView.classList.add('hidden');
            otpDisplay.textContent = '....';

            try {
                const res = await fetch('/api.php', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type: 'generate-otp', sessionId: mySessionId })
                });
                const data = await res.json();
                if (data.otp) {
                    otpDisplay.textContent = data.otp;
                    startListeningForRequests(mySessionId);
                } else {
                    otpStatus.textContent = 'Error generating code.';
                }
            } catch {
                otpStatus.textContent = 'Network error generating code.';
            }
        } else {
            otpSenderView.classList.add('hidden');
            otpReceiverView.classList.remove('hidden');
            otpInput.value = '';
            otpInput.focus();
        }
    }

    btnConnectOtp.addEventListener('click', async () => {
        const code = otpInput.value.trim();
        if (code.length !== 4) {
            otpStatus.textContent = 'Please enter a 4-digit code.';
            return;
        }

        btnConnectOtp.disabled = true;
        btnConnectOtp.textContent = 'Connecting...';

        try {
            const res = await fetch('/api.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'claim-otp', code })
            });
            const data = await res.json();
            if (data.status === 'ok') {
                otpStatus.textContent = 'Code verified! Connecting to sender...';
                targetPeerId = data.sessionId;
                if (!targetPeerId) return;
                // Send a real transfer request signal to the sender's session
                await sendSignal(targetPeerId, {
                    type: 'request-transfer',
                    deviceName: myDeviceName,
                    filesCount: '',
                    totalSize: '',
                    senderRadarId: mySessionId
                }, localClientId);
                // Start listening on the SENDER's session for the accept-transfer response
                startListeningForRequests(targetPeerId);
            } else {
                otpStatus.textContent = data.error || 'Invalid or expired code.';
                btnConnectOtp.disabled = false;
                btnConnectOtp.textContent = 'Connect securely →';
            }
        } catch {
            otpStatus.textContent = 'Network error verifying code.';
            btnConnectOtp.disabled = false;
            btnConnectOtp.textContent = 'Connect securely →';
        }
    });

    btnCancelOtp.addEventListener('click', () => { cleanup(); switchView(viewMethod); });

    // ==========================================
    // SIGNALING: TRANSFER REQUEST/ACCEPT/REJECT
    // ==========================================

    function startListeningForRequests(listenId: string) {
        if (requestPollInterval) clearInterval(requestPollInterval);
        requestPollInterval = setInterval(async () => {
            try {
                const res = await fetch(`/api.php?action=poll&sessionId=${listenId}&lastMsgId=${lastMsgId}`, { cache: 'no-store' });
                const data = await res.json();
                if (data.messages) {
                    for (const msg of data.messages) {
                        lastMsgId = msg.msgId;
                        if (msg.clientId === localClientId) continue;

                        if (msg.type === 'request-transfer' && currentRole === 'receive') {
                            handleIncomingRequest(msg, msg.senderRadarId || msg.clientId);
                        } else if (msg.type === 'request-transfer' && currentRole === 'send') {
                            // OTP flow: A receiver has joined via web code. Auto-accept since sender already chose files.
                            targetPeerId = msg.senderRadarId || msg.clientId;
                            cleanup();
                            switchView(viewTransfer);
                            // Tell the receiver we accepted
                            await sendSignal(listenId, { type: 'accept-transfer', sessionId: listenId }, localClientId);
                            // Sender initiates the WebRTC connection
                            connectToSignaling(listenId, true, updateStatus, updateProgress);
                        } else if (msg.type === 'accept-transfer' && currentRole === 'send') {
                            handleAcceptance(msg.sessionId || targetPeerId!);
                        } else if (msg.type === 'accept-transfer' && currentRole === 'receive') {
                            // OTP flow: The sender accepted. Receiver joins the WebRTC connection.
                            cleanup();
                            switchView(viewTransfer);
                            connectToSignaling(msg.sessionId || listenId, false, updateStatus, updateProgress);
                        } else if (msg.type === 'reject-transfer' && currentRole === 'send') {
                            alert('Transfer declined by receiver.');
                        }
                    }
                }
            } catch (e) {
                console.error('Polling error', e);
            }
        }, 1000);
    }

    function handleIncomingRequest(msg: any, senderRadarId: string) {
        targetPeerId = senderRadarId;
        const sizeInfo = msg.totalSize ? ` (${msg.totalSize} MB)` : '';
        permissionText.textContent = `${msg.deviceName || 'A device'} wants to share ${msg.filesCount || ''} file(s)${sizeInfo}.`;
        permissionModal.classList.remove('hidden');
    }

    function handleAcceptance(roomId: string) {
        cleanup();
        switchView(viewTransfer);
        connectToSignaling(roomId, true, updateStatus, updateProgress);
    }

    // ==========================================
    // PERMISSION MODAL
    // ==========================================
    btnAccept.addEventListener('click', async () => {
        permissionModal.classList.add('hidden');
        cleanup();
        switchView(viewTransfer);
        await sendSignal(targetPeerId!, { type: 'accept-transfer', sessionId: targetPeerId }, localClientId);
        connectToSignaling(targetPeerId!, false, updateStatus, updateProgress);
    });

    btnDecline.addEventListener('click', async () => {
        permissionModal.classList.add('hidden');
        await sendSignal(targetPeerId!, { type: 'reject-transfer' }, localClientId);
    });

    // ==========================================
    // WEBRTC CALLBACKS
    // ==========================================
    function updateStatus(msg: string) {
        const heading = document.getElementById('transfer-heading');

        if (msg === 'Connected and ready') isDataChannelOpen = true;
        if (msg === 'Secure channel established') isSecureChannelEstablished = true;

        if (isDataChannelOpen && isSecureChannelEstablished && !isTransferring) {
            isTransferring = true;
            if (heading) heading.textContent = 'Transferring';
            if (currentRole === 'send' && pendingFiles.length > 0) processTransferQueue();
            else if (currentRole === 'receive') transferFilename.textContent = 'Waiting for files...';
        } else if (msg === 'Transfer complete!') {
            if (heading) heading.textContent = 'The transferring is done! 🎉';
            transferFilename.innerHTML = `<strong>That was blazing fast!</strong><br/>No servers, no tracking, pure peer-to-peer.<br/><span style="color:var(--primary);font-weight:600;margin-top:0.5rem;display:inline-block">Bookmark XferFlow for your next unlimited transfer!</span>`;
            btnTransferDone.classList.remove('hidden');
            btnTransferDone.textContent = "Transfer More Files 🚀";
        } else if (msg.startsWith('Receiving:')) {
            transferFilename.textContent = msg;
        }
    }

    btnTransferDone.addEventListener('click', () => {
        btnTransferDone.classList.add('hidden');
        cleanup();
        switchView(viewHome);
    });

    function updateProgress(pct: number, speedMBps: number, eta: string) {
        transferPercentage.textContent = `${pct}%`;
        progressRingCircle.style.strokeDashoffset = String(circumference - (pct / 100) * circumference);
        transferSpeed.textContent = speedMBps > 0 ? `${speedMBps.toFixed(2)} MB/s` : '';
        transferEta.textContent = eta ? `ETA: ${eta}` : '';
    }

    // ==========================================
    // FILE STREAMING
    // ==========================================
    async function processTransferQueue() {
        const ch = getDataChannel();
        if (!ch || ch.readyState !== 'open') { transferFilename.textContent = 'Error: Connection not ready.'; return; }

        while (pendingFiles.length > 0) {
            const item = pendingFiles.shift()!;
            const file = item.file;
            transferFilename.textContent = item.relativePath;
            updateProgress(0, 0, '--:--');

            // Metadata packet (type=0)
            const meta = JSON.stringify({ name: file.name, size: file.size, type: file.type, relativePath: item.relativePath });
            const encMeta = await encryptChunk(new TextEncoder().encode(meta));
            const mp = new Uint8Array(1 + encMeta.byteLength); mp[0] = 0; mp.set(new Uint8Array(encMeta), 1);
            ch.send(mp);

            // Data packets (type=1)
            let offset = 0, lastT = Date.now(), lastB = 0;
            while (offset < file.size) {
                const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
                const enc = await encryptChunk(new Uint8Array(buf));
                const dp = new Uint8Array(1 + enc.byteLength); dp[0] = 1; dp.set(new Uint8Array(enc), 1);

                // Increase buffer threshold to 1MB (1048576 bytes) for faster throughput without crashing older phones
                while (ch.bufferedAmount > 1048576) {
                    if (ch.readyState !== 'open') throw new Error('Connection closed prematurely');
                    await new Promise<void>(r => setTimeout(r, 10));
                }
                if (ch.readyState !== 'open') throw new Error('Connection closed prematurely');
                ch.send(dp);
                offset += buf.byteLength;

                const now = Date.now();
                if (now - lastT > 500) {
                    const transmitted = offset - ch.bufferedAmount;
                    const spd = ((transmitted - lastB) / ((now - lastT) / 1000)) / (1024 * 1024);
                    let eta = '--:--';
                    if (spd > 0) { const s = Math.round((file.size - transmitted) / (spd * 1024 * 1024)); eta = `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`; }
                    updateProgress(Math.floor((transmitted / file.size) * 100), spd, eta);
                    lastT = now; lastB = transmitted;
                }
            }
            ch.send(new Uint8Array([2])); // EOF
            updateProgress(100, 0, '0:00');
        }
        transferFilename.textContent = 'All transfers complete!';
        updateStatus('Transfer complete!');
    }
});
