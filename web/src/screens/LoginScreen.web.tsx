import React, { useState, useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { AppDispatch } from '../store';
import { login, register } from '../store/authSlice.web';
import LandingScreen from './LandingScreen.web';
import api from '../services/api.web';

export default function LoginScreen() {
  const dispatch = useDispatch<AppDispatch>();
  const [mode, setMode] = useState<'landing' | 'login' | 'waitlist' | 'register'>('landing');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [role, setRole] = useState<'traveler' | 'operator'>('traveler');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [waitlistSuccess, setWaitlistSuccess] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');

  // Check for invite token in URL
  useEffect(() => {
    const path = window.location.pathname;
    const match = path.match(/\/invite\/([a-zA-Z0-9-]+)/);
    if (match) {
      const token = match[1];
      // Validate the token
      api.get(`/waitlist/invite/${token}`)
        .then(r => {
          if (r.data.valid) {
            setInviteToken(token);
            setInviteEmail(r.data.email || '');
            setEmail(r.data.email || '');
            setName(r.data.name || '');
            setMode('register');
          } else {
            setError(r.data.message || 'Invalid invite link.');
            setMode('login');
          }
        })
        .catch(() => {
          setError('This invite link is invalid or has expired.');
          setMode('login');
        });
    }
  }, []);

  const handleLogin = async () => {
    if (!email || !password) { setError('Please enter your email and password'); return; }
    setLoading(true);
    setError('');
    try {
      await dispatch(login({ email, password })).unwrap();
    } catch (err: any) {
      setError(err?.message || err || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async () => {
    if (!email || !password) { setError('Please enter your email and password'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters'); return; }
    setLoading(true);
    setError('');
    try {
      await dispatch(register({ email, password, role })).unwrap();
      // Mark invite as used
      if (inviteToken) {
        await api.post('/waitlist/use-invite', { token: inviteToken }).catch(() => {});
      }
    } catch (err: any) {
      setError(err?.message || err || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleWaitlist = async () => {
    if (!email) { setError('Please enter your email address'); return; }
    setLoading(true);
    setError('');
    try {
      await api.post('/waitlist', { email, name: name || undefined, destination: destination || undefined, source: 'direct' });
      setWaitlistSuccess(true);
    } catch (err: any) {
      setError(err?.response?.data?.message || 'Something went wrong. Please try again.');
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

  // Waitlist form
  if (mode === 'waitlist') {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <button style={s.back} onClick={() => setMode('landing')}>← Back</button>
          <h1 style={s.logo}>◈ Drift</h1>
          <p style={s.tagline}>Join the waitlist</p>

          {waitlistSuccess ? (
            <div style={s.success}>
              <p style={s.successTitle}>You're on the list.</p>
              <p style={s.successSub}>We'll send you an invite when a spot opens up. We're opening slowly so we can keep quality high.</p>
              <button style={s.back} onClick={() => setMode('landing')}>← Back to home</button>
            </div>
          ) : (
            <>
              <p style={s.waitlistDesc}>
                Drift is currently invite-only. Leave your details and we'll be in touch when a spot opens up.
              </p>

              {error && <div style={s.error}>{error}</div>}

              <div style={s.field}>
                <label style={s.label}>Your name</label>
                <input style={s.input} type="text" value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="First name" autoFocus />
              </div>

              <div style={s.field}>
                <label style={s.label}>Email address</label>
                <input style={s.input} type="email" value={email}
                  onChange={e => setEmail(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleWaitlist()}
                  placeholder="you@example.com" />
              </div>

              <div style={s.field}>
                <label style={s.label}>Where do you want to travel?</label>
                <input style={s.input} type="text" value={destination}
                  onChange={e => setDestination(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleWaitlist()}
                  placeholder="Bali, Albania, anywhere..." />
              </div>

              <button style={{ ...s.submit, opacity: loading ? 0.7 : 1 }}
                onClick={handleWaitlist} disabled={loading}>
                {loading ? 'Joining...' : 'Join the waitlist'}
              </button>

              <p style={s.fine}>Already have an invite?{' '}
                <button style={s.link} onClick={() => setMode('register')}>Create your account</button>
              </p>
              <p style={s.fine}>Already a member?{' '}
                <button style={s.link} onClick={() => setMode('login')}>Sign in</button>
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  // Register form (invite only)
  if (mode === 'register') {
    return (
      <div style={s.page}>
        <div style={s.card}>
          <button style={s.back} onClick={() => setMode('landing')}>← Back</button>
          <h1 style={s.logo}>◈ Drift</h1>
          <p style={s.tagline}>Create your account</p>

          {inviteToken && (
            <div style={s.inviteBanner}>
              ✓ Invite accepted — welcome to Drift
            </div>
          )}

          {/* Open signup — invite banner above still greets invited users;
              no blocking message for everyone else. */}

          {error && <div style={s.error}>{error}</div>}

          <div style={s.field}>
            <label style={s.label}>Email</label>
            <input style={s.input} type="email" value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="you@example.com"
              disabled={!!inviteEmail} />
          </div>

          <div style={s.field}>
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" value={password}
              onChange={e => setPassword(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRegister()}
              placeholder="Min 8 characters" />
          </div>

          <div style={s.field}>
            <label style={s.label}>I am a</label>
            <div style={s.roleRow}>
              <button style={{ ...s.roleBtn, ...(role === 'traveler' ? s.roleBtnActive : {}) }}
                onClick={() => setRole('traveler')}>Traveller</button>
              <button style={{ ...s.roleBtn, ...(role === 'operator' ? s.roleBtnActive : {}) }}
                onClick={() => setRole('operator')}>Operator</button>
            </div>
          </div>

          <button style={{ ...s.submit, opacity: loading ? 0.7 : 1 }}
            onClick={handleRegister} disabled={loading}>
            {loading ? 'Creating account...' : 'Create account'}
          </button>

          <p style={s.fine}>Already a member?{' '}
            <button style={s.link} onClick={() => setMode('login')}>Sign in</button>
          </p>
        </div>
      </div>
    );
  }

  // Login form
  return (
    <div style={s.page}>
      <div style={s.card}>
        <button style={s.back} onClick={() => setMode('landing')}>← Back</button>
        <h1 style={s.logo}>◈ Drift</h1>
        <p style={s.tagline}>Travel with better people.</p>

        {error && <div style={s.error}>{error}</div>}

        <div style={s.field}>
          <label style={s.label}>Email</label>
          <input style={s.input} type="email" value={email}
            onChange={e => setEmail(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="you@example.com" autoFocus />
        </div>

        <div style={s.field}>
          <label style={s.label}>Password</label>
          <input style={s.input} type="password" value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLogin()}
            placeholder="••••••••" />
        </div>

        <button style={{ ...s.submit, opacity: loading ? 0.7 : 1 }}
          onClick={handleLogin} disabled={loading}>
          {loading ? 'Signing in...' : 'Sign in'}
        </button>

        <p style={s.fine}>
          Don't have an account?{' '}
          <button style={s.link} onClick={() => setMode('waitlist')}>Join the waitlist</button>
        </p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f8f7f4', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { background: '#fff', borderRadius: 20, padding: '40px 36px', width: '100%', maxWidth: 420, boxShadow: '0 4px 24px rgba(0,0,0,0.06)' },
  back: { background: 'none', border: 'none', color: '#888', fontSize: 13, cursor: 'pointer', padding: 0, marginBottom: 24 },
  logo: { fontSize: 28, fontWeight: 800, color: '#C9A84C', letterSpacing: -1, marginBottom: 4 },
  tagline: { fontSize: 14, color: '#888', marginBottom: 28 },
  waitlistDesc: { fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 24 },
  error: { background: '#ffebee', color: '#c62828', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  inviteBanner: { background: '#ECFDF5', color: '#10B981', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600 },
  warningBanner: { background: '#FBF5E6', color: '#A8893A', padding: '10px 14px', borderRadius: 8, marginBottom: 16, fontSize: 13 },
  success: { textAlign: 'center' as const, padding: '20px 0' },
  successTitle: { fontSize: 22, fontWeight: 700, color: '#1A1A1A', marginBottom: 12 },
  successSub: { fontSize: 14, color: '#666', lineHeight: 1.6, marginBottom: 24 },
  field: { marginBottom: 16 },
  label: { fontSize: 13, fontWeight: 500, color: '#555', display: 'block', marginBottom: 6 },
  input: { width: '100%', padding: '12px 14px', border: '1.5px solid #E8E4DE', borderRadius: 10, fontSize: 15, boxSizing: 'border-box' as const, background: '#f8f7f4', outline: 'none' },
  roleRow: { display: 'flex', gap: 8 },
  roleBtn: { flex: 1, padding: '10px 0', border: '1.5px solid #E8E4DE', borderRadius: 10, background: '#fff', fontSize: 13, cursor: 'pointer', color: '#555' },
  roleBtnActive: { borderColor: '#C9A84C', background: '#C9A84C', color: '#fff', fontWeight: 500 },
  submit: { width: '100%', padding: '14px 0', background: '#C9A84C', color: '#fff', border: 'none', borderRadius: 10, fontSize: 16, fontWeight: 600, cursor: 'pointer', marginTop: 8 },
  fine: { fontSize: 12, color: '#bbb', textAlign: 'center' as const, marginTop: 16 },
  link: { background: 'none', border: 'none', color: '#C9A84C', cursor: 'pointer', fontSize: 12, padding: 0, fontWeight: 600 },
};
