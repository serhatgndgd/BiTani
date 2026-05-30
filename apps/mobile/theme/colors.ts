export const darkTheme = {
  bg:          '#080808',
  card:        '#131313',
  surface:     '#131313',
  surfaceAlt:  '#1c1c1c',
  border:      '#252525',
  overlay:     'rgba(0,0,0,0.65)',

  primary:     '#2563eb',
  primaryLight:'rgba(37,99,235,0.18)',
  primaryDim:  'rgba(37,99,235,0.12)',
  onPrimary:   '#FFFFFF',
  onPrimaryMuted: 'rgba(255,255,255,0.72)',
  onPrimaryDim: 'rgba(255,255,255,0.18)',

  text1:       '#f5f5f5',
  text2:       '#a1a1aa',
  text3:       '#52525b',

  success:     '#22c55e',
  successDim:  'rgba(34,197,94,0.12)',
  warning:     '#f59e0b',
  warningDim:  'rgba(245,158,11,0.12)',
  error:       '#ef4444',
  errorDim:    'rgba(239,68,68,0.12)',

  pharmacy:    '#10b981',
  pharmacyDim: 'rgba(16,185,129,0.12)',
} as const;

export const lightTheme = {
  bg:          '#FFFFFF',
  card:        '#FFFFFF',
  surface:     '#F3F4F6',
  surfaceAlt:  '#FFFFFF',
  border:      '#D1D5DB',
  overlay:     'rgba(0,0,0,0.42)',

  primary:     darkTheme.primary,
  primaryLight:'rgba(37,99,235,0.10)',
  primaryDim:  'rgba(37,99,235,0.12)',
  onPrimary:   '#FFFFFF',
  onPrimaryMuted: 'rgba(255,255,255,0.72)',
  onPrimaryDim: 'rgba(255,255,255,0.18)',

  text1:       '#1A1A1A',
  text2:       '#4A4A4A',
  text3:       '#6B7280',

  success:     darkTheme.success,
  successDim:  'rgba(34,197,94,0.12)',
  warning:     darkTheme.warning,
  warningDim:  'rgba(245,158,11,0.12)',
  error:       darkTheme.error,
  errorDim:    'rgba(239,68,68,0.12)',

  pharmacy:    darkTheme.pharmacy,
  pharmacyDim: 'rgba(16,185,129,0.12)',
} as const;

export type ThemeColors = {
  [K in keyof typeof darkTheme]: string;
};

// Backwards-compatible default for non-themed utility imports.
export const C = darkTheme;
