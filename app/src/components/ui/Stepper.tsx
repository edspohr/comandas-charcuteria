import { useState } from 'react';

interface Props {
  value: number;
  onChange: (n: number) => void;
  min?: number;
  step?: number;
  quick?: number[];
  decimals?: number;
}

export default function Stepper({ value, onChange, min = 0, step = 1, quick = [1, 5, 10], decimals = 0 }: Props) {
  const [raw, setRaw] = useState<string>(value.toString());

  function commit(next: number) {
    const clamped = Math.max(min, Number.isFinite(next) ? next : min);
    const rounded = decimals > 0 ? Number(clamped.toFixed(decimals)) : Math.round(clamped);
    onChange(rounded);
    setRaw(rounded.toString());
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex items-center rounded-md border border-charcoal-200 bg-white overflow-hidden">
        <button
          type="button"
          onClick={() => commit(value - step)}
          className="w-11 h-11 text-xl text-charcoal-500 hover:bg-cream-100 active:bg-cream-200"
          aria-label="Restar"
        >−</button>
        <input
          type="number"
          inputMode="decimal"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={() => commit(parseFloat(raw))}
          className="w-16 h-11 text-center outline-none border-x border-charcoal-200 font-medium"
        />
        <button
          type="button"
          onClick={() => commit(value + step)}
          className="w-11 h-11 text-xl text-charcoal-500 hover:bg-cream-100 active:bg-cream-200"
          aria-label="Sumar"
        >+</button>
      </div>
      <div className="flex gap-1">
        {quick.map((q) => (
          <button
            key={q}
            type="button"
            onClick={() => commit(value + q)}
            className="rounded-full bg-cream-100 hover:bg-cream-200 px-3 py-1 text-xs font-semibold text-charcoal-500 tracking-[0.03em]"
          >
            +{q}
          </button>
        ))}
      </div>
    </div>
  );
}
