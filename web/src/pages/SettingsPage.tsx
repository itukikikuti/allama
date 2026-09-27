import { useEffect, useState } from 'react';
import { CircleAlert, CircleCheck, Loader2, Plus, Trash2 } from 'lucide-react';
import type { CheckResult, ModelSetting, Settings } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { cx } from '../util.ts';

type Kind = 'ollama' | 'claude' | 'custom';

/** 画面で編集するための形。保存するときに config.json の形に戻す */
interface Row {
  key: number;
  id: string;
  label: string;
  kind: Kind;
  model: string;
  original: ModelSetting;
}

let nextKey = 1;

function toRow(m: ModelSetting): Row {
  const base = { key: nextKey++, id: m.id, label: m.label, original: m };
  if (m.ollama) return { ...base, kind: 'ollama', model: m.ollama };
  const c = m.command ?? ['claude'];
  if (!m.env && c[0] === 'claude' && (c.length === 1 || (c.length === 3 && c[1] === '--model'))) {
    return { ...base, kind: 'claude', model: c[2] ?? '' };
  }
  return { ...base, kind: 'custom', model: c.join(' ') };
}

function toModel(r: Row): ModelSetting {
  if (r.kind === 'ollama') return { id: r.id, label: r.label, ollama: r.model.trim() };
  if (r.kind === 'claude') return { id: r.id, label: r.label, command: r.model.trim() ? ['claude', '--model', r.model.trim()] : ['claude'] };
  return { ...r.original, id: r.id, label: r.label };
}

function newId(rows: Row[], hint: string): string {
  const base = hint.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'model';
  let id = base;
  for (let i = 2; rows.some((r) => r.id === id); i++) id = `${base}-${i}`;
  return id;
}

function Result({ r }: { r?: CheckResult | 'busy' }) {
  if (!r) return null;
  if (r === 'busy') return <span className="check busy"><Loader2 className="spin" size={13} /> 確かめています…</span>;
  return (
    <span className={cx('check', r.ok ? 'ok' : 'ng')}>
      {r.ok ? <CircleCheck size={13} /> : <CircleAlert size={13} />} {r.message}
    </span>
  );
}

export function SettingsPage() {
  const [loaded, setLoaded] = useState<Settings | null>(null);
  const [host, setHost] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [defaultId, setDefaultId] = useState('');
  const [hostCheck, setHostCheck] = useState<CheckResult | 'busy'>();
  const [modelChecks, setModelChecks] = useState<Record<number, CheckResult | 'busy'>>({});
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const apply = (s: Settings) => {
    setLoaded(s);
    setHost(s.ollamaHost);
    setRows(s.models.map(toRow));
    setDefaultId(s.defaultModelId);
  };

  useEffect(() => {
    api.settings().then(apply).catch((e) => setMsg({ ok: false, text: (e as Error).message }));
  }, []);

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const add = (kind: Kind) =>
    setRows((rs) => [
      ...rs,
      { key: nextKey++, id: newId(rs, kind), label: kind === 'ollama' ? 'Ollama: ' : 'Claude', kind, model: '', original: { id: '', label: '' } },
    ]);

  const remove = (r: Row) => {
    setRows((rs) => rs.filter((x) => x.key !== r.key));
    if (defaultId === r.id) setDefaultId('');
  };

  const checkHost = async () => {
    setHostCheck('busy');
    setHostCheck(await api.checkOllama(host).catch((e) => ({ ok: false, message: (e as Error).message })));
  };

  const checkRow = async (r: Row) => {
    setModelChecks((c) => ({ ...c, [r.key]: 'busy' }));
    const res = await api.checkModel(toModel(r), host).catch((e) => ({ ok: false, message: (e as Error).message }));
    setModelChecks((c) => ({ ...c, [r.key]: res }));
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      apply(await api.saveSettings({ ollamaHost: host, models: rows.map(toModel), defaultModelId: defaultId }));
      setModelChecks({});
      setMsg({ ok: true, text: '保存した。次に動く手から使われる。' });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setSaving(false);
    }
  };

  if (!loaded) return <div className="page">{msg ? <div className="error-box">{msg.text}</div> : <div className="loading-inline">読み込み中…</div>}</div>;

  return (
    <div className="page settings">
      <h2>Ollama</h2>
      <div className="card">
        <label className="field">
          <span>接続先</span>
          <div className="field-row">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="http://127.0.0.1:11434" />
            <button type="button" onClick={checkHost}>確かめる</button>
          </div>
        </label>
        <Result r={hostCheck} />
        <p className="muted small">クラウドモデル（〜:cloud）を使うには、Ollama が動いているマシンで一度 <code>ollama signin</code> が必要。</p>
      </div>

      <h2>モデル</h2>
      <div className="card models">
        {rows.map((r) => (
          <div key={r.key} className="model-row">
            <div className="model-head">
              <label className="radio" title="目覚ましなど、自動で始まる手が使う">
                <input type="radio" name="default" checked={defaultId === r.id} onChange={() => setDefaultId(r.id)} /> 既定
              </label>
              <input className="model-label" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} placeholder="表示名" />
              <button type="button" className="icon-btn" onClick={() => remove(r)} title="消す">
                <Trash2 size={15} />
              </button>
            </div>
            <div className="field-row">
              <select
                value={r.kind}
                disabled={r.kind === 'custom'}
                onChange={(e) => update(r.key, { kind: e.target.value as Kind })}
              >
                <option value="ollama">Ollama</option>
                <option value="claude">Claude</option>
                {r.kind === 'custom' && <option value="custom">カスタム</option>}
              </select>
              <input
                value={r.model}
                disabled={r.kind === 'custom'}
                onChange={(e) => update(r.key, { model: e.target.value })}
                placeholder={r.kind === 'ollama' ? 'モデル名（例: deepseek-v4.1-flash:cloud）' : 'モデル（空なら既定。例: opus）'}
              />
              <button type="button" onClick={() => checkRow(r)} disabled={r.kind !== 'ollama' || !r.model.trim()}>
                確かめる
              </button>
            </div>
            <Result r={modelChecks[r.key]} />
          </div>
        ))}
        <div className="add-row">
          <button type="button" onClick={() => add('ollama')}>
            <Plus size={14} /> Ollama のモデル
          </button>
          <button type="button" onClick={() => add('claude')}>
            <Plus size={14} /> Claude のモデル
          </button>
        </div>
      </div>

      <div className="save-bar">
        {msg && <span className={cx('check', msg.ok ? 'ok' : 'ng')}>{msg.text}</span>}
        <button type="button" className="primary" onClick={save} disabled={saving}>
          {saving ? '保存中…' : '保存する'}
        </button>
      </div>
    </div>
  );
}
