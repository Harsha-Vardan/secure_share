'use client';
import { useEffect, useState, use } from 'react';
import { BACKEND_URL } from '@/lib/api';
import { importKey, decryptFile, verifyIntegrity } from '@/lib/encryption';
import {
    Download, AlertCircle, ShieldCheck, Loader2, Lock,
    CheckCircle2, XCircle, Hash, Clock, Layers, Eye, EyeOff
} from 'lucide-react';

interface LinkInfo {
    filename: string;
    file_size: number;
    iv: string;
    file_hash: string;
    expiry_time: string;
    downloads_remaining: number;
    password_protected: boolean;
}

type IntegrityStatus = 'pending' | 'verified' | 'failed';

export default function DownloadPage({ params }: { params: Promise<{ token: string }> }) {
    const { token } = use(params);
    const [infoLoading, setInfoLoading] = useState(true);
    const [decrypting, setDecrypting] = useState(false);
    const [error, setError] = useState('');
    const [linkInfo, setLinkInfo] = useState<LinkInfo | null>(null);
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [integrityStatus, setIntegrityStatus] = useState<IntegrityStatus>('pending');
    const [downloadedFile, setDownloadedFile] = useState<{ name: string; size: string } | null>(null);
    const [progress, setProgress] = useState(0);

    // ── Load link metadata on mount ───────────────────────────────────────────
    useEffect(() => {
        const fetchInfo = async () => {
            try {
                const res = await fetch(`${BACKEND_URL}/share/info/${token}`);
                if (!res.ok) {
                    const data = await res.json();
                    setError(data.error || 'Invalid or expired link');
                } else {
                    setLinkInfo(await res.json());
                }
            } catch {
                setError('Could not reach the server. Check your connection.');
            } finally {
                setInfoLoading(false);
            }
        };
        fetchInfo();
    }, [token]);

    const formatBytes = (bytes: number) => {
        if (!bytes) return '—';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    };

    // ── Secure Download ───────────────────────────────────────────────────────
    const handleDownload = async () => {
        if (linkInfo?.password_protected && !password.trim()) {
            setError('Please enter the password to download this file.');
            return;
        }

        setDecrypting(true);
        setError('');
        setProgress(10);

        try {
            // 1. Extract encryption key from URL fragment (never sent to server)
            //    The key is encodeURIComponent'd to survive URLSearchParams parsing of Base64 +/=
            const hash = window.location.hash;
            const rawKeyParam = new URLSearchParams(hash.substring(1)).get('key');
            if (!rawKeyParam) throw new Error('Encryption key missing from URL. Share the full URL including the #key= fragment.');
            const keyParam = decodeURIComponent(rawKeyParam);

            // Use pre-fetched linkInfo for filename, IV and hash — avoids CORS custom header issues
            const fileName  = linkInfo?.filename || 'securely_shared_file';
            const ivBase64  = linkInfo?.iv;
            const serverHash = linkInfo?.file_hash;

            if (!ivBase64) throw new Error('Initialization Vector missing — cannot decrypt. Re-share the file.');

            setProgress(20);

            // 2. POST to download endpoint (password in body — gets the encrypted blob)
            const res = await fetch(`${BACKEND_URL}/share/download/${token}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: password || undefined }),
            });

            if (!res.ok) {
                const data = await res.json();
                throw new Error(data.error || 'Download failed');
            }

            setProgress(50);

            // 3. Read encrypted blob
            const encryptedBuffer = await res.arrayBuffer();

            setProgress(65);

            // 4. ── Integrity verification (before decryption) ──────────────
            if (serverHash) {
                const actualHex = Array.from(new Uint8Array(await window.crypto.subtle.digest('SHA-256', encryptedBuffer)))
                    .map(b => b.toString(16).padStart(2, '0')).join('');
                const verified = await verifyIntegrity(encryptedBuffer, serverHash);
                setIntegrityStatus(verified ? 'verified' : 'failed');
                if (!verified) {
                    throw new Error(`⚠️ Integrity check FAILED! Expected: ${serverHash.slice(0, 16)}… Got: ${actualHex.slice(0, 16)}… The file may be corrupted.`);
                }
            }

            setProgress(80);

            // 5. Decrypt
            const key = await importKey(keyParam);
            const decryptedFile = await decryptFile(encryptedBuffer, key, ivBase64, fileName);

            setProgress(95);

            // 6. Trigger browser download with correct filename
            const objectUrl = URL.createObjectURL(decryptedFile);
            setDownloadedFile({ name: fileName, size: formatBytes(decryptedFile.size) });

            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = fileName;  // correct original filename from DB
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 5000);

            setProgress(100);

        } catch (err: any) {
            setError(err.message || 'An error occurred during secure download.');
            setIntegrityStatus('pending');
        } finally {
            setDecrypting(false);
        }
    };

    // ── Loading state ─────────────────────────────────────────────────────────
    if (infoLoading) return (
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
            <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
    );

    return (
        <div className="min-h-screen bg-[#0a0a0f] flex flex-col items-center justify-center p-4">
            {/* Background glow */}
            <div className="fixed inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl" />
            </div>

            <div className="relative max-w-md w-full">
                {/* Card */}
                <div className="bg-white/[0.03] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
                    {/* Top accent bar */}
                    <div className="h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-purple-500" />

                    <div className="p-8">
                        {/* Header */}
                        <div className="text-center mb-8">
                            <div className="w-16 h-16 bg-blue-500/10 border border-blue-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                <ShieldCheck className="text-blue-400" size={30} />
                            </div>
                            <h1 className="text-2xl font-bold text-white mb-2">Secure Download</h1>
                            <p className="text-sm text-white/40">
                                End-to-end encrypted · Decrypted locally · Server never sees plaintext
                            </p>
                        </div>

                        {/* File Metadata */}
                        {linkInfo && !error && (
                            <div className="bg-white/[0.03] border border-white/5 rounded-xl p-4 mb-6 space-y-2">
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-white/40 flex items-center gap-1.5"><Layers size={12} /> File</span>
                                    <span className="text-white/70 font-medium truncate max-w-[200px]">{linkInfo.filename}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-white/40">Size</span>
                                    <span className="text-white/70">{formatBytes(linkInfo.file_size)}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-white/40 flex items-center gap-1.5"><Clock size={12} /> Expires</span>
                                    <span className="text-white/70">{new Date(linkInfo.expiry_time).toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between text-sm">
                                    <span className="text-white/40">Downloads Left</span>
                                    <span className={`font-medium ${linkInfo.downloads_remaining <= 1 ? 'text-amber-400' : 'text-emerald-400'}`}>
                                        {linkInfo.downloads_remaining}
                                    </span>
                                </div>
                                {linkInfo.password_protected && (
                                    <div className="flex items-center gap-2 pt-1 border-t border-white/5">
                                        <Lock size={12} className="text-amber-400" />
                                        <span className="text-xs text-amber-400">Password protected</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Error */}
                        {error && (
                            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6 flex items-start gap-3">
                                <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={18} />
                                <p className="text-red-300 text-sm">{error}</p>
                            </div>
                        )}

                        {/* Integrity Badge */}
                        {integrityStatus !== 'pending' && (
                            <div className={`rounded-xl p-4 mb-6 flex items-center gap-3 ${
                                integrityStatus === 'verified'
                                    ? 'bg-emerald-500/10 border border-emerald-500/20'
                                    : 'bg-red-500/10 border border-red-500/20'
                            }`}>
                                {integrityStatus === 'verified' ? (
                                    <CheckCircle2 className="text-emerald-400" size={20} />
                                ) : (
                                    <XCircle className="text-red-400" size={20} />
                                )}
                                <div>
                                    <p className={`text-sm font-semibold ${integrityStatus === 'verified' ? 'text-emerald-400' : 'text-red-400'}`}>
                                        {integrityStatus === 'verified' ? 'Integrity Verified ✓' : 'Integrity Check Failed ✗'}
                                    </p>
                                    <p className="text-xs text-white/30 flex items-center gap-1 mt-0.5">
                                        <Hash size={10} /> SHA-256 hash {integrityStatus === 'verified' ? 'matches' : 'mismatch — file may be corrupted'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {/* Success State */}
                        {downloadedFile ? (
                            <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-6 text-center">
                                <CheckCircle2 className="text-emerald-400 mx-auto mb-3" size={32} />
                                <p className="text-white font-semibold truncate">{downloadedFile.name}</p>
                                <p className="text-white/40 text-sm mt-1">{downloadedFile.size} · Decrypted successfully</p>
                            </div>
                        ) : !error ? (
                            <div className="space-y-4">
                                {/* Password field */}
                                {linkInfo?.password_protected && (
                                    <div className="relative">
                                        <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/30" />
                                        <input
                                            type={showPassword ? 'text' : 'password'}
                                            placeholder="Enter link password"
                                            value={password}
                                            onChange={e => setPassword(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleDownload()}
                                            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-10 py-3 text-sm text-white placeholder:text-white/25 outline-none focus:border-blue-500/50 transition-colors"
                                        />
                                        <button
                                            onClick={() => setShowPassword(v => !v)}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-white/25 hover:text-white/50"
                                        >
                                            {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                        </button>
                                    </div>
                                )}

                                {/* Progress bar */}
                                {decrypting && (
                                    <div className="space-y-2">
                                        <div className="flex justify-between text-xs text-white/30">
                                            <span>{progress < 50 ? 'Downloading…' : progress < 80 ? 'Verifying integrity…' : 'Decrypting…'}</span>
                                            <span>{progress}%</span>
                                        </div>
                                        <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                                            <div
                                                className="h-full bg-gradient-to-r from-blue-500 to-indigo-500 rounded-full transition-all duration-500"
                                                style={{ width: `${progress}%` }}
                                            />
                                        </div>
                                    </div>
                                )}

                                <button
                                    onClick={handleDownload}
                                    disabled={decrypting || (linkInfo?.password_protected && !password)}
                                    className="w-full flex items-center justify-center gap-2.5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-xl font-medium transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98]"
                                >
                                    {decrypting ? (
                                        <><Loader2 className="animate-spin" size={18} /> Downloading &amp; Decrypting…</>
                                    ) : (
                                        <><Download size={18} /> Download Securely</>
                                    )}
                                </button>
                            </div>
                        ) : null}
                    </div>
                </div>

                <p className="mt-6 text-white/20 text-xs text-center">
                    AES-256-GCM · SHA-256 integrity · JWT Auth · Powered by SecureShare PRD 2
                </p>
            </div>
        </div>
    );
}
