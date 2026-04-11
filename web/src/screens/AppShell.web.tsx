import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../store/authSlice.web';
import { AppDispatch, RootState } from '../store';
import ExploreScreen from './ExploreScreen.web';
import BookingsScreen from './BookingsScreen.web';
import SafetyScreen from './SafetyScreen.web';
import ProfileScreen from './ProfileScreen.web';
import DashboardScreen from './DashboardScreen.web';

type Tab = 'explore' | 'bookings' | 'safety' | 'profile' | 'dashboard';

export default function AppShell() {
  const dispatch = useDispatch<AppDispatch>();
  const { user } = useSelector((s: RootState) => s.auth);
  const [tab, setTab] = useState<Tab>(user?.role === 'operator' ? 'dashboard' : 'explore');
  const [detail, setDetail] = useState<any>(null);

  const isOperator = user?.role === 'operator';

  const NAV_ITEMS: { key: Tab; label: string; icon: string }[] = isOperator
    ? [
        { key: 'dashboard', label: 'Dashboard', icon: '📊' },
        { key: 'bookings', label: 'Bookings', icon: '📋' },
        { key: 'profile', label: 'Profile', icon: '👤' },
      ]
    : [
        { key: 'explore', label: 'Explore', icon: '🗺' },
        { key: 'bookings', label: 'Bookings', icon: '📋' },
        { key: 'safety', label: 'Safety', icon: '🛡' },
        { key: 'profile', label: 'Profile', icon: '👤' },
      ];

  const renderContent = () => {
    switch (tab) {
      case 'explore': return <ExploreScreen onSelectOperator={(op: any) => setDetail({ type: 'operator', data: op })} detail={detail} onClearDetail={() => setDetail(null)} />;
      case 'bookings': return <BookingsScreen />;
      case 'safety': return <SafetyScreen />;
      case 'profile': return <ProfileScreen />;
      case 'dashboard': return <DashboardScreen />;
      default: return null;
    }
  };

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.sidebarLogo}>
          <span style={{ fontSize: 28 }}>🌏</span>
          <span style={styles.sidebarLogoText}>Travel Tool</span>
        </div>

        <nav style={styles.nav}>
          {NAV_ITEMS.map(item => (
            <button
              key={item.key}
              style={{ ...styles.navItem, ...(tab === item.key ? styles.navItemActive : {}) }}
              onClick={() => { setTab(item.key); setDetail(null); }}>
              <span style={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        <div style={styles.sidebarFooter}>
          <p style={styles.userRole}>{user?.role}</p>
          <p style={styles.userEmail}>{user?.email}</p>
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
  shell: { display: 'flex', height: '100vh', overflow: 'hidden' },
  sidebar: {
    width: 220, background: '#fff', borderRight: '1px solid #f0f0f0',
    display: 'flex', flexDirection: 'column', padding: '24px 0', flexShrink: 0,
  },
  sidebarLogo: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '0 20px 24px', borderBottom: '1px solid #f5f5f5',
  },
  sidebarLogoText: { fontSize: 16, fontWeight: 700, color: '#1a1a1a' },
  nav: { flex: 1, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  navItem: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
    borderRadius: 10, border: 'none', background: 'transparent',
    cursor: 'pointer', fontSize: 14, color: '#666', fontWeight: 500, textAlign: 'left',
  },
  navItemActive: { background: '#f0f7f0', color: '#2E7D32' },
  navIcon: { fontSize: 18, width: 24 },
  sidebarFooter: { padding: '16px 20px', borderTop: '1px solid #f5f5f5' },
  userRole: { fontSize: 11, color: '#bbb', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 },
  userEmail: { fontSize: 12, color: '#999', marginBottom: 10, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  logoutBtn: {
    width: '100%', padding: '8px 0', border: '1px solid #ffcdd2',
    borderRadius: 8, background: 'transparent', color: '#c62828',
    fontSize: 13, cursor: 'pointer', fontWeight: 500,
  },
  main: { flex: 1, overflow: 'auto', background: '#f8f8f6' },
};
