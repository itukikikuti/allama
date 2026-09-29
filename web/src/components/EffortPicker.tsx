import { EFFORT_LABEL, EFFORT_LEVELS, type EffortLevel } from '../../../shared/types.ts';

/** 考える量（エフォート）の選択。空は Claude Code の既定に任せる */
export function EffortPicker({
  value,
  onChange,
  disabled,
}: {
  value?: EffortLevel;
  onChange: (v: EffortLevel | null) => void;
  disabled?: boolean;
}) {
  return (
    <select
      className="effort-select"
      value={value ?? ''}
      disabled={disabled}
      onChange={(e) => onChange((e.target.value || null) as EffortLevel | null)}
      aria-label="考える量"
      title="考える量（エフォート）。Claude のときだけ効く"
    >
      <option value="">既定</option>
      {EFFORT_LEVELS.map((l) => (
        <option key={l} value={l}>
          {EFFORT_LABEL[l]}
        </option>
      ))}
    </select>
  );
}
