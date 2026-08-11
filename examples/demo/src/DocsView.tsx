/* The docs, rendered in place — not linked out to GitHub. Real markdown
 * (docs.ts imports it raw, unmodified) through `marked`, with in-repo links
 * rewritten to internal navigation so reading one doc can lead to another
 * without ever leaving the page.
 *
 * The renderer carries three jobs marked no longer does by default:
 * heading ids (GitHub's slug algorithm, so the anchors the docs already
 * link — #3--a-season-not-a-window and friends — resolve here exactly as
 * they do on GitHub), syntax highlighting through the site's one shared
 * highlighter, and a copy button on every fence. The "On this page" rail is
 * read from the raw markdown itself (fence-aware), never from the DOM. */
import { Marked } from "marked";
import type { Tokens } from "marked";
import { useEffect, useMemo, useRef } from "react";
import { DOCS, DOC_BY_KEY, DOC_GROUPS, rewriteDocLinks, type DocKey } from "./docs";
import { escapeHtml, highlightCode } from "./highlight";

/* GitHub's anchor slug: lowercase, punctuation dropped, EVERY space a
 * hyphen (spaces are not collapsed — that is where the double hyphen in
 * "resolution--shared" comes from). */
function githubSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
}

type TocEntry = { depth: 2 | 3; id: string; text: string };

/* Fence-aware scan of the raw markdown for h2/h3 — the same slugs the
 * renderer emits, because both run the same function over the same text. */
function tableOfContents(markdown: string): TocEntry[] {
  const entries: TocEntry[] = [];
  const counts = new Map<string, number>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(##{1,2})\s+(.*)$/.exec(line);
    if (!match) continue;
    const raw = (match[2] as string).replace(/\s#+\s*$/, "");
    const base = githubSlug(raw);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    entries.push({
      depth: (match[1] as string).length as 2 | 3,
      id: seen === 0 ? base : `${base}-${seen}`,
      text: raw.replace(/[`*_]/g, ""),
    });
  }
  return entries;
}

/* One Marked instance per parse: the heading-id de-duplication counter is
 * per-document state, and a fresh instance is cheaper than sharing mutable
 * state across renders. */
function renderDocHtml(markdown: string): string {
  const counts = new Map<string, number>();
  const marked = new Marked({
    renderer: {
      heading({ tokens, depth, text }: Tokens.Heading): string {
        const base = githubSlug(text.replace(/\s#+\s*$/, ""));
        const seen = counts.get(base) ?? 0;
        counts.set(base, seen + 1);
        const id = seen === 0 ? base : `${base}-${seen}`;
        const inline = this.parser.parseInline(tokens);
        return `<h${depth} id="${id}">${inline}<a class="demo-docs-anchor" href="#${id}" aria-label="Link to this section">#</a></h${depth}>\n`;
      },
      code({ text, lang }: Tokens.Code): string {
        const language = (lang ?? "").split(/\s+/)[0];
        const html = highlightCode(text, language || undefined);
        return (
          `<div class="demo-docs-code">` +
          `<button class="demo-docs-copy" type="button">Copy</button>` +
          `<pre><code class="hljs${language ? ` language-${escapeHtml(language)}` : ""}">${html}</code></pre>` +
          `</div>\n`
        );
      },
    },
  });
  return marked.parse(markdown, { async: false }) as string;
}

export function DocsView({
  page,
  onNavigate,
}: {
  page: DocKey;
  onNavigate: (page: DocKey, hash: string) => void;
}) {
  const doc = DOC_BY_KEY.get(page) ?? DOC_BY_KEY.get("readme")!;
  const contentRef = useRef<HTMLDivElement>(null);

  const { html, toc } = useMemo(() => {
    const rewritten = rewriteDocLinks(doc.markdown, doc.repoPath);
    return { html: renderDocHtml(rewritten), toc: tableOfContents(doc.markdown) };
  }, [doc]);

  /* The page scrolls, not this div — top on every doc switch; a hash
   * navigation's own scrollIntoView (queued by the opener) lands after. */
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [doc]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const copy = (event.target as HTMLElement).closest("button.demo-docs-copy");
    if (copy) {
      const code = copy.parentElement?.querySelector("code")?.textContent ?? "";
      void navigator.clipboard?.writeText(code).then(() => {
        copy.textContent = "Copied";
        window.setTimeout(() => {
          copy.textContent = "Copy";
        }, 1_200);
      });
      return;
    }
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href");
    if (!href || !href.startsWith("#/")) return; // plain #anchor and external links navigate natively
    event.preventDefault();
    const [key, hash = ""] = href.slice(2).split("#");
    if (DOC_BY_KEY.has(key as DocKey)) onNavigate(key as DocKey, hash);
  };

  const flatIndex = DOCS.findIndex((entry) => entry.key === doc.key);
  const previous = flatIndex > 0 ? DOCS[flatIndex - 1] : undefined;
  const next = flatIndex < DOCS.length - 1 ? DOCS[flatIndex + 1] : undefined;

  return (
    <div className="demo-docs">
      <nav aria-label="Documentation" className="demo-docs-nav">
        {DOC_GROUPS.map((group) => (
          <div className="demo-docs-nav-group" key={group.label}>
            <span className="demo-docs-nav-label">{group.label}</span>
            {group.keys.map((key) => {
              const entry = DOC_BY_KEY.get(key)!;
              return (
                <button
                  aria-pressed={entry.key === page}
                  key={entry.key}
                  onClick={() => onNavigate(entry.key, "")}
                  type="button"
                >
                  {entry.title}
                </button>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="demo-docs-main">
        <div
          className="demo-docs-content"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={handleClick}
          ref={contentRef}
        />
        <nav aria-label="Previous and next page" className="demo-docs-pager">
          {previous ? (
            <button onClick={() => onNavigate(previous.key, "")} type="button">
              <span>← Previous</span>
              <strong>{previous.title}</strong>
            </button>
          ) : (
            <span />
          )}
          {next ? (
            <button className="demo-docs-pager-next" onClick={() => onNavigate(next.key, "")} type="button">
              <span>Next →</span>
              <strong>{next.title}</strong>
            </button>
          ) : (
            <span />
          )}
        </nav>
      </div>
      {toc.length > 1 && (
        <nav aria-label="On this page" className="demo-docs-toc">
          <span className="demo-docs-nav-label">On this page</span>
          {toc.map((entry) => (
            <a data-depth={entry.depth} href={`#${entry.id}`} key={entry.id}>
              {entry.text}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
