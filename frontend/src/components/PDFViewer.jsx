import React from 'react';
import { EyeOff, FileText, ChevronLeft, ChevronRight, X, Download } from 'lucide-react';

export default function PDFViewer({
  viewingDoc,
  pdfPageNum,
  onClose,
  isCollapsed,
  onToggleCollapse,
  apiUrl = ''
}) {
  if (isCollapsed) {
    return (
      <button 
        className="viewer-toggle-btn" 
        onClick={onToggleCollapse}
        title="Open PDF Viewer"
      >
        <ChevronLeft size={16} />
      </button>
    );
  }

  // Construct source URL with page hash
  // e.g. /api/documents/123/view#page=3
  const pdfUrl = viewingDoc 
    ? `${apiUrl}/api/documents/${viewingDoc.id}/view#page=${pdfPageNum || 1}` 
    : null;

  return (
    <div className="pdf-viewer-container">
      {/* Collapse toggle handle */}
      <button 
        className="viewer-toggle-btn" 
        onClick={onToggleCollapse}
        title="Close PDF Viewer"
      >
        <ChevronRight size={16} />
      </button>

      {/* Header toolbar */}
      <div className="pdf-viewer-header">
        <div className="pdf-viewer-title-block">
          <FileText size={18} className="logo-icon" style={{ flexShrink: 0 }} />
          <span className="pdf-doc-name" title={viewingDoc ? viewingDoc.name : ''}>
            {viewingDoc ? viewingDoc.name : 'No PDF Loaded'}
          </span>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          {viewingDoc && (
            <a 
              href={`${apiUrl}/api/documents/${viewingDoc.id}/view`} 
              download={viewingDoc.name}
              className="pdf-close-btn"
              title="Download PDF"
              style={{ marginRight: '10px' }}
            >
              <Download size={18} />
            </a>
          )}
          <button 
            className="pdf-close-btn" 
            onClick={onClose}
            title="Collapse panel"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Document Area */}
      <div className="pdf-frame-wrapper">
        {viewingDoc ? (
          <iframe 
            key={`${viewingDoc.id}-${pdfPageNum}`} // Force reload iframe on page or document changes
            src={pdfUrl}
            className="pdf-iframe"
            title="PDF Document Viewer"
          />
        ) : (
          <div className="pdf-placeholder">
            <EyeOff size={48} className="pdf-placeholder-icon" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 600 }}>Viewer Inactive</h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--color-text-secondary)' }}>
              Click on an interactive citation badge inside the chat or upload a document to inspect PDF pages side-by-side.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
