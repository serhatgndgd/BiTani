/* Compose all brand artifacts on a design canvas */

const { DesignCanvas, DCSection, DCArtboard } = window;
const { IconMark, Wordmark, Splash, BRAND } = window;

/* Caption helpers */
const Caption = ({ children }) => (
  <div style={{
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: 11,
    color: '#8a8f98',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    marginTop: 14,
  }}>{children}</div>
);

/* ---- Artboard contents ---- */

const IconArtboard = ({ bg, stroke, label, surface }) => (
  <div style={{
    width: 560, height: 620,
    background: surface,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center',
    padding: 40,
  }}>
    <div style={{ width: 360, height: 360, borderRadius: 80, overflow: 'hidden',
      boxShadow: surface === '#0a0a0a'
        ? '0 40px 80px -30px rgba(26,110,245,0.45), 0 0 0 1px rgba(255,255,255,0.04)'
        : '0 40px 80px -30px rgba(0,0,0,0.25), 0 0 0 1px rgba(0,0,0,0.06)'
    }}>
      <IconMark size={360} bg={bg} stroke={stroke} />
    </div>
    <Caption>{label}</Caption>
  </div>
);

const IconScaleArtboard = ({ surface }) => (
  <div style={{
    width: 720, height: 360,
    background: surface,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 36, padding: 40,
  }}>
    {[180, 120, 80, 56, 40, 28].map((s) => (
      <div key={s} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
        <div style={{ width: s, height: s, borderRadius: s * 0.225, overflow: 'hidden',
          boxShadow: surface === '#0a0a0a' ? '0 0 0 1px rgba(255,255,255,0.05)' : '0 0 0 1px rgba(0,0,0,0.06)' }}>
          <IconMark size={s} bg={BRAND.blue} stroke={BRAND.white} />
        </div>
        <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 10, color: surface==='#0a0a0a'?'#5a5f68':'#8a8f98', letterSpacing:'0.06em' }}>{s}</div>
      </div>
    ))}
  </div>
);

const WordmarkArtboard = ({ surface, onDark, label, height = 88 }) => (
  <div style={{
    width: 760, height: 320,
    background: surface,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 18,
    padding: 40,
  }}>
    <Wordmark height={height} onDark={onDark} />
    <Caption>{label}</Caption>
  </div>
);

const WordmarkSizesArtboard = ({ surface, onDark }) => (
  <div style={{
    width: 760, height: 360,
    background: surface,
    display: 'flex', flexDirection: 'column',
    alignItems: 'center', justifyContent: 'center', gap: 28, padding: 40,
  }}>
    {[88, 56, 36, 24].map((h) => (
      <div key={h} style={{ display:'flex', alignItems:'center', gap: 20 }}>
        <Wordmark height={h} onDark={onDark} />
      </div>
    ))}
  </div>
);

const SplashArtboard = () => (
  <div style={{
    width: 470, height: 920,
    background: '#101013',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 40,
  }}>
    <div style={{
      borderRadius: 48,
      overflow: 'hidden',
      boxShadow: '0 60px 120px -30px rgba(0,0,0,0.6), 0 0 0 8px #1c1c1f, 0 0 0 9px #2a2a2e',
      width: 390, height: 844, position: 'relative',
    }}>
      <Splash />
      {/* notch */}
      <div style={{
        position:'absolute', top: 11, left: '50%', transform:'translateX(-50%)',
        width: 120, height: 32, borderRadius: 20, background: '#000',
      }} />
    </div>
  </div>
);

const PaletteArtboard = () => {
  const swatches = [
    { c: '#1a6ef5', name: 'Primary', code: '#1A6EF5' },
    { c: '#0d4fcc', name: 'Primary / Deep', code: '#0D4FCC' },
    { c: '#3b8aff', name: 'Primary / Glow', code: '#3B8AFF' },
    { c: '#ffffff', name: 'White', code: '#FFFFFF' },
    { c: '#0a0a0a', name: 'Ink', code: '#0A0A0A' },
    { c: '#8a8f98', name: 'Mute', code: '#8A8F98' },
  ];
  return (
    <div style={{ width: 760, height: 280, background: '#0a0a0a', padding: 40, display:'grid', gridTemplateColumns:'repeat(3, 1fr)', gap: 16 }}>
      {swatches.map((s) => (
        <div key={s.code} style={{ display:'flex', alignItems:'center', gap: 14, color:'#fff' }}>
          <div style={{ width: 56, height: 56, borderRadius: 12, background: s.c, boxShadow:'inset 0 0 0 1px rgba(255,255,255,0.06)' }} />
          <div>
            <div style={{ fontFamily:'Inter', fontWeight: 500, fontSize: 14 }}>{s.name}</div>
            <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 11, color:'#8a8f98', letterSpacing:'0.04em' }}>{s.code}</div>
          </div>
        </div>
      ))}
    </div>
  );
};

