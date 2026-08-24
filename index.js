import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { dbOperations } from './services/db.js';
import { pdfService, chunkDocumentPages } from './services/pdf.js';
import { geminiService, getGeminiClient } from './services/gemini.js';
import { vectorService } from './services/vector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// Set up upload folder
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    // Avoid filename collisions
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are supported!'), false);
    }
  },
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Helper: Query Reformulation
async function reformulateQuery(chatHistory, currentQuestion) {
  if (!chatHistory || chatHistory.length === 0) return currentQuestion;
  
  // Only keep last 4 messages to save tokens and keep it focused
  const recentHistory = chatHistory.slice(-4);
  const historyText = recentHistory
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = `
    Given the following conversation history and a follow-up question, rewrite the question into a standalone, descriptive search query that contains all necessary context from the conversation. The query will be used for document retrieval. Do not answer the question, only output the rewritten search query.
    
    Conversation History:
    ${historyText}
    
    Follow-up Question: ${currentQuestion}
    
    Standalone Search Query:
  `;

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-3.6-flash',
      contents: prompt,
    });
    const rewritten = response.text.trim();
    console.log(`Reformulated query from: "${currentQuestion}" to: "${rewritten}"`);
    return rewritten;
  } catch (error) {
    console.warn('Failed to reformulate query, using original question:', error);
    return currentQuestion;
  }
}

/* ==========================================================================
   API ROUTES
   ========================================================================== */

// 1. Get List of Documents
app.get('/api/documents', (req, res) => {
  try {
    const docs = dbOperations.getDocuments();
    res.json(docs);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve documents.' });
  }
});

// 2. Upload Document & Ingest Asynchronously
app.post('/api/documents', upload.single('pdf'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No PDF file uploaded.' });
  }

  const { originalname, path: filePath, size } = req.file;
  let documentId;

  try {
    // Save document metadata as 'processing'
    documentId = dbOperations.createDocument(originalname, filePath, size);
    
    // Respond to user immediately with file registration details
    res.status(202).json({
      message: 'PDF uploaded successfully. Processing started.',
      documentId
    });

    // Start background ingestion
    (async () => {
      try {
        // A. Parse PDF (Local extraction or Gemini OCR fallback)
        const parseResult = await pdfService.parsePDF(filePath, documentId);
        
        // B. Chunk Text pages
        const chunks = chunkDocumentPages(parseResult.pages, documentId);
        if (chunks.length === 0) {
          throw new Error('No text or content could be extracted from the PDF.');
        }

        // C. Generate embeddings in batch
        console.log(`Generating embeddings for ${chunks.length} chunks of document: "${originalname}"...`);
        const chunkTexts = chunks.map(c => c.content);
        const embeddings = await geminiService.getEmbeddings(chunkTexts);

        // D. Save chunks & embeddings to database
        dbOperations.insertChunks(chunks);
        
        const embeddingRecords = chunks.map((chunk, index) => ({
          chunk_id: chunk.id,
          document_id: documentId,
          embedding: embeddings[index]
        }));
        dbOperations.insertEmbeddings(embeddingRecords);

        // E. Update status to 'ready'
        dbOperations.updateDocumentStatus(documentId, 'ready', parseResult.pagesCount);
        console.log(`Document "${originalname}" successfully ingested with ${chunks.length} chunks.`);

      } catch (ingestError) {
        console.error(`Failed to ingest document ID: ${documentId}:`, ingestError);
        dbOperations.updateDocumentStatus(documentId, 'failed', 0, ingestError.message);
      }
    })();

  } catch (error) {
    console.error('File upload registration failed:', error);
    res.status(500).json({ error: 'Failed to register and upload file.' });
  }
});

