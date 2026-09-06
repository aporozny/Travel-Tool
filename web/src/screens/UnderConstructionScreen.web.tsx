import React from 'react';

const C = {
  gold:      '#C9A84C',
  goldLight: '#FBF5E6',
  goldDark:  '#A8893A',
  text:      '#1A1A1A',
  muted:     '#9B9590',
  border:    '#F0EDE8',
};

interface Props {
  title: string;
  message?: string;
}

// Generic gate for a feature whose backend is real but not yet safe to
// expose -- e.g. still pointed at a sandbox/test API key, so a "confirmed"
// booking wouldn't be a real one. Swap a screen out for this in AppShell's
// renderContent() rather than deleting/half-building the real screen.
export default function UnderConstructionScreen({ title, message }: Props) {
  return (
    <div style={styles.wrap}>
      <div style={styles.mark}>◈</div>
      <h1 style={styles.title}>{title}</h1>
      <p style={styles.message}>
        {message || "This is still being finished. Check back soon."}
      </p>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    padding: 40,
  },
  mark: { fontSize: 32, color: C.gold, marginBottom: 16 },
  title: {
    fontFamily: "'DM Serif Display', serif",
    fontSize: 24,
    color: C.text,
    marginBottom: 8,
  },
  message: {
    fontSize: 14,
    color: C.muted,
    maxWidth: 360,
    lineHeight: 1.6,
  },
};
