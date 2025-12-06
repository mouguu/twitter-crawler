import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  CheckCircle,
  XCircle,
  RefreshCw,
  FileJson,
  User,
  Cookie,
  FileUp,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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

  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [cookieName, setCookieName] = useState('');

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
    } catch {
      setError('Network error while fetching sessions');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSessions();
  }, []);

  // When file is selected, open the modal
  const handleFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setSelectedFile(file);
    // Default name: remove .json extension
    const defaultName = file.name.replace(/\.json$/i, '');
    setCookieName(defaultName);
    setIsModalOpen(true);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Upload the file with custom name
  const handleUpload = async () => {
    if (!selectedFile) return;

    setUploading(true);
    const formData = new FormData();

    // Sanitize the name and ensure .json extension
    let finalName = cookieName.trim() || selectedFile.name.replace(/\.json$/i, '');
    finalName = finalName.replace(/[^a-zA-Z0-9_-]/g, '_'); // Sanitize special chars
    if (!finalName.endsWith('.json')) {
      finalName += '.json';
    }

    // Create a new file with the custom name
    const renamedFile = new File([selectedFile], finalName, { type: selectedFile.type });
    formData.append('file', renamedFile);

    try {
      const response = await fetch('/api/cookies', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();

      if (data.success) {
        await fetchSessions();
        setError(null);
        setIsModalOpen(false);
        setSelectedFile(null);
        setCookieName('');
      } else {
        setError(data.error || 'Upload failed');
      }
    } catch {
      setError('Network error during upload');
    } finally {
      setUploading(false);
    }
  };

  const handleCloseModal = () => {
    setIsModalOpen(false);
    setSelectedFile(null);
    setCookieName('');
  };

  return (
    <section id="sessions" className="py-12">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            Sessions
          </h2>
          <p className="text-sm text-muted-foreground mt-1 ml-13">
            Manage your Twitter accounts and cookies
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={fetchSessions} disabled={loading}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>

          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileSelect}
            accept=".json"
            className="hidden"
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="gap-2"
          >
            {uploading ? (
              <RefreshCw className="w-4 h-4 animate-spin" />
            ) : (
              <Upload className="w-4 h-4" />
            )}
            Upload Cookies
          </Button>
        </div>
      </div>

      {/* Upload Modal */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="w-5 h-5" />
              Name Your Session
            </DialogTitle>
            <DialogDescription>
              Give this cookie file a memorable name. This will be used as the filename.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            {/* File Info */}
            {selectedFile && (
              <div className="flex items-center gap-3 p-3 bg-muted/50 rounded-lg border border-border/50">
                <FileJson className="w-8 h-8 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{selectedFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(selectedFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
              </div>
            )}

            {/* Name Input */}
            <div className="space-y-2">
              <Label htmlFor="cookie-name">Session Name</Label>
              <Input
                id="cookie-name"
                value={cookieName}
                onChange={(e) => setCookieName(e.target.value)}
                placeholder="e.g. my_twitter_account"
                className="font-mono"
              />
              <p className="text-xs text-muted-foreground">
                Will be saved as:{' '}
                <code className="bg-muted px-1 rounded">
                  {cookieName.trim() ? `${cookieName.replace(/[^a-zA-Z0-9_-]/g, '_')}.json` : '...'}
                </code>
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={handleCloseModal}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={uploading || !cookieName.trim()}>
              {uploading ? (
                <>
                  <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                  Uploading...
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4 mr-2" />
                  Upload
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="mb-6 p-4 bg-red-50 border border-red-100 rounded-xl text-red-800 text-sm flex items-center gap-3"
          >
            <XCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sessions Grid */}
      {sessions.length === 0 && !loading ? (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="border border-dashed border-border rounded-2xl p-12 text-center"
        >
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-muted flex items-center justify-center">
            <FileJson className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-medium mb-2">No sessions found</h3>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto">
            Upload a cookie JSON file to add Twitter accounts for scraping.
          </p>
        </motion.div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {sessions.map((session, index) => (
              <motion.div
                key={session.filename}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ delay: index * 0.05 }}
                className={`
                                    relative p-5 rounded-2xl border transition-all duration-300 group
                                    ${
                                      session.isValid
                                        ? 'bg-card border-border/50 hover:border-border hover:shadow-md'
                                        : 'bg-red-50/50 border-red-100 hover:border-red-200'
                                    }
                                `}
              >
                <div className="flex items-start gap-4">
                  <div
                    className={`
                                        w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 transition-colors
                                        ${session.isValid ? 'bg-muted text-foreground' : 'bg-red-100 text-red-600'}
                                    `}
                  >
                    {session.isValid ? (
                      <CheckCircle className="w-5 h-5" />
                    ) : (
                      <XCircle className="w-5 h-5" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <h4 className="font-medium truncate group-hover:text-foreground transition-colors">
                      {session.username
                        ? `@${session.username}`
                        : session.filename.replace(/\.json$/i, '')}
                    </h4>

                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="secondary" className="font-mono text-2xs">
                        {session.filename}
                      </Badge>
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Cookie className="w-3 h-3" />
                        {session.cookieCount}
                      </span>
                    </div>

                    {!session.isValid && session.error && (
                      <p className="text-xs text-red-600 mt-3 line-clamp-2">{session.error}</p>
                    )}
                  </div>
                </div>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
