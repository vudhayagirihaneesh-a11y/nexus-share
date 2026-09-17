/**
 * NexusShare - Service Worker for PWA and Web Share Target
 */

self.addEventListener('install', (event) => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
    // Intercept Web Share Target POST request
    if (event.request.method === 'POST' && event.request.url.includes('/share-target')) {
        event.respondWith((async () => {
            const formData = await event.request.formData();
            const files = formData.getAll('files');
            
            // In a real implementation, we'd store these files in IndexedDB 
            // and read them when the main client loads.
            // For now, we'll redirect to home with a query param and try to pass via postMessage.
            
            const client = await self.clients.get(event.clientId) || await self.clients.openWindow('/');
            
            if (files && files.length > 0) {
                // Wait for the client to be ready and send the files
                setTimeout(() => {
                    client.postMessage({
                        type: 'SHARED_FILES',
                        files: files
                    });
                }, 1000);
            }

            return Response.redirect('/', 303);
        })());
    }
});
