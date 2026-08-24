import fs from 'fs';
import crypto from 'crypto';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { geminiService } from './gemini.js';

/**
 * Clean and normalize text extracted from PDF.
 */
function cleanText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Splits text into sentences using regex.
 */
function getSentences(text) {
  if (!text) return [];
  // Basic sentence splitter: looks for punctuation followed by space/newline
  return text.split(/(?<=[.!?])\s+/);
}

/**
 * Intelligent chunker.
 * Groups sentences into chunks of target size (~1000 chars) with overlap (~200 chars).
 * Retains page number for each chunk.
 */
export function chunkDocumentPages(pages, documentId) {
  const chunks = [];
  const targetSize = 1000;
  const overlapSize = 200;

  for (const pageObj of pages) {
    const pageNum = pageObj.page;
    const text = cleanText(pageObj.text);
    if (!text) continue;

    const sentences = getSentences(text);
    let currentChunk = '';
    let chunkIndex = 0;

    for (let i = 0; i < sentences.length; i++) {
      const sentence = sentences[i];
      
      if ((currentChunk + ' ' + sentence).length <= targetSize) {
        currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
      } else {
        // Save current chunk
        if (currentChunk.trim()) {
          chunks.push({
            id: `${documentId}_p${pageNum}_c${chunkIndex++}`,
            document_id: documentId,
            page_number: pageNum,
            content: currentChunk.trim()
          });
        }

        // Create new chunk with overlap
        // Take a few sentences from the end of the previous chunk as overlap
        let overlap = '';
        let j = i - 1;
        while (j >= 0 && (overlap + ' ' + sentences[j]).length <= overlapSize) {
          overlap = sentences[j] + (overlap ? ' ' + overlap : '');
          j--;
        }
        
        currentChunk = overlap ? overlap + ' ' + sentence : sentence;
      }
    }

    // Push final chunk for this page
    if (currentChunk.trim()) {
      chunks.push({
        id: `${documentId}_p${pageNum}_c${chunkIndex}`,
        document_id: documentId,
        page_number: pageNum,
        content: currentChunk.trim()
      });
    }
  }

  return chunks;
}

export const pdfService = {
  /**
   * Main entrypoint to parse a PDF file.
   * Uses local parsing first, and falls back to Gemini File API if document is scanned/OCR needed.
   * @param {string} filePath - Absolute path to the PDF file.
   * @param {string} documentId - Database ID of the document.
   * @param {boolean} forceOCR - Force Gemini OCR parsing even if text is present.
   */
  parsePDF: async (filePath, documentId, forceOCR = false) => {
    let pages = [];
    let isScanned = false;
    let localPagesCount = 0;

    try {
      if (!forceOCR) {
        console.log(`Starting local PDF parsing for ${filePath}...`);
        const data = new Uint8Array(fs.readFileSync(filePath));
        const loadingTask = pdfjs.getDocument({
          data,
          useSystemFonts: true,
          disableFontFace: true,
        });
        const pdfDocument = await loadingTask.promise;
        localPagesCount = pdfDocument.numPages;

        let totalCharCount = 0;

        for (let i = 1; i <= localPagesCount; i++) {
          const page = await pdfDocument.getPage(i);
          const textContent = await page.getTextContent();
          const textItems = textContent.items.map(item => item.str);
          const pageText = textItems.join(' ');
          totalCharCount += pageText.length;
          pages.push({ page: i, text: pageText });
        }

        // Check if PDF is scanned (empty text or extremely low character count per page)
        const avgChars = localPagesCount > 0 ? totalCharCount / localPagesCount : 0;
        console.log(`Local parsing complete. Extracted ${localPagesCount} pages. Avg chars/page: ${avgChars.toFixed(1)}`);
        
        if (avgChars < 100) {
          console.log(`Average characters per page is ${avgChars.toFixed(1)} (< 100). Flagging document as scanned.`);
          isScanned = true;
        }
      }
    } catch (localError) {
      console.warn('Local PDF extraction failed or file is corrupted. Falling back to Gemini File API:', localError);
      isScanned = true;
    }

    // If scanned, empty, or OCR forced, use Gemini OCR
    if (isScanned || forceOCR || pages.length === 0) {
      try {
        console.log(`Attempting Gemini Multimodal OCR parsing for ${filePath}...`);
        const parsedPages = await geminiService.parsePDFMultimodal(filePath);
        console.log(`Gemini OCR parsing complete. Extracted ${parsedPages.length} pages.`);
        return {
          pagesCount: parsedPages.length,
          pages: parsedPages,
          method: 'gemini-ocr'
        };
      } catch (geminiError) {
        console.error('Gemini OCR parsing failed as well:', geminiError);
        // Robust fallback: if we got some text locally, use it instead of failing completely!
        if (pages.length > 0 && !forceOCR) {
          console.warn('Falling back to locally extracted text, despite low character density.');
          return {
            pagesCount: localPagesCount,
            pages: pages,
            method: 'local-fallback'
          };
        }
        throw new Error('Failed to parse PDF document. Both local extraction and Gemini OCR failed.');
      }
    }

    return {
      pagesCount: localPagesCount,
      pages: pages,
      method: 'local'
    };
  }
};
