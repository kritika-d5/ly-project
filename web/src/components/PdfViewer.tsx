import { useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import Icon from './Icon';

// Vite resolves this to a hashed asset URL at build time; without it pdf.js
// falls back to a CDN worker that the browser may block.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

/**
 * The official SCR PDF, streamed through the API (the S3 bucket sends no CORS
 * header, so the browser cannot fetch it directly).
 *
 * This is the reading surface. The chatbot does NOT read this file — it reads
 * the structured chunks parsed from the Kanoon HTML of the same judgment. Same
 * judgment, two representations: one for a human's eyes, one that preserves
 * who-is-speaking labels a PDF cannot carry.
 */
export default function PdfViewer({ url }: { url: string }) {
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [failed, setFailed] = useState<string | null>(null);

  if (failed) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-gold-200 bg-gold-50 p-4 text-sm text-gold-700">
        <Icon name="alert" size={16} className="mt-0.5" />
        <span>
        Could not load the official PDF ({failed}). The full text is still available on the
        Text tab.
        </span>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="flex items-center gap-1 rounded border border-stone-300 bg-white px-2.5 py-1
                       transition-colors hover:border-maroon-300 disabled:opacity-40"
          >
            <Icon name="chevronLeft" size={14} />
            Previous
          </button>
          <span className="text-stone-600 tabular-nums">
            {page} / {numPages || '…'}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(numPages, p + 1))}
            disabled={!numPages || page >= numPages}
            className="flex items-center gap-1 rounded border border-stone-300 bg-white px-2.5 py-1
                       transition-colors hover:border-maroon-300 disabled:opacity-40"
          >
            Next
            <Icon name="chevronRight" size={14} />
          </button>
        </div>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1.5 text-xs text-stone-500 underline underline-offset-4
                     hover:text-maroon-700"
        >
          <Icon name="external" size={13} />
          Open original
        </a>
      </div>

      <div className="rounded-lg border border-stone-200 bg-stone-100 p-3 overflow-auto">
        <Document
          file={url}
          onLoadSuccess={({ numPages: n }) => setNumPages(n)}
          onLoadError={(e) => setFailed(e.message)}
          loading={<p className="p-8 text-center text-sm text-stone-500">Loading PDF…</p>}
        >
          <Page pageNumber={page} width={720} renderTextLayer={false} renderAnnotationLayer={false} />
        </Document>
      </div>
    </div>
  );
}
