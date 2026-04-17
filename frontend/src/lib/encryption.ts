// Web Crypto API based AES-GCM-256 File Encryption & Integrity Utilities

// ─── Key Management ───────────────────────────────────────────────────────────

export async function generateKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

export async function exportKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

export async function importKey(base64Key: string): Promise<CryptoKey> {
    const bytes = Uint8Array.from(atob(base64Key), c => c.charCodeAt(0));
    return await window.crypto.subtle.importKey(
        'raw', bytes,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

// ─── File Encryption ──────────────────────────────────────────────────────────

export interface EncryptedFileResult {
    file: File;
    iv: string; // Base64 encoded Initialization Vector
}

export async function encryptFile(file: File, key: CryptoKey): Promise<EncryptedFileResult> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const fileBuffer = await file.arrayBuffer();

    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        fileBuffer
    );

    const ivBase64 = btoa(String.fromCharCode(...Array.from(iv)));
    const encryptedFile = new File([encryptedBuffer], file.name, { type: 'application/octet-stream' });

    return { file: encryptedFile, iv: ivBase64 };
}

// ─── Chunk Encryption ─────────────────────────────────────────────────────────
// Each chunk is encrypted with the same key but a UNIQUE IV derived from chunkIndex.

export async function encryptChunk(
    chunkBuffer: ArrayBuffer,
    key: CryptoKey,
    baseIV: Uint8Array,
    chunkIndex: number
): Promise<{ data: ArrayBuffer; iv: string }> {
    // Derive unique IV per chunk: XOR last 4 bytes of base IV with chunkIndex
    const iv = new Uint8Array(baseIV);
    const view = new DataView(iv.buffer);
    view.setUint32(8, view.getUint32(8) ^ chunkIndex, false);

    const encrypted = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        chunkBuffer
    );

    return { data: encrypted, iv: btoa(String.fromCharCode(...Array.from(iv))) };
}

// ─── File Decryption ──────────────────────────────────────────────────────────

export async function decryptFile(
    encryptedBuffer: ArrayBuffer,
    key: CryptoKey,
    ivBase64: string,
    originalName: string,
    originalType: string = 'application/octet-stream'
): Promise<File> {
    const iv = Uint8Array.from(atob(ivBase64), c => c.charCodeAt(0));

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedBuffer
    );

    return new File([decryptedBuffer], originalName, { type: originalType });
}

// ─── Integrity Hashing ────────────────────────────────────────────────────────

/**
 * Compute SHA-256 hash of an ArrayBuffer.
 * Returns lowercase hex string — matches the server-side crypto.createHash('sha256') output.
 */
export async function hashBuffer(buffer: ArrayBuffer): Promise<string> {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hashBuffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Verify downloaded encrypted data matches the server-stored SHA-256 hash.
 */
export async function verifyIntegrity(buffer: ArrayBuffer, expectedHash: string): Promise<boolean> {
    const actualHash = await hashBuffer(buffer);
    return actualHash.toLowerCase() === expectedHash.toLowerCase();
}
