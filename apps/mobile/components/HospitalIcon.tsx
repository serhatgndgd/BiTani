import Svg, { Rect } from 'react-native-svg';

interface Props {
  size?: number;
}

/**
 * Hastane sembolü — beyaz kare üzerinde kırmızı artı (+)
 */
export function HospitalIcon({ size = 36 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Beyaz dış kare */}
      <Rect width="100" height="100" fill="#fff" rx="8" />
      {/* Kırmızı artı — dikey bar */}
      <Rect x="40" y="20" width="20" height="60" fill="#e30613" />
      {/* Kırmızı artı — yatay bar */}
      <Rect x="20" y="40" width="60" height="20" fill="#e30613" />
    </Svg>
  );
}
