"use client";

import { toggleMulti, toggleSingle } from "../../lib/option-toggle";

export interface OptionItem<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface BaseProps<T extends string> {
  options: ReadonlyArray<OptionItem<T>>;
  ariaLabel?: string;
  disabled?: boolean;
}

interface SingleProps<T extends string> extends BaseProps<T> {
  mode: "single";
  value: T | null;
  onChange: (next: T | null) => void;
}

interface MultiProps<T extends string> extends BaseProps<T> {
  mode: "multi";
  value: readonly T[];
  onChange: (next: T[]) => void;
}

export type OptionCardsProps<T extends string> = SingleProps<T> | MultiProps<T>;

export function OptionCards<T extends string>(props: OptionCardsProps<T>) {
  const { options, ariaLabel, disabled } = props;

  function isSelected(value: T): boolean {
    if (props.mode === "single") return props.value === value;
    return props.value.includes(value);
  }

  function handleClick(value: T) {
    if (disabled) return;
    if (props.mode === "single") {
      props.onChange(toggleSingle(props.value, value));
    } else {
      props.onChange(toggleMulti(props.value, value));
    }
  }

  return (
    <div
      className="option-cards"
      role={props.mode === "single" ? "radiogroup" : "group"}
      aria-label={ariaLabel}
    >
      {options.map((opt) => {
        const selected = isSelected(opt.value);
        return (
          <button
            key={opt.value}
            type="button"
            className={`option-card${selected ? " option-card-selected" : ""}`}
            role={props.mode === "single" ? "radio" : "checkbox"}
            aria-checked={selected}
            aria-label={opt.label}
            onClick={() => handleClick(opt.value)}
            disabled={disabled}
          >
            <span className="option-card-label">{opt.label}</span>
            {opt.description && (
              <span className="option-card-desc">{opt.description}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
