import React from 'react';

export interface ArgonCardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'card' | 'surface' | 'flat';
  padded?: boolean;
}

export const ArgonCard: React.FC<ArgonCardProps> = ({
  variant = 'card',
  padded = true,
  children,
  className = '',
  ...props
}) => {
  const variantStyles = {
    card: 'bg-argon-card border border-argon-border shadow-xs',
    surface: 'bg-argon-surface border border-argon-border',
    flat: 'bg-argon-card/50 border border-argon-border/60',
  }[variant];

  return (
    <div
      className={`rounded-xl text-argon-text ${variantStyles} ${padded ? 'p-5 sm:p-6' : ''} ${className}`}
      {...props}
    >
      {children}
    </div>
  );
};

export const ArgonCardHeader: React.FC<React.HTMLAttributes<HTMLDivElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <div className={`flex items-center justify-between pb-4 border-b border-argon-border/70 mb-4 ${className}`} {...props}>
    {children}
  </div>
);

export const ArgonCardTitle: React.FC<React.HTMLAttributes<HTMLHeadingElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <h3 className={`text-base font-bold text-argon-text tracking-tight flex items-center gap-2 ${className}`} {...props}>
    {children}
  </h3>
);

export const ArgonCardDescription: React.FC<React.HTMLAttributes<HTMLParagraphElement>> = ({
  children,
  className = '',
  ...props
}) => (
  <p className={`text-xs text-argon-muted leading-relaxed mt-1 ${className}`} {...props}>
    {children}
  </p>
);

