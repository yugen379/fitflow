import React, { useEffect, useRef, useState } from 'react';

/**
 * A number field that SHOWS a stored metric value in the person's unit and
 * hands back metric (src/lib/units.ts does the maths).
 *
 * Why not just `value={toDisplay(v)}`: converting on every keystroke would
 * re-round what is being typed (135 lb → 61.23 kg → "135" is fine, but
 * "135." or "5.3" oz would jump about). So the field keeps the raw text the
 * person typed, and the metric value is computed from it exactly once per
 * edit. The stored value is never re-derived from a rounded display: until
 * the person edits the field, the parent keeps whatever metric value it had.
 *
 * When the value changes from OUTSIDE (a preset button, a stepper, a
 * progression suggestion) or the unit changes, the text re-reads it.
 */
type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  /** Stored metric value (kg, g, ml, kcal). */
  value: number;
  /** The display unit's name; a change re-reads the text. */
  unit: string;
  /** Metric → the number to show. */
  toDisplay: (metric: number) => number;
  /** Typed text → metric, or null when it does not parse. */
  fromDisplay: (text: string) => number | null;
  /** Receives the metric value whenever the typed text parses. */
  onValue: (metric: number) => void;
  /** What an empty field stores (default 0). */
  emptyValue?: number;
  /** Show 0 as "0" (default) or leave the field blank. */
  showZero?: boolean;
};

export const UnitInput: React.FC<Props> = ({
  value, unit, toDisplay, fromDisplay, onValue, emptyValue = 0, showZero = true, inputMode = 'decimal', ...rest
}) => {
  const shown = (v: number) => {
    const d = toDisplay(v);
    return d === 0 && !showZero ? '' : String(d);
  };
  const [text, setText] = useState(() => shown(value));
  const [invalid, setInvalid] = useState(false);
  // The last metric value this field emitted. A prop equal to it is just the
  // echo of our own edit, so the typed text stays as typed.
  const echo = useRef<number>(value);

  useEffect(() => {
    // Equal in DISPLAY terms counts as an echo too: a parent that tidies the
    // metric value (grams to a whole number) must not rewrite "5." mid-typing.
    const same = Object.is(value, echo.current) || toDisplay(value) === toDisplay(echo.current);
    echo.current = value;
    if (same) return;
    setText(shown(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => {
    echo.current = value;
    setText(shown(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unit]);

  return (
    <input
      {...rest}
      type="text"
      inputMode={inputMode}
      autoComplete="off"
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        const metric = t.trim() === '' ? emptyValue : fromDisplay(t);
        setInvalid(metric == null);
        if (metric == null) return;
        echo.current = metric;
        onValue(metric);
      }}
    />
  );
};
