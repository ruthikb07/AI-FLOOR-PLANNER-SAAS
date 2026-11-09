import React from 'react';
import { Minus, Plus } from 'lucide-react';

export interface ArgonCounterProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  className?: string;
}

export const ArgonCounter: React.FC<ArgonCounterProps> = ({
  value,
  onChange,
  min = 0,
  max = 99,
  step = 1,
  disabled = false,
  className = '',
}) => {
  const handleDecrement = () => {
    if (!disabled && value > min) {
      onChange(Math.max(min, value - step));
    }
  };

  const handleIncrement = () => {
    if (!disabled && value < max) {
      onChange(Math.min(max, value + step));
    }
  };

  return (
    <div
      className={`inline-flex items-center gap-2 bg-argon-surface/80 border border-argon-border rounded-xl p-1.5 select-none ${className}`}
    >
      <button
        type="button"
        onClick={handleDecrement}
        disabled={disabled || value <= min}
        aria-label="Decrement value"
        className="w-8 h-8 rounded-lg bg-argon-card hover:bg-argon-card/80 active:scale-95 text-argon-text border border-argon-border/70 flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
      >
        <Minus className="w-3.5 h-3.5" />
      </button>

      <span className="w-8 text-center font-mono text-base font-bold text-argon-btn select-all">
        {value}
      </span>

      <button
        type="button"
        onClick={handleIncrement}
        disabled={disabled || value >= max}
        aria-label="Increment value"
        className="w-8 h-8 rounded-lg bg-argon-card hover:bg-argon-card/80 active:scale-95 text-argon-text border border-argon-border/70 flex items-center justify-center transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-2xs"
      >
        <Plus className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

