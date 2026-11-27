import React, { useState } from 'react';
import {
  browserLocalPersistence,
  browserSessionPersistence,
  createUserWithEmailAndPassword,
  getMultiFactorResolver,
  GoogleAuthProvider,
  MultiFactorResolver,
  sendEmailVerification,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  TotpMultiFactorGenerator,
  updateProfile,
} from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AlertTriangle, ArrowLeft, CheckCircle2, ExternalLink, Eye, EyeOff, KeyRound, Lock, Mail, ShieldCheck, UserPlus } from 'lucide-react';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth, db, handleFirestoreError, OperationType } from '../lib/firebase';
import { AppView } from '../types/env';

interface AuthViewsProps {
  mode: 'login' | 'register' | 'forgot-password' | 'admin-login';
  onNavigate: (view: AppView) => void;
  onAuthSuccess: (isAdminPortal: boolean) => void;
}

const COUNTRIES = [
  'India',
  'United States',
  'United Kingdom',
  'Germany',
  'France',
  'Canada',
  'Australia',
  'Japan',
  'Singapore',
  'Brazil',
  'Other',
];

function validatePasswordStrength(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters long.';
  if (!/[A-Z]/.test(pw)) return 'Password must include at least one uppercase letter.';
  if (!/[a-z]/.test(pw)) return 'Password must include at least one lowercase letter.';
  if (!/[0-9]/.test(pw)) return 'Password must include at least one number.';
  return null;
}

