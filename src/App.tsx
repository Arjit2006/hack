import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut, User } from 'firebase/auth';
import { AdminPortal } from './components/AdminPortal';
import { AuthViews } from './components/AuthViews';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LandingPage } from './components/LandingPage';
import { OfflineIndicator } from './components/PWAStatusUI';
import { ToastProvider } from './components/ToastProvider';
import { UserDashboard } from './components/UserDashboard';
import { auth, testFirestoreConnection } from './lib/firebase';
import { AppView } from './types/env';

export default function App() {
  const [view, setView] = useState<AppView>('landing');
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    void testFirestoreConnection();

    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      setUser(fbUser);
      if (fbUser) {
        try {
          const token = await fbUser.getIdToken();
          const res = await fetch('/api/admin/overview', {
            headers: { Authorization: `Bearer ${token}` },
          });
          setIsAdmin(res.ok);
        } catch {
          setIsAdmin(false);
        }
      } else {
        setIsAdmin(false);
      }
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  const handleSignOut = async () => {
    await signOut(auth);
    setIsAdmin(false);
    setView('landing');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#F6F8F7] flex items-center justify-center">
        <div className="text-sm font-medium text-slate-600">Initializing EcoIntelligence...</div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <ToastProvider>
        <div className="min-h-screen overflow-x-hidden">
          {view === 'landing' && (
            <LandingPage
              onNavigate={setView}
              isAuthenticated={Boolean(user)}
              isAdmin={isAdmin}
            />
          )}

          {(view === 'login' || view === 'register' || view === 'forgot-password' || view === 'admin-login') && (
            <AuthViews
              mode={view}
              onNavigate={setView}
              onAuthSuccess={(adminPortal) => {
                if (adminPortal) {
                  setIsAdmin(true);
                  setView('admin');
                } else {
                  setView('dashboard');
                }
              }}
            />
          )}

          {view === 'dashboard' && (
            user ? (
              <UserDashboard
                isAdmin={isAdmin}
                onNavigate={setView}
                onSignOut={() => void handleSignOut()}
              />
            ) : (
              <AuthViews
                mode="login"
                onNavigate={setView}
                onAuthSuccess={() => setView('dashboard')}
              />
            )
          )}

          {view === 'admin' && (
            user && isAdmin ? (
              <AdminPortal
                onNavigate={setView}
                onSignOut={() => void handleSignOut()}
              />
            ) : (
              <AuthViews
                mode="admin-login"
                onNavigate={setView}
                onAuthSuccess={(ok) => {
                  if (ok) {
                    setIsAdmin(true);
                    setView('admin');
                  }
                }}
              />
            )
          )}
          {view !== 'dashboard' && <OfflineIndicator />}
        </div>
      </ToastProvider>
    </ErrorBoundary>
  );
}
