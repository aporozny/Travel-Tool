import React from 'react';
import { useSelector } from 'react-redux';
import { RootState } from './store';
import LoginScreen from './screens/LoginScreen.web';
import AppShell from './screens/AppShell.web';

export default function App() {
  const { isAuthenticated } = useSelector((s: RootState) => s.auth);
  return isAuthenticated ? <AppShell /> : <LoginScreen />;
}
