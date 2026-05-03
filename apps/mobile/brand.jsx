/* BiTanı brand primitives — icon mark, wordmark, splash */

const BRAND = {
  blue: '#1a6ef5',
  blueDeep: '#0d4fcc',
  blueGlow: '#3b8aff',
  ink: '#0a0a0a',
  ink2: '#141414',
  ink3: '#1c1c1c',
  white: '#ffffff',
  off: '#f5f6f8',
  mute: '#8a8f98',
};

/* ---------- The icon mark (chat bubble + EKG) ----------
   Designed on a 1024 grid. Chat bubble is a rounded-square
   speech container with a small tail at bottom-left.
   EKG is a single white stroke, mathematically symmetric
   around center, with one diagnostic spike. */

function IconMark({ size = 1024, bg = BRAND.blue, stroke = BRAND.white, radius = 0.225, showTail = true, container = 'square' }) {
  // radius is fraction of size (iOS superellipse approximation via large rx)
  const r = size * radius;
  const pad = size * 0.16;        // inner padding to EKG
  const cy = size * 0.52;          // EKG vertical center (slightly below mid for tail balance)
  const x0 = pad;
  const x1 = size - pad;
  const w  = x1 - x0;

  // EKG path — flat → small p-wave bump → flat → QRS spike → small t-wave → flat
  const seg = w / 16;
  const p = [
    `M ${x0} ${cy}`,
    `H ${x0 + seg * 2}`,
    // P wave (small bump up)
    `q ${seg * 0.5} ${-seg * 0.6} ${seg} 0`,
    `H ${x0 + seg * 5}`,
    // QRS: small dip, big spike up, big spike down, small dip
    `l ${seg * 0.6} ${seg * 0.5}`,
    `l ${seg * 0.5} ${-seg * 3.0}`,
    `l ${seg * 0.7} ${seg * 4.5}`,
    `l ${seg * 0.6} ${-seg * 2.0}`,
    `l ${seg * 0.6} 0`,
    `H ${x0 + seg * 11}`,
    // T wave (medium bump up)
    `q ${seg * 0.75} ${-seg * 1.1} ${seg * 1.5} 0`,
    `H ${x1}`,
  ].join(' ');

  const sw = size * 0.052;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={`bg-${size}-${bg.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={bg} stopOpacity="1" />
          <stop offset="1" stopColor={bg} stopOpacity="0.92" />
        </linearGradient>
        <radialGradient id={`sheen-${size}-${bg.replace('#','')}`} cx="0.3" cy="0.15" r="0.9">
          <stop offset="0" stopColor="#ffffff" stopOpacity="0.10" />
          <stop offset="0.6" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>

      {container === 'square' ? (
        <>
          <rect x="0" y="0" width={size} height={size} rx={r} ry={r} fill={`url(#bg-${size}-${bg.replace('#','')})`} />
          <rect x="0" y="0" width={size} height={size} rx={r} ry={r} fill={`url(#sheen-${size}-${bg.replace('#','')})`} />
        </>
      ) : null}

      {/* Chat bubble silhouette (only visible if container !== 'square', otherwise the square IS the bubble) */}
      {container === 'bubble' ? (() => {
        const bx = size * 0.08, by = size * 0.10, bw = size * 0.84, bh = size * 0.74;
        const br = size * 0.18;
        const tailX = size * 0.26;
        const tailY = by + bh;
        const tailW = size * 0.10;
        const tailH = size * 0.12;
        const d = [
          `M ${bx + br} ${by}`,
          `H ${bx + bw - br}`,
          `Q ${bx + bw} ${by}, ${bx + bw} ${by + br}`,
          `V ${by + bh - br}`,
          `Q ${bx + bw} ${by + bh}, ${bx + bw - br} ${by + bh}`,
          `H ${tailX + tailW}`,
          `L ${tailX} ${tailY + tailH}`,
          `L ${tailX - 4} ${by + bh}`,
          `H ${bx + br}`,
          `Q ${bx} ${by + bh}, ${bx} ${by + bh - br}`,
          `V ${by + br}`,
          `Q ${bx} ${by}, ${bx + br} ${by}`,
          'Z',
        ].join(' ');
        return <path d={d} fill={bg} />;
      })() : null}

      {/* EKG */}
      <path
        d={p}
        fill="none"
        stroke={stroke}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* tiny pulse dot at the end of the line */}
      <circle cx={x1} cy={cy} r={size * 0.022} fill={stroke} />
    </svg>
  );
}

/* ---------- Horizontal wordmark ---------- */

