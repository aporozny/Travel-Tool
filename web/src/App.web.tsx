import React, { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { AppDispatch, RootState } from './store';
import { logout, setUser } from './store/authSlice.web';
import LoginScreen from './screens/LoginScreen.web';
import AppShell from './screens/AppShell.web';
import OnboardingScreen from './screens/OnboardingScreen.web';
import api from './services/api.web';
import AdminWaitlist from './screens/AdminWaitlist.web';
import ErrorBoundary from './components/ErrorBoundary.web';

function AdminWrapper() {
  if (window.location.pathname.startsWith('/admin')) {
    return <AdminWaitlist />;
  }
  return <AppInner />;
}

export default function Root() {
  return (
    <ErrorBoundary>
      <AdminWrapper />
    </ErrorBoundary>
  );
}

function AppInner() {
  const dispatch = useDispatch<AppDispatch>();
  const { isAuthenticated, user } = useSelector((s: RootState) => s.auth);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);
  // After a page reload only the login token survives, not who the user is. Until we
  // have asked the server, we must not decide the menu or the onboarding check
  // (a null user used to show every operator and admin the traveller menu).
  const [restoring, setRestoring] = useState(isAuthenticated && !user);
  const [restoreFailed, setRestoreFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isAuthenticated || user) {
      setRestoring(false);
      return;
    }
    let cancelled = false;
    setRestoring(true);
    setRestoreFailed(false);
    api.get('/auth/me')
      .then(r => { if (!cancelled) dispatch(setUser(r.data)); })
      .catch(err => {
        if (cancelled) return;
        if (err?.response?.status === 401 || err?.response?.status === 403) {
          dispatch(logout()); // the token is no longer good: back to the login page
        } else {
          setRestoring(false); // a network or server hiccup must not sign anyone out
          setRestoreFailed(true);
        }
      });
    return () => { cancelled = true; };
  }, [isAuthenticated, user, attempt]);

  useEffect(() => {
    if (restoring) return;
    if (!isAuthenticated || user?.role !== 'traveler') {
      setOnboardingDone(true);
      setChecking(false);
      return;
    }

    setChecking(true);
    api.get('/travelers/me/onboarding-status')
      .then(r => {
        setOnboardingDone(r.data.onboarding_completed === true);
      })
      .catch(() => setOnboardingDone(true))
      .finally(() => setChecking(false));
  }, [isAuthenticated, user, restoring]);

  if (window.location.pathname.startsWith('/admin')) return <AdminWaitlist />;
  if (!isAuthenticated) return <LoginScreen />;
  if (restoreFailed) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 12, color: '#555' }}>
        <p>We couldn't reach Drift just now.</p>
        <button style={{ padding: '10px 20px', borderRadius: 10, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }} onClick={() => setAttempt(a => a + 1)}>Try again</button>
      </div>
    );
  }
  if (restoring || checking) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#999' }}>Loading...</div>;
  if (!onboardingDone) return <OnboardingScreen onComplete={() => setOnboardingDone(true)} />;
  return <AppShell />;
}
