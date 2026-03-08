'use client';
import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { generateKey, encryptFile, exportKey } from '@/lib/encryption';
import { LogOut, Upload, Link as LinkIcon, Trash2, File as FileIcon, Loader2 } from 'lucide-react';

interface FileRecord {
    id: string;
    filename: string;
    created_at: string;
}

export default function Dashboard() {
    const { user, loading, logout } = useAuth();
    const router = useRouter();
    const [files, setFiles] = useState<FileRecord[]>([]);
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [error, setError] = useState('');
    const [shareTokens, setShareTokens] = useState<Record<string, string>>({});

    useEffect(() => {
        if (!loading && !user) {
            router.push('/login');
        } else if (user) {
            fetchFiles();
        }
    }, [user, loading, router]);

    const fetchFiles = async () => {
        try {
            const res = await api.get('/files');
            setFiles(res.data);
        } catch (err) {
            console.error('Failed to fetch files');
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            setSelectedFile(e.target.files[0]);
            setError('');
        }
    };

    const handleUpload = async () => {
        if (!selectedFile) return;
        setUploading(true);
        setError('');
        setUploadProgress(10); // Start artificial progress

        try {
            // 1. Generate local encryption key
            const key = await generateKey();
            setUploadProgress(30);

            // 2. Encrypt file using Web Crypto
            const { file: encryptedFileBlob, iv } = await encryptFile(selectedFile, key);
            setUploadProgress(60);

            // 3. Upload to server
            const formData = new FormData();
            formData.append('file', encryptedFileBlob);
            formData.append('iv', iv);

            const res = await api.post('/files/upload', formData, {
                headers: { 'Content-Type': 'multipart/form-data' },
            });
            setUploadProgress(90);

            // 4. Temporarily hold the generated key with the file ID so user can share it
            const exportedKey = await exportKey(key);
            
            // We append the key to session storage to create the share link shortly without server ever seeing it
            sessionStorage.setItem(`encryptionKey_${res.data.file.id}`, exportedKey);

            await fetchFiles();
            setSelectedFile(null);
        } catch (err: any) {
            setError(err.response?.data?.error || 'Upload failed');
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    };

    const handleCreateLink = async (fileId: string) => {
        try {
            const res = await api.post('/share/create', {
                file_id: fileId,
                expiry_hours: 24,
                download_limit: 5
            });

            // Get encryption key we saved to session storage during upload
            // If user logged out/in or refreshed between upload/share, they must recreate key... 
            // In a full system, you would store encrypted keys tied to User's Master Key. For simplicity here it's ephemeral.
            const key = sessionStorage.getItem(`encryptionKey_${fileId}`);
            if (!key) {
                alert('Encryption key unavailable for this session. In production, this would be derived from user password.');
                return;
            }

            const shareUrl = `${window.location.origin}/download/${res.data.token}#key=${key}`;
            setShareTokens(prev => ({ ...prev, [fileId]: shareUrl }));
        } catch (err) {
            alert('Failed to create share link');
        }
    };

    const handleDelete = async (id: string) => {
        try {
            await api.delete(`/files/${id}`);
            fetchFiles();
        } catch (err) {
            alert('Failed to delete file');
        }
    };

    if (loading || !user) return <div className="min-h-screen bg-neutral-950 flex items-center justify-center"><Loader2 className="animate-spin text-blue-500" /></div>;

    return (
        <div className="min-h-screen bg-neutral-950 text-white">
            <nav className="border-b border-neutral-800 bg-neutral-900/50 backdrop-blur-md">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                    <div className="flex justify-between h-16 items-center">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
                                <span className="font-bold">S</span>
                            </div>
                            <span className="text-xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">SecureShare</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <span className="text-sm text-neutral-400">{user.email}</span>
                            <button onClick={logout} className="p-2 text-neutral-400 hover:text-white hover:bg-neutral-800 rounded-md transition-colors">
                                <LogOut size={20} />
                            </button>
                        </div>
                    </div>
                </div>
            </nav>

            <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
                <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-6 shadow-xl mb-8">
                    <h2 className="text-lg font-semibold mb-4">Secure Upload</h2>
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 relative">
                            <input type="file" onChange={handleFileChange} id="file-upload" className="hidden" />
                            <label htmlFor="file-upload" className="flex items-center justify-center gap-2 w-full px-4 py-8 border-2 border-dashed border-neutral-700 rounded-lg cursor-pointer hover:border-blue-500 hover:bg-neutral-800/50 transition-all text-neutral-400 hover:text-neutral-200">
                                <Upload size={24} />
                                <span>{selectedFile ? selectedFile.name : 'Choose a file to encrypt & upload'}</span>
                            </label>
                        </div>
                        {selectedFile && (
                            <div className="flex items-end">
                                <button
                                    onClick={handleUpload}
                                    disabled={uploading}
                                    className="h-12 px-6 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
                                >
                                    {uploading ? <Loader2 className="animate-spin" size={20} /> : <Upload size={20} />}
                                    {uploading ? `Encrypting (${uploadProgress}%)` : 'Upload File'}
                                </button>
                            </div>
                        )}
                    </div>
                    {error && <p className="mt-3 text-red-500 text-sm">{error}</p>}
                </div>

                <div className="bg-neutral-900 border border-neutral-800 rounded-xl shadow-xl overflow-hidden">
                    <div className="p-6 border-b border-neutral-800">
                        <h2 className="text-lg font-semibold">Your Secured Files</h2>
                    </div>
                    {files.length === 0 ? (
                        <div className="p-12 text-center text-neutral-500">
                            <FileIcon className="mx-auto mb-3 opacity-50" size={48} />
                            <p>No files uploaded yet.</p>
                        </div>
                    ) : (
                        <ul className="divide-y divide-neutral-800">
                            {files.map(file => (
                                <li key={file.id} className="p-6 hover:bg-neutral-800/30 transition-colors">
                                    <div className="flex items-center justify-between flex-wrap gap-4">
                                        <div className="flex items-center gap-3">
                                            <div className="p-3 bg-neutral-800 rounded-lg">
                                                <FileIcon className="text-blue-400" size={24} />
                                            </div>
                                            <div>
                                                <p className="font-medium text-neutral-200">{file.filename}</p>
                                                <p className="text-sm text-neutral-500">{new Date(file.created_at).toLocaleDateString()}</p>
                                            </div>
                                        </div>
                                        
                                        <div className="flex items-center gap-3">
                                            {shareTokens[file.id] ? (
                                                <div className="flex items-center gap-2 bg-neutral-950 border border-neutral-700 px-3 py-1.5 rounded-md max-w-xs overflow-hidden">
                                                    <input 
                                                        type="text" 
                                                        readOnly 
                                                        value={shareTokens[file.id]} 
                                                        className="bg-transparent text-sm w-48 text-neutral-300 outline-none"
                                                    />
                                                    <button 
                                                        onClick={() => navigator.clipboard.writeText(shareTokens[file.id])}
                                                        className="text-blue-400 hover:text-blue-300 text-xs font-medium"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                            ) : (
                                                <button 
                                                    onClick={() => handleCreateLink(file.id)}
                                                    className="px-3 py-1.5 flex items-center gap-2 text-sm text-neutral-300 bg-neutral-800 hover:bg-neutral-700 rounded-md transition-colors"
                                                >
                                                    <LinkIcon size={16} /> Share Link
                                                </button>
                                            )}
                                            
                                            <button 
                                                onClick={() => handleDelete(file.id)}
                                                className="p-1.5 text-neutral-500 hover:text-red-400 hover:bg-red-400/10 rounded-md transition-colors"
                                            >
                                                <Trash2 size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </main>
        </div>
    );
}
