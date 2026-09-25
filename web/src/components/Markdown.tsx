import { useMemo } from 'react';
import { Marked } from 'marked';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function highlight(code: string, lang?: string): string {
  if (code.length > 200_000) return escapeHtml(code);
  if (lang && hljs.getLanguage(lang)) {
    try {
      return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
    } catch {
      // 失敗したらそのまま
    }
  }
  return escapeHtml(code);
}

const md = new Marked({ gfm: true, breaks: true });
md.use({
  renderer: {
    code({ text, lang }) {
      const language = (lang ?? '').split(/\s/)[0];
      return `<pre class="code"><code class="hljs">${highlight(text, language)}</code></pre>`;
    },
  },
});

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

export function Markdown({ text, className }: { text: string; className?: string }) {
  const html = useMemo(() => DOMPurify.sanitize(md.parse(text ?? '', { async: false }) as string), [text]);
  return <div className={`md ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Code({ code, lang }: { code: string; lang?: string }) {
  const html = useMemo(() => highlight(code, lang), [code, lang]);
  return (
    <pre className="code">
      <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
