import React from 'react';

// Matches FlightsScreen.web.tsx / StaysScreen.web.tsx / AppShell.web.tsx tokens.
const C = {
  gold:      '#C9A84C',
  goldLight: '#FBF5E6',
  goldDark:  '#A8893A',
  bg:        '#f8f7f4',
  white:     '#FFFFFF',
  border:    '#F0EDE8',
  text:      '#1A1A1A',
  muted:     '#9B9590',
  soft:      '#F5F3EF',
};

type Kind = 'flights' | 'stays';

const COPY: Record<Kind, { title: string; blurb: string; bullets: string[] }> = {
  flights: {
    title: 'Flights are coming soon',
    blurb: 'Compare fares from full-service and low-cost airlines in one place, then book without leaving Drift.',
    bullets: ['Search across many airlines at once', 'Clear, all-in pricing', 'Bookings kept with the rest of your trip'],
  },
  stays: {
    title: 'Stays are coming soon',
    blurb: 'Browse hotels and apartments for your destination, side by side with your trip plans.',
    bullets: ['Hotels and apartments worldwide', 'Ratings, photos and amenities', 'Bookings kept with the rest of your trip'],
  },
};

// Illustrative placeholders only -- deliberately no prices, and the whole
// preview is blurred, inert and hidden from assistive tech.
const FLIGHT_ROWS = [
  { a: 'SYD', b: 'DPS', t: '06:10 → 12:35', n: 'Direct · 6h 25m' },
  { a: 'SYD', b: 'DPS', t: '09:45 → 16:20', n: 'Direct · 6h 35m' },
  { a: 'SYD', b: 'DPS', t: '13:00 → 21:15', n: '1 stop · 9h 15m' },
];
const STAY_ROWS = [
  { name: 'Seaside boutique hotel', city: 'Bali', n: '★ 4.6 · Pool · Breakfast' },
  { name: 'Old town apartment', city: 'Rome', n: '★ 4.4 · Kitchen · Wi-Fi' },
  { name: 'Riverside guesthouse', city: 'Lisbon', n: '★ 4.7 · Garden · Wi-Fi' },
];

function Preview({ kind }: { kind: Kind }) {
  return (
    <div style={s.previewInner} aria-hidden="true">
      <div style={s.searchBar}>
        {(kind === 'flights' ? ['From', 'To', 'Depart', 'Passengers'] : ['Destination', 'Check-in', 'Check-out', 'Guests']).map(l => (
          <div key={l} style={s.field}><span style={s.fieldLabel}>{l}</span><div style={s.fieldBox} /></div>
        ))}
        <div style={s.searchBtn}>Search</div>
      </div>
      {kind === 'flights'
        ? FLIGHT_ROWS.map((r, i) => (
            <div key={i} style={s.card}>
              <div style={s.thumb}>✈</div>
              <div style={{ flex: 1 }}>
                <div style={s.cardTitle}>{r.a} → {r.b}</div>
                <div style={s.cardSub}>{r.t}</div>
                <div style={s.cardSub}>{r.n}</div>
              </div>
              <div style={s.pill}>Select</div>
            </div>
          ))
        : STAY_ROWS.map((r, i) => (
            <div key={i} style={s.card}>
              <div style={{ ...s.thumb, width: 96, height: 72 }}>⌂</div>
              <div style={{ flex: 1 }}>
                <div style={s.cardTitle}>{r.name}</div>
                <div style={s.cardSub}>{r.city}</div>
                <div style={s.cardSub}>{r.n}</div>
              </div>
              <div style={s.pill}>View</div>
            </div>
          ))}
    </div>
  );
}

export default function ComingSoonScreen({ kind }: { kind: Kind }) {
  const copy = COPY[kind];
  return (
    <div style={s.wrap}>
      <div style={s.preview}>
        <Preview kind={kind} />
      </div>
      <div style={s.overlay}>
        <div style={s.panel} role="status">
          <div style={s.badge}>Coming soon</div>
          <h2 style={s.title}>{copy.title}</h2>
          <p style={s.blurb}>{copy.blurb}</p>
          <ul style={s.list}>
            {copy.bullets.map(b => <li key={b} style={s.li}><span style={s.tick}>✓</span>{b}</li>)}
          </ul>
          <p style={s.foot}>In the meantime, plan your trip in Trips and stay covered with the Safety Line.</p>
        </div>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', minHeight: '100%', height: '100%', overflow: 'hidden', background: C.bg },
  preview: { position: 'absolute', inset: 0, filter: 'blur(7px)', opacity: 0.75, pointerEvents: 'none', userSelect: 'none', overflow: 'hidden' },
  previewInner: { maxWidth: 860, margin: '0 auto', padding: '32px 24px' },
  searchBar: { display: 'flex', gap: 12, alignItems: 'flex-end', background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 20, flexWrap: 'wrap' },
  field: { flex: '1 1 120px', display: 'flex', flexDirection: 'column', gap: 6 },
  fieldLabel: { fontSize: 12, color: C.muted },
  fieldBox: { height: 38, borderRadius: 8, background: C.soft, border: `1px solid ${C.border}` },
  searchBtn: { background: C.gold, color: C.white, fontWeight: 600, borderRadius: 10, padding: '10px 22px' },
  card: { display: 'flex', alignItems: 'center', gap: 16, background: C.white, border: `1px solid ${C.border}`, borderRadius: 14, padding: 16, marginBottom: 14 },
  thumb: { width: 64, height: 64, borderRadius: 10, background: C.goldLight, color: C.goldDark, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 },
  cardTitle: { fontSize: 17, fontWeight: 600, color: C.text },
  cardSub: { fontSize: 13, color: C.muted, marginTop: 3 },
  pill: { border: `1px solid ${C.gold}`, color: C.goldDark, borderRadius: 20, padding: '6px 16px', fontSize: 13 },
  overlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16, background: 'rgba(248,247,244,0.35)' },
  panel: { background: C.white, border: `1px solid ${C.border}`, borderRadius: 18, boxShadow: '0 12px 40px rgba(0,0,0,0.12)', padding: '32px 32px 26px', maxWidth: 460, width: '100%', textAlign: 'center' },
  badge: { display: 'inline-block', background: C.goldLight, color: C.goldDark, border: `1px solid ${C.gold}`, borderRadius: 20, padding: '4px 14px', fontSize: 12, fontWeight: 700, letterSpacing: 0.6, textTransform: 'uppercase' },
  title: { margin: '14px 0 8px', fontSize: 24, color: C.text },
  blurb: { margin: '0 0 16px', color: C.muted, fontSize: 15, lineHeight: 1.5 },
  list: { listStyle: 'none', padding: 0, margin: '0 0 16px', textAlign: 'left', display: 'inline-block' },
  li: { fontSize: 14, color: C.text, margin: '6px 0' },
  tick: { color: C.gold, fontWeight: 700, marginRight: 8 },
  foot: { margin: 0, fontSize: 13, color: C.muted },
};
