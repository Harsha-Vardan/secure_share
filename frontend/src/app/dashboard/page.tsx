'use client';
import { useEffect, useState, useRef } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { generateKey, encryptFile, exportKey } from '@/lib/encryption';
import { uploadFileInChunks, UploadProgress } from '@/lib/chunkedUpload';
import {
    LogOut, Upload, Link as LinkIcon, Trash2, File as FileIcon,
    Loader2, ShieldCheck, Hash, Lock, ChevronDown, ChevronUp,
    CheckCircle2, AlertCircle, Zap, Clock, Layers
} from 'lucide-react';

interface ShareLinkRecord {
    token: string;
    expiry_time: string;
    download_limit: number;
    download_count: number;
    created_at: string;
}

interface FileRecord {
    id: string;
    filename: string;
    file_hash: string;
    file_size: number;
    chunk_count: number;
    created_at: string;
    share_links?: ShareLinkRecord[];
}

interface ShareOptions {
    expiryHours: number;
    downloadLimit: number;
    password: string;
}

export default function Dashboard() {
    const { user, loading, logout } = useAuth();
    const router = useRouter();
    const fileInputRef = useRef<HTMLInputElement>(null);

    const [files, setFiles] = useState<FileRecord[]>([]);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [error, setError] = useState('');
    const [shareTokens, setShareTokens] = useState<Record<string, { url: string; key: string }>>({});
    const [shareOptions, setShareOptions] = useState<Record<string, ShareOptions>>({});
    const [expandedShare, setExpandedShare] = useState<string | null>(null);
    const [copiedField, setCopiedField] = useState<string | null>(null);
    const [creatingLink, setCreatingLink] = useState<string | null>(null);
    const [shareError, setShareError] = useState<Record<string, string>>({});
    const [useChunked, setUseChunked] = useState(true);

    useEffect(() => {
        if (!loading && !user) router.push('/login');
        else if (user) fetchFiles();
    }, [user, loading, router]);

    const fetchFiles = async () => {
        try {
            const res = await api.get('/files');
            setFiles(res.data);
        } catch {
            console.error('Failed to fetch files');
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files?.[0]) {
            setSelectedFile(e.target.files[0]);
            setError('');
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer.files?.[0]) {
            setSelectedFile(e.dataTransfer.files[0]);
            setError('');
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;
        setUploading(true);
        setError('');
        setUploadProgress({ chunksTotal: 1, chunksUploaded: 0, chunksFailed: 0, percentage: 5, phase: 'encrypting' });

        try {
            const key = await generateKey();
            const ivBytes = window.crypto.getRandomValues(new Uint8Array(12));
            const ivBase64 = btoa(String.fromCharCode(...Array.from(ivBytes)));

            const token = localStorage.getItem('token') || '';

            let fileRecord: { id: string; filename: string; file_hash: string };

            if (useChunked && selectedFile.size > 1 * 1024 * 1024) {
                // ── Chunked upload for files > 1 MB ──────────────────────────
                fileRecord = await uploadFileInChunks(
                    selectedFile, key, ivBytes, ivBase64, token,
                    (prog) => setUploadProgress(prog)
                );
            } else {
                // ── Single-shot upload for small files ────────────────────────
                setUploadProgress({ chunksTotal: 1, chunksUploaded: 0, chunksFailed: 0, percentage: 30, phase: 'encrypting' });
                const { file: encryptedBlob, iv } = await encryptFile(selectedFile, key);

                setUploadProgress({ chunksTotal: 1, chunksUploaded: 0, chunksFailed: 0, percentage: 60, phase: 'uploading' });
                const formData = new FormData();
                formData.append('file', encryptedBlob);
                formData.append('iv', iv);

                const res = await api.post('/files/upload', formData, {
                    headers: { 'Content-Type': 'multipart/form-data' },
                });
                fileRecord = res.data.file;
                setUploadProgress({ chunksTotal: 1, chunksUploaded: 1, chunksFailed: 0, percentage: 100, phase: 'done' });
            }

            const exportedKey = await exportKey(key);
            // encodeURIComponent so Base64 +/= chars don't break URLSearchParams parsing
            sessionStorage.setItem(`encryptionKey_${fileRecord.id}`, exportedKey);

            await fetchFiles();
            setSelectedFile(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
        } catch (err: any) {
            setError(err.message || err.response?.data?.error || 'Upload failed');
            setUploadProgress(prev => prev ? { ...prev, phase: 'error' } : null);
        } finally {
            setUploading(false);
            setTimeout(() => setUploadProgress(null), 3000);
        }
    };

    const getShareOptions = (fileId: string): ShareOptions => {
        return shareOptions[fileId] || { expiryHours: 24, downloadLimit: 5, password: '' };
    };

    const updateShareOption = (fileId: string, field: keyof ShareOptions, value: string | number) => {
        setShareOptions(prev => ({
            ...prev,
            [fileId]: { ...getShareOptions(fileId), [field]: value }
        }));
    };

    const handleCreateLink = async (fileId: string) => {
        setCreatingLink(fileId);
        setShareError(prev => ({ ...prev, [fileId]: '' }));
        try {
            const opts = getShareOptions(fileId);
            const res = await api.post('/share/create', {
                file_id: fileId,
                expiry_hours: opts.expiryHours,
                download_limit: opts.downloadLimit,
                password: opts.password || undefined,
            });

            const key = sessionStorage.getItem(`encryptionKey_${fileId}`);
            if (!key) {
                setShareError(prev => ({
                    ...prev,
                    [fileId]: 'Encryption key unavailable — re-upload the file to get a shareable link.',
                }));
                return;
            }

            // Security: Do NOT embed the key in the URL — share it separately
            const shareUrl = `${window.location.origin}/download/${res.data.token}`;
            setShareTokens(prev => ({ ...prev, [fileId]: { url: shareUrl, key } }));
            setExpandedShare(null);
            await fetchFiles();
        } catch (err: any) {
            const msg = err?.response?.data?.error || err?.message || 'Failed to create share link';
            setShareError(prev => ({ ...prev, [fileId]: msg }));
        } finally {
            setCreatingLink(null);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this file? All share links will stop working.')) return;
        try {
            await api.delete(`/files/${id}`);
            fetchFiles();
            setShareTokens(prev => { const n = { ...prev }; delete n[id]; return n; });
            setShareError(prev => { const n = { ...prev }; delete n[id]; return n; });
        } catch (err: any) {
            const msg = err?.response?.data?.error || err?.message || 'Failed to delete file';
            alert(`Delete failed: ${msg}`);
        }
    };

    const progressColor = (phase: string) => {
        if (phase === 'error') return 'bg-red-500';
        if (phase === 'done') return 'bg-emerald-500';
        return 'bg-blue-500';
    };

    if (loading || !user) return (
        <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
            <Loader2 className="animate-spin text-blue-500" size={32} />
        </div>
    );

    return (
        <div className="min-h-screen bg-[#0a0a0f] text-white">
            {/* ── Nav ──────────────────────────────────────────────────────── */}
            <nav className="border-b border-white/5 bg-white/[0.02] backdrop-blur-xl sticky top-0 z-50">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 flex justify-between h-16 items-center">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
                            <ShieldCheck size={18} />
                        </div>
                        <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
                            SecureShare
                        </span>
                        <span className="hidden sm:block text-[10px] font-medium bg-blue-500/10 border border-blue-500/20 text-blue-400 px-2 py-0.5 rounded-full">
                            AES-256 · PRD 2
                        </span>
                    </div>
                    <div className="flex items-center gap-4">
                        <span className="hidden sm:block text-sm text-white/40">{user.username}</span>
                        <button onClick={logout}
                            className="flex items-center gap-2 px-3 py-1.5 text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-lg transition-all">
                            <LogOut size={16} /> Sign out
                        </button>
                    </div>
                </div>
            </nav>

            <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">

                {/* ── Stats Bar ────────────────────────────────────────────── */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { icon: <Layers size={16} />, label: 'Files', value: files.length },
                        { icon: <Zap size={16} />, label: 'Encryption', value: 'AES-256-GCM' },
                        { icon: <Hash size={16} />, label: 'Integrity', value: 'SHA-256' },
                        { icon: <Lock size={16} />, label: 'Auth', value: 'JWT + bcrypt' },
                    ].map(stat => (
                        <div key={stat.label}
                            className="bg-white/[0.025] border border-white/5 rounded-xl p-3 flex items-center gap-3">
                            <div className="text-blue-400">{stat.icon}</div>
                            <div>
                                <p className="text-[10px] text-white/30 uppercase tracking-wider">{stat.label}</p>
                                <p className="text-sm font-semibold text-white/80">{stat.value}</p>
                            </div>
                        </div>
                    ))}
                </div>

                {/* ── Upload Panel ──────────────────────────────────────────── */}
                <div className="bg-white/[0.025] border border-white/5 rounded-2xl p-6 shadow-xl">
                    <div className="flex items-center justify-between mb-5">
                        <h2 className="text-base font-semibold tracking-tight">Secure Upload</h2>
                        <label className="flex items-center gap-2 text-xs text-white/40 cursor-pointer select-none">
                            <div
                                onClick={() => setUseChunked(v => !v)}
                                className={`w-8 h-4 rounded-full transition-colors relative ${useChunked ? 'bg-blue-600' : 'bg-white/10'}`}>
                                <div className={`w-3 h-3 bg-white rounded-full absolute top-0.5 transition-all ${useChunked ? 'left-4' : 'left-0.5'}`} />
                            </div>
                            Chunked Mode
                        </label>
                    </div>

                    <div
                        onDrop={handleDrop}
                        onDragOver={e => e.preventDefault()}
                        onClick={() => !selectedFile && fileInputRef.current?.click()}
                        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all
                            ${selectedFile ? 'border-blue-500/40 bg-blue-500/5' : 'border-white/10 hover:border-blue-500/30 hover:bg-white/[0.02]'}`}
                    >
                        <input ref={fileInputRef} type="file" onChange={handleFileChange} className="hidden" />
                        <Upload className="mx-auto mb-3 text-white/30" size={32} />
                        {selectedFile ? (
                            <div>
                                <p className="font-medium text-white/80 truncate max-w-xs mx-auto">{selectedFile.name}</p>
                                <p className="text-sm text-white/30 mt-1">{formatBytes(selectedFile.size)} · {Math.ceil(selectedFile.size / (1024 * 1024))} chunk{Math.ceil(selectedFile.size / (1024 * 1024)) !== 1 ? 's' : ''}</p>
                            </div>
                        ) : (
                            <div>
                                <p className="text-white/50 font-medium">Drop a file here or click to browse</p>
                                <p className="text-sm text-white/25 mt-1">Encrypted client-side before upload · Up to 500 MB</p>
                            </div>
                        )}
                    </div>

                    {/* Progress */}
                    {uploadProgress && (
                        <div className="mt-4 space-y-2">
                            <div className="flex justify-between text-xs text-white/40">
                                <span className="capitalize">{uploadProgress.phase === 'encrypting' ? '🔐 Encrypting' : uploadProgress.phase === 'uploading' ? '⬆️ Uploading' : uploadProgress.phase === 'finalizing' ? '🔧 Finalizing' : uploadProgress.phase === 'done' ? '✅ Done' : '❌ Error'}
                                    {uploadProgress.phase === 'uploading' && ` · Chunk ${uploadProgress.currentChunk ?? 0 + 1}/${uploadProgress.chunksTotal}`}
                                </span>
                                <span>{uploadProgress.percentage}%</span>
                            </div>
                            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                <div
                                    className={`h-full rounded-full transition-all duration-300 ${progressColor(uploadProgress.phase)}`}
                                    style={{ width: `${uploadProgress.percentage}%` }}
                                />
                            </div>
                            {uploadProgress.chunksTotal > 1 && (
                                <div className="flex gap-1 flex-wrap">
                                    {Array.from({ length: uploadProgress.chunksTotal }).map((_, i) => (
                                        <div key={i} className={`h-1.5 flex-1 min-w-[4px] rounded-sm transition-colors ${
                                            i < uploadProgress.chunksUploaded ? 'bg-emerald-500' :
                                            i === uploadProgress.chunksUploaded ? 'bg-blue-500 animate-pulse' : 'bg-white/10'
                                        }`} />
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {selectedFile && !uploading && (
                        <button
                            onClick={handleUpload}
                            className="mt-4 w-full py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white rounded-xl font-medium transition-all shadow-lg shadow-blue-600/20 flex items-center justify-center gap-2"
                        >
                            <Upload size={16} /> Encrypt &amp; Upload Securely
                        </button>
                    )}
                    {error && <p className="mt-3 text-red-400 text-sm">{error}</p>}
                </div>

                {/* ── File List ─────────────────────────────────────────────── */}
                <div className="bg-white/[0.025] border border-white/5 rounded-2xl overflow-hidden shadow-xl">
                    <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between">
                        <h2 className="text-base font-semibold tracking-tight">Your Secured Files</h2>
                        <span className="text-xs text-white/30">{files.length} file{files.length !== 1 ? 's' : ''}</span>
                    </div>

                    {files.length === 0 ? (
                        <div className="py-16 text-center">
                            <FileIcon className="mx-auto mb-3 text-white/10" size={48} />
                            <p className="text-white/30 text-sm">No files yet. Upload your first file above.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-white/[0.04]">
                            {files.map(file => (
                                <li key={file.id} className="p-6 hover:bg-white/[0.02] transition-colors">
                                    <div className="flex items-start justify-between gap-4 flex-wrap">
                                        {/* File info */}
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 rounded-xl shrink-0">
                                                <FileIcon className="text-blue-400" size={20} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="font-medium text-white/80 truncate max-w-[240px]">{file.filename}</p>
                                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                    <span className="text-xs text-white/30">{formatBytes(file.file_size)}</span>
                                                    <span className="text-white/15">·</span>
                                                    <span className="text-xs text-white/30">{file.chunk_count} chunk{file.chunk_count !== 1 ? 's' : ''}</span>
                                                    <span className="text-white/15">·</span>
                                                    <span className="text-xs text-white/30">{new Date(file.created_at).toLocaleDateString()}</span>
                                                </div>
                                                {/* Integrity hash */}
                                                <div className="flex items-center gap-1.5 mt-1.5" title={`SHA-256: ${file.file_hash}`}>
                                                    <CheckCircle2 size={11} className="text-emerald-400 shrink-0" />
                                                    <span className="text-[10px] font-mono text-white/25 truncate max-w-[200px]">
                                                        SHA-256: {file.file_hash.slice(0, 16)}…
                                                    </span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Actions */}
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setExpandedShare(expandedShare === file.id ? null : file.id)}
                                                className={`px-3 py-1.5 flex items-center gap-1.5 text-sm border rounded-lg transition-all ${
                                                    expandedShare === file.id
                                                        ? 'text-blue-400 bg-blue-500/10 border-blue-500/30'
                                                        : 'text-white/50 bg-white/5 hover:bg-white/10 border-white/10'
                                                }`}
                                            >
                                                <LinkIcon size={14} /> Share
                                                {expandedShare === file.id ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                            </button>

                                            <button
                                                onClick={() => handleDelete(file.id)}
                                                className="p-1.5 text-white/20 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all"
                                                title="Delete file"
                                            >
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Active Share Links */}
                                    {file.share_links && file.share_links.length > 0 && (
                                        <div className="mt-4 bg-white/[0.01] border border-white/5 rounded-xl p-3.5 space-y-2">
                                            <p className="text-[10px] uppercase tracking-wider text-white/30 font-bold flex items-center gap-1">
                                                <Clock size={10} /> Created Share Links
                                            </p>
                                            <div className="space-y-2">
                                                {file.share_links.map(link => {
                                                    const now = new Date();
                                                    const expiry = new Date(link.expiry_time);
                                                    const isExpired = now > expiry;
                                                    const isLimitReached = link.download_count >= link.download_limit;
                                                    const downloadsLeft = Math.max(0, link.download_limit - link.download_count);
                                                    
                                                    // Calculate remaining time
                                                    let timeLeftStr = '';
                                                    if (isExpired) {
                                                        timeLeftStr = 'Expired';
                                                    } else {
                                                        const diffMs = expiry.getTime() - now.getTime();
                                                        const diffHrs = Math.floor(diffMs / (3600 * 1000));
                                                        const diffMins = Math.floor((diffMs % (3600 * 1000)) / (60 * 1000));
                                                        if (diffHrs > 0) {
                                                            timeLeftStr = `${diffHrs}h ${diffMins}m remaining`;
                                                        } else {
                                                            timeLeftStr = `${diffMins}m remaining`;
                                                        }
                                                    }

                                                    const statusColor = (isExpired || isLimitReached) ? 'text-red-400/80' : 'text-emerald-400/80';
                                                    const statusBg = (isExpired || isLimitReached) ? 'bg-red-500/5 border-red-500/10' : 'bg-emerald-500/5 border-emerald-500/10';

                                                    return (
                                                        <div key={link.token} className={`flex items-center justify-between border rounded-lg px-3 py-2 text-xs transition-all ${statusBg}`}>
                                                            <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
                                                                <span className="text-white/45 font-mono text-[10px] truncate max-w-[140px]" title={link.token}>
                                                                    ...{link.token.slice(-12)}
                                                                </span>
                                                                <span className="text-white/10">|</span>
                                                                <span className={`font-semibold ${statusColor}`}>
                                                                    {isExpired ? 'Expired' : isLimitReached ? 'Limit Reached' : `${downloadsLeft} of ${link.download_limit} downloads left`}
                                                                </span>
                                                                {!isExpired && !isLimitReached && (
                                                                    <>
                                                                        <span className="text-white/10">·</span>
                                                                        <span className="text-white/40">{timeLeftStr}</span>
                                                                    </>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={() => {
                                                                    const shareUrl = `${window.location.origin}/download/${link.token}`;
                                                                    navigator.clipboard.writeText(shareUrl);
                                                                    alert('Share link copied to clipboard!');
                                                                }}
                                                                className="px-2.5 py-1 bg-white/5 hover:bg-white/10 text-white/70 hover:text-white border border-white/10 hover:border-white/20 text-[10px] font-medium rounded-md transition-all shrink-0"
                                                            >
                                                                Copy URL
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Inline Share Panel (no overflow clipping) ── */}
                                    {expandedShare === file.id && !shareTokens[file.id] && (
                                        <div className="mt-4 bg-white/[0.03] border border-white/10 rounded-xl p-4 space-y-3">
                                            <p className="text-xs font-semibold text-white/50 uppercase tracking-wider">Link Options</p>

                                            <div className="grid grid-cols-2 gap-3">
                                                <div>
                                                    <label className="text-xs text-white/40 mb-1 flex items-center gap-1"><Clock size={10} /> Expiry (hours)</label>
                                                    <input
                                                        type="number" min={1} max={720}
                                                        value={getShareOptions(file.id).expiryHours}
                                                        onChange={e => updateShareOption(file.id, 'expiryHours', parseInt(e.target.value))}
                                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-blue-500/50"
                                                    />
                                                </div>
                                                <div>
                                                    <label className="text-xs text-white/40 mb-1 block">Max Downloads</label>
                                                    <input
                                                        type="number" min={1} max={100}
                                                        value={getShareOptions(file.id).downloadLimit}
                                                        onChange={e => updateShareOption(file.id, 'downloadLimit', parseInt(e.target.value))}
                                                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-blue-500/50"
                                                    />
                                                </div>
                                            </div>

                                            <div>
                                                <label className="text-xs text-white/40 mb-1 flex items-center gap-1"><Lock size={10} /> Password (optional)</label>
                                                <input
                                                    type="password"
                                                    placeholder="Leave blank for no password"
                                                    value={getShareOptions(file.id).password}
                                                    onChange={e => updateShareOption(file.id, 'password', e.target.value)}
                                                    className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white/80 outline-none focus:border-blue-500/50 placeholder:text-white/20"
                                                />
                                            </div>

                                            <button
                                                onClick={() => handleCreateLink(file.id)}
                                                disabled={!!creatingLink}
                                                className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-sm rounded-lg font-medium transition-all flex items-center justify-center gap-2"
                                            >
                                                {creatingLink === file.id ? <Loader2 size={14} className="animate-spin" /> : <LinkIcon size={14} />}
                                                Generate Link
                                            </button>
                                            {shareError[file.id] && (
                                                <p className="text-red-400 text-xs leading-snug">{shareError[file.id]}</p>
                                            )}
                                        </div>
                                    )}

                                    {/* ── Generated Share Link (inline, full-width) ── */}
                                    {shareTokens[file.id] && (
                                        <div className="mt-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-4 space-y-3">
                                            <p className="text-xs font-semibold text-emerald-400 mb-2 flex items-center gap-1.5">
                                                <CheckCircle2 size={12} /> Share link created
                                            </p>

                                            {/* Step 1: Share Link */}
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wider text-white/30 mb-1.5 font-semibold">① Share Link <span className="text-white/20">(send via any channel)</span></p>
                                                <div className="flex items-center gap-2 bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                                                    <input
                                                        readOnly
                                                        value={shareTokens[file.id].url}
                                                        className="bg-transparent text-xs flex-1 text-white/50 outline-none min-w-0"
                                                        onClick={e => (e.target as HTMLInputElement).select()}
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(shareTokens[file.id].url);
                                                            setCopiedField('link-' + file.id);
                                                            setTimeout(() => setCopiedField(null), 2000);
                                                        }}
                                                        className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-md transition-all shrink-0"
                                                    >
                                                        {copiedField === 'link-' + file.id ? '✓ Copied' : 'Copy'}
                                                    </button>
                                                </div>
                                            </div>

                                            {/* Step 2: Decryption Key (separate channel) */}
                                            <div>
                                                <p className="text-[10px] uppercase tracking-wider text-amber-400/70 mb-1.5 font-semibold flex items-center gap-1">② Decryption Key <Lock size={9} /> <span className="text-amber-400/40">(send via a DIFFERENT channel)</span></p>
                                                <div className="flex items-center gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2">
                                                    <input
                                                        readOnly
                                                        value={shareTokens[file.id].key}
                                                        className="bg-transparent text-xs flex-1 text-amber-300/60 outline-none min-w-0 font-mono"
                                                        onClick={e => (e.target as HTMLInputElement).select()}
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            navigator.clipboard.writeText(shareTokens[file.id].key);
                                                            setCopiedField('key-' + file.id);
                                                            setTimeout(() => setCopiedField(null), 2000);
                                                        }}
                                                        className="px-3 py-1 bg-amber-600 hover:bg-amber-500 text-white text-xs font-medium rounded-md transition-all shrink-0"
                                                    >
                                                        {copiedField === 'key-' + file.id ? '✓ Copied' : 'Copy Key'}
                                                    </button>
                                                </div>
                                            </div>



                                            <div className="bg-amber-500/5 border border-amber-500/15 rounded-lg p-2.5">
                                                <p className="text-[11px] text-amber-400/70 leading-relaxed">
                                                    <AlertCircle size={11} className="inline mr-1 -mt-0.5" />
                                                    <strong>Security:</strong> Send the link and the key through <strong>different channels</strong> (e.g., link via email, key via SMS). This way, intercepting one channel alone won't compromise the file.
                                                </p>
                                            </div>

                                            <button
                                                onClick={() => setShareTokens(prev => { const n = { ...prev }; delete n[file.id]; return n; })}
                                                className="text-xs text-white/25 hover:text-white/40 transition-colors"
                                            >
                                                Generate new link
                                            </button>
                                        </div>
                                    )}
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                {/* ── Feature Info Footer ───────────────────────────────────── */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                        { icon: <ShieldCheck size={16} className="text-blue-400" />, title: 'End-to-End Encrypted', desc: 'Files are encrypted with AES-256-GCM in your browser. The server never sees plaintext.' },
                        { icon: <Layers size={16} className="text-indigo-400" />, title: 'Chunked Transfer', desc: 'Large files split into 1 MB chunks, uploaded in parallel with automatic retry on failure.' },
                        { icon: <Hash size={16} className="text-emerald-400" />, title: 'Integrity Verified', desc: 'SHA-256 hash computed on upload. Every download is verified against this hash.' },
                    ].map(f => (
                        <div key={f.title} className="bg-white/[0.02] border border-white/5 rounded-xl p-4">
                            <div className="flex items-center gap-2 mb-2">{f.icon}<span className="text-sm font-medium text-white/70">{f.title}</span></div>
                            <p className="text-xs text-white/30 leading-relaxed">{f.desc}</p>
                        </div>
                    ))}
                </div>
            </main>
        </div>
    );
}