const TypeArtboard = () => (
  <div style={{ width: 760, height: 360, background:'#0a0a0a', color:'#fff', padding: 48, display:'flex', flexDirection:'column', justifyContent:'center', gap: 22 }}>
    <div style={{ fontFamily:'JetBrains Mono, monospace', fontSize: 11, color:'#8a8f98', letterSpacing:'0.08em', textTransform:'uppercase' }}>Inter — variable</div>
    <div style={{ fontFamily:'Inter', fontSize: 64, letterSpacing:'-0.03em', lineHeight: 1, display:'flex', alignItems:'baseline' }}>
      <span style={{ fontWeight: 300 }}>Bi</span><span style={{ fontWeight: 700 }}>Tanı</span>
    </div>
    <div style={{ fontFamily:'Inter', fontSize: 16, color:'rgba(255,255,255,0.6)', letterSpacing:'-0.005em', maxWidth: 540, lineHeight: 1.5 }}>
      The lockup pairs Inter Light (300) for "Bi" with Inter Bold (700) for "Tanı" — a 400-weight gap that gives the second syllable diagnostic emphasis. Set tight: -2.5% to -3%.
    </div>
    <div style={{ display:'flex', gap: 24, fontFamily:'Inter', fontSize: 13, color:'#8a8f98' }}>
      <span>300 · Light</span><span>400 · Regular</span><span>500 · Medium</span><span>700 · Bold</span>
    </div>
  </div>
);

/* ---- Page ---- */

function App() {
  return (
    <DesignCanvas
      title="BiTanı — Brand Identity"
      subtitle="App icon · wordmark · splash · system tokens"
      background="#0a0a0a"
    >
      <DCSection id="icon" title="01 · App Icon">
        <DCArtboard id="icon-light" label="Primary · Blue" width={560} height={620}>
          <IconArtboard bg={BRAND.blue} stroke={BRAND.white} surface="#f5f6f8" label="iOS / Android · 1024" />
        </DCArtboard>
        <DCArtboard id="icon-dark" label="Dark Mode · Ink on Blue Bubble" width={560} height={620}>
          <IconArtboard bg={BRAND.blue} stroke={BRAND.white} surface="#0a0a0a" label="Dark Surface · 1024" />
        </DCArtboard>
        <DCArtboard id="icon-mono-light" label="Mono · Inverse" width={560} height={620}>
          <IconArtboard bg={BRAND.white} stroke={BRAND.blue} surface="#f5f6f8" label="Inverse · Light Surface" />
        </DCArtboard>
        <DCArtboard id="icon-mono-dark" label="Mono · Ink" width={560} height={620}>
          <IconArtboard bg={BRAND.ink} stroke={BRAND.white} surface="#1c1c1c" label="Mono · Ink" />
        </DCArtboard>
        <DCArtboard id="icon-scale-dark" label="Scale Test · Dark" width={720} height={360}>
          <IconScaleArtboard surface="#0a0a0a" />
        </DCArtboard>
        <DCArtboard id="icon-scale-light" label="Scale Test · Light" width={720} height={360}>
          <IconScaleArtboard surface="#f5f6f8" />
        </DCArtboard>
      </DCSection>

      <DCSection id="wordmark" title="02 · Horizontal Wordmark">
        <DCArtboard id="wm-dark" label="On Dark · #0A0A0A" width={760} height={320}>
          <WordmarkArtboard surface="#0a0a0a" onDark={true} label="Primary lockup · dark" />
        </DCArtboard>
        <DCArtboard id="wm-light" label="On White" width={760} height={320}>
          <WordmarkArtboard surface="#ffffff" onDark={false} label="Primary lockup · light" />
        </DCArtboard>
        <DCArtboard id="wm-sizes-dark" label="Sizes · Dark" width={760} height={360}>
          <WordmarkSizesArtboard surface="#0a0a0a" onDark={true} />
        </DCArtboard>
        <DCArtboard id="wm-sizes-light" label="Sizes · Light" width={760} height={360}>
          <WordmarkSizesArtboard surface="#ffffff" onDark={false} />
        </DCArtboard>
      </DCSection>

      <DCSection id="splash" title="03 · Splash Screen · 390 × 844">
        <DCArtboard id="splash-device" label="Device frame" width={470} height={920}>
          <SplashArtboard />
        </DCArtboard>
        <DCArtboard id="splash-flat" label="Flat · 1:1" width={390} height={844}>
          <Splash />
        </DCArtboard>
      </DCSection>

      <DCSection id="system" title="04 · System">
        <DCArtboard id="palette" label="Palette" width={760} height={280}>
          <PaletteArtboard />
        </DCArtboard>
        <DCArtboard id="type" label="Typography" width={760} height={360}>
          <TypeArtboard />
        </DCArtboard>
      </DCSection>
    </DesignCanvas>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
