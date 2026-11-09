import React from 'react';

export interface ArgonButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'accent' | 'danger' | 'pass';
  size?: 'sm' | 'md' | 'lg';
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  loading?: boolean;
}

export const ArgonButton: React.FC<ArgonButtonProps> = ({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  loading = false,
  children,
  className = '',
  disabled,
  ...props
}) => {
  const baseStyles =
    'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-150 select-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-45';

  const sizeStyles = {
    sm: 'px-3 py-1.5 text-xs rounded-lg',
    md: 'px-4 py-2.5 text-xs font-semibold',
    lg: 'px-6 py-3 text-sm font-bold',
  }[size];

  const variantStyles = {
    primary:
      'bg-argon-btn hover:bg-argon-btnHover text-argon-card shadow-sm hover:shadow active:scale-[0.99]',
    secondary:
      'bg-argon-surface hover:bg-argon-border text-argon-text border border-argon-border shadow-xs active:scale-[0.99]',
    outline:
      'bg-transparent hover:bg-argon-surface text-argon-text border border-argon-border hover:border-argon-muted',
    ghost:
      'bg-transparent hover:bg-argon-surface text-argon-muted hover:text-argon-text',
    accent:
      'bg-argon-accent hover:bg-argon-btn text-argon-card shadow-xs font-semibold',
    danger:
      'bg-argon-error hover:opacity-90 text-white shadow-xs',
    pass:
      'bg-argon-pass hover:opacity-90 text-white shadow-xs font-semibold',
  }[variant];

  return (
    <button
      className={`${baseStyles} ${sizeStyles} ${variantStyles} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
      ) : (
        leftIcon && <span className="shrink-0">{leftIcon}</span>
      )}
      {children}
      {!loading && rightIcon && <span className="shrink-0">{rightIcon}</span>}
    </button>
  );
};

