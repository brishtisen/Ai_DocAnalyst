import React, { useState, useEffect, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import ChatArea from './components/ChatArea';
import PDFViewer from './components/PDFViewer';

// Reads from environment variable (VITE_API_URL) at build time,
// with automatic fallback to your live Render backend for production, and relative proxy for dev.
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? '' : 'https://ai-docanalyst.onrender.com');

export default function App() {
  // Theme state
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('docanalyst-theme');
    return saved || 'dark';
  });

  // UI state
  const [conversations, setConversations] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [selectedDocIds, setSelectedDocIds] = useState([]);
  
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [streamingCitations, setStreamingCitations] = useState([]);

  // File upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // PDF Viewer state
  const [viewingDoc, setViewingDoc] = useState(null);
  const [pdfPageNum, setPdfPageNum] = useState(1);
  const [isViewerCollapsed, setIsViewerCollapsed] = useState(true);

  // Apply theme to document element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('docanalyst-theme', theme);
  }, [theme]);

  const handleToggleTheme = () => {
    setTheme(prev => prev === 'dark' ? 'light' : 'dark');
  };

  /* ==========================================================================
     API DATA LOADING
     ========================================================================== */

  const loadDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/documents`);
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error('Failed to load documents:', err);
    }
  }, []);

  const loadConversations = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/conversations`);
      if (res.ok) {
        const data = await res.json();
        setConversations(data);
        // If there's conversations and none active, select the first one
        if (data.length > 0 && !activeSessionId) {
          setActiveSessionId(data[0].id);
        }
      }
    } catch (err) {
      console.error('Failed to load conversations:', err);
    }
  }, [activeSessionId]);

  const loadMessages = useCallback(async (sessionId) => {
    if (!sessionId) return;
    try {
      const res = await fetch(`${API_URL}/api/conversations/${sessionId}/messages`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data);
      }
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
  }, []);

  // Initial Load
  useEffect(() => {
    loadDocuments();
    loadConversations();
  }, [loadDocuments, loadConversations]);

  // Load messages when active session changes
  useEffect(() => {
    if (activeSessionId) {
      loadMessages(activeSessionId);
    } else {
      setMessages([]);
    }
  }, [activeSessionId, loadMessages]);

  // Ingestion status polling: polls every 3 seconds if any doc is 'processing'
  useEffect(() => {
    const hasProcessingDocs = documents.some(doc => doc.status === 'processing');
    if (!hasProcessingDocs) return;

    const interval = setInterval(() => {
      loadDocuments();
    }, 3000);

    return () => clearInterval(interval);
  }, [documents, loadDocuments]);

  // Select all uploaded docs by default as they finish processing
  useEffect(() => {
    const readyDocIds = documents.filter(d => d.status === 'ready').map(d => d.id);
    setSelectedDocIds(prev => {
      // Keep only selection choices that are still in documents list
      const filtered = prev.filter(id => readyDocIds.includes(id));
      // If we had none selected and now have ready ones, auto-select them
      if (filtered.length === 0 && readyDocIds.length > 0 && prev.length === 0) {
        return readyDocIds;
      }
      return filtered;
    });
  }, [documents]);

  /* ==========================================================================
     HANDLERS
     ========================================================================== */

  // Chat session creation
  const handleCreateSession = async () => {
    try {
      const res = await fetch(`${API_URL}/api/conversations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: `Chat ${new Date().toLocaleDateString()}` })
      });
      if (res.ok) {
        const newSession = await res.json();
        setConversations(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
      }
    } catch (err) {
      console.error('Failed to create chat session:', err);
    }
  };

  // Chat session deletion
  const handleDeleteSession = async (id) => {
    try {
      const res = await fetch(`${API_URL}/api/conversations/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setConversations(prev => prev.filter(s => s.id !== id));
        if (activeSessionId === id) {
          setActiveSessionId(null);
        }
      }
    } catch (err) {
      console.error('Failed to delete chat session:', err);
    }
  };

  // Document Toggle Filter Selection
  const handleToggleDocSelect = (id) => {
    setSelectedDocIds(prev => 
      prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]
    );
  };

  // Document deletion
  const handleDeleteDoc = async (id) => {
    if (!window.confirm('Are you sure you want to delete this document? All associated vectors will be erased.')) return;
    try {
      const res = await fetch(`${API_URL}/api/documents/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== id));
        if (viewingDoc && viewingDoc.id === id) {
          setViewingDoc(null);
          setIsViewerCollapsed(true);
        }
      }
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
  };

  // PDF File Upload Handler (using XHR for upload progress tracking)
  const handleUploadFiles = async (files) => {
    setIsUploading(true);
    setUploadProgress(0);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.type !== 'application/pdf') {
        alert(`"${file.name}" is not a PDF file. Only PDF uploads are supported.`);
        continue;
      }

      await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('pdf', file);

        xhr.open('POST', `${API_URL}/api/documents`, true);

        // Upload progress listener
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setUploadProgress(pct);
          }
        });

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            let errResponse = {};
            try {
              errResponse = JSON.parse(xhr.responseText || '{}');
            } catch {
              errResponse = {};
            }
            reject(new Error(errResponse.error || 'Upload failed'));
          }
        };

        xhr.onerror = () => reject(new Error('Network error during upload.'));
        xhr.send(formData);
      })
      .catch(err => {
        console.error('File upload failed:', err);
        alert(`Failed to upload file "${file.name}": ${err.message}`);
      });
    }

    setIsUploading(false);
    setUploadProgress(0);
    // Refresh documents list
    loadDocuments();
    // Auto-create chat if none active
    if (!activeSessionId) {
      handleCreateSession();
    }
  };

  // Click handler on citation badging
  const handleCitationClick = (docId, docName, pageNumber) => {
    setViewingDoc({ id: docId, name: docName });
    setPdfPageNum(pageNumber);
    setIsViewerCollapsed(false);
  };

  // Sending chat query messages & handling the Server-Sent Events (SSE) stream
  const handleSendMessage = async (text) => {
    if (!activeSessionId) return;

    // Add user message locally first
    const userMsgId = Date.now().toString();
    const newUserMessage = {
      id: userMsgId,
      role: 'user',
      content: text,
      created_at: new Date().toISOString()
    };
    
    setMessages(prev => [...prev, newUserMessage]);
    setInputValue('');
    setIsStreaming(true);
    setStreamingText('');
    setStreamingCitations([]);

    try {
      const response = await fetch(`${API_URL}/api/conversations/${activeSessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: text,
          documentIds: selectedDocIds
        })
      });

      if (!response.ok) {
        throw new Error('Server returned an error.');
      }

      // Stream Reader setup
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        // Decode binary chunk and append to stream buffer
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        
        // Keep the last unfinished line in buffer
        buffer = lines.pop();

        for (const line of lines) {
          const trimmedLine = line.trim();
          if (trimmedLine.startsWith('data: ')) {
            const dataStr = trimmedLine.slice(6);
            try {
              const data = JSON.parse(dataStr);
              
              if (data.error) {
                alert(`Error: ${data.error}`);
                setIsStreaming(false);
                return;
              }

              if (data.citations) {
                setStreamingCitations(data.citations);
              }

              if (data.text) {
                setStreamingText(prev => prev + data.text);
              }

              if (data.done) {
                // Done! Refresh messages list to sync with DB
                loadMessages(activeSessionId);
                setIsStreaming(false);
                setStreamingText('');
                setStreamingCitations([]);
              }
            } catch (jsonErr) {
              console.error('Failed to parse SSE JSON chunk:', dataStr, jsonErr);
            }
          }
        }
      }
    } catch (err) {
      console.error('Query message transaction failed:', err);
      alert(`Chat transaction failed: ${err.message}`);
      setIsStreaming(false);
    }
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <Sidebar
        conversations={conversations}
        activeSessionId={activeSessionId}
        onSelectSession={setActiveSessionId}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        documents={documents}
        selectedDocIds={selectedDocIds}
        onToggleDocSelect={handleToggleDocSelect}
        onDeleteDoc={handleDeleteDoc}
        onUploadFiles={handleUploadFiles}
        isUploading={isUploading}
        uploadProgress={uploadProgress}
        theme={theme}
        onToggleTheme={handleToggleTheme}
      />

      {/* Main split work pane */}
      <div className="main-workspace">
        {/* Chat area */}
        <ChatArea
          messages={messages}
          activeSessionId={activeSessionId}
          documents={documents}
          selectedDocIds={selectedDocIds}
          inputValue={inputValue}
          onChangeInput={setInputValue}
          onSendMessage={handleSendMessage}
          isStreaming={isStreaming}
          streamingText={streamingText}
          streamingCitations={streamingCitations}
          onCitationClick={handleCitationClick}
        />

        {/* PDF viewer panel */}
        <PDFViewer
          viewingDoc={viewingDoc}
          pdfPageNum={pdfPageNum}
          onClose={() => setIsViewerCollapsed(true)}
          isCollapsed={isViewerCollapsed}
          onToggleCollapse={() => setIsViewerCollapsed(prev => !prev)}
          apiUrl={API_URL}
        />
      </div>
    </div>
  );
}
