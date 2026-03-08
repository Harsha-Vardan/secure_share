'use client';
import { useEffect, useState, use } from 'react';
import { api, BACKEND_URL } from '@/lib/api';
import { importKey, decryptFile } from '@/lib/encryption';
import { Download, AlertCircle, FileKey, ShieldCheck, Loader2 } from 'lucide-react';

export default function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const [loading, setLoading] = useState(true);
    const [decrypting, setDecrypting] = useState(false);
    const [error, setError] = useState('');
    const [fileInfo, setFileInfo] = useState<{name: string, size: string} | null>(null);
    const [decryptedFileUrl, setDecryptedFileUrl] = useState<string | null>(null);

    useEffect(() => {
        // Try head request to verify token without downloading full file
        const verifyLink = async () => {
            try {
                // Not ideal since we don't have a specific GET /info endpoint in backend, 
                // but the prompt is for downloading directly. 
                // We'll show a "Ready to Download" screen, then fetch the blob.
                setLoading(false);
            } catch (err: any) {
                setError(err.response?.data?.error || 'Invalid or expired link');
                setLoading(false);
            }
        };
        verifyLink();
    }, [token]);

    const handleDownload = async () => {
        setDecrypting(true);
        setError('');
        
        try {
            // 1. Get encryption key from URL fragment
            const hash = window.location.hash;
            const keyParam = new URLSearchParams(hash.substring(1)).get('key');
            
            if (!keyParam) {
                throw new Error('Encryption key missing from URL. Cannot decrypt file.');
            }

            // 2. Fetch the encrypted file blob
            const response = await fetch(`${BACKEND_URL}/share/download/${token}`);
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || 'Failed to download file');
            }

            const encryptedBlob = await response.blob();
            const encryptedBuffer = await encryptedBlob.arrayBuffer();

            // 3. Extract metadata headers sent from server
            const fileName = decodeURIComponent(response.headers.get('x-file-name') || 'securely_shared_file');
            const ivBase64 = response.headers.get('x-file-iv');

            if (!ivBase64) {
                throw new Error('Missing Initialization Vector. Cannot decrypt.');
            }

            // 4. Decrypt the file
            const key = await importKey(keyParam);
            const decryptedFile = await decryptFile(encryptedBuffer, key, ivBase64, fileName, encryptedBlob.type);

            // 5. Create download link
            const objectUrl = URL.createObjectURL(decryptedFile);
            setDecryptedFileUrl(objectUrl);
            setFileInfo({ name: fileName, size: (decryptedFile.size / 1024 / 1024).toFixed(2) + ' MB' });

            // Auto trigger download
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

        } catch (err: any) {
            setError(err.message || 'An error occurred during secure download.');
        } finally {
            setDecrypting(false);
        }
    };

    if (loading) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

    return (
        <div className="min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4">
            <div className="max-w-md w-full bg-neutral-900 rounded-2xl border border-neutral-800 p-8 shadow-2xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-cyan-400"></div>
                
                <div className="mb-8 text-center">
                    <div className="w-16 h-16 bg-blue-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-blue-500/20">
                        <ShieldCheck className="text-blue-400" size={32} />
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2">Secure Download</h1>
                    <p className="text-neutral-400 text-sm">
                        This file is end-to-end encrypted. It will be downloaded and decrypted locally on your device.
                    </p>
                </div>

                {error ? (
                    <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-center">
                        <AlertCircle className="text-red-400 mx-auto mb-2" size={24} />
                        <p className="text-red-400 font-medium">{error}</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {fileInfo ? (
                            <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-6 text-center">
                                <FileKey className="text-green-400 mx-auto mb-4" size={32} />
                                <h3 className="text-white font-medium mb-1 truncate">{fileInfo.name}</h3>
                                <p className="text-neutral-400 text-sm mb-4">{fileInfo.size}</p>
                                <p className="text-green-400 text-sm font-medium">Decrypted Successfully</p>
                            </div>
                        ) : (
                            <button
                                onClick={handleDownload}
                                disabled={decrypting}
                                className="w-full flex items-center justify-center gap-3 py-4 bg-blue-600 hover:bg-blue-700 disabled:bg-neutral-800 disabled:text-neutral-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98]"
                            >
                                {decrypting ? (
                                    <>
                                        <Loader2 className="animate-spin" size={20} />
                                        Downloading & Decrypting...
                                    </>
                                ) : (
                                    <>
                                        <Download size={20} />
                                        Download Securely
                                    </>
                                )}
                            </button>
                        )}
                    </div>
                )}
            </div>
            
            <p className="mt-8 text-neutral-600 text-xs text-center max-w-sm">
                Powered by AES-256 Web Crypto. The server never sees the decryption key.
            </p>
        </div>
    );
}
