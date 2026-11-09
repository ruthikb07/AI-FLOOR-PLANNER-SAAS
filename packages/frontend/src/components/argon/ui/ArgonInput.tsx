import React from 'react';

export interface ArgonInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  helperText?: string;
  error?: string;
  suffix?: string;
  prefixText?: string;
}

export const ArgonInput = React.forwardRef<HTMLInputElement, ArgonInputProps>(
  ({ label, helperText, error, suffix, prefixText, className = '', id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined);

    return (
      <div className="space-y-1.5 w-full">
        {label && (
          <label
            htmlFor={inputId}
            className="block text-xs font-mono font-bold uppercase tracking-wider text-argon-text"
          >
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {prefixText && (
            <span className="absolute left-3.5 text-xs font-mono text-argon-muted select-none pointer-events-none">
              {prefixText}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={`w-full bg-argon-card text-argon-text border rounded-xl py-2.5 text-sm transition-all duration-150 placeholder:text-argon-muted/50 focus:outline-none focus:border-argon-btn focus:ring-1 focus:ring-argon-btn disabled:opacity-50 disabled:bg-argon-surface/50 ${
              prefixText ? 'pl-9 pr-3.5' : suffix ? 'pl-3.5 pr-12' : 'px-3.5'
            } ${error ? 'border-argon-error ring-1 ring-argon-error' : 'border-argon-border'} ${className}`}
            {...props}
          />
          {suffix && (
            <span className="absolute right-3.5 text-xs font-mono font-medium text-argon-muted select-none pointer-events-none">
              {suffix}
            </span>
          )}
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

ArgonInput.displayName = 'ArgonInput';