function Wordmark({ height = 96, onDark = true, showIcon = true }) {
  const iconSize = height;
  const fontSize = height * 0.7;
  const color = onDark ? BRAND.white : BRAND.ink;
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: height * 0.22, lineHeight: 1 }}>
      {showIcon ? (
        <div style={{ width: iconSize, height: iconSize, borderRadius: iconSize * 0.225, overflow: 'hidden', boxShadow: onDark ? '0 0 0 1px rgba(255,255,255,0.04)' : '0 0 0 1px rgba(0,0,0,0.06)' }}>
          <IconMark size={iconSize} bg={BRAND.blue} stroke={BRAND.white} />
        </div>
      ) : null}
      <div style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize,
        color,
        letterSpacing: '-0.025em',
        display: 'flex',
        alignItems: 'baseline',
      }}>
        <span style={{ fontWeight: 300 }}>Bi</span>
        <span style={{ fontWeight: 700 }}>Tanı</span>
      </div>
    </div>
  );
}

/* ---------- Splash screen 390x844 ---------- */

function Splash() {
  return (
    <div style={{
      width: 390,
      height: 844,
      background: BRAND.ink,
      position: 'relative',
      overflow: 'hidden',
      fontFamily: 'Inter, system-ui, sans-serif',
      color: BRAND.white,
    }}>
      {/* subtle radial glow behind logo */}
      <div style={{
        position: 'absolute', inset: 0,
        background: 'radial-gradient(ellipse 60% 40% at 50% 42%, rgba(26,110,245,0.18), rgba(26,110,245,0) 70%)',
        pointerEvents: 'none',
      }} />

      {/* status bar */}
      <div style={{
        position: 'absolute', top: 0, left: 0, right: 0,
        height: 54, padding: '18px 28px 0',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        fontSize: 15, fontWeight: 600, letterSpacing: '-0.01em',
      }}>
        <span>9:41</span>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <Signal /> <Wifi /> <Battery />
        </span>
      </div>

      {/* center stack */}
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        gap: 28,
      }}>
        <div style={{ width: 132, height: 132, borderRadius: 30, overflow: 'hidden', boxShadow: '0 30px 80px -20px rgba(26,110,245,0.55), 0 0 0 1px rgba(255,255,255,0.05)' }}>
          <IconMark size={132} bg={BRAND.blue} stroke={BRAND.white} />
        </div>

        <div style={{
          fontSize: 42,
          color: BRAND.white,
          letterSpacing: '-0.03em',
          lineHeight: 1,
          display: 'flex', alignItems: 'baseline',
        }}>
          <span style={{ fontWeight: 300 }}>Bi</span>
          <span style={{ fontWeight: 700 }}>Tanı</span>
        </div>

        <div style={{
          fontSize: 15,
          color: 'rgba(255,255,255,0.55)',
          letterSpacing: '-0.005em',
          fontWeight: 400,
          textAlign: 'center',
          maxWidth: 280,
        }}>
          Sağlığın için akıllı asistan
        </div>
      </div>

      {/* footer mark */}
      <div style={{
        position: 'absolute', bottom: 36, left: 0, right: 0,
        textAlign: 'center',
        fontSize: 11,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: 'rgba(255,255,255,0.30)',
        fontWeight: 500,
      }}>
        v 1.0 · Türkiye
      </div>

      {/* home indicator */}
      <div style={{
        position: 'absolute', bottom: 8, left: '50%', transform: 'translateX(-50%)',
        width: 134, height: 5, borderRadius: 3, background: 'rgba(255,255,255,0.35)',
      }} />
    </div>
  );
}

/* tiny status-bar glyphs */
function Signal() { return (
  <svg width="18" height="11" viewBox="0 0 18 11" fill="none">
    {[2,5,8,11].map((h,i) => <rect key={i} x={i*4} y={11-h} width="3" height={h} rx="0.5" fill="white" />)}
  </svg>
); }
function Wifi() { return (
  <svg width="16" height="11" viewBox="0 0 16 11" fill="none">
    <path d="M1 4 a10 10 0 0 1 14 0" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    <path d="M3.5 6.5 a6.5 6.5 0 0 1 9 0" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
    <circle cx="8" cy="9.5" r="1.2" fill="white"/>
  </svg>
); }
function Battery() { return (
  <svg width="26" height="12" viewBox="0 0 26 12" fill="none">
    <rect x="0.5" y="0.5" width="22" height="11" rx="2.5" stroke="white" opacity="0.6" fill="none"/>
    <rect x="2" y="2" width="18" height="8" rx="1.2" fill="white"/>
    <rect x="23" y="4" width="2" height="4" rx="1" fill="white" opacity="0.6"/>
  </svg>
); }

window.BRAND = BRAND;
window.IconMark = IconMark;
window.Wordmark = Wordmark;
window.Splash = Splash;
