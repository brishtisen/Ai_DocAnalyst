import React, { useRef } from 'react';
import { 
  MessageSquare, Plus, Trash2, FileText, UploadCloud, 
  CheckSquare, Square, Sun, Moon, Loader2, AlertTriangle, CheckCircle2 
} from 'lucide-react';

export default function Sidebar({
  conversations,
  activeSessionId,
  onSelectSession,
  onCreateSession,
  onDeleteSession,
  documents,
  selectedDocIds,
  onToggleDocSelect,
  onDeleteDoc,
  onUploadFiles,
  isUploading,
  uploadProgress,
  theme,
  onToggleTheme
}) {
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onUploadFiles(e.dataTransfer.files);
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files.length > 0) {
      onUploadFiles(e.target.files);
    }
  };

  const formatSize = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  return (
    <aside className="sidebar">
      {/* Logo & Header */}
      <div className="sidebar-header">
        <div className="logo-container">
          <FileText className="logo-icon" size={24} />
          <span className="logo-text">DocAnalyst</span>
        </div>
      </div>

      {/* New Chat Button */}
      <button className="new-chat-btn" onClick={onCreateSession}>
        <Plus size={18} />
        New Chat
      </button>

      {/* Sidebar sections */}
      <div className="sidebar-section">
        {/* Chats History List */}
        <div>
          <h3 className="sidebar-title">Chats</h3>
          {conversations.length === 0 ? (
            <p style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)', paddingLeft: '5px' }}>
              No chats yet.
            </p>
          ) : (
            <div className="sessions-list">
              {conversations.map((session) => (
                <div 
                  key={session.id} 
                  className={`session-item ${session.id === activeSessionId ? 'active' : ''}`}
                  onClick={() => onSelectSession(session.id)}
                >
                  <MessageSquare size={16} style={{ flexShrink: 0, marginRight: '8px' }} />
                  <span className="session-title-text">{session.title}</span>
                  <button 
                    className="delete-session-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteSession(session.id);
                    }}
                    title="Delete Chat"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Document Ingestion & Listing */}
        <div>
          <h3 className="sidebar-title">Documents</h3>
          
          {/* Drag & Drop Upload Zone */}
          <div 
            className="upload-zone"
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              style={{ display: 'none' }} 
              multiple 
              accept=".pdf"
              onChange={handleFileChange}
              disabled={isUploading}
            />
            {isUploading ? (
              <Loader2 className="upload-icon" style={{ animation: 'spin 1.5s linear infinite' }} size={24} />
            ) : (
              <UploadCloud className="upload-icon" size={24} />
            )}
            <p className="upload-text">
              {isUploading ? 'Uploading...' : <span>Upload PDFs</span>}
            </p>
            {isUploading && (
              <div className="upload-progress-container">
                <div className="progress-bar-bg">
                  <div 
                    className="progress-bar-fill" 
                    style={{ width: `${uploadProgress}%` }}
                  ></div>
                </div>
              </div>
            )}
          </div>

          {/* Uploaded Documents List */}
          <div className="docs-list" style={{ marginTop: '15px' }}>
            {documents.map((doc) => {
              const isSelected = selectedDocIds.includes(doc.id);
              return (
                <div 
                  key={doc.id} 
                  className={`doc-item-row ${isSelected && doc.status === 'ready' ? 'selected' : ''}`}
                >
                  {doc.status === 'ready' ? (
                    <button 
                      onClick={() => onToggleDocSelect(doc.id)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                    >
                      {isSelected ? (
                        <CheckSquare size={16} className="logo-icon" />
                      ) : (
                        <Square size={16} style={{ color: 'var(--color-text-muted)' }} />
                      )}
                    </button>
                  ) : doc.status === 'processing' ? (
                    <Loader2 size={16} style={{ color: 'var(--color-warning)', animation: 'spin 1.5s linear infinite', flexShrink: 0 }} />
                  ) : (
                    <AlertTriangle size={16} style={{ color: 'var(--color-danger)', flexShrink: 0 }} />
                  )}
                  
                  <div className="doc-info">
                    <p className="doc-name" title={doc.name}>{doc.name}</p>
                    <div className="doc-meta">
                      <span>{formatSize(doc.size)}</span>
                      {doc.pages > 0 && <span>• {doc.pages} pgs</span>}
                      {doc.status !== 'ready' && (
                        <span className={`status-badge ${doc.status}`}>
                          {doc.status}
                        </span>
                      )}
                    </div>
                  </div>

                  <button 
                    className="delete-doc-btn"
                    onClick={() => onDeleteDoc(doc.id)}
                    title="Delete PDF"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Sidebar Footer settings */}
      <footer className="sidebar-footer">
        <span style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>
          v1.0.0 (Node + SQLite)
        </span>
        <button className="theme-toggle-btn" onClick={onToggleTheme} title="Toggle Dark/Light Mode">
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>
      </footer>
    </aside>
  );
}
