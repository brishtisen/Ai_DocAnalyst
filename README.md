# DocAnalyst - AI PDF Document Analyst

An advanced, production-quality Multi-Document Chatbot and AI Analyst. It parses, indexes, and searches multiple PDFs using a robust Hybrid RAG (Retrieval-Augmented Generation) pipeline featuring Semantic Dense Search, Keyword BM25 Sparse Search, Reciprocal Rank Fusion (RRF), and Gemini LLM Reranking.

Features a premium dark/light mode UI inspired by Claude and Linear, complete with an integrated PDF viewer and interactive page-exact citations that automatically navigate and highlight sources.

---

## 🚀 Getting Started

### 1. Prerequisites
- **Node.js**: v18.0.0 or higher (Tested on v24.18.0)
- **NPM**: v9.0.0 or higher
- **Gemini API Key**: A valid key from [Google AI Studio](https://aistudio.google.com/)

### 2. Set Up Environment Variables
Create a `.env` file in the root folder of the project. You can copy the template:
```bash
# In the project root (C:\Users\USER\.gemini\antigravity\scratch\ai-pdf-chatbot)
copy .env.example .env
```
Open `.env` and fill in your Gemini API key:
```env
GEMINI_API_KEY=AIzaSy...
```

*Alternatively, run this PowerShell command to quickly append your key:*
```powershell
Add-Content -Path "C:\Users\USER\.gemini\antigravity\scratch\ai-pdf-chatbot\.env" -Value "GEMINI_API_KEY=your_actual_key"
```

### 3. Run the Application
Start both the Express server (port 5000) and the Vite React frontend (port 3000) concurrently with a single command:
```bash
npm run dev
```
Open your browser and navigate to **`http://localhost:3000`**.

---

## 🛠️ Project Architecture

```
ai-pdf-chatbot/
  ├── package.json              # Root package to orchestrate concurrent dev environments
  ├── .env                      # Local API keys (ignored by Git)
  ├── .env.example              # Configuration template
  ├── .gitignore                # Excludes node_modules, database files, and uploaded PDFs
  ├── README.md                 # Project handbook
  ├── server/
  │    ├── package.json         # Backend dependencies (Express, Multer, @google/genai, pdfjs-dist)
  │    ├── index.js             # Express entrypoint, routes, SSE streaming, file uploads
  │    ├── database.db          # Native SQLite database (auto-created)
  │    ├── services/
  │    │    ├── db.js           # SQLite db client using native node:sqlite
  │    │    ├── pdf.js          # local PDF parsing + Gemini File API OCR fallback and chunking
  │    │    ├── vector.js       # Dense similarity calculations + custom BM25 + RRF Hybrid search
  │    │    └── gemini.js       # Gemini API wrappers (embeddings, reranking, completions)
  │    └── tests/
  │         └── rag.test.js     # Programmatic RAG accuracy & parser test runner
  └── frontend/
       ├── package.json         # React client dependencies (vite, lucide-react)
       ├── vite.config.js       # Dev server configurations & API routing proxies
       ├── index.html           # Fonts and responsive headers
       └── src/
            ├── main.jsx        # App mounting entrypoint
            ├── index.css       # Core design tokens, light/dark theme variables, transitions
            ├── App.jsx         # App coordinator (SSE streams, uploads, states)
            └── components/
                 ├── Sidebar.jsx     # Document manager, upload drops, session selections
                 ├── ChatArea.jsx    # Custom Markdown parser, citations, starter prompts
                 └── PDFViewer.jsx   # Embedded PDF viewport side-by-side with page navigations
```

---

## 🧬 How the Hybrid RAG Works

1. **Ingestion**:
   - Standard text PDFs are parsed locally and for free using `pdfjs-dist`.
   - If a page has very sparse text (scanned PDF/images), it automatically falls back to **Gemini File API**, utilizing Google's state-of-the-art vision models to extract structured markdown text and tables.
   - Text is split into semantic paragraphs/sentences (~1000 characters, ~200 characters overlap) while keeping track of page numbers.
   - Embeddings are generated using Gemini's `text-embedding-004` and stored in SQLite.

2. **Retrieval**:
   - When you type a query, the conversation context is condensed into a standalone query.
   - **Semantic Search**: Computes cosine similarity of the query embedding against the SQLite database vectors.
   - **Keyword Search**: Runs a lightweight custom JavaScript **BM25 TF-IDF** algorithm on the active documents.
   - **RRF Integration**: Combines dense semantic rankings and sparse keyword rankings using Reciprocal Rank Fusion.
   - **Reranking**: Sends the top 15 RRF candidates to Gemini for an LLM-based reranking, selecting the top 5 most relevant chunks to prevent LLM noise.

3. **Response & Citations**:
   - The final answer is streamed to the user via Server-Sent Events (SSE).
   - Citations are sent as metadata and rendered inside the chat bubble as clickable pills (`📄 Financial Report, p. 12`).
   - Clicking a pill launches the integrated viewer, reloading the PDF at the specific page (`#page=12`).

---

## 🧪 Integration Testing
Verify the backend RAG pipeline by running the test runner against any PDF file:
```bash
# syntax: npm run test:rag -- <path-to-pdf> "<query>"
npm run test:rag -- server/uploads/sample.pdf "Calculate the total revenue reported in the table"
```
If no arguments are provided, it runs a quick SQLite and service configuration integrity check.