export const AuthViews: React.FC<AuthViewsProps> = ({ mode, onNavigate, onAuthSuccess }) => {
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [country, setCountry] = useState('India');
  const [preferredLocation, setPreferredLocation] = useState('Delhi');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [showPassword, setShowPassword] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [operationNotAllowed, setOperationNotAllowed] = useState(false);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [adminAttempts, setAdminAttempts] = useState(0);
  const [adminLockUntil, setAdminLockUntil] = useState<number>(0);

  // Admin MFA sign-in resolver state
  const [mfaResolver, setMfaResolver] = useState<MultiFactorResolver | null>(null);
  const [mfaTotpCode, setMfaTotpCode] = useState('');

  const ensureUserProfileInFirestore = async (
    uid: string,
    userEmail: string,
    name: string,
    userCountry: string,
    prefLoc: string,
    emailVerified: boolean
  ) => {
    if (!emailVerified) return; // Firestore rules enforce verified email on writes
    const ref = doc(db, 'users', uid);
    try {
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const now = new Date().toISOString();
        await setDoc(ref, {
          uid,
          fullName: name || userEmail.split('@')[0],
          email: userEmail,
          country: userCountry,
          preferredLocation: prefLoc,
          role: 'USER',
          status: 'active',
          termsAccepted: true,
          createdAt: now,
          updatedAt: now,
        });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}`);
    }
  };

  const handleGoogleSignIn = async (isAdminPortal: boolean) => {
    setError(null);
    setOperationNotAllowed(false);
    setInfoMessage(null);
    setLoading(true);
    try {
      await setPersistence(auth, rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const provider = new GoogleAuthProvider();
      const cred = await signInWithPopup(auth, provider);
      if (isAdminPortal) {
        const token = await cred.user.getIdToken();
        const check = await fetch('/api/admin/overview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!check.ok) {
          await auth.signOut();
          setError('Access denied: this account does not hold Administrator or Super Administrator privileges.');
          setLoading(false);
          return;
        }
        onAuthSuccess(true);
      } else {
        await ensureUserProfileInFirestore(
          cred.user.uid,
          cred.user.email || '',
          cred.user.displayName || 'EcoIntelligence User',
          country,
          preferredLocation,
          cred.user.emailVerified
        );
        onAuthSuccess(false);
      }
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      if (fbErr?.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, err as Parameters<typeof getMultiFactorResolver>[1]);
        setMfaResolver(resolver);
        setInfoMessage('Second-factor verification required. Enter the 6-digit code from your authenticator app.');
      } else {
        setError(fbErr?.message || 'Google Sign-In failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOperationNotAllowed(false);
    setInfoMessage(null);

    if (!fullName.trim()) return setError('Full name is required.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Please enter a valid email address.');
    const pwErr = validatePasswordStrength(password);
    if (pwErr) return setError(pwErr);
    if (password !== confirmPassword) return setError('Passwords do not match.');
    if (!termsAccepted) return setError('You must accept the Terms of Use and Privacy Notice.');

    setLoading(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      await updateProfile(cred.user, { displayName: fullName.trim() });
      await sendEmailVerification(cred.user);
      setInfoMessage('Account created! A verification email has been sent. Please verify your email before saving private Firestore records.');
      setTimeout(() => onAuthSuccess(false), 1200);
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      if (fbErr?.code === 'auth/email-already-in-use') {
        setError('An account with this email already exists. Please sign in instead.');
      } else if (fbErr?.code === 'auth/operation-not-allowed') {
        setOperationNotAllowed(true);
        setError('Email/Password sign-in is disabled in Firebase Console for this project.');
      } else {
        setError(fbErr?.message || 'Registration failed.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setOperationNotAllowed(false);
    setInfoMessage(null);

    const isAdminPortal = mode === 'admin-login';
    if (isAdminPortal && Date.now() < adminLockUntil) {
      const secs = Math.ceil((adminLockUntil - Date.now()) / 1000);
      setError(`Too many failed admin login attempts. Wait ${secs}s before retrying.`);
      return;
    }

    setLoading(true);
    try {
      await setPersistence(auth, !isAdminPortal && rememberMe ? browserLocalPersistence : browserSessionPersistence);
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      if (isAdminPortal) {
        const token = await cred.user.getIdToken();
        const check = await fetch('/api/admin/overview', {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!check.ok) {
          await auth.signOut();
          const nextAttempts = adminAttempts + 1;
          setAdminAttempts(nextAttempts);
          if (nextAttempts >= 5) {
            setAdminLockUntil(Date.now() + 60_000);
          }
          setError('Unauthorized: account does not have Administrator permissions.');
          setLoading(false);
          return;
        }
        setAdminAttempts(0);
        onAuthSuccess(true);
      } else {
        await ensureUserProfileInFirestore(
          cred.user.uid,
          cred.user.email || '',
          cred.user.displayName || '',
          country,
          preferredLocation,
          cred.user.emailVerified
        );
        onAuthSuccess(false);
      }
    } catch (err: unknown) {
      const fbErr = err as { code?: string; message?: string };
      if (fbErr?.code === 'auth/multi-factor-auth-required') {
        const resolver = getMultiFactorResolver(auth, err as Parameters<typeof getMultiFactorResolver>[1]);
        setMfaResolver(resolver);
        setInfoMessage('Second-factor verification required. Enter your 6-digit TOTP authenticator code.');
      } else if (fbErr?.code === 'auth/operation-not-allowed') {
        setOperationNotAllowed(true);
        setError('Email/Password sign-in is disabled in Firebase Console for this project.');
      } else {
        if (isAdminPortal) {
          const nextAttempts = adminAttempts + 1;
          setAdminAttempts(nextAttempts);
          if (nextAttempts >= 5) setAdminLockUntil(Date.now() + 60_000);
        }
        setError('Invalid credentials or authentication error. Please verify your email and password.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaResolver) return;
    setError(null);
    setLoading(true);
    try {
      const totpHint = mfaResolver.hints.find((h) => h.factorId === TotpMultiFactorGenerator.FACTOR_ID) || mfaResolver.hints[0];
      const assertion = TotpMultiFactorGenerator.assertionForSignIn(totpHint.uid, mfaTotpCode.trim());
      const cred = await mfaResolver.resolveSignIn(assertion);
      const token = await cred.user.getIdToken();
      const check = await fetch('/api/admin/overview', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!check.ok) {
        await auth.signOut();
        setError('Access denied: Administrator privileges required.');
        return;
      }
      setMfaResolver(null);
      onAuthSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid verification code.');
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setError('Enter a valid email address.');
      return;
    }
    setLoading(true);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch {
      // Intentionally swallow user-not-found to prevent account enumeration
    } finally {
      setLoading(false);
      setInfoMessage('If an account exists for that email address, a password-reset link has been dispatched.');
    }
  };

  const isAdminMode = mode === 'admin-login';

  return (
    <div className="min-h-screen bg-[#F6F8F7] flex flex-col justify-center py-10 px-4 sm:px-6">
      <div className="max-w-md w-full mx-auto space-y-5">
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={() => onNavigate('landing')}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-[#14532D] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span>Back to Home</span>
          </button>
          <span className="text-base font-bold text-[#14532D] font-display">EcoIntelligence</span>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 sm:p-8 space-y-6">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {isAdminMode ? (
                <ShieldCheck className="w-5 h-5 text-[#0F766E]" aria-hidden="true" />
              ) : mode === 'register' ? (
                <UserPlus className="w-5 h-5 text-[#14532D]" aria-hidden="true" />
              ) : mode === 'forgot-password' ? (
                <KeyRound className="w-5 h-5 text-[#14532D]" aria-hidden="true" />
              ) : (
                <Lock className="w-5 h-5 text-[#14532D]" aria-hidden="true" />
              )}
              <h1 className="text-xl font-bold text-slate-900">
                {mode === 'register' && 'Create Environmental Monitor Account'}
                {mode === 'login' && 'Sign In to EcoIntelligence'}
                {mode === 'forgot-password' && 'Reset Password'}
                {mode === 'admin-login' && 'Administrator Portal Sign In'}
              </h1>
            </div>
            <p className="text-xs text-slate-600">
              {isAdminMode
                ? 'Restricted administrative console with server-side RBAC and Firebase multifactor authentication.'
                : mode === 'register'
                  ? 'Set your monitoring location preferences and access verified environmental analytics.'
                  : mode === 'forgot-password'
                    ? 'Request a secure password reset link for your registered email.'
                    : 'Access your environmental dashboards, WQI/WMI calculators, and EcoAI assistant.'}
            </p>
          </div>

          {error && (
            <div className="p-3.5 rounded-lg bg-red-50 border border-red-200 space-y-2 text-xs text-red-900" role="alert">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-700" aria-hidden="true" />
                <span>{error}</span>
              </div>
              {operationNotAllowed && (
                <div className="pl-6 space-y-2 text-slate-700">
                  <p>
                    Project <code className="font-mono-tabular bg-white px-1 py-0.5 rounded border border-red-200">{firebaseConfig.projectId}</code> currently has Google Sign-In active. To enable Email &amp; Password:
                  </p>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>Open Firebase Console Authentication &rarr; Sign-in method.</li>
                    <li>Click <strong>Add new provider</strong> &rarr; <strong>Email/Password</strong>, toggle Enable on, and Save.</li>
                  </ol>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <a
                      href={`https://console.firebase.google.com/project/${firebaseConfig.projectId}/authentication/providers`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-white border border-red-300 rounded font-medium text-red-800 hover:bg-red-100"
                    >
                      <span>Open Firebase Sign-in Providers</span>
                      <ExternalLink className="w-3 h-3" aria-hidden="true" />
                    </a>
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => handleGoogleSignIn(isAdminMode)}
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 bg-[#14532D] text-white rounded font-medium hover:bg-[#166534]"
                    >
                      <span>Use Google Sign-In Now</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {infoMessage && (
            <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 flex items-start gap-2.5 text-xs text-emerald-900" role="status">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{infoMessage}</span>
            </div>
          )}

          {mode !== 'forgot-password' && !mfaResolver && (
            <div className="space-y-3">
              <button
                type="button"
                disabled={loading}
                onClick={() => handleGoogleSignIn(isAdminMode)}
                className="w-full py-2.5 px-4 text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded-lg hover:bg-slate-100 transition-colors flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Mail className="w-4 h-4 text-[#14532D]" aria-hidden="true" />
                <span>{isAdminMode ? 'Administrator Sign In with Google (Active)' : 'Continue with Google (Instant Sign-In)'}</span>
              </button>
              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-white px-2 text-slate-500">or use email &amp; password</span>
                </div>
              </div>
            </div>
          )}

          {mfaResolver ? (
            <form onSubmit={handleMfaVerify} className="space-y-4">
              <div>
                <label htmlFor="mfa-code" className="block text-xs font-medium text-slate-700 mb-1">
                  Authenticator 6-Digit Code
                </label>
                <input
                  id="mfa-code"
                  type="text"
                  inputMode="numeric"
                  required
                  value={mfaTotpCode}
                  onChange={(e) => setMfaTotpCode(e.target.value)}
                  placeholder="123456"
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg font-mono-tabular focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
              >
                {loading ? 'Verifying Second Factor...' : 'Verify & Open Admin Portal'}
              </button>
            </form>
          ) : mode === 'forgot-password' ? (
            <form onSubmit={handleForgotPassword} className="space-y-4">
              <div>
                <label htmlFor="reset-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Registered Email Address
                </label>
                <input
                  id="reset-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@organization.org"
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                />
              </div>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
              >
                {loading ? 'Sending Reset Email...' : 'Send Password Reset Link'}
              </button>
              <div className="text-center text-xs text-slate-600">
                <button type="button" onClick={() => onNavigate('login')} className="text-[#14532D] font-medium hover:underline">
                  Return to User Login
                </button>
              </div>
            </form>
          ) : mode === 'register' ? (
            <form onSubmit={handleRegisterSubmit} className="space-y-3.5">
              <div>
                <label htmlFor="reg-name" className="block text-xs font-medium text-slate-700 mb-1">
                  Full Name
                </label>
                <input
                  id="reg-name"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Aarav Sharma"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                />
              </div>
              <div>
                <label htmlFor="reg-email" className="block text-xs font-medium text-slate-700 mb-1">
                  Email Address
                </label>
                <input
                  id="reg-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="aarav@example.com"
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-country" className="block text-xs font-medium text-slate-700 mb-1">
                    Country
                  </label>
                  <select
                    id="reg-country"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  >
                    {COUNTRIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label htmlFor="reg-city" className="block text-xs font-medium text-slate-700 mb-1">
                    Preferred City / Location
                  </label>
                  <input
                    id="reg-city"
                    type="text"
                    required
                    value={preferredLocation}
                    onChange={(e) => setPreferredLocation(e.target.value)}
                    placeholder="Delhi"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="reg-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Password (8+ chars, upper, lower, digit)
                </label>
                <div className="relative">
                  <input
                    id="reg-pw"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label htmlFor="reg-cpw" className="block text-xs font-medium text-slate-700 mb-1">
                  Confirm Password
                </label>
                <input
                  id="reg-cpw"
                  type="password"
                  required
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                />
              </div>
              <label className="flex items-start gap-2.5 text-xs text-slate-600 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={termsAccepted}
                  onChange={(e) => setTermsAccepted(e.target.checked)}
                  className="mt-0.5 rounded border-slate-300 text-[#14532D] focus:ring-[#14532D]"
                />
                <span>I agree to the EcoIntelligence Terms of Service and Environmental Data Privacy Policy.</span>
              </label>
              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 px-4 text-sm font-semibold text-white bg-[#14532D] rounded-lg hover:bg-[#166534] disabled:opacity-50"
              >
                {loading ? 'Creating Account...' : 'Create Account'}
              </button>
            </form>
          ) : (
            <form onSubmit={handleLoginSubmit} className="space-y-4">
              <div>
                <label htmlFor="login-email" className="block text-xs font-medium text-slate-700 mb-1">
                  {isAdminMode ? 'Administrator Email' : 'Email Address'}
                </label>
                <input
                  id="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={isAdminMode ? 'admin@ecointelligence.org' : 'you@example.com'}
                  className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                />
              </div>
              <div>
                <label htmlFor="login-pw" className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <div className="relative">
                  <input
                    id="login-pw"
                    type={showPassword ? 'text' : 'password'}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2.5 pr-10 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#14532D]"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2.5 top-3 text-slate-400 hover:text-slate-700"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {!isAdminMode && (
                <div className="flex items-center justify-between text-xs">
                  <label className="flex items-center gap-2 text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      className="rounded border-slate-300 text-[#14532D]"
                    />
                    <span>Remember me</span>
                  </label>
                  <button
                    type="button"
                    onClick={() => onNavigate('forgot-password')}
                    className="text-[#14532D] font-medium hover:underline"
                  >
                    Forgot Password?
                  </button>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className={`w-full py-2.5 px-4 text-sm font-semibold text-white rounded-lg disabled:opacity-50 ${
                  isAdminMode ? 'bg-[#0F766E] hover:bg-[#0D9488]' : 'bg-[#14532D] hover:bg-[#166534]'
                }`}
              >
                {loading ? 'Signing In...' : isAdminMode ? 'Verify & Enter Admin Portal' : 'Sign In'}
              </button>
            </form>
          )}



          <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            {mode === 'login' && (
              <>
                <button type="button" onClick={() => onNavigate('register')} className="text-[#14532D] font-medium hover:underline">
                  Create New Account
                </button>
                <button type="button" onClick={() => onNavigate('admin-login')} className="text-slate-600 hover:underline">
                  Administrator Login →
                </button>
              </>
            )}
            {mode === 'register' && (
              <>
                <button type="button" onClick={() => onNavigate('login')} className="text-[#14532D] font-medium hover:underline">
                  Already have an account? Sign In
                </button>
                <button type="button" onClick={() => onNavigate('admin-login')} className="text-slate-600 hover:underline">
                  Administrator Login →
                </button>
              </>
            )}
            {mode === 'admin-login' && (
              <>
                <span className="text-slate-500">Admin accounts cannot be self-registered.</span>
                <button type="button" onClick={() => onNavigate('login')} className="text-[#14532D] font-medium hover:underline">
                  Standard User Login
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
