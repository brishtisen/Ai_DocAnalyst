import { dbOperations } from './db.js';
import { geminiService } from './gemini.js';

/**
 * Computes cosine similarity between two vectors.
 */
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Tokenizes text into lowercase terms.
 */
function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // remove punctuation except hyphens
    .split(/\s+/)
    .filter(token => token.length > 0);
}

/**
 * Custom BM25 Sparse Retrieval implementation in pure JS.
 */
function runBM25Search(query, chunks, k1 = 1.2, b = 0.75) {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || chunks.length === 0) {
    return chunks.map(c => ({ chunk: c, score: 0 }));
  }

  const N = chunks.length;
  
  // Calculate term statistics
  const docTokensList = chunks.map(c => tokenize(c.content || ''));
  const docLengths = docTokensList.map(tokens => tokens.length);
  const avgDL = docLengths.reduce((sum, len) => sum + len, 0) / N;

  // Calculate Document Frequency (DF) for each query term
  const df = {};
  for (const term of queryTerms) {
    df[term] = 0;
    for (const tokens of docTokensList) {
      if (tokens.includes(term)) {
        df[term]++;
      }
    }
  }

  // Calculate Inverse Document Frequency (IDF)
  const idf = {};
  for (const term of queryTerms) {
    const docFreq = df[term] || 0;
    // Standard BM25 IDF formulation
    idf[term] = Math.log((N - docFreq + 0.5) / (docFreq + 0.5) + 1);
  }

  // Score each document
  const scoredChunks = chunks.map((chunk, idx) => {
    const tokens = docTokensList[idx];
    const docLen = docLengths[idx];
    
    // Count Term Frequency (TF) for each query term in this document
    const tf = {};
    for (const term of queryTerms) {
      tf[term] = tokens.filter(t => t === term).length;
    }

    let score = 0;
    for (const term of queryTerms) {
      const termTF = tf[term] || 0;
      const termIDF = idf[term] || 0;
      
      // BM25 term scoring formula
      const numerator = termTF * (k1 + 1);
      const denominator = termTF + k1 * (1 - b + b * (docLen / (avgDL || 1)));
      score += termIDF * (numerator / denominator);
    }

    return { chunk, score };
  });

  // Sort descending by score
  return scoredChunks.sort((a, b) => b.score - a.score);
}

export const vectorService = {
  /**
   * Performs hybrid retrieval over chunks of selected documents.
   * Reranks retrieval results using Reciprocal Rank Fusion (RRF),
   * then applies Gemini-based LLM reranking to return the best matches.
   * 
   * @param {string} query - The user's search query.
   * @param {Array<string>} documentIds - List of document IDs to search.
   * @param {number} finalTopK - Number of chunks to return for the LLM.
   */
  search: async (query, documentIds, finalTopK = 5) => {
    if (!documentIds || documentIds.length === 0) return [];

    console.log(`Starting Hybrid Search for query: "${query}" on documents: [${documentIds.join(', ')}]`);

    // 1. Fetch embeddings and chunks from DB
    const dbEmbeddings = dbOperations.getEmbeddingsForDocuments(documentIds);
    if (dbEmbeddings.length === 0) {
      console.log('No embeddings found for the selected documents.');
      return [];
    }

    // 2. Generate embedding for query
    const queryEmbeddings = await geminiService.getEmbeddings([query]);
    const queryVec = queryEmbeddings[0];

    // 3. Dense/Semantic Search (Cosine Similarity)
    const semanticScores = dbEmbeddings.map(record => {
      const chunkVec = JSON.parse(record.embedding);
      const similarity = cosineSimilarity(queryVec, chunkVec);
      
      return {
        id: record.chunk_id,
        document_id: record.document_id,
        document_name: record.document_name,
        page_number: record.page_number,
        content: record.content,
        score: similarity
      };
    }).sort((a, b) => b.score - a.score);

    // 4. Sparse/Keyword Search (BM25)
    // Convert DB records to basic chunk format for BM25
    const chunkListForBM25 = dbEmbeddings.map(record => ({
      id: record.chunk_id,
      document_id: record.document_id,
      document_name: record.document_name,
      page_number: record.page_number,
      content: record.content
    }));

    const keywordScores = runBM25Search(query, chunkListForBM25);

    // 5. Reciprocal Rank Fusion (RRF)
    // Create rank mappings
    const semanticRank = new Map();
    semanticScores.forEach((item, index) => {
      semanticRank.set(item.id, index + 1); // 1-indexed rank
    });

    const keywordRank = new Map();
    keywordScores.forEach((item, index) => {
      keywordRank.set(item.chunk.id, index + 1);
    });

    // Compute RRF scores (constant k = 60 is standard in research)
    const k = 60;
    const rrfScores = [];

    // Combine all unique chunks
    const allUniqueChunks = new Map();
    dbEmbeddings.forEach(record => {
      allUniqueChunks.set(record.chunk_id, {
        id: record.chunk_id,
        document_id: record.document_id,
        document_name: record.document_name,
        page_number: record.page_number,
        content: record.content
      });
    });

    for (const [chunkId, chunk] of allUniqueChunks.entries()) {
      const sRank = semanticRank.get(chunkId) || Infinity;
      const kRank = keywordRank.get(chunkId) || Infinity;
      
      const rrfScore = (1 / (k + sRank)) + (1 / (k + kRank));
      rrfScores.push({ chunk, rrfScore });
    }

    // Sort chunks by RRF score descending
    const hybridResults = rrfScores
      .sort((a, b) => b.rrfScore - a.rrfScore)
      .map(item => item.chunk);

    // Take top 15 candidates for LLM Reranking
    const topCandidates = hybridResults.slice(0, 15);
    console.log(`Hybrid RRF retrieved ${topCandidates.length} chunks. Sending to Gemini for final Reranking...`);

    // 6. Gemini LLM Reranking
    // Reranks candidate chunks and returns indices in order of relevance
    const rerankedIndices = await geminiService.rerankChunks(query, topCandidates, finalTopK);
    const finalChunks = rerankedIndices.map(idx => topCandidates[idx]);

    console.log(`Reranking complete. Selected ${finalChunks.length} final chunks for context.`);
    return finalChunks;
  }
};
