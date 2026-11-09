import React from 'react';
import { ChevronDown } from 'lucide-react';

export interface ArgonSelectOption {
  value: string;
  label: string;
  description?: string;
}

export interface ArgonSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  helperText?: string;
  error?: string;
  options?: ArgonSelectOption[];
}

export const ArgonSelect = React.forwardRef<HTMLSelectElement, ArgonSelectProps>(
  ({ label, helperText, error, options, children, className = '', id, ...props }, ref) => {
    const selectId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label
            htmlFor={selectId}
            className="block text-xs font-mono font-bold uppercase tracking-wider text-argon-text"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          <select
            ref={ref}
            id={selectId}
            className={`w-full appearance-none bg-argon-card text-argon-text border rounded-xl pl-3.5 pr-10 py-2.5 text-sm transition-all duration-150 focus:outline-none focus:border-argon-btn focus:ring-1 focus:ring-argon-btn disabled:opacity-50 disabled:bg-argon-surface/50 cursor-pointer ${
              error ? 'border-argon-error ring-1 ring-argon-error' : 'border-argon-border'
            } ${className}`}
            {...props}
          >
            {options
              ? options.map((opt) => (
                  <option key={opt.value} value={opt.value} className="bg-argon-card text-argon-text py-1">
                    {opt.label}
                  </option>
                ))
              : children}
          </select>
          <div className="absolute right-3.5 pointer-events-none text-argon-muted">
            <ChevronDown className="w-4 h-4" />
          </div>
        </div>
        {error ? (
          <p className="text-xs text-argon-error font-medium">{error}</p>
        ) : helperText ? (
          <p className="text-xs text-argon-muted">{helperText}</p>
        ) : null}
      </div>
    );
  }
);

ArgonSelect.displayName = 'ArgonSelect';

