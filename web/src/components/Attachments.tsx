// 画面からファイルを預ける。預けた先は、そのままセッションから読める場所。

import { useRef, useState } from 'react';
import { Loader2, Paperclip, X } from 'lucide-react';
import type { UploadedFile } from '../../../shared/types.ts';
import { uploadFile } from '../api.ts';

export interface Attachments {
  files: UploadedFile[];
  busy: boolean;
  error: string;
  pick: (list: FileList | null) => Promise<void>;
  remove: (path: string) => void;
  clear: () => void;
}

export function useAttachments(): Attachments {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const pick = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError('');
    try {
      for (const file of Array.from(list)) {
        const up = await uploadFile(file);
        setFiles((cur) => [...cur, up]);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return {
    files,
    busy,
    error,
    pick,
    remove: (p) => setFiles((cur) => cur.filter((f) => f.path !== p)),
    clear: () => setFiles([]),
  };
}

/** 預けるファイルを選ぶボタン */
export function AttachButton({ up }: { up: Attachments }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void up.pick(e.target.files);
          e.target.value = '';
        }}
      />
      <button
        type="button"
        className="icon-btn"
        title="ファイルを添える"
        aria-label="ファイルを添える"
        disabled={up.busy}
        onClick={() => ref.current?.click()}
      >
        {up.busy ? <Loader2 className="spin" size={16} /> : <Paperclip size={16} />}
      </button>
    </>
  );
}

/** 預けたファイルの一覧 */
export function AttachChips({ up }: { up: Attachments }) {
  return (
    <>
      {up.files.length > 0 && (
        <div className="chips">
          {up.files.map((f) => (
            <span key={f.path} className="chip" title={f.path}>
              {f.name}
              <button type="button" aria-label={`${f.name} を外す`} onClick={() => up.remove(f.path)}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {up.error && <div className="form-error">{up.error}</div>}
    </>
  );
}