// 3. Delete Document
app.delete('/api/documents/:id', (req, res) => {
  const { id } = req.params;
  try {
    const doc = dbOperations.getDocument(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    // Delete record from Database (cascades chunk & embedding deletion)
    dbOperations.deleteDocument(id);

    // Delete physical file from disk
    if (fs.existsSync(doc.path)) {
      fs.unlinkSync(doc.path);
    }

    res.json({ message: 'Document successfully deleted.' });
  } catch (error) {
    console.error('Failed to delete document:', error);
    res.status(500).json({ error: 'Failed to delete document.' });
  }
});

// 4. View PDF File (Inline display in iframe)
app.get('/api/documents/:id/view', (req, res) => {
  const { id } = req.params;
  try {
    const doc = dbOperations.getDocument(id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found.' });
    }

    if (!fs.existsSync(doc.path)) {
      return res.status(404).json({ error: 'Physical PDF file missing from disk.' });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.name)}"`);
    fs.createReadStream(doc.path).pipe(res);
  } catch (error) {
    console.error('Failed to serve PDF:', error);
    res.status(500).json({ error: 'Failed to serve PDF.' });
  }
});

// 5. Conversation History Endpoints
app.get('/api/conversations', (req, res) => {
  try {
    const list = dbOperations.getConversations();
    res.json(list);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch conversations.' });
  }
});

app.post('/api/conversations', (req, res) => {
  const { title } = req.body;
  try {
    const id = dbOperations.createConversation(title || 'New Chat');
    res.status(201).json({ id, title: title || 'New Chat' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create conversation.' });
  }
});

app.delete('/api/conversations/:id', (req, res) => {
  const { id } = req.params;
  try {
    dbOperations.deleteConversation(id);
    res.json({ message: 'Conversation deleted.' });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete conversation.' });
  }
});

app.get('/api/conversations/:id/messages', (req, res) => {
  const { id } = req.params;
  try {
    const messages = dbOperations.getMessages(id);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve messages.' });
  }
});

// 6. Conversational Streaming RAG Query
app.post('/api/conversations/:id/messages', async (req, res) => {
  const { id: conversationId } = req.params;
  const { content, documentIds } = req.body;

  if (!content) {
    return res.status(400).json({ error: 'Message content is required.' });
  }

  // Set up Server Sent Events headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  try {
    // 1. Get history for conversation
    const history = dbOperations.getMessages(conversationId);

    // 2. Save user message to database
    dbOperations.insertMessage(conversationId, 'user', content);

    // 3. Check document filters
    if (!documentIds || documentIds.length === 0) {
      res.write(`data: ${JSON.stringify({ error: 'Please upload and select at least one document to start chatting.' })}\n\n`);
      res.end();
      return;
    }

    // 4. Reformulate query based on conversation history
    const searchQuery = await reformulateQuery(history, content);

    // 5. Query Hybrid Vector + Keyword Search
    const contextChunks = await vectorService.search(searchQuery, documentIds, 5);

    if (contextChunks.length === 0) {
      const responseText = "I cannot find any relevant sections in the uploaded documents to answer your question.";
      dbOperations.insertMessage(conversationId, 'model', responseText);
      res.write(`data: ${JSON.stringify({ text: responseText, done: true })}\n\n`);
      res.end();
      return;
    }

    // Send context metadata (sources) to the client immediately
    const citations = contextChunks.map(chunk => ({
      document_id: chunk.document_id,
      document_name: chunk.document_name,
      page_number: chunk.page_number,
      content: chunk.content
    }));

    res.write(`data: ${JSON.stringify({ citations })}\n\n`);

    // 6. Construct prompt and stream response
    // Append user's new message to the chatHistory sent to the model
    const chatHistoryForGemini = [...history, { role: 'user', content }];

    await geminiService.streamChatResponse(
      chatHistoryForGemini,
      contextChunks,
      (textChunk) => {
        // Stream text chunk
        res.write(`data: ${JSON.stringify({ text: textChunk })}\n\n`);
      },
      (completeText) => {
        // On completion, save model message in DB
        dbOperations.insertMessage(conversationId, 'model', completeText, citations);
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      },
      (error) => {
        console.error('Error during streaming:', error);
        res.write(`data: ${JSON.stringify({ error: 'An error occurred while generating response. Please try again.' })}\n\n`);
        res.end();
      }
    );

  } catch (error) {
    console.error('Failed to process message query:', error);
    res.write(`data: ${JSON.stringify({ error: error.message || 'Failed to process message.' })}\n\n`);
    res.end();
  }
});

/* ==========================================================================
   START SERVER
   ========================================================================== */
app.listen(PORT, () => {
  console.log(`Server running in ${process.env.NODE_ENV || 'development'} mode on http://localhost:${PORT}`);
});
