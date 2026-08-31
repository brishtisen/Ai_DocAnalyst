import { GoogleGenAI } from '@google/genai';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load env variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config();

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GEMINI_EMBEDDING_MODEL = process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001';

let ai = null;

// Initialize Gemini Client
export function getGeminiClient() {
  if (ai) return ai;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.startsWith('your_gemini_api_key')) {
    throw new Error('GEMINI_API_KEY is not configured in .env file.');
  }

  ai = new GoogleGenAI({ apiKey });
  return ai;
}

export const geminiService = {
  /**
   * Generates embeddings for an array of texts.
   * Uses multi-model fallback (gemini-embedding-001, text-embedding-004, embedding-001).
   */
  getEmbeddings: async (texts) => {
    const client = getGeminiClient();
    const batchSize = 100;
    const embeddings = [];
    const candidateModels = [
      GEMINI_EMBEDDING_MODEL,
      'gemini-embedding-001',
      'text-embedding-004',
      'embedding-001'
    ].filter((v, i, a) => a.indexOf(v) === i);

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize);
      let lastError = null;
      let batchSuccess = false;

      for (const modelName of candidateModels) {
        try {
          const response = await client.models.embedContent({
            model: modelName,
            contents: batch,
          });

          if (response.embeddings) {
            const vals = response.embeddings.map(e => e.values || e);
            embeddings.push(...vals);
            batchSuccess = true;
            break;
          } else if (response.embedding) {
            embeddings.push(response.embedding.values || response.embedding);
            batchSuccess = true;
            break;
          }
        } catch (err) {
          lastError = err;
          console.warn(`Embedding attempt with ${modelName} failed, trying next candidate:`, err.message);
        }
      }

      if (!batchSuccess) {
        console.error('All embedding candidate models failed.');
        throw lastError || new Error('Failed to generate embeddings with all candidate models.');
      }
    }

    return embeddings;
  },

  /**
   * Performs high-fidelity parsing of a PDF using Gemini File API.
   * Extracts text and tables page-by-page in structured Markdown.
   */
  parsePDFMultimodal: async (filePath) => {
    const client = getGeminiClient();
    console.log(`Uploading ${filePath} to Gemini File API for OCR/Multimodal parsing...`);

    let fileUpload;
    try {
      // 1. Upload the PDF file
      fileUpload = await client.files.upload({
        file: filePath,
        mimeType: 'application/pdf',
      });

      console.log(`File uploaded successfully: ${fileUpload.name}. Starting content extraction...`);

      // 2. Query Gemini Flash to extract text page-by-page in JSON
      const prompt = `
        You are a high-fidelity document parsing engine. Read this PDF document.
        Extract the text and tabular content of this PDF page by page.
        - For every page, output all text and format tables as Markdown tables.
        - Preserve the original reading order, document headers, footers, and page numbers.
        - Output the extracted pages as a JSON array of objects, with keys "page" (integer, 1-indexed) and "text" (string in Markdown format).
        - Format the response strictly as a JSON array. Do not enclose it in markdown blocks like \`\`\`json.
        
        Example structure:
        [
          {"page": 1, "text": "# Page Title\\nThis is some paragraph text..."},
          {"page": 2, "text": "## Section\\n| Header 1 | Header 2 |\\n|---|---|\\n| Val 1 | Val 2 |"}
        ]
      `;

      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          fileUpload,
          prompt
        ],
        config: {
          responseMimeType: 'application/json',
        }
      });

      const responseText = response.text;
      try {
        const pages = JSON.parse(responseText);
        return pages; // [{ page: 1, text: '...' }, ...]
      } catch (parseError) {
        console.error('Failed to parse Gemini JSON output, attempting extraction cleanup:', parseError);
        console.log('Gemini raw output:', responseText);
        // Fallback: try to strip markdown code blocks if the model wrapped it
        const jsonMatch = responseText.match(/\[\s*\{[\s\S]*\}\s*\]/);
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0]);
        }
        throw new Error('Failed to parse Gemini OCR output into structured JSON.');
      }
    } catch (error) {
      console.error('Gemini Multimodal PDF parsing error:', error);
      throw error;
    } finally {
      // 3. Clean up the file from Gemini cloud
      if (fileUpload && fileUpload.name) {
        try {
          await client.files.delete({ name: fileUpload.name });
          console.log(`Cleaned up uploaded file ${fileUpload.name} from Gemini File API.`);
        } catch (cleanupError) {
          console.warn('Failed to clean up file from Gemini File API:', cleanupError);
        }
      }
    }
  },

  /**
   * Reranks the retrieved chunks by query relevance using Gemini.
   * Returns sorted array of indices of the most relevant chunks.
   */
  rerankChunks: async (query, chunks, topK = 5) => {
    if (!chunks || chunks.length === 0) return [];
    if (chunks.length <= topK) {
      return chunks.map((_, index) => index); // No need to rerank if under topK
    }

    const client = getGeminiClient();
    
    // Format chunks for prompt
    const formattedChunks = chunks.map((c, i) => `[Chunk ${i}] (Doc: ${c.document_name}, Page: ${c.page_number})\n${c.content}\n---`).join('\n');

    const prompt = `
      You are an expert information retrieval assistant. Your task is to rank the retrieved text chunks based on their relevance to the user's query.
      
      Query: "${query}"
      
      Retrieved Chunks:
      ${formattedChunks}
      
      Rank the chunks. Return a JSON array of objects containing:
      - "index" (integer): The index of the chunk (e.g. 0 for Chunk 0)
      - "relevance_score" (integer, 0-10): How relevant the chunk is to answering the query (10 is extremely relevant, 0 is irrelevant)
      
      Sort the JSON list in descending order of relevance. Return only the JSON list of all chunks. Do not wrap it in \`\`\`json.
      
      Example output:
      [
        {"index": 2, "relevance_score": 9},
        {"index": 0, "relevance_score": 8},
        {"index": 1, "relevance_score": 3}
      ]
    `;

    try {
      const response = await client.models.generateContent({
        model: GEMINI_MODEL,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
        }
      });

      const rankings = JSON.parse(response.text);
      // Filter out low scores (e.g. relevance < 2) and return topK indices
      const sortedIndices = rankings
        .filter(r => r.relevance_score >= 2)
        .map(r => r.index)
        .slice(0, topK);

      return sortedIndices;
    } catch (error) {
      console.error('Error in Gemini reranking, falling back to original vector scores:', error);
      // Return first topK items as fallback
      return Array.from({ length: Math.min(chunks.length, topK) }, (_, i) => i);
    }
  },

  /**
   * Streams chat completions back to the user, incorporating context chunks.
   */
  streamChatResponse: async (chatHistory, contextChunks, onChunk, onDone, onError) => {
    const client = getGeminiClient();

    // Prepare context block
    const contextText = contextChunks
      .map((c, i) => `[Source ${i+1}] Document: "${c.document_name}" (ID: ${c.document_id}), Page: ${c.page_number}\n${c.content}\n`)
      .join('\n');

    // Build the system instructions
    const systemInstruction = `
      You are a professional AI document analyst. You answer questions accurately based ONLY on the provided document context.
      
      Here is the document context:
      ${contextText}
      
      Strict Rules:
      1. Answer the user's question using the context. Be direct, clear, and professional.
      2. Support your assertions with citations. For any fact you state from the context, append an inline citation pointing to the source index.
         Format the citation EXACTLY like this: [Document Name](citation://documentId?page=pageNumber).
         Example: "The profit increased by 15% in Q3 [Financial Report](citation://report123?page=4)."
         DO NOT write page numbers inside the brackets, the link MUST use the format: citation://<document_id>?page=<page_number>.
         Do NOT generate general citations like [1] or [Source]. Use the specified markdown URL format.
      3. If the answer cannot be found in the provided context, state clearly: "I cannot find the answer to this question in the uploaded documents." Do NOT attempt to answer using external training knowledge or hallucinate any facts.
      4. For numerical or mathematical questions, check the tables in the context. Show your step-by-step calculations explicitly so the user can verify them.
      5. Keep the conversation context in mind for follow-up questions, but always prioritize the document context to formulate answers.
    `;

    // Map conversation history into Gemini format
    // Gemini expects: [{ role: 'user'|'model', parts: [{ text: '...' }] }]
    const contents = chatHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    }));

    try {
      const responseStream = await client.models.generateContentStream({
        model: GEMINI_MODEL,
        contents: contents,
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.1, // Low temperature for factual accuracy
        }
      });

      let completeText = '';
      for await (const chunk of responseStream) {
        const text = chunk.text || '';
        completeText += text;
        onChunk(text);
      }
      
      onDone(completeText);
    } catch (error) {
      console.error('Error streaming Gemini response:', error);
      onError(error);
    }
  }
};
