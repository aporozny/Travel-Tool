import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/authSlice.web';
import { AppDispatch, RootState } from '../store';
import ExploreScreen from './ExploreScreen.web';
import api from '../services/api.web';
import BookingsScreen from './BookingsScreen.web';
import SafetyScreen from './SafetyScreen.web';
import ProfileScreen from './ProfileScreen.web';
import DashboardScreen from './DashboardScreen.web';
import MembersScreen from './MembersScreen.web';
import MessagesScreen from './MessagesScreen.web';
import CommunityScreen from './CommunityScreen.web';

type Tab = 'explore' | 'community' | 'bookings' | 'safety' | 'profile' | 'dashboard' | 'members' | 'messages';

// ─── Design tokens ────────────────────────────────────────────────────────────
const C = {
  gold:       '#C9A84C',
  goldLight:  '#FBF5E6',
  goldDark:   '#A8893A',
  bg:         '#f8f7f4',
  sidebar:    '#FFFFFF',
  border:     '#F0EDE8',
  text:       '#1A1A1A',
  muted:      '#9B9590',
  navHover:   '#FAF8F4',
};

export default function AppShell() {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((s: RootState) => s.auth);
  // Explore has real, worldwide content today; Community's cold-start
  // problem (near-zero real posts for a new/early-stage platform) isn't
  // something a query can fix, so it shouldn't be where a traveller
  // lands by default while that's still true.
  const [tab, setTab] = useState<Tab>(user?.role === 'operator' ? 'dashboard' : 'explore');
  const [detail, setDetail] = useState<any>(null);
  const [pendingConnections, setPendingConnections] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);

  React.useEffect(() => {
    if (user?.role !== 'traveler') return;
    const check = () => {
      api.get('/members/my/connections')
        .then(r => {
          const pending = (r.data || []).filter((c: any) => c.direction === 'received' && c.status === 'pending').length;
          setPendingConnections(pending);
        }).catch(() => {});
      api.get('/messages/unread/count')
        .then(r => setUnreadMessages(r.data.count || 0))
        .catch(() => {});
    };
    check();
    const interval = setInterval(check, 15000);
    return () => clearInterval(interval);
  }, [user]);

  const isOperator = user?.role === 'operator';
  const isAdmin = user?.role === 'admin';

  const NAV_ITEMS: { key: Tab; label: string; icon: string; badge?: number }[] = isOperator
    ? [
        { key: 'dashboard', label: 'Dashboard',  icon: '◈' },
        { key: 'bookings',  label: 'Bookings',   icon: '◎' },
        { key: 'profile',   label: 'Profile',    icon: '◉' },
      ]
    : [
        { key: 'community', label: 'Feed',       icon: '◈' },
        { key: 'explore',   label: 'Explore',    icon: '◎' },
        { key: 'members',   label: 'Members',    icon: '◉', badge: pendingConnections },
        { key: 'messages',  label: 'Messages',   icon: '◇', badge: unreadMessages },
        { key: 'bookings',  label: 'Bookings',   icon: '◆' },
        { key: 'safety',    label: 'Safety',     icon: '⬡' },
        { key: 'profile',   label: 'Profile',    icon: '◑' },
      ];

  const renderContent = () => {
    switch (tab) {
      case 'community': return <CommunityScreen />;
      case 'explore':   return <ExploreScreen onSelectOperator={(op: any) => setDetail({ type: 'operator', data: op })} detail={detail} onClearDetail={() => setDetail(null)} />;
      case 'bookings':  return <BookingsScreen />;
      case 'safety':    return <SafetyScreen />;
      case 'profile':   return <ProfileScreen />;
      case 'members':   return <MembersScreen />;
      case 'messages':  return <MessagesScreen />;
      case 'dashboard': return <DashboardScreen />;
      default:          return null;
    }
  };

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        {/* Logo */}
        <div style={styles.logo}>
          <span style={styles.logoMark}>◈</span>
          <span style={styles.logoText}>Drift</span>
        </div>

        {/* Nav */}
        <nav style={styles.nav}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              style={{
                ...styles.navItem,
                ...(tab === item.key ? styles.navItemActive : {}),
              }}
              onClick={() => { setTab(item.key); setDetail(null); }}
            >
              <span style={{
                ...styles.navIcon,
                color: tab === item.key ? C.gold : C.muted,
              }}>{item.icon}</span>
              <span style={{ color: tab === item.key ? C.text : C.muted }}>
                {item.label}
              </span>
              {item.badge ? (
                <span style={styles.badge}>{item.badge}</span>
              ) : null}
            </button>
          ))}
          {isAdmin && (
            <button style={styles.navItem} onClick={() => window.open('/admin.html', '_blank')}>
              <span style={{ ...styles.navIcon, color: C.muted }}>⚙</span>
              <span style={{ color: C.muted }}>Admin</span>
            </button>
          )}
        </nav>

        {/* Footer */}
        <div style={styles.sidebarFooter}>
          <div style={styles.userInfo}>
            <div style={styles.userAvatar}>
              {(user?.email?.[0] || '?').toUpperCase()}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <p style={styles.userRole}>{user?.role}</p>
              <p style={styles.userEmail}>{user?.email}</p>
            </div>
          </div>
          <button style={styles.logoutBtn} onClick={() => dispatch(logout())}>
            Sign out
          </button>
        </div>
      </aside>

      <main style={styles.main}>
        {renderContent()}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  shell: { display: 'flex', height: '100vh', overflow: 'hidden', background: C.bg },

  sidebar: {
    width: 220,
    background: C.sidebar,
    borderRight: `1px solid ${C.border}`,
    display: 'flex',
    flexDirection: 'column',
    padding: '0',
    flexShrink: 0,
  },

  logo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '28px 24px 24px',
    borderBottom: `1px solid ${C.border}`,
  },
  logoMark: {
    fontSize: 22,
    color: C.gold,
    lineHeight: 1,
  },
  logoText: {
    fontSize: 18,
    fontWeight: 700,
    color: C.text,
    letterSpacing: '-0.3px',
    fontFamily: "'DM Serif Display', serif",
  },

  nav: {
    flex: 1,
    padding: '12px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  navItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 12px',
    borderRadius: 8,
    border: 'none',
    background: 'transparent',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
    textAlign: 'left',
    width: '100%',
    transition: 'background 0.15s',
  },
  navItemActive: {
    background: C.goldLight,
  },
  navIcon: {
    fontSize: 16,
    width: 20,
    textAlign: 'center',
    flexShrink: 0,
  },
  badge: {
    background: '#E53E3E',
    color: '#fff',
    borderRadius: 10,
    padding: '1px 6px',
    fontSize: 10,
    marginLeft: 'auto',
    fontWeight: 700,
  },

  sidebarFooter: {
    padding: '16px 16px 20px',
    borderTop: `1px solid ${C.border}`,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  userInfo: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  userAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    background: C.goldLight,
    color: C.goldDark,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 700,
    flexShrink: 0,
  },
  userRole: {
    fontSize: 10,
    color: C.muted,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.8px',
    marginBottom: 1,
  },
  userEmail: {
    fontSize: 11,
    color: C.muted,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  logoutBtn: {
    width: '100%',
    padding: '8px 0',
    border: `1px solid ${C.border}`,
    borderRadius: 8,
    background: 'transparent',
    color: C.muted,
    fontSize: 13,
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'all 0.15s',
  },

  main: {
    flex: 1,
    overflow: 'auto',
    background: C.bg,
  },
};
