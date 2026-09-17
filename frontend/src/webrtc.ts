import { generateKeyPair, getPublicKeyJwk, deriveSharedKey, decryptChunk } from './crypto.ts';
import { createOPFSWriter, downloadFromOPFS } from './fileSystem.ts';

const SIGNALING_URL = '/api.php';
let peerConnection: RTCPeerConnection;
let dataChannel: RTCDataChannel;
export let sessionId: string;
let fileWriter: FileSystemWritableFileStream | null = null;
let memoryBuffer: ArrayBuffer[] = [];
let useMemoryFallback = false;
let writeQueue: Promise<void> = Promise.resolve();
let currentMetadata: { name: string, size: number, relativePath?: string } | null = null;
let receivedBytes = 0;
let pollInterval: any = null;
let lastMsgId = '';
export const localClientId = Math.random().toString(36).substring(2, 10);
let webrtcConnected = false;
let secureChannelEstablished = false;

function checkAndStopPolling() {
    if (webrtcConnected && secureChannelEstablished) {
        if (pollInterval) {
            clearInterval(pollInterval);
            pollInterval = null;
        }
    }
}

const configuration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};

window.addEventListener('beforeunload', () => {
    if (sessionId) {
        navigator.sendBeacon(SIGNALING_URL, JSON.stringify({ type: 'leave', sessionId, clientId: localClientId }));
    }
});

export async function sendSignal(sessionId: string, message: any, clientId = localClientId) {
    message.clientId = clientId;
    try {
        await fetch(SIGNALING_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...message, sessionId }),
            cache: 'no-store'
        });
    } catch (e) {
        console.error("Signal send error", e);
    }
}

export async function connectToSignaling(id: string, isInitiator: boolean, onStatusChange: (s:string)=>void, onProgress: (p:number, speed:number, eta:string)=>void) {
    sessionId = id;
    lastMsgId = ''; // Reset to avoid stale state from previous connections
    webrtcConnected = false;
    secureChannelEstablished = false;
    
    // Generate key pair IMMEDIATELY so we are ready to decrypt or derive shared keys at any time
    await generateKeyPair();

    onStatusChange('Connecting to signaling server...');
    sendSignal(sessionId, { type: 'join' });
    
    if (isInitiator) {
        onStatusChange('Creating session. Waiting for peer...');
        setupPeerConnection(isInitiator, onStatusChange, onProgress);
    }
    
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
        try {
            const res = await fetch(`${SIGNALING_URL}?action=poll&sessionId=${sessionId}&lastMsgId=${lastMsgId}`, { cache: 'no-store' });
            const data = await res.json();
            if (data.messages) {
                for (const msg of data.messages) {
                    lastMsgId = msg.msgId; 
                    if (msg.clientId === localClientId) continue;
                    await handleSignalingMessage(msg, isInitiator, onStatusChange, onProgress);
                }
            }
        } catch (e) {
            console.error("Polling error", e);
        }
    }, 1500);
}

async function handleSignalingMessage(message: any, isInitiator: boolean, onStatusChange: (s:string)=>void, onProgress: (p:number, speed:number, eta:string)=>void) {
    switch (message.type) {
        case 'join':
            if (isInitiator) {
                onStatusChange('Peer joined. Negotiating connection...');
            }
            break;
        case 'offer':
            if (!isInitiator) {
                onStatusChange('Negotiating connection...');
                await setupPeerConnection(false, onStatusChange, onProgress);
                await peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                sendSignal(sessionId, { type: 'answer', payload: answer });
            }
            break;
        case 'answer':
            if (isInitiator) {
                await peerConnection.setRemoteDescription(new RTCSessionDescription(message.payload));
            }
            break;
        case 'ice-candidate':
            try {
                if (peerConnection) {
                    await peerConnection.addIceCandidate(new RTCIceCandidate(message.payload));
                }
            } catch (e) {
                console.error('Error adding received ice candidate', e);
            }
            break;
        case 'public-key':
            await deriveSharedKey(message.payload);
            secureChannelEstablished = true;
            onStatusChange('Secure channel established');
            checkAndStopPolling();
            break;
        case 'peer-left':
            onStatusChange('Peer disconnected');
            if (pollInterval) clearInterval(pollInterval);
            break;
    }
}

