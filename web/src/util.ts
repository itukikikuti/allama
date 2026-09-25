export function ago(iso?: string): string {
  if (!iso) return '';
  const ms = Date.now() - Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const min = Math.round(ms / 60000);
  if (ms < 0) return untilText(-ms);
  if (min < 1) return 'たった今';
  if (min < 60) return `${min}分前`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}時間前`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}日前`;
  return dateTime(iso);
}

function untilText(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 1) return 'まもなく';
  if (min < 60) return `${min}分後`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}時間後`;
  return `${Math.round(h / 24)}日後`;
}

export function dateTime(iso?: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function duration(ms?: number): string {
  if (!ms && ms !== 0) return '';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}分${s % 60}秒`;
  return `${Math.floor(m / 60)}時間${m % 60}分`;
}

/** 長いパスは後ろの方だけ見せる */
export function shortPath(p?: string, keep = 3): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts.length <= keep ? p : `…/${parts.slice(-keep).join('/')}`;
}

const EXT_LANG: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', mts: 'typescript', cts: 'typescript',
  js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin', swift: 'swift',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp', php: 'php', lua: 'lua',
  json: 'json', md: 'markdown', css: 'css', scss: 'scss', html: 'xml', xml: 'xml', svg: 'xml',
  sh: 'bash', bash: 'bash', zsh: 'bash', ps1: 'powershell', yml: 'yaml', yaml: 'yaml',
  toml: 'ini', ini: 'ini', sql: 'sql', dockerfile: 'dockerfile', glsl: 'glsl',
};

export function langFromPath(p?: string): string | undefined {
  if (!p) return undefined;
  const name = p.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'dockerfile';
  return EXT_LANG[name.split('.').pop() ?? ''];
}

export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}

export function loadPref(key: string): string {
  try {
    return localStorage.getItem(`atama:${key}`) ?? '';
  } catch {
    return '';
  }
}

export function savePref(key: string, value: string): void {
  try {
    localStorage.setItem(`atama:${key}`, value);
  } catch {
    // 保存できなくても困らない
  }
}
