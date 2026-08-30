import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { dbOperations } from '../services/db.js';
import { pdfService, chunkDocumentPages } from '../services/pdf.js';
import { geminiService } from '../services/gemini.js';
import { vectorService } from '../services/vector.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

async function runTest() {
  console.log('================================================================');
  console.log('AI PDF Chatbot - RAG Pipeline Integration Test');
  console.log('================================================================');

  // Get PDF file path from arguments
  const pdfPathArg = process.argv[2];
  if (!pdfPathArg) {
    console.log('\nUsage: npm run test:rag -- <path-to-pdf-file> "<test-query>"\n');
    console.log('Running test with a mock document check...');
    await runMockVerification();
    return;
  }

  // Verify API Key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith('your_gemini_api_key')) {
    console.error('ERROR: GEMINI_API_KEY is not configured in your .env file.');
    console.error('Please configure it and run this test again.');
    process.exit(1);
  }

  const resolvedPdfPath = path.resolve(pdfPathArg);
  if (!fs.existsSync(resolvedPdfPath)) {
    console.error(`ERROR: File not found at: ${resolvedPdfPath}`);
    process.exit(1);
  }

  const testQuery = process.argv[3] || 'What is the main topic of this document?';
  console.log(`Target PDF: ${path.basename(resolvedPdfPath)}`);
  console.log(`Test Query: "${testQuery}"`);
  console.log('\n--- Step 1: Parsing PDF File ---');

  try {
    const docName = path.basename(resolvedPdfPath);
    const docSize = fs.statSync(resolvedPdfPath).size;
    const documentId = dbOperations.createDocument(docName, resolvedPdfPath, docSize);
    
    // Ingest PDF
    const parseResult = await pdfService.parsePDF(resolvedPdfPath, documentId);
    console.log(`✓ PDF parsed successfully (${parseResult.pagesCount} pages, method: ${parseResult.method}).`);

    console.log('\n--- Step 2: Intelligent Chunking ---');
    const chunks = chunkDocumentPages(parseResult.pages, documentId);
    console.log(`✓ Text chunked into ${chunks.length} segments.`);
    if (chunks.length > 0) {
      console.log(`  Sample chunk 1 (Page ${chunks[0].page_number}): "${chunks[0].content.slice(0, 120)}..."`);
    } else {
      throw new Error('No chunks generated. Parsing yielded empty results.');
    }

    console.log('\n--- Step 3: Embeddings Generation & DB Insertion ---');
    dbOperations.insertChunks(chunks);
    const chunkTexts = chunks.map(c => c.content);
    const embeddings = await geminiService.getEmbeddings(chunkTexts);
    
    const embeddingRecords = chunks.map((chunk, index) => ({
      chunk_id: chunk.id,
      document_id: documentId,
      embedding: embeddings[index]
    }));
    dbOperations.insertEmbeddings(embeddingRecords);
    dbOperations.updateDocumentStatus(documentId, 'ready', parseResult.pagesCount);
    console.log('✓ Embeddings saved successfully to database.');

    console.log('\n--- Step 4: Hybrid Search Retrieval ---');
    const retrievedChunks = await vectorService.search(testQuery, [documentId], 5);
    console.log(`✓ Retrieved ${retrievedChunks.length} chunks after Hybrid & Gemini Reranking.`);
    retrievedChunks.forEach((chunk, i) => {
      console.log(`  [Rank ${i+1}] (Page ${chunk.page_number}): "${chunk.content.slice(0, 150)}..."`);
    });

    console.log('\n--- Step 5: Gemini RAG Question Answering ---');
    const mockHistory = [{ role: 'user', content: testQuery }];
    let completedText = '';

    await geminiService.streamChatResponse(
      mockHistory,
      retrievedChunks,
      (textChunk) => {
        process.stdout.write(textChunk);
        completedText += textChunk;
      },
      (doneText) => {
        console.log('\n\n✓ Streaming finished.');
        console.log('================================================================');
        console.log('TEST PASSED SUCCESSFULLY');
        console.log('================================================================');
        
        // Clean up document from database to keep test run clean
        dbOperations.deleteDocument(documentId);
      },
      (error) => {
        throw error;
      }
    );

  } catch (error) {
    console.error('\n✗ TEST FAILED with error:', error);
    process.exit(1);
  }
}

// Simulates a pipeline verification if no file is provided
async function runMockVerification() {
  console.log('\nChecking service imports and database connection...');
  try {
    // Check SQLite insertion
    const mockId = dbOperations.createDocument('mock.pdf', '/path/mock.pdf', 1024);
    dbOperations.updateDocumentStatus(mockId, 'ready', 5);
    const docs = dbOperations.getDocuments();
    const mockDoc = docs.find(d => d.id === mockId);
    
    if (mockDoc && mockDoc.name === 'mock.pdf') {
      console.log('✓ SQLite DatabaseSync read/write operations OK.');
      dbOperations.deleteDocument(mockId);
    } else {
      throw new Error('DatabaseSync check failed.');
    }

    console.log('✓ Basic service configurations are verified.');
    console.log('\nTo run a full RAG pipeline test with Gemini embeddings and API generation, provide a PDF file:');
    console.log('  npm run test:rag -- <path-to-pdf-file> "<test-query>"\n');
  } catch (error) {
    console.error('✗ Mock verification failed:', error);
  }
}

runTest();
