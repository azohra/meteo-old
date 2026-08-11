/* The docs, rendered in place — not linked out to GitHub. Real markdown
 * (docs.ts imports it raw, unmodified) through `marked`, with in-repo links
 * rewritten to internal navigation so reading one doc can lead to another
 * without ever leaving the page. */
import { marked } from "marked";
import { useEffect, useMemo, useRef } from "react";
import { DOCS, DOC_BY_KEY, rewriteDocLinks, type DocKey } from "./docs";

export function DocsView({
  page,
  onNavigate,
}: {
  page: DocKey;
  onNavigate: (page: DocKey, hash: string) => void;
}) {
  const doc = DOC_BY_KEY.get(page) ?? DOC_BY_KEY.get("readme")!;
  const contentRef = useRef<HTMLDivElement>(null);

  const html = useMemo(() => {
    const rewritten = rewriteDocLinks(doc.markdown, doc.repoPath);
    return marked.parse(rewritten, { async: false }) as string;
  }, [doc]);

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 });
  }, [doc]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("#/")) return; // real external hrefs navigate natively
    event.preventDefault();
    const [key, hash = ""] = href.slice(2).split("#");
    if (DOC_BY_KEY.has(key as DocKey)) onNavigate(key as DocKey, hash);
  };

  return (
    <div className="demo-docs">
      <nav aria-label="Documentation" className="demo-docs-nav">
        {DOCS.map((entry) => (
          <button
            aria-pressed={entry.key === page}
            key={entry.key}
            onClick={() => onNavigate(entry.key, "")}
            type="button"
          >
            {entry.title}
          </button>
        ))}
      </nav>
      <div
        className="demo-docs-content"
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={handleClick}
        ref={contentRef}
      />
    </div>
  );
}
