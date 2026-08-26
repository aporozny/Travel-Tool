import React from 'react';
import { useTripMode } from '../hooks/useTripMode.web';

const C = {
  gold: '#C9A84C',
  text: '#1A1A1A',
  muted: '#9B9590',
  border: '#F0EDE8',
  red: '#C62828',
};

// Rendered from both SafetyScreen.web.tsx and WhosGoingPanel.tsx -- Trip
// Mode feeds both Safety Line auto-location and "near you now" matching,
// so it's a single shared toggle rather than one per feature.
export function TripModeToggle() {
  const { enabled, error, enable, disable } = useTripMode();

  return (
    <div style={s.card}>
      <div style={s.row}>
        <div style={{ flex: 1 }}>
          <div style={s.title}>Trip Mode</div>
          <div style={s.desc}>
            Shares your live location while Drift is open in this browser tab — it pauses if you close the tab or lock your phone.
          </div>
        </div>
        <button
          style={{ ...s.toggle, ...(enabled ? s.toggleOn : {}) }}
          onClick={() => (enabled ? disable() : enable())}
          aria-pressed={enabled}
          aria-label="Toggle Trip Mode"
        >
          <div style={{ ...s.knob, ...(enabled ? s.knobOn : {}) }} />
        </button>
      </div>
      {error && <div style={s.error}>⚠ {error}</div>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: { background: '#fff', borderRadius: 14, padding: 16, border: `1px solid ${C.border}`, marginBottom: 16 },
  row: { display: 'flex', alignItems: 'center', gap: 14 },
  title: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 4 },
  desc: { fontSize: 12.5, color: C.muted, lineHeight: 1.5 },
  toggle: {
    width: 46, height: 26, borderRadius: 13, border: 'none', background: C.border,
    cursor: 'pointer', position: 'relative' as const, flexShrink: 0, padding: 0,
  },
  toggleOn: { background: C.gold },
  knob: {
    width: 20, height: 20, borderRadius: '50%', background: '#fff', position: 'absolute' as const,
    top: 3, left: 3, transition: 'left 0.15s ease', boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
  },
  knobOn: { left: 23 },
  error: { marginTop: 10, fontSize: 12.5, color: C.red },
};
