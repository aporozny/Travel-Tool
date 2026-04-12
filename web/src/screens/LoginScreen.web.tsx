import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';
import { login, register } from '../store/authSlice.web';
import LandingScreen from './LandingScreen.web';

export default function LoginScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const [mode, setMode] = useState<'landing' | 'login' | 'register'>('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'traveler' | 'operator'>('traveler');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!email || !password) { setError('Please enter your email and password'); return; }
    setLoading(true);
    setError('');
    try {
      if (mode === 'login') {
        await dispatch(login({ email, password })).unwrap();
      } else {
        await dispatch(register({ email, password, role })).unwrap();
      }
    } catch (err: any) {
      setError(err?.message || err || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'landing') {
    return (
      <LandingScreen
        onJoin={() => setMode('register')}
        onLogin={() => setMode('login')}
      />
    );
  }

  return (
    <div style={s.page}>
      <div style={s.card}>
        <button style={s.back} onClick={() => setMode('landing')}>← Back</button>
        <h1 style={s.logo}>Drift</h1>
        <p style={s.tagline}>Travel with better people.</p>

        <div style={s.tabs}>
          <button style={{ ...s.tab, ...(mode === 'login' ? s.tabActive : {}) }} onClick={() => { setMode('login'); setError(''); }}>Sign in</button>
          <button style={{ ...s.tab, ...(mode === 'register' ? s.tabActive : {}) }} onClick={() => { setMode('register'); setError(''); }}>Join free</button>
        </div>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.field}>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder="you@example.com" autoFocus />
        </div>

        <div style={s.field}>
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSubmit()}
            placeholder={mode === 'register' ? 'Min 8 characters' : '••••••••'} />
        </div>

        {mode === 'register' && (
          <div style={s.field}>
            <label style={s.label}>I am a</label>
            <div style={s.roleRow}>
              <button style={{ ...s.roleBtn, ...(role === 'traveler' ? s.roleBtnActive : {}) }}
                onClick={() => setRole('traveler')}>Traveller</button>
              <button style={{ ...s.roleBtn, ...(role === 'operator' ? s.roleBtnActive : {}) }}
                onClick={() => setRole('operator')}>Operator / business</button>
            </div>
          </div>
        )}

        <button style={{ ...s.submit, opacity: loading ? 0.7 : 1 }}
          onClick={handleSubmit} disabled={loading}>
          {loading ? 'Please wait...' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>

        {mode === 'register' && (
          <p style={s.fine}>By joining you agree to our terms and privacy policy.</p>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f8f8f6', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { background: '#fff', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  back: { background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 24 },
  logo: { fontSize: 28, fontWeight: 800, color: '#1a1a1a', letterSpacing: -1, marginBottom: 4 },
  tagline: { fontSize: 14, color: '#888', marginBottom: 28 },
  tabs: { display: 'flex', borderBottom: '2px solid #f0f0f0', marginBottom: 24 },
  tab: { flex: 1, padding: '10px 0', border: 'none', background: 'none', fontSize: 15, color: '#888', cursor: 'pointer', fontWeight: 500 },
  tabActive: { color: '#1a1a1a', borderBottom: '2px solid #1a1a1a', marginBottom: -2 },
  error: { background: '#ffebee', color: '#c62828', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: 500, color: '#555', display: 'block', marginBottom: 6 },
  input: { width: '100%', padding: '12px 14px', border: '1.5px solid #e0e0e0', borderRadius: 10, fontSize: 15, boxSizing: 'border-box', background: '#fafafa' },
  roleRow: { display: 'flex', gap: 8 },
  roleBtn: { flex: 1, padding: '10px 0', border: '1.5px solid #e0e0e0', borderRadius: 10, background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' },
  roleBtnActive: { borderColor: '#1a1a1a', background: '#1a1a1a', color: '#fff', fontWeight: 500 },
  submit: { width: '100%', padding: '14px 0', background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
  fine: { fontSize: 12, color: '#bbb', textAlign: 'center', marginTop: 16 },
};
