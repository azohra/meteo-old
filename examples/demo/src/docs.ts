/* The actual repo docs, imported as raw text (Vite's `?raw` suffix) — never
 * copy-pasted, so the Pages site can't drift from what's committed. One
 * link, everything you need: the gallery for what it looks like, this
 * registry for how to use it. */
import readmeRaw from "../../../README.md?raw";
import gettingStartedRaw from "../../../docs/getting-started.md?raw";
import wireContractRaw from "../../../docs/wire-contract.md?raw";
import adaptersRaw from "../../../docs/adapters.md?raw";
import clientDataRaw from "../../../docs/client-data.md?raw";
import reactRaw from "../../../docs/react.md?raw";
import elementsRaw from "../../../docs/elements.md?raw";
import themingRaw from "../../../docs/theming.md?raw";
import changelogRaw from "../../../CHANGELOG.md?raw";

export type DocKey =
  | "readme"
  | "getting-started"
  | "wire-contract"
  | "adapters"
  | "client-data"
  | "react"
  | "elements"
  | "theming"
  | "changelog";

export type DocEntry = {
  key: DocKey;
  title: string;
  /* The file's own path in the repo, root-relative — the base every
   * relative link inside it resolves against. */
  repoPath: string;
  markdown: string;
};

export const DOCS: DocEntry[] = [
  { key: "readme", title: "Overview", repoPath: "README.md", markdown: readmeRaw },
  {
    key: "getting-started",
    title: "Getting started",
    repoPath: "docs/getting-started.md",
    markdown: gettingStartedRaw,
  },
  {
    key: "wire-contract",
    title: "Wire contract",
    repoPath: "docs/wire-contract.md",
    markdown: wireContractRaw,
  },
  { key: "adapters", title: "Adapters", repoPath: "docs/adapters.md", markdown: adaptersRaw },
  {
    key: "client-data",
    title: "Client data layer",
    repoPath: "docs/client-data.md",
    markdown: clientDataRaw,
  },
  { key: "react", title: "React binding", repoPath: "docs/react.md", markdown: reactRaw },
  { key: "elements", title: "Elements binding", repoPath: "docs/elements.md", markdown: elementsRaw },
  { key: "theming", title: "Theming", repoPath: "docs/theming.md", markdown: themingRaw },
  { key: "changelog", title: "Changelog", repoPath: "CHANGELOG.md", markdown: changelogRaw },
];

/* The sidebar's argument: the wire (headless) and the pixels (bindings) are
 * peer tracks, not a core and an afterthought. */
export const DOC_GROUPS: Array<{ label: string; keys: DocKey[] }> = [
  { label: "Start", keys: ["readme", "getting-started"] },
  { label: "The wire — headless", keys: ["wire-contract", "adapters", "client-data"] },
  { label: "The pixels — bindings", keys: ["react", "elements", "theming"] },
  { label: "Project", keys: ["changelog"] },
];

export const DOC_BY_KEY = new Map(DOCS.map((doc) => [doc.key, doc]));
const KEY_BY_REPO_PATH = new Map(DOCS.map((doc) => [doc.repoPath, doc.key]));

export function isDocKey(value: string | null): value is DocKey {
  return value != null && DOC_BY_KEY.has(value as DocKey);
}

export type ResolvedLink =
  | { kind: "internal"; key: DocKey; hash: string }
  | { kind: "external"; href: string };

/* A markdown link inside one doc pointing at another (or at the repo root)
 * resolves to an internal, in-page navigation; everything else — external
 * URLs, images, schema/, LICENSE — falls back to the real GitHub blob URL,
 * so nothing this component doesn't render ever 404s. */
export function resolveDocLink(href: string, fromRepoPath: string): ResolvedLink {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "external", href }; // any URL scheme, incl. mailto:
  const hashIndex = href.indexOf("#");
  const pathPart = hashIndex === -1 ? href : href.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : href.slice(hashIndex + 1);
  const baseDir = fromRepoPath.includes("/")
    ? fromRepoPath.slice(0, fromRepoPath.lastIndexOf("/") + 1)
    : "";
  const resolvedPath = new URL(pathPart || ".", `https://_/${baseDir}`).pathname.replace(/^\//, "");
  const key = KEY_BY_REPO_PATH.get(resolvedPath);
  if (key) return { kind: "internal", key, hash };
  /* An image (or any other non-.md asset) wants raw bytes, not GitHub's blob
   * *viewer* page — an <img src> pointed at the viewer just breaks. */
  const isImage = /\.(svg|png|jpe?g|gif|webp|avif)$/i.test(resolvedPath);
  return {
    kind: "external",
    href: isImage
      ? `https://raw.githubusercontent.com/azohra/meteo-old/main/${resolvedPath}`
      : `https://github.com/azohra/meteo-old/blob/main/${resolvedPath}${hash ? `#${hash}` : ""}`,
  };
}

function rewriteHref(href: string, fromRepoPath: string): string {
  const resolved = resolveDocLink(href, fromRepoPath);
  return resolved.kind === "internal"
    ? `#/${resolved.key}${resolved.hash ? `#${resolved.hash}` : ""}`
    : resolved.href;
}

/* Two syntaxes carry links/images in these docs: markdown's own
 * `[text](url)` / `![alt](url)`, and raw HTML (the README's `<picture>`
 * header, the gallery `<table>`) that markdown passes through untouched.
 * Both need rewriting, or "raw HTML" quietly means "broken here". */
export function rewriteDocLinks(markdown: string, fromRepoPath: string): string {
  const withMarkdownLinks = markdown.replace(
    /(\]\()([^)\s]+)(\))/g,
    (whole, open: string, href: string, close: string) => `${open}${rewriteHref(href, fromRepoPath)}${close}`,
  );
  return withMarkdownLinks.replace(
    /\b(src|srcset|href)="([^"]+)"/g,
    (whole, attr: string, value: string) => {
      if (attr === "srcset") {
        // "url descriptor, url descriptor" — rewrite each url, keep each descriptor.
        const rewritten = value
          .split(",")
          .map((entry) => {
            const [url, ...descriptor] = entry.trim().split(/\s+/);
            return [rewriteHref(url as string, fromRepoPath), ...descriptor].join(" ");
          })
          .join(", ");
        return `${attr}="${rewritten}"`;
      }
      return `${attr}="${rewriteHref(value, fromRepoPath)}"`;
    },
  );
}
