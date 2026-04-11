import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { login, register, clearError } from '../store/authSlice.web';
import { AppDispatch, RootState } from '../store';

export default function LoginScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const { isLoading, error } = useSelector((s: RootState) => s.auth);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'traveler' | 'operator'>('traveler');
  const [localError, setLocalError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError('');
    dispatch(clearError());

    if (!email || !password) { setLocalError('Please fill in all fields'); return; }
    if (mode === 'register' && password.length < 8) {
      setLocalError('Password must be at least 8 characters'); return;
    }

    const action = mode === 'login'
      ? login({ email: email.trim().toLowerCase(), password })
      : register({ email: email.trim().toLowerCase(), password, role });

    const result = await dispatch(action as any);
    if ((result as any).error) {
      setLocalError((result.payload as string) || 'Something went wrong');
    }
  };

  const displayError = localError || error;

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>🌏</span>
          <h1 style={styles.logoText}>Travel Tool</h1>
          <p style={styles.logoSub}>Bali travel ecosystem</p>
        </div>

        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(mode === 'login' ? styles.tabActive : {}) }}
            onClick={() => { setMode('login'); setLocalError(''); }}>
            Sign in
          </button>
          <button
            style={{ ...styles.tab, ...(mode === 'register' ? styles.tabActive : {}) }}
            onClick={() => { setMode('register'); setLocalError(''); }}>
            Register
          </button>
        </div>

        <form onSubmit={handleSubmit} style={styles.form}>
          <label style={styles.label}>Email</label>
          <input
            style={styles.input}
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoComplete="email"
          />

          <label style={styles.label}>Password</label>
          <input
            style={styles.input}
            type="password"
            placeholder={mode === 'register' ? 'Min 8 characters' : 'Your password'}
            value={password}
            onChange={e => setPassword(e.target.value)}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />

          {mode === 'register' && (
            <>
              <label style={styles.label}>I am a</label>
              <div style={styles.roleRow}>
                {(['traveler', 'operator'] as const).map(r => (
                  <button
                    key={r}
                    type="button"
                    style={{ ...styles.roleBtn, ...(role === r ? styles.roleBtnActive : {}) }}
                    onClick={() => setRole(r)}>
                    {r === 'traveler' ? '🧳 Traveler' : '🏪 Operator'}
                  </button>
                ))}
              </div>
            </>
          )}

          {displayError && <p style={styles.error}>{displayError}</p>}

          <button type="submit" style={styles.submit} disabled={isLoading}>
            {isLoading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: '#f0f4f0', padding: 20,
  },
  card: {
    background: '#fff', borderRadius: 20, padding: 40,
    width: '100%', maxWidth: 420,
    boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
  },
  logo: { textAlign: 'center', marginBottom: 32 },
  logoIcon: { fontSize: 48 },
  logoText: { fontSize: 28, fontWeight: 700, color: '#1a1a1a', margin: '8px 0 4px' },
  logoSub: { fontSize: 14, color: '#888' },
  tabs: { display: 'flex', borderRadius: 10, background: '#f5f5f5', padding: 4, marginBottom: 28 },
  tab: {
    flex: 1, padding: '10px 0', border: 'none', borderRadius: 8,
    background: 'transparent', fontSize: 15, color: '#888',
    cursor: 'pointer', fontWeight: 500, transition: 'all 0.15s',
  },
  tabActive: { background: '#fff', color: '#1a1a1a', boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  form: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 13, fontWeight: 500, color: '#555', marginTop: 10 },
  input: {
    padding: '12px 14px', borderRadius: 10, border: '1px solid #e0e0e0',
    fontSize: 15, color: '#1a1a1a', outline: 'none',
    transition: 'border-color 0.15s',
  },
  roleRow: { display: 'flex', gap: 10, marginTop: 4 },
  roleBtn: {
    flex: 1, padding: '12px 0', border: '1px solid #e0e0e0',
    borderRadius: 10, background: '#fafafa', fontSize: 14,
    cursor: 'pointer', fontWeight: 500, color: '#555', transition: 'all 0.15s',
  },
  roleBtnActive: { background: '#2E7D32', borderColor: '#2E7D32', color: '#fff' },
  error: { color: '#c62828', fontSize: 13, marginTop: 4, padding: '8px 12px', background: '#ffebee', borderRadius: 8 },
  submit: {
    marginTop: 20, padding: '14px 0', background: '#2E7D32', color: '#fff',
    border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 600,
    cursor: 'pointer', transition: 'opacity 0.15s',
  },
};
