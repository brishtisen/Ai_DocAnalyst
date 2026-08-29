import ReactMarkdown from 'react-markdown';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import 'katex/dist/katex.min.css';
import React, { useRef, useEffect } from 'react';
import { Send, FileText, Bot, User, Check, ShieldAlert } from 'lucide-react';

export default function ChatArea({
  messages,
  activeSessionId,
  documents,
  selectedDocIds,
  inputValue,
  onChangeInput,
  onSendMessage,
  isStreaming,
  streamingText,
  streamingCitations,
  onCitationClick
}) {
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  // Auto-scroll to bottom of chat on new messages or streaming updates
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText]);

  // Autogrow text area
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
    }
  }, [inputValue]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (inputValue.trim() && !isStreaming) {
      onSendMessage(inputValue.trim());
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Beautiful Custom Markdown & Citation Parser
const renderParsedMarkdown = (text, citationsList = [], isMessageStreaming = false) => {
  if (!text) return null;

  const citationRegex =
    /\[([^\]]+)\]\(citation:\/\/([^?]+)\?page=(\d+)\)/g;

  const parts = [];
  let lastIndex = 0;
  let match;

  while ((match = citationRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push({
        type: 'markdown',
        content: text.slice(lastIndex, match.index)
      });
    }

    parts.push({
      type: 'citation',
      docName: match[1],
      docId: match[2],
      pageNum: parseInt(match[3], 10)
    });

    lastIndex = citationRegex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push({
      type: 'markdown',
      content: text.slice(lastIndex)
    });
  }

  if (parts.length === 0) {
    parts.push({
      type: 'markdown',
      content: text
    });
  }

  return parts.map((part, index) => {
    if (part.type === 'citation') {
      return (
        <span
          key={`citation-${index}`}
          className="citation-pill"
          onClick={() =>
            onCitationClick(
              part.docId,
              part.docName,
              part.pageNum
            )
          }
          title={`Click to open ${part.docName} on Page ${part.pageNum}`}
        >
          📄 {part.docName}, p. {part.pageNum}
        </span>
      );
    }

    return (
      <ReactMarkdown
        key={`markdown-${index}`}
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={{
          h1: ({ children }) => (
            <h1 style={{ margin: '12px 0 8px' }}>{children}</h1>
          ),

          h2: ({ children }) => (
            <h2 style={{ margin: '12px 0 8px' }}>{children}</h2>
          ),

          h3: ({ children }) => (
            <h3 style={{ margin: '10px 0 6px' }}>{children}</h3>
          ),

          p: ({ children }) => (
            <p style={{ margin: '0 0 10px', lineHeight: 1.6 }}>
              {children}
            </p>
          ),

          ul: ({ children }) => (
            <ul style={{ margin: '6px 0 10px 20px' }}>
              {children}
            </ul>
          ),

          ol: ({ children }) => (
            <ol style={{ margin: '6px 0 10px 20px' }}>
              {children}
            </ol>
          ),

          li: ({ children }) => (
            <li style={{ marginBottom: '4px' }}>
              {children}
            </li>
          ),

          code: ({ inline, className, children, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');

            if (!inline) {
              return (
                <pre className="markdown-code-block">
                  <code className={match ? `language-${match[1]}` : ''} {...props}>
                    {String(children).replace(/\n$/, '')}
                  </code>
                </pre>
              );
            }

            return (
              <code className="markdown-inline-code" {...props}>
                {children}
              </code>
            );
          },

          table: ({ children }) => (
            <div
              className="table-responsive"
              style={{
                overflowX: 'auto',
                margin: '15px 0'
              }}
            >
              <table>{children}</table>
            </div>
          ),

          th: ({ children }) => (
            <th>{children}</th>
          ),

          td: ({ children }) => (
            <td>{children}</td>
          ),

          blockquote: ({ children }) => (
            <blockquote
              style={{
                borderLeft: '3px solid var(--color-primary)',
                paddingLeft: '12px',
                margin: '10px 0',
                opacity: 0.9
              }}
            >
              {children}
            </blockquote>
          )
        }}
      >
        {part.content}
      </ReactMarkdown>
    );
  });
};

  // Render starter cards
  const activeDocs = documents.filter(d => selectedDocIds.includes(d.id) && d.status === 'ready');

  const renderEmptyState = () => {
    if (documents.length === 0) {
      return (
        <div className="chat-empty-state">
          <div className="welcome-icon-box">
            <FileText size={32} />
          </div>
          <h2 className="welcome-title">Welcome to DocAnalyst</h2>
          <p className="welcome-desc">
            To get started, upload one or multiple PDFs in the sidebar. Once uploaded, the documents will be analyzed, indexed, and made ready for conversation.
          </p>
        </div>
      );
    }

    if (activeDocs.length === 0) {
      return (
        <div className="chat-empty-state">
          <div className="welcome-icon-box" style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger)' }}>
            <ShieldAlert size={32} />
          </div>
          <h2 className="welcome-title">Select Documents to Start</h2>
          <p className="welcome-desc">
            You have uploaded documents, but none are selected. Check the boxes next to the documents in the sidebar to activate them in your search context.
          </p>
        </div>
      );
    }

    return (
      <div className="chat-empty-state">
        <div className="welcome-icon-box">
          <Bot size={32} />
        </div>
        <h2 className="welcome-title">AI Document Analyst Ready</h2>
        <p className="welcome-desc">
          Ask questions about the selected files ({activeDocs.length} active). Queries use semantic hybrid retrieval and LLM reranking to fetch page-exact answers.
        </p>
        
        <div className="starter-questions-grid">
          <div className="starter-card" onClick={() => onSendMessage("Summarize the key takeaways and main topics of this document.")}>
            <strong>Summarize Document</strong>
            <p style={{ color: 'var(--color-text-secondary)', marginTop: '4px', fontSize: '0.8rem' }}>Get a rapid breakdown of themes, scope, and conclusions.</p>
          </div>
          <div className="starter-card" onClick={() => onSendMessage("What are the main statistics, metrics, or table calculations reported?")}>
            <strong>Extract Key Metrics</strong>
            <p style={{ color: 'var(--color-text-secondary)', marginTop: '4px', fontSize: '0.8rem' }}>Perform numerical discovery and isolate table balances.</p>
          </div>
          <div className="starter-card" onClick={() => onSendMessage("What are the major limitations, risks, or conflicts raised?")}>
            <strong>Identify Risks</strong>
            <p style={{ color: 'var(--color-text-secondary)', marginTop: '4px', fontSize: '0.8rem' }}>Search for clauses, exceptions, risk items, and disclosures.</p>
          </div>
          <div className="starter-card" onClick={() => onSendMessage("Create a detailed structured index of the contents of the files.")}>
            <strong>Table of Contents</strong>
            <p style={{ color: 'var(--color-text-secondary)', marginTop: '4px', fontSize: '0.8rem' }}>Map the document structures page-by-page.</p>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="chat-container">
      {/* Header Info */}
      <div className="chat-header">
        <div className="chat-header-info">
          <h2 style={{ fontSize: '1rem', fontWeight: 600 }}>Conversation</h2>
          {activeDocs.length > 0 && (
            <span className="active-filters-pill">
              {activeDocs.length} PDF{activeDocs.length > 1 ? 's' : ''} Selected
            </span>
          )}
        </div>
      </div>

      {/* Message Feed */}
      <div className="chat-messages">
        {(!activeSessionId || (messages.length === 0 && !streamingText)) ? (
          renderEmptyState()
        ) : (
          <>
            {messages.map((msg) => (
              <div key={msg.id} className="message-bubble">
                <div className={`message-avatar ${msg.role}`}>
                  {msg.role === 'user' ? <User size={18} /> : <Bot size={18} />}
                </div>
                <div className="message-content">
                  <span className="message-sender">
                    {msg.role === 'user' ? 'You' : 'DocAnalyst AI'}
                  </span>
                  <div className="message-text">
                    {renderParsedMarkdown(msg.content, msg.citations)}
                  </div>
                  
                  {/* Collapsible Source Citation Block */}
                  {msg.role === 'model' && msg.citations && msg.citations.length > 0 && (
                    <div className="message-citations-block">
                      <span className="citations-title">Sources Cited:</span>
                      <div className="citations-list-container">
                        {msg.citations.map((cite, cIdx) => (
                          <span 
                            key={cIdx} 
                            className="citation-pill"
                            onClick={() => onCitationClick(cite.document_id, cite.document_name, cite.page_number)}
                            title={cite.content.slice(0, 150) + '...'}
                          >
                            📄 {cite.document_name} (Page {cite.page_number})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {/* Render Streaming Chunk (if active) */}
            {isStreaming && streamingText && (
              <div className="message-bubble">
                <div className="message-avatar model">
                  <Bot size={18} />
                </div>
                <div className="message-content">
                  <span className="message-sender">DocAnalyst AI</span>
                  <div className="message-text streaming-cursor">
                    {renderParsedMarkdown(streamingText, streamingCitations, true)}
                  </div>
                  
                  {streamingCitations && streamingCitations.length > 0 && (
                    <div className="message-citations-block">
                      <span className="citations-title">Sources:</span>
                      <div className="citations-list-container">
                        {streamingCitations.map((cite, cIdx) => (
                          <span 
                            key={cIdx} 
                            className="citation-pill"
                            onClick={() => onCitationClick(cite.document_id, cite.document_name, cite.page_number)}
                          >
                            📄 {cite.document_name} (Page {cite.page_number})
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input controls */}
      <div className="chat-input-container">
        <form onSubmit={handleSubmit} className="chat-input-wrapper">
          <textarea
            ref={textareaRef}
            rows={1}
            value={inputValue}
            onChange={(e) => onChangeInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              !activeSessionId 
                ? "Start a new conversation..." 
                : activeDocs.length === 0 
                  ? "Select a document in the sidebar to write..." 
                  : "Ask a question about the active documents..."
            }
            className="chat-textarea"
            disabled={!activeSessionId || activeDocs.length === 0 || isStreaming}
          />
          <div className="chat-input-controls">
            <span className="chat-input-meta">
              {isStreaming ? 'Streaming response...' : 'Shift + Enter for new line'}
            </span>
            <button 
              type="submit" 
              className="send-message-btn"
              disabled={!inputValue.trim() || !activeSessionId || activeDocs.length === 0 || isStreaming}
            >
              <Send size={16} />
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
