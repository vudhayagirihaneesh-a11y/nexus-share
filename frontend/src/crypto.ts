export let sharedCryptoKey: CryptoKey | null = null;
let keyPair: CryptoKeyPair;

export async function generateKeyPair(): Promise<void> {
    keyPair = await window.crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveKey', 'deriveBits']
    );
}

export async function getPublicKeyJwk(): Promise<JsonWebKey> {
    return await window.crypto.subtle.exportKey('jwk', keyPair.publicKey);
}

export async function deriveSharedKey(remoteJwk: JsonWebKey): Promise<void> {
    const remoteKey = await window.crypto.subtle.importKey(
        'jwk',
        remoteJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        []
    );

    sharedCryptoKey = await window.crypto.subtle.deriveKey(
        { name: 'ECDH', public: remoteKey },
        keyPair.privateKey,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

export async function encryptChunk(data: Uint8Array): Promise<ArrayBuffer> {
    if (!sharedCryptoKey) throw new Error("Key not established");
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        sharedCryptoKey,
        data as any
    );
    // Prefix IV to ciphertext
    const result = new Uint8Array(iv.length + encrypted.byteLength);
    result.set(iv, 0);
    result.set(new Uint8Array(encrypted), iv.length);
    return result.buffer;
}

export async function decryptChunk(encryptedData: ArrayBuffer): Promise<ArrayBuffer> {
    if (!sharedCryptoKey) throw new Error("Key not established");
    const array = new Uint8Array(encryptedData);
    const iv = array.slice(0, 12);
    const ciphertext = array.slice(12);
    return await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        sharedCryptoKey,
        ciphertext
    );
}
