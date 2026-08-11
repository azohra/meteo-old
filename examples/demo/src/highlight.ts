/* One configured highlighter for every code surface on the site — the docs
 * pages and the landing's own snippets — registered with exactly the
 * grammars the docs actually use (ts/tsx, html, sh, jsonc — counted, not
 * guessed), so the bundle never carries a language nothing renders. Colours
 * come from the CSS side: `highlightCode` emits hljs token classes only. */
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

hljs.registerLanguage("typescript", typescript); // registers ts/tsx aliases
hljs.registerLanguage("xml", xml); // registers the html alias
hljs.registerLanguage("bash", bash); // registers the sh alias
hljs.registerLanguage("json", json);

const ALIASES: Record<string, string> = { jsonc: "json" };

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Highlighted HTML for a fence, or plain escaped text for a language the
 * registry doesn't know — never a throw over a stray fence tag. */
export function highlightCode(code: string, lang: string | undefined): string {
  const language = lang ? (ALIASES[lang] ?? lang) : undefined;
  if (language && hljs.getLanguage(language)) {
    try {
      return hljs.highlight(code, { language }).value;
    } catch {
      /* fall through to plain */
    }
  }
  return escapeHtml(code);
}
