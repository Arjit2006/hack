import React, { useState } from 'react';
import { CloudOff, Download, RefreshCw } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWA';

export const PWAInstallButton: React.FC<{ compact?: boolean }> = ({ compact = false }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) return null;

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={() => void install()}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 text-[#14532D] font-semibold hover:bg-emerald-100 transition-colors whitespace-nowrap ${
          compact ? 'px-2.5 py-1.5 text-xs' : 'px-3.5 py-2 text-xs'
        }`}
      >
        <Download className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        <span>Install Offline App</span>
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
        >
          <Download className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Install App</span>
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white border border-slate-200 p-6 space-y-3">
              <h3 className="text-base font-bold text-slate-900">Install EcoIntelligence on iOS</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                1. Tap the <strong>Share</strong> icon in Safari.<br />
                2. Scroll down and select <strong>Add to Home Screen</strong> so cached Firebase &amp; environmental views stay available offline.
              </p>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full py-2 text-xs font-semibold bg-[#14532D] text-white rounded-lg hover:bg-[#166534]"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};

export const OfflineIndicator: React.FC<{ pendingSyncCount?: number }> = ({ pendingSyncCount = 0 }) => {
  const isOnline = useOnlineStatus();

  if (isOnline && pendingSyncCount === 0) return null;

  return (
    <div
      role="status"
      className={`fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] md:bottom-4 left-3 right-3 sm:right-auto sm:left-4 z-40 flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium shadow-md max-w-md ${
        !isOnline
          ? 'bg-amber-900 text-amber-50 border-amber-700'
          : 'bg-[#14532D] text-emerald-50 border-emerald-700'
      }`}
    >
      {!isOnline ? (
        <>
          <CloudOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>
            Offline Mode — Cached Firebase &amp; environmental data active
            {pendingSyncCount > 0 ? ` (${pendingSyncCount} queued to sync)` : ''}
          </span>
        </>
      ) : (
        <>
          <RefreshCw className="w-3.5 h-3.5 shrink-0 animate-spin" aria-hidden="true" />
          <span>Back online — Syncing {pendingSyncCount} queued update(s) to Firebase...</span>
        </>
      )}
    </div>
  );
};
