import { useState } from 'react';
import { Code } from './Markdown.tsx';

/** 長い出力は途中まで見せて、残りはボタンで開く */
export function Output({ text, lang, maxLines = 24 }: { text: string; lang?: string; maxLines?: number }) {
  const [all, setAll] = useState(false);
  const lines = text.split('\n');
  const long = lines.length > maxLines;
  const shown = all || !long ? text : lines.slice(0, maxLines).join('\n');
  return (
    <div className="output">
      {lang ? <Code code={shown} lang={lang} /> : <pre className="plain">{shown}</pre>}
      {long && (
        <button type="button" className="link-btn" onClick={() => setAll(!all)}>
          {all ? '折りたたむ' : `すべて表示（${lines.length}行）`}
        </button>
      )}
    </div>
  );
}

export function contentText(content: any): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c?.type === 'text')
      .map((c) => c.text)
      .join('\n');
  }
  return content == null ? '' : JSON.stringify(content, null, 2);
}

export function ContentImages({ content }: { content: any }) {
  if (!Array.isArray(content)) return null;
  const images = content.filter((c) => c?.type === 'image' && c.source?.type === 'base64');
  if (!images.length) return null;
  return (
    <div className="images">
      {images.map((img, i) => (
        <img key={i} src={`data:${img.source.media_type};base64,${img.source.data}`} alt="" />
      ))}
    </div>
  );
}
