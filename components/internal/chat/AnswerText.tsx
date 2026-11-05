import Markdown, { type Components } from "react-markdown";

// SEC-09: restricted Markdown. No raw HTML (react-markdown escapes it; no rehype-raw), no images,
// links only https:, opened safely.
const ALLOWED = ["p", "strong", "em", "ul", "ol", "li", "a", "code", "br"];

const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow">
      {children}
    </a>
  ),
};

export function safeUrl(url: string): string {
  return /^https:\/\//i.test(url) ? url : "";
}

export function AnswerText({ text }: { text: string }) {
  return (
    <Markdown
      allowedElements={ALLOWED}
      unwrapDisallowed
      skipHtml
      urlTransform={safeUrl}
      components={components}
    >
      {text}
    </Markdown>
  );
}
