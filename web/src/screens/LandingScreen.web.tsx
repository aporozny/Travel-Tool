import React, { useEffect, useState } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';

interface Props {
  onJoin: () => void;
  onLogin: () => void;
}

function StatCounter({ value, label }: { value: string; label: string }) {
  return (
    <div style={stat.wrap}>
      <p style={stat.value}>{value}</p>
      <p style={stat.label}>{label}</p>
    </div>
  );
}

function ValueProp({ icon, title, body }: { icon: string; title: string; body: string }) {
  return (
    <div style={vp.card}>
      <div style={vp.icon}>{icon}</div>
      <h3 style={vp.title}>{title}</h3>
      <p style={vp.body}>{body}</p>
    </div>
  );
}

function Step({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div style={step.wrap}>
      <div style={step.num}>{number}</div>
      <div>
        <h4 style={step.title}>{title}</h4>
        <p style={step.body}>{body}</p>
      </div>
    </div>
  );
}

export default function LandingScreen({ onJoin, onLogin }: Props) {
  const [stats, setStats] = useState({ members: '—', operators: '—', regions: '—' });

  const [liveDestinations, setLiveDestinations] = useState<{ region: string; country: string }[]>([]);

  useEffect(() => {
    fetch('/health/stats')
      .then(r => r.json())
      .then(data => {
        setStats({
          members: data.members > 0 ? data.members.toString() : '—',
          operators: (data.operators + data.places).toString(),
          regions: data.regions > 1 ? data.regions.toString() : 'Bali',
        });
      }).catch(() => {});
    // Same live-computed list Explore uses -- never a hand-maintained
    // roadmap that goes stale the moment coverage changes.
    fetch('/api/v1/discover/destinations')
      .then(r => r.json())
      .then(data => setLiveDestinations(data.featured || []))
      .catch(() => {});
  }, []);

  return (
    <div style={s.page}>

      {/* Nav */}
      <nav style={s.nav}>
        <div style={s.navInner}>
          <span style={s.logo}>Drift</span>
          <div style={s.navLinks}>
            <button style={s.navLink} onClick={onLogin}>Sign in</button>
            <button style={s.joinBtn} onClick={onJoin}>Join free</button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section style={s.hero}>
        <div style={s.heroInner}>
          <p style={s.heroEyebrow}>
            {stats.regions !== '—' ? `Live in ${stats.regions} destinations worldwide` : 'Now open worldwide'}
          </p>
          <h1 style={s.heroTitle}>Travel with<br />better people.</h1>
          <p style={s.heroSub}>
            Drift is a community for travellers who go deeper.
            Better operators. Real local knowledge. People who actually know the place.
          </p>
          <div style={s.heroCtas}>
            <button style={s.primaryBtn} onClick={onJoin}>Join the community</button>
            <button style={s.ghostBtn} onClick={onLogin}>Already a member</button>
          </div>
        </div>
        <div style={s.heroVisual}>
          <div style={s.heroCard}>
            <div style={s.heroCardTop}>
              <div style={s.heroCardAvatar}>A</div>
              <div>
                <p style={s.heroCardName}>Andre</p>
                <p style={s.heroCardMeta}>Solo · Mid budget · Diver</p>
              </div>
            </div>
            <p style={s.heroCardText}>
              "Found a dive operator in Nusa Penida I never would have found on my own.
              The community recommendation was spot on."
            </p>
            <div style={s.heroCardTags}>
              {['Scuba diving', 'Nusa Penida', 'Budget mid'].map(t => (
                <span key={t} style={s.heroCardTag}>{t}</span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section style={s.stats}>
        <div style={s.statsInner}>
          <StatCounter value={stats.operators} label="Operators listed" />
          <div style={s.statDivider} />
          <StatCounter value={stats.regions} label="Regions covered" />
          <div style={s.statDivider} />
          <StatCounter value="Free" label="To join" />
          <div style={s.statDivider} />
          <StatCounter value="0" label="Ads. Ever." />
        </div>
      </section>

      {/* Problem */}
      <section style={s.problem}>
        <div style={s.sectionInner}>
          <h2 style={s.problemTitle}>
            Most travel platforms show you<br />what everyone else sees.
          </h2>
          <p style={s.problemBody}>
            Algorithm-ranked hotels. Sponsored listings. Reviews from people who stayed once
            and never came back. You end up at the same places as everyone else,
            wondering why it doesn't feel like the destination you imagined.
          </p>
          <p style={s.problemBody}>
            Drift is different. It's built around people who know — travellers who've been,
            operators who care, and a community that gives a damn about the places it visits.
          </p>
        </div>
      </section>

      {/* Value props */}
      <section style={s.props}>
        <div style={s.sectionInner}>
          <h2 style={s.sectionTitle}>What makes Drift different</h2>
          <div style={vp.grid}>
            <ValueProp
              icon="01"
              title="Preference-matched"
              body="Tell us how you travel — your budget, activities, dietary needs, pace. We surface operators that actually fit. Not the most popular. The most relevant to you."
            />
            <ValueProp
              icon="02"
              title="Community-vetted"
              body="Every recommendation comes from people who've been there. Members share real trip reports, ask real questions, and connect with operators who respond."
            />
            <ValueProp
              icon="03"
              title="No sponsored results"
              body="Drift is ad-free. Operators are listed on merit and member feedback. The best operators rise to the top because they're genuinely good, not because they paid more."
            />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section style={s.how}>
        <div style={s.sectionInner}>
          <h2 style={s.sectionTitle}>How it works</h2>
          <div style={s.howGrid}>
            <Step
              number="01"
              title="Join and tell us how you travel"
              body="A quick onboarding covers your budget, activities, dietary needs, where you want to go, and how you like to move. Takes five minutes."
            />
            <Step
              number="02"
              title="Explore your personalised feed"
              body="Operators, places, and trip reports ranked by how well they match you — not by who paid for placement. Save the ones that interest you."
            />
            <Step
              number="03"
              title="Connect and go deeper"
              body="Ask the community questions, find members heading to the same region, and book directly with operators who match your travel style."
            />
          </div>
        </div>
      </section>

      {/* Destinations -- live-computed, same source Explore uses. No
          hardcoded roadmap: a fixed "coming soon" list is a future promise
          the team gets held to long after coverage has actually changed. */}
      {liveDestinations.length > 0 && (
        <section style={s.destinations}>
          <div style={s.sectionInner}>
            <h2 style={s.sectionTitle}>Where travellers are exploring</h2>
            <p style={s.destinationSub}>
              Real, live coverage worldwide -- not a fixed list. Search any city,
              island or town and Drift builds real coverage there on demand.
            </p>
            <div style={s.destGrid}>
              {liveDestinations.map(d => (
                <div key={d.region} style={{ ...s.destCard, ...s.destCardLive }}>
                  <div style={s.destTop}>
                    <h4 style={s.destName}>{d.region}</h4>
                    <span style={{ ...s.destStatus, ...s.destStatusLive }}>Live</span>
                  </div>
                  <p style={s.destSub}>{d.country}</p>
                </div>
              ))}
              </div>
          </div>
        </section>
      )}

      {/* Operator CTA */}
      <section style={s.operator}>
        <div style={s.operatorInner}>
          <div style={s.operatorText}>
            <h2 style={s.operatorTitle}>Are you an operator?</h2>
            <p style={s.operatorBody}>
              List your business on Drift and get found by travellers who are genuinely
              looking for what you offer. No commission. No pay-to-rank. Just the right people
              finding the right operator.
            </p>
            <button style={s.operatorBtn} onClick={onJoin}>List your business</button>
          </div>
          <div style={s.operatorFeatures}>
            {[
              'Matched to travellers by preference',
              'Respond to booking requests directly',
              'Build your reputation through reviews',
              'No commission on bookings',
              'Verified operator badge',
            ].map(f => (
              <div key={f} style={s.operatorFeature}>
                <span style={s.operatorCheck}>✓</span>
                <span style={s.operatorFeatureText}>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section style={s.finalCta}>
        <div style={s.sectionInner}>
          <h2 style={s.finalTitle}>Travel with better people.</h2>
          <p style={s.finalSub}>Join Drift. Free, always.</p>
          <button style={s.primaryBtn} onClick={onJoin}>Get started</button>
        </div>
      </section>

      {/* Footer */}
      <footer style={s.footer}>
        <div style={s.footerInner}>
          <span style={s.footerLogo}>Drift</span>
          <p style={s.footerTagline}>Travel with better people.</p>
          <p style={s.footerCopy}>© 2026 Drift. Built for travellers, not algorithms.</p>
        </div>
      </footer>

    </div>
  );
}

// Styles
const s: Record<string, React.CSSProperties> = {
  page: { fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1a1a1a', background: '#fff' },
  nav: { position: 'sticky', top: 0, background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', borderBottom: '1px solid #f0f0f0', zIndex: 100 },
  navInner: { maxWidth: 1100, margin: '0 auto', padding: '0 24px', height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  logo: { fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: '#1a1a1a' },
  navLinks: { display: 'flex', alignItems: 'center', gap: 12 },
  navLink: { background: 'none', border: 'none', fontSize: 14, color: '#666', cursor: 'pointer', padding: '8px 12px' },
  joinBtn: { background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 8, padding: '8px 18px', fontSize: 14, fontWeight: 500, cursor: 'pointer' },

  hero: { maxWidth: 1100, margin: '0 auto', padding: '80px 24px 80px', display: 'flex', gap: 60, alignItems: 'center' },
  heroInner: { flex: 1 },
  heroEyebrow: { fontSize: 13, color: '#2E7D32', fontWeight: 600, letterSpacing: 0.5, marginBottom: 16, textTransform: 'uppercase' },
  heroTitle: { fontSize: 64, fontWeight: 800, lineHeight: 1.05, letterSpacing: -2, color: '#1a1a1a', marginBottom: 20 },
  heroSub: { fontSize: 18, color: '#555', lineHeight: 1.7, marginBottom: 32, maxWidth: 480 },
  heroCtas: { display: 'flex', gap: 12, flexWrap: 'wrap' },
  primaryBtn: { background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 10, padding: '14px 28px', fontSize: 16, fontWeight: 600, cursor: 'pointer' },
  ghostBtn: { background: 'transparent', color: '#555', border: '1.5px solid #e0e0e0', borderRadius: 10, padding: '14px 28px', fontSize: 15, cursor: 'pointer' },

  heroVisual: { flex: '0 0 360px' },
  heroCard: { background: '#f8f8f6', borderRadius: 20, padding: 28, border: '1px solid #ebebeb' },
  heroCardTop: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 16 },
  heroCardAvatar: { width: 40, height: 40, borderRadius: 20, background: '#1a1a1a', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 700 },
  heroCardName: { fontSize: 15, fontWeight: 600, color: '#1a1a1a', marginBottom: 2 },
  heroCardMeta: { fontSize: 12, color: '#999' },
  heroCardText: { fontSize: 14, color: '#444', lineHeight: 1.7, fontStyle: 'italic', marginBottom: 16 },
  heroCardTags: { display: 'flex', flexWrap: 'wrap', gap: 6 },
  heroCardTag: { fontSize: 11, background: '#fff', border: '1px solid #e0e0e0', borderRadius: 6, padding: '3px 8px', color: '#666' },

  stats: { background: '#f8f8f6', borderTop: '1px solid #ebebeb', borderBottom: '1px solid #ebebeb' },
  statsInner: { maxWidth: 900, margin: '0 auto', padding: '32px 24px', display: 'flex', justifyContent: 'space-around', alignItems: 'center', flexWrap: 'wrap', gap: 24 },
  statDivider: { width: 1, height: 40, background: '#e0e0e0' },

  problem: { maxWidth: 1100, margin: '0 auto', padding: '80px 24px' },
  sectionInner: { maxWidth: 1100, margin: '0 auto', padding: '80px 24px' },
  problemTitle: { fontSize: 36, fontWeight: 700, letterSpacing: -1, color: '#1a1a1a', marginBottom: 24, lineHeight: 1.2 },
  problemBody: { fontSize: 17, color: '#555', lineHeight: 1.8, marginBottom: 16, maxWidth: 640 },

  props: { background: '#f8f8f6' },
  sectionTitle: { fontSize: 32, fontWeight: 700, letterSpacing: -0.5, color: '#1a1a1a', marginBottom: 40 },

  how: { background: '#fff' },
  howGrid: { display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 640 },

  destinations: { background: '#f8f8f6' },
  destinationSub: { fontSize: 16, color: '#666', lineHeight: 1.7, marginBottom: 32, maxWidth: 560 },
  destGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12 },
  destCard: { background: '#fff', borderRadius: 12, padding: '16px 20px', border: '1px solid #e8e8e8' },
  destCardLive: { borderColor: '#c8e6c9' },
  destTop: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  destName: { fontSize: 16, fontWeight: 600, color: '#1a1a1a' },
  destStatus: { fontSize: 11, color: '#999', background: '#f5f5f5', padding: '2px 8px', borderRadius: 6 },
  destStatusLive: { color: '#2E7D32', background: '#E8F5E9' },
  destSub: { fontSize: 12, color: '#999', lineHeight: 1.5 },

  operator: { background: '#1a1a1a', color: '#fff' },
  operatorInner: { maxWidth: 1100, margin: '0 auto', padding: '80px 24px', display: 'flex', gap: 60, alignItems: 'flex-start', flexWrap: 'wrap' },
  operatorText: { flex: 1 },
  operatorTitle: { fontSize: 32, fontWeight: 700, color: '#fff', marginBottom: 16, letterSpacing: -0.5 },
  operatorBody: { fontSize: 16, color: '#aaa', lineHeight: 1.8, marginBottom: 28, maxWidth: 480 },
  operatorBtn: { background: '#fff', color: '#1a1a1a', border: 'none', borderRadius: 10, padding: '14px 28px', fontSize: 15, fontWeight: 600, cursor: 'pointer' },
  operatorFeatures: { flex: '0 0 300px', display: 'flex', flexDirection: 'column', gap: 14 },
  operatorFeature: { display: 'flex', gap: 12, alignItems: 'flex-start' },
  operatorCheck: { color: '#4caf50', fontSize: 16, flexShrink: 0, marginTop: 1 },
  operatorFeatureText: { fontSize: 14, color: '#ccc', lineHeight: 1.5 },

  finalCta: { textAlign: 'center' },
  finalTitle: { fontSize: 40, fontWeight: 800, letterSpacing: -1, color: '#1a1a1a', marginBottom: 12 },
  finalSub: { fontSize: 16, color: '#888', marginBottom: 28 },

  footer: { background: '#f8f8f6', borderTop: '1px solid #ebebeb' },
  footerInner: { maxWidth: 1100, margin: '0 auto', padding: '40px 24px', textAlign: 'center' },
  footerLogo: { fontSize: 20, fontWeight: 700, color: '#1a1a1a', display: 'block', marginBottom: 8 },
  footerTagline: { fontSize: 14, color: '#888', marginBottom: 16 },
  footerCopy: { fontSize: 12, color: '#bbb' },
};

const stat: Record<string, React.CSSProperties> = {
  wrap: { textAlign: 'center' },
  value: { fontSize: 32, fontWeight: 700, color: '#1a1a1a', marginBottom: 4 },
  label: { fontSize: 13, color: '#888' },
};

const vp: Record<string, React.CSSProperties> = {
  grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 24 },
  card: { background: '#fff', borderRadius: 16, padding: 28, border: '1px solid #ebebeb' },
  icon: { fontSize: 12, fontWeight: 700, color: '#2E7D32', letterSpacing: 1, marginBottom: 16, background: '#E8F5E9', padding: '4px 10px', borderRadius: 6, display: 'inline-block' },
  title: { fontSize: 18, fontWeight: 600, color: '#1a1a1a', marginBottom: 10 },
  body: { fontSize: 14, color: '#666', lineHeight: 1.7 },
};

const step: Record<string, React.CSSProperties> = {
  wrap: { display: 'flex', gap: 24, alignItems: 'flex-start' },
  num: { fontSize: 13, fontWeight: 700, color: '#2E7D32', letterSpacing: 1, flexShrink: 0, marginTop: 2, width: 32 },
  title: { fontSize: 17, fontWeight: 600, color: '#1a1a1a', marginBottom: 8 },
  body: { fontSize: 14, color: '#666', lineHeight: 1.7 },
};
