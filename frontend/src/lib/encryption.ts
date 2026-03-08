// Web Crypto API based AES-GCM-256 File Encryption

// Helper to generate a random 256-bit encryption key
export async function generateKey(): Promise<CryptoKey> {
    return await window.crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true, // extractable
        ['encrypt', 'decrypt']
    );
}

// Helper to export a CryptoKey to a base64 string
export async function exportKey(key: CryptoKey): Promise<string> {
    const exported = await window.crypto.subtle.exportKey('raw', key);
    const exportedArray = Array.from(new Uint8Array(exported));
    return btoa(String.fromCharCode.apply(null, exportedArray));
}

// Helper to import a base64 string back into a CryptoKey
export async function importKey(base64Key: string): Promise<CryptoKey> {
    const binaryStr = atob(base64Key);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
    }
    return await window.crypto.subtle.importKey(
        'raw',
        bytes,
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt']
    );
}

export interface EncryptedFileResult {
    file: File;
    iv: string; // Base64 encoded Initialization Vector
}

// Encrypt a file using a given key
export async function encryptFile(file: File, key: CryptoKey): Promise<EncryptedFileResult> {
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const fileBuffer = await file.arrayBuffer();

    const encryptedBuffer = await window.crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        key,
        fileBuffer
    );

    const ivBase64 = btoa(String.fromCharCode.apply(null, Array.from(iv)));
    
    const encryptedFile = new File([encryptedBuffer], file.name, {
        type: 'application/octet-stream',
    });

    return { file: encryptedFile, iv: ivBase64 };
}

// Decrypt a file chunk/buffer using a given key and IV
export async function decryptFile(
    encryptedBuffer: ArrayBuffer,
    key: CryptoKey,
    ivBase64: string,
    originalName: string,
    originalType: string = 'application/octet-stream'
): Promise<File> {
    const binaryIV = atob(ivBase64);
    const iv = new Uint8Array(binaryIV.length);
    for (let i = 0; i < binaryIV.length; i++) {
        iv[i] = binaryIV.charCodeAt(i);
    }

    const decryptedBuffer = await window.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv },
        key,
        encryptedBuffer
    );

    return new File([decryptedBuffer], originalName, { type: originalType });
}
