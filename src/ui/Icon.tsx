import type { LucideIcon } from 'lucide-react';

/**
 * Mount once near the app root. Defines the shared aera brand gradient used by
 * any icon (or SVG) that opts into it via the `.icon-grad` class.
 */
export function GradientDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
      <defs>
        <linearGradient id="aera-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--accent)" />
          <stop offset="100%" stopColor="var(--accent-2)" />
        </linearGradient>
      </defs>
    </svg>
  );
}

interface IconProps {
  icon: LucideIcon;
  size?: number;
  strokeWidth?: number;
  gradient?: boolean;
  className?: string;
}

/** Lucide icon wrapper; when `gradient` is set it strokes with the brand gradient. */
export function Icon({
  icon: LucideCmp,
  size = 24,
  strokeWidth = 2,
  gradient = false,
  className = '',
}: IconProps) {
  return (
    <LucideCmp
      size={size}
      strokeWidth={strokeWidth}
      className={`${gradient ? 'icon-grad' : ''} ${className}`.trim()}
    />
  );
}
