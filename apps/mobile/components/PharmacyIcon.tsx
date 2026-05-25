import Svg, { Rect, Text as SvgText } from 'react-native-svg';

interface Props {
  size?: number;
}

/**
 * Türk eczane sembolü — kırmızı kare içinde beyaz "E"
 */
export function PharmacyIcon({ size = 36 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {/* Kırmızı dış kare */}
      <Rect width="100" height="100" fill="#e30613" rx="8" />
      {/* İnce beyaz çerçeve */}
      <Rect x="10" y="10" width="80" height="80" fill="none" stroke="#fff" strokeWidth="3" />
      {/* Ortada büyük beyaz "E" */}
      <SvgText
        x="50"
        y="72"
        fontSize="60"
        fontWeight="bold"
        fill="#fff"
        textAnchor="middle"
      >
        E
      </SvgText>
    </Svg>
  );
}
