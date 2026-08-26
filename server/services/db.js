import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Database path: server/database.db
const dbDir = path.resolve(__dirname, '..');
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}
const dbPath = path.join(dbDir, 'database.db');
const db = new DatabaseSync(dbPath);

// Initialize Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    size INTEGER NOT NULL,
    pages INTEGER DEFAULT 0,
    status TEXT DEFAULT 'processing', -- 'processing', 'ready', 'failed'
    error_message TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    page_number INTEGER NOT NULL,
    content TEXT NOT NULL,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS embeddings (
    chunk_id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    embedding TEXT NOT NULL, -- JSON representation of the float array
    FOREIGN KEY(chunk_id) REFERENCES chunks(id) ON DELETE CASCADE,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL,
    role TEXT NOT NULL, -- 'user' or 'model'
    content TEXT NOT NULL,
    citations TEXT, -- JSON string array of citations
    created_at TEXT NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );
`);

// Helper Database Operations
export const dbOperations = {
  // Document Operations
  createDocument: (name, filePath, size) => {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO documents (id, name, path, size, pages, status, created_at)
      VALUES (?, ?, ?, ?, 0, 'processing', ?)
    `);
    stmt.run(id, name, filePath, size, createdAt);
    return id;
  },

  updateDocumentStatus: (id, status, pages = 0, errorMessage = null) => {
    const stmt = db.prepare(`
      UPDATE documents 
      SET status = ?, pages = ?, error_message = ? 
      WHERE id = ?
    `);
    stmt.run(status, pages, errorMessage, id);
  },

  getDocuments: () => {
    const stmt = db.prepare(`SELECT * FROM documents ORDER BY created_at DESC`);
    return stmt.all();
  },

  getDocument: (id) => {
    const stmt = db.prepare(`SELECT * FROM documents WHERE id = ?`);
    const results = stmt.all(id);
    return results[0] || null;
  },

  deleteDocument: (id) => {
    // Foreign keys will cascade delete chunks and embeddings
    const stmt = db.prepare(`DELETE FROM documents WHERE id = ?`);
    stmt.run(id);
  },

  // Chunk Operations
  insertChunks: (chunks) => {
    // chunks: Array of { id, document_id, page_number, content }
    const stmt = db.prepare(`
      INSERT INTO chunks (id, document_id, page_number, content)
      VALUES (?, ?, ?, ?)
    `);
    for (const chunk of chunks) {
      stmt.run(chunk.id, chunk.document_id, chunk.page_number, chunk.content);
    }
  },

  getChunksForDocuments: (documentIds) => {
    if (!documentIds || documentIds.length === 0) return [];
    
    // Prepare placeholders like (?, ?, ?)
    const placeholders = documentIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT c.id, c.document_id, c.page_number, c.content, d.name as document_name 
      FROM chunks c
      JOIN documents d ON c.document_id = d.id
      WHERE c.document_id IN (${placeholders})
    `);
    return stmt.all(...documentIds);
  },

  // Embedding Operations
  insertEmbeddings: (embeddings) => {
    // embeddings: Array of { chunk_id, document_id, embedding } (embedding is array of numbers)
    const stmt = db.prepare(`
      INSERT INTO embeddings (chunk_id, document_id, embedding)
      VALUES (?, ?, ?)
    `);
    for (const emb of embeddings) {
      stmt.run(emb.chunk_id, emb.document_id, JSON.stringify(emb.embedding));
    }
  },

  getEmbeddingsForDocuments: (documentIds) => {
    if (!documentIds || documentIds.length === 0) return [];
    
    const placeholders = documentIds.map(() => '?').join(',');
    const stmt = db.prepare(`
      SELECT e.chunk_id, e.document_id, e.embedding, c.content, c.page_number, d.name as document_name
      FROM embeddings e
      JOIN chunks c ON e.chunk_id = c.id
      JOIN documents d ON e.document_id = d.id
      WHERE e.document_id IN (${placeholders})
    `);
    return stmt.all(...documentIds);
  },

  // Conversation Operations
  createConversation: (title = 'New Chat') => {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO conversations (id, title, created_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(id, title, createdAt);
    return id;
  },

  getConversations: () => {
    const stmt = db.prepare(`SELECT * FROM conversations ORDER BY created_at DESC`);
    return stmt.all();
  },

  getConversation: (id) => {
    const stmt = db.prepare(`SELECT * FROM conversations WHERE id = ?`);
    const results = stmt.all(id);
    return results[0] || null;
  },

  updateConversationTitle: (id, title) => {
    const stmt = db.prepare(`UPDATE conversations SET title = ? WHERE id = ?`);
    stmt.run(title, id);
  },

  deleteConversation: (id) => {
    const stmt = db.prepare(`DELETE FROM conversations WHERE id = ?`);
    stmt.run(id);
  },

  // Message Operations
  insertMessage: (conversationId, role, content, citations = null) => {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const citationsStr = citations ? JSON.stringify(citations) : null;
    const stmt = db.prepare(`
      INSERT INTO messages (id, conversation_id, role, content, citations, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, conversationId, role, content, citationsStr, createdAt);
    return id;
  },

  getMessages: (conversationId) => {
    const stmt = db.prepare(`
      SELECT * FROM messages 
      WHERE conversation_id = ? 
      ORDER BY created_at ASC
    `);
    const results = stmt.all(conversationId);
    return results.map(msg => ({
      ...msg,
      citations: msg.citations ? JSON.parse(msg.citations) : null
    }));
  }
};

export default db;
