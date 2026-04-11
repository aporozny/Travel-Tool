import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { RootState } from './store';
import LoginScreen from './screens/LoginScreen.web';
import AppShell from './screens/AppShell.web';
import OnboardingScreen from './screens/OnboardingScreen.web';
import api from './services/api.web';

export default function App() {
  const { isAuthenticated, user } = useSelector((s: RootState) => s.auth);
  const [onboardingDone, setOnboardingDone] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!isAuthenticated || user?.role !== 'traveler') {
      setOnboardingDone(true);
      setChecking(false);
      return;
    }

    api.get('/travelers/me/onboarding-status')
      .then(r => {
        setOnboardingDone(r.data.onboarding_completed === true);
      })
      .catch(() => setOnboardingDone(true))
      .finally(() => setChecking(false));
  }, [isAuthenticated, user]);

  if (!isAuthenticated) return <LoginScreen />;
  if (checking) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', color: '#999' }}>Loading...</div>;
  if (!onboardingDone) return <OnboardingScreen onComplete={() => setOnboardingDone(true)} />;
  return <AppShell />;
}
