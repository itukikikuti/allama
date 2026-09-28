import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, CircleCheck, Loader2, Plus, Trash2 } from 'lucide-react';
import type { CheckResult, ModelSetting, Settings } from '../../../shared/types.ts';
import { api } from '../api.ts';
import { cx } from '../util.ts';

type Kind = 'ollama' | 'claude';

/** 画面で編集するための形 */
interface Row {
  key: number;
  id: string;
  label: string;
  kind: Kind;
  model: string;
}

let nextKey = 1;
const toRow = (m: ModelSetting): Row => ({ key: nextKey++, id: m.id, label: m.label, kind: m.ollama !== undefined ? 'ollama' : 'claude', model: m.ollama ?? m.claude ?? '' });
const toModel = (r: Row): ModelSetting => (r.kind === 'ollama' ? { id: r.id, label: r.label, ollama: r.model.trim() } : { id: r.id, label: r.label, claude: r.model.trim() });

function newId(rows: Row[], hint: string): string {
  let id = hint;
  for (let i = 2; rows.some((r) => r.id === id); i++) id = `${hint}-${i}`;
  return id;
}

type Check = CheckResult | 'busy' | undefined;
const failed = (e: unknown): CheckResult => ({ ok: false, message: (e as Error).message });

function Result({ r }: { r: Check }) {
  if (!r) return null;
  if (r === 'busy') return <span className="check busy"><Loader2 className="spin" size={13} /> 確かめています…</span>;
  return (
    <span className={cx('check', r.ok ? 'ok' : 'ng')}>
      {r.ok ? <CircleCheck size={13} /> : <CircleAlert size={13} />} {r.message}
    </span>
  );
}

export function SettingsPage() {
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const [host, setHost] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [defaultId, setDefaultId] = useState('');
  const [memModel, setMemModel] = useState('');
  const [embedModel, setEmbedModel] = useState('');
  const [checks, setChecks] = useState<Record<string, Check>>({});

  const apply = (s: Settings) => {
    setHost(s.ollamaHost);
    setRows(s.models.map(toRow));
    setDefaultId(s.defaultModelId);
    setMemModel(s.memory.model);
    setEmbedModel(s.memory.embedModel);
  };
  useEffect(() => {
    if (settings.data) apply(settings.data);
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      api.saveSettings({ ollamaHost: host, models: rows.map(toModel), defaultModelId: defaultId, memory: { model: memModel, embedModel } }),
    onSuccess: (s) => {
      qc.setQueryData(['settings'], s);
      setChecks({});
    },
  });

  const check = async (key: string, run: () => Promise<CheckResult>) => {
    setChecks((c) => ({ ...c, [key]: 'busy' }));
    const r = await run().catch(failed);
    setChecks((c) => ({ ...c, [key]: r }));
  };

  const update = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const ollamaModels = rows.filter((r) => r.kind === 'ollama' && r.model.trim()).map((r) => r.model.trim());

  if (!settings.data) return <div className="page">{settings.error ? <div className="error-box">{settings.error.message}</div> : <div className="loading-inline">読み込み中…</div>}</div>;

  return (
    <div className="page settings">
      <h2>Ollama</h2>
      <div className="card">
        <label className="field">
          <span>接続先</span>
          <div className="field-row">
            <input value={host} onChange={(e) => setHost(e.target.value)} placeholder="http://127.0.0.1:11434" />
            <button type="button" onClick={() => check('host', () => api.checkOllama(host))}>確かめる</button>
          </div>
        </label>
        <Result r={checks.host} />
        <p className="muted small">クラウドモデル（〜:cloud）を使うには、Ollama が動いているマシンで一度 <code>ollama signin</code> が必要。</p>
      </div>

      <h2>セッションのモデル</h2>
      <div className="card models">
        {rows.map((r) => (
          <div key={r.key} className="model-row">
            <div className="model-head">
              <label className="radio" title="目覚ましなど、自動で始まるセッションが使う">
                <input type="radio" name="default" checked={defaultId === r.id} onChange={() => setDefaultId(r.id)} /> 既定
              </label>
              <input className="model-label" value={r.label} onChange={(e) => update(r.key, { label: e.target.value })} placeholder="表示名" />
              <button type="button" className="icon-btn" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} title="消す">
                <Trash2 size={15} />
              </button>
            </div>
            <div className="field-row">
              <select value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as Kind })}>
                <option value="ollama">Ollama</option>
                <option value="claude">Claude</option>
              </select>
              <input
                value={r.model}
                onChange={(e) => update(r.key, { model: e.target.value })}
                placeholder={r.kind === 'ollama' ? 'モデル名（例: deepseek-v4.1-flash:cloud）' : 'モデル（空なら既定。例: opus）'}
              />
              <button type="button" disabled={r.kind === 'ollama' && !r.model.trim()} onClick={() => check(`m${r.key}`, () => api.checkModel(toModel(r), host))}>
                確かめる
              </button>
            </div>
            <Result r={checks[`m${r.key}`]} />
          </div>
        ))}
        <div className="add-row">
          <button type="button" onClick={() => setRows((rs) => [...rs, { key: nextKey++, id: newId(rs, 'ollama'), label: 'Ollama: ', kind: 'ollama', model: '' }])}>
            <Plus size={14} /> Ollama のモデル
          </button>
          <button type="button" onClick={() => setRows((rs) => [...rs, { key: nextKey++, id: newId(rs, 'claude'), label: 'Claude', kind: 'claude', model: '' }])}>
            <Plus size={14} /> Claude のモデル
          </button>
        </div>
      </div>

      <h2>記憶</h2>
      <div className="card">
        <label className="field">
          <span>覚える・整理するのに使うモデル（Ollama）</span>
          <div className="field-row">
            <input value={memModel} onChange={(e) => setMemModel(e.target.value)} list="ollama-models" placeholder="deepseek-v4.1-flash:cloud" />
            <button type="button" disabled={!memModel.trim()} onClick={() => check('mem', () => api.checkModel({ id: 'memory', label: 'memory', ollama: memModel.trim() }, host))}>
              確かめる
            </button>
          </div>
          <datalist id="ollama-models">
            {ollamaModels.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </label>
        <Result r={checks.mem} />
        <label className="field">
          <span>意味で探すための埋め込みモデル（Ollama のマシンで動く）</span>
          <div className="field-row">
            <input value={embedModel} onChange={(e) => setEmbedModel(e.target.value)} placeholder="qwen3-embedding:0.6b" />
            <button type="button" disabled={!embedModel.trim()} onClick={() => check('embed', () => api.checkEmbed(embedModel.trim(), host))}>
              確かめる
            </button>
            <button type="button" disabled={!embedModel.trim()} onClick={() => check('embed', () => api.pull(embedModel.trim(), host))}>
              取得する
            </button>
          </div>
        </label>
        <Result r={checks.embed} />
        <p className="muted small">埋め込みモデルを変えると、それまでの記憶は意味では探せなくなる（言葉では探せる）。</p>
      </div>

      <div className="save-bar">
        {save.isError && <span className="check ng">{save.error.message}</span>}
        {save.isSuccess && <span className="check ok">保存した。次に動くセッションから使われる。</span>}
        <button type="button" className="primary" onClick={() => save.mutate()} disabled={save.isPending}>
          {save.isPending ? '保存中…' : '保存する'}
        </button>
      </div>
    </div>
  );
}
