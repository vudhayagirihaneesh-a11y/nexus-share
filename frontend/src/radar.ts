export const API_URL = '/api.php';
let radarInterval: number | null = null;
let currentRadarId = '';

export interface RadarPeer {
    radarId: string;
    deviceName: string;
}

export function startRadar(radarId: string, deviceName: string, onPeersUpdate: (peers: RadarPeer[]) => void) {
    currentRadarId = radarId;
    
    // Join radar
    fetch(API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'radar-join', radarId, deviceName })
    }).catch(console.error);

    // Poll for updates
    radarInterval = window.setInterval(async () => {
        try {
            const res = await fetch(`${API_URL}?action=radar&radarId=${encodeURIComponent(radarId)}`);
            const data = await res.json();
            if (data.type === 'radar-update') {
                onPeersUpdate(data.peers);
            }
            
            // Heartbeat
            fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'radar-join', radarId, deviceName })
            }).catch(() => {});
        } catch (e) {
            console.error('Radar poll failed', e);
        }
    }, 2000);
}

export function stopRadar() {
    if (radarInterval !== null) {
        clearInterval(radarInterval);
        radarInterval = null;
    }
    if (currentRadarId) {
        fetch(API_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type: 'radar-leave', radarId: currentRadarId })
        }).catch(console.error);
        currentRadarId = '';
    }
}
