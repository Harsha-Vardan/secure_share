import { encryptChunk } from './encryption';
import { BACKEND_URL } from './api';

const CHUNK_SIZE = 1 * 1024 * 1024; // 1 MB per chunk
const MAX_PARALLEL = 3;              // Upload 3 chunks simultaneously
const MAX_RETRIES = 3;               // Retry failed chunks up to 3 times

export interface UploadProgress {
    chunksTotal: number;
    chunksUploaded: number;
    chunksFailed: number;
    percentage: number;
    phase: 'encrypting' | 'uploading' | 'finalizing' | 'done' | 'error';
    currentChunk?: number;
}

type ProgressCallback = (progress: UploadProgress) => void;

/**
 * Upload a file in parallel encrypted chunks.
 * 
 * Flow:
 *   1. Split file blob into CHUNK_SIZE slices
 *   2. Encrypt each chunk individually (unique IV per chunk)
 *   3. Upload chunks in batches of MAX_PARALLEL (parallel)
 *   4. Retry failed chunks up to MAX_RETRIES times
 *   5. Call /chunks/finalize to reassemble on server
 * 
 * @returns The file record returned by /chunks/finalize
 */
export async function uploadFileInChunks(
    file: File,
    key: CryptoKey,
    baseIV: Uint8Array,
    ivBase64: string,
    token: string,
    onProgress: ProgressCallback
): Promise<{ id: string; filename: string; file_hash: string }> {

    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const sessionId = crypto.randomUUID();

    // ── Phase 1: Build chunk slices ──────────────────────────────────────────
    const chunks: { index: number; blob: Blob }[] = [];
    for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        chunks.push({ index: i, blob: file.slice(start, end) });
    }

    let chunksUploaded = 0;
    let chunksFailed = 0;

    // ── Phase 2+3: Encrypt + Upload in parallel batches ───────────────────────
    const uploadChunk = async (chunkInfo: { index: number; blob: Blob }, attempt = 1): Promise<void> => {
        onProgress({
            chunksTotal: totalChunks,
            chunksUploaded,
            chunksFailed,
            percentage: Math.round((chunksUploaded / totalChunks) * 80), // 0–80% for upload phase
            phase: 'encrypting',
            currentChunk: chunkInfo.index,
        });

        // Encrypt this chunk
        const chunkBuffer = await chunkInfo.blob.arrayBuffer();
        const { data: encryptedData } = await encryptChunk(chunkBuffer, key, baseIV, chunkInfo.index);

        onProgress({
            chunksTotal: totalChunks,
            chunksUploaded,
            chunksFailed,
            percentage: Math.round((chunksUploaded / totalChunks) * 80),
            phase: 'uploading',
            currentChunk: chunkInfo.index,
        });

        // Upload the encrypted chunk
        const formData = new FormData();
        formData.append('chunk', new Blob([encryptedData], { type: 'application/octet-stream' }), `chunk_${chunkInfo.index}`);
        formData.append('sessionId', sessionId);
        formData.append('chunkIndex', String(chunkInfo.index));
        formData.append('totalChunks', String(totalChunks));

        const res = await fetch(`${BACKEND_URL}/chunks/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: formData,
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: 'Upload failed' }));
            if (attempt <= MAX_RETRIES) {
                console.warn(`[chunkedUpload] Chunk ${chunkInfo.index} failed (attempt ${attempt}/${MAX_RETRIES}): ${err.error}. Retrying...`);
                await delay(500 * attempt); // exponential-ish backoff
                return uploadChunk(chunkInfo, attempt + 1);
            } else {
                chunksFailed++;
                throw new Error(`Chunk ${chunkInfo.index} failed after ${MAX_RETRIES} retries: ${err.error}`);
            }
        }

        chunksUploaded++;
    };

    // Run in sliding window batches
    for (let i = 0; i < chunks.length; i += MAX_PARALLEL) {
        const batch = chunks.slice(i, i + MAX_PARALLEL);
        await Promise.all(batch.map(c => uploadChunk(c)));

        onProgress({
            chunksTotal: totalChunks,
            chunksUploaded,
            chunksFailed,
            percentage: Math.round((chunksUploaded / totalChunks) * 80),
            phase: 'uploading',
        });
    }

    // ── Phase 4: Finalize (reassemble on server) ──────────────────────────────
    onProgress({
        chunksTotal: totalChunks,
        chunksUploaded,
        chunksFailed,
        percentage: 85,
        phase: 'finalizing',
    });

    const finalizeRes = await fetch(`${BACKEND_URL}/chunks/finalize`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
            sessionId,
            totalChunks,
            filename: file.name,
            iv: ivBase64,
        }),
    });

    if (!finalizeRes.ok) {
        const err = await finalizeRes.json().catch(() => ({ error: 'Finalize failed' }));
        throw new Error(err.error || 'Finalize request failed');
    }

    const result = await finalizeRes.json();

    onProgress({
        chunksTotal: totalChunks,
        chunksUploaded,
        chunksFailed,
        percentage: 100,
        phase: 'done',
    });

    return result.file;
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