async function setupPeerConnection(isInitiator: boolean, onStatusChange: (s:string)=>void, onProgress: (p:number, speed:number, eta:string)=>void) {
    peerConnection = new RTCPeerConnection(configuration);

    peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
            sendSignal(sessionId, { type: 'ice-candidate', payload: event.candidate });
        }
    };

    peerConnection.onconnectionstatechange = () => {
        if (peerConnection.connectionState === 'connected') {
            webrtcConnected = true;
            checkAndStopPolling();
        }
    };

    if (isInitiator) {
        dataChannel = peerConnection.createDataChannel('xferflow-transfer', { ordered: true });
        dataChannel.binaryType = 'arraybuffer';
        setupDataChannel(dataChannel, onStatusChange, onProgress);

        const publicKey = await getPublicKeyJwk();
        sendSignal(sessionId, { type: 'public-key', payload: publicKey });

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        sendSignal(sessionId, { type: 'offer', payload: offer });
    } else {
        peerConnection.ondatachannel = async (event) => {
            dataChannel = event.channel;
            dataChannel.binaryType = 'arraybuffer';
            setupDataChannel(dataChannel, onStatusChange, onProgress);

            const publicKey = await getPublicKeyJwk();
            sendSignal(sessionId, { type: 'public-key', payload: publicKey });
        };
    }
}

let lastBytesReported = 0;
let lastReportTime = 0;

function setupDataChannel(channel: RTCDataChannel, onStatusChange: (s:string)=>void, onProgress: (p:number, speed:number, eta:string)=>void) {
    channel.onopen = () => {
        onStatusChange('Connected and ready');
    };

    channel.onmessage = (event) => {
        // Enqueue the entire message processing to prevent race conditions where data/EOF packets 
        // arrive before the OPFS file writer is fully initialized by the metadata packet.
        writeQueue = writeQueue.then(async () => {
            const buffer = event.data as ArrayBuffer;
            const array = new Uint8Array(buffer);
            const type = array[0];
            const payloadBuffer = buffer.slice(1);

            if (type === 0) { // Metadata
                const decryptedBuffer = await decryptChunk(payloadBuffer);
                const metadataString = new TextDecoder().decode(decryptedBuffer);
                currentMetadata = JSON.parse(metadataString);
                receivedBytes = 0;
                lastReportTime = Date.now();
                lastBytesReported = 0;
                
                const displayPath = currentMetadata?.relativePath || currentMetadata?.name;
                onStatusChange(`Receiving: ${displayPath}`);
                
                try {
                    fileWriter = await createOPFSWriter(displayPath!);
                    useMemoryFallback = false;
                } catch (e) {
                    console.warn("OPFS not available (likely HTTP context). Falling back to memory buffer.", e);
                    useMemoryFallback = true;
                    memoryBuffer = [];
                }
            } else if (type === 1) { // Data
                if (!fileWriter && !useMemoryFallback) return;
                const decryptedChunk = await decryptChunk(payloadBuffer);
                
                if (useMemoryFallback) {
                    memoryBuffer.push(decryptedChunk);
                } else {
                    await fileWriter!.write(decryptedChunk);
                }
                
                receivedBytes += decryptedChunk.byteLength;
                
                const now = Date.now();
                if (now - lastReportTime > 500) { // Update stats every 500ms
                    const bytesSinceLast = receivedBytes - lastBytesReported;
                    const timeSinceLast = (now - lastReportTime) / 1000;
                    const speedBps = bytesSinceLast / timeSinceLast;
                    const speedMBps = speedBps / (1024 * 1024);
                    
                    const remainingBytes = currentMetadata!.size - receivedBytes;
                    let eta = '--:--';
                    if (speedBps > 0) {
                        const remainingSeconds = Math.round(remainingBytes / speedBps);
                        const m = Math.floor(remainingSeconds / 60);
                        const s = remainingSeconds % 60;
                        eta = `${m}:${s.toString().padStart(2, '0')}`;
                    }
                    
                    onProgress(Math.floor((receivedBytes / currentMetadata!.size) * 100), speedMBps, eta);
                    
                    lastReportTime = now;
                    lastBytesReported = receivedBytes;
                }
            } else if (type === 2) { // EOF
                if (useMemoryFallback) {
                    const blob = new Blob(memoryBuffer);
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = currentMetadata?.name || 'download';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                    memoryBuffer = [];
                    onStatusChange('Transfer complete!');
                    onProgress(100, 0, '0:00');
                } else if (fileWriter) {
                    await fileWriter!.close();
                    fileWriter = null;
                    
                    try {
                        const path = currentMetadata?.relativePath || currentMetadata?.name || 'download';
                        await downloadFromOPFS(path);
                    } catch (e) {
                        console.error('Failed to trigger OPFS download', e);
                    }
                    
                    onStatusChange('Transfer complete!');
                    onProgress(100, 0, '0:00');
                }
            }
        }).catch(e => console.error("Error processing incoming message", e));
    };
}

export function getDataChannel(): RTCDataChannel {
    return dataChannel;
}
