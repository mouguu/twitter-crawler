import { useState, useEffect, useRef } from 'react';
import { Upload, CheckCircle, XCircle, RefreshCw, FileJson } from 'lucide-react';

interface SessionInfo {
    filename: string;
    username: string | null;
    isValid: boolean;
    error?: string;
    cookieCount: number;
}

export function SessionManager() {
    const [sessions, setSessions] = useState<SessionInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const fetchSessions = async () => {
        setLoading(true);
        try {
            const response = await fetch('/api/sessions');
            const data = await response.json();
            if (data.success) {
                setSessions(data.sessions);
                setError(null);
            } else {
                setError(data.error || 'Failed to fetch sessions');
            }
        } catch (err) {
            setError('Network error while fetching sessions');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSessions();
    }, []);

    const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        try {
            const response = await fetch('/api/cookies', {
                method: 'POST',
                body: formData,
            });
            const data = await response.json();

            if (data.success) {
                await fetchSessions(); // Refresh list
                setError(null);
            } else {
                setError(data.error || 'Upload failed');
            }
        } catch (err) {
            setError('Network error during upload');
        } finally {
            setUploading(false);
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    return (
        <div className="bg-white/50 backdrop-blur-sm rounded-xl border border-stone/20 p-6 shadow-sm">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-xl font-display text-charcoal">Session Management</h3>
                    <p className="text-sm text-stone font-serif mt-1">
                        Manage your Twitter accounts and cookies
                    </p>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={fetchSessions} 
                        className="p-2 text-stone hover:text-rust transition-colors"
                        title="Refresh sessions"
                    >
                        <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                    <div className="relative">
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileUpload}
                            accept=".json"
                            className="hidden"
                        />
                        <button
                            onClick={() => fileInputRef.current?.click()}
                            disabled={uploading}
                            className="flex items-center gap-2 px-4 py-2 bg-charcoal text-washi rounded-lg hover:bg-charcoal/90 transition-colors disabled:opacity-50 text-sm font-medium"
                        >
                            {uploading ? (
                                <RefreshCw className="w-4 h-4 animate-spin" />
                            ) : (
                                <Upload className="w-4 h-4" />
                            )}
                            Upload Cookies
                        </button>
                    </div>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                    <XCircle className="w-4 h-4" />
                    {error}
                </div>
            )}

            <div className="grid gap-4">
                {sessions.length === 0 && !loading ? (
                    <div className="text-center py-8 text-stone/60 border-2 border-dashed border-stone/20 rounded-lg">
                        <FileJson className="w-8 h-8 mx-auto mb-2 opacity-50" />
                        <p>No sessions found. Upload a cookie JSON file to get started.</p>
                    </div>
                ) : (
                    sessions.map((session) => (
                        <div 
                            key={session.filename}
                            className={`flex items-center justify-between p-4 rounded-lg border transition-all ${
                                session.isValid 
                                    ? 'bg-white border-stone/10 hover:border-moss/30' 
                                    : 'bg-red-50/50 border-red-100'
                            }`}
                        >
                            <div className="flex items-center gap-4">
                                <div className={`p-2 rounded-full ${
                                    session.isValid ? 'bg-moss/10 text-moss' : 'bg-red-100 text-red-600'
                                }`}>
                                    {session.isValid ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                                </div>
                                <div>
                                    <h4 className="font-medium text-charcoal">
                                        {session.username ? `@${session.username}` : 'Unknown User'}
                                    </h4>
                                    <div className="flex items-center gap-3 text-xs text-stone mt-0.5">
                                        <span className="font-mono">{session.filename}</span>
                                        <span>•</span>
                                        <span>{session.cookieCount} cookies</span>
                                        {!session.isValid && (
                                            <span className="text-red-600">• {session.error}</span>
                                        )}
                                    </div>
                                </div>
                            </div>
                            
                            {/* Future: Add delete button here */}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
