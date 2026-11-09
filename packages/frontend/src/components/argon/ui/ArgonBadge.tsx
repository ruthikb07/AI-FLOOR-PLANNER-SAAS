import React from 'react';

export interface ArgonBadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'pass' | 'warn' | 'error' | 'accent' | 'neutral' | 'leather';
  size?: 'sm' | 'md';
  icon?: React.ReactNode;
}

export const ArgonBadge: React.FC<ArgonBadgeProps> = ({
  variant = 'neutral',
  size = 'md',
  icon,
  children,
  className = '',
  ...props
}) => {
  const sizeStyles = {
    sm: 'px-2 py-0.5 text-[10px]',
    md: 'px-2.5 py-1 text-xs',
  }[size];

  const variantStyles = {
    pass: 'bg-argon-pass/15 text-argon-pass border border-argon-pass/30 font-semibold',
    warn: 'bg-argon-warn/15 text-argon-warn border border-argon-warn/30 font-semibold',
    error: 'bg-argon-error/15 text-argon-error border border-argon-error/30 font-semibold',
    accent: 'bg-argon-accent/20 text-argon-text border border-argon-accent/40 font-bold',
    neutral: 'bg-argon-surface text-argon-muted border border-argon-border font-medium',
    leather: 'bg-argon-btn/15 text-argon-btn border border-argon-btn/30 font-bold',
  }[variant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg font-mono tracking-tight ${sizeStyles} ${variantStyles} ${className}`}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </span>
  );
};

