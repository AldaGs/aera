import type { Icon as PhosphorIcon } from '@phosphor-icons/react';

interface IconProps {
  icon: PhosphorIcon;
  size?: number;
  className?: string;
}

/** Phosphor icon wrapper; color follows currentColor (set `.icon-grad` via className for the accent tint). */
export function Icon({ icon: IconCmp, size = 24, className = '' }: IconProps) {
  return <IconCmp size={size} className={className} />;
}
