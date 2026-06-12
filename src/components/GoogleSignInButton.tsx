import React, { useEffect, useRef, useState } from 'react';
import {
  GOOGLE_OAUTH_CLIENT_ID,
  signInWithGoogleCredential,
  signInWithGoogle,
  signInWithGoogleNative,
  isNativeApp,
  friendlyAuthError,
} from '../lib/firebase';

const GoogleGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.6 6.2 29.6 4 24 4 13 4 4 13 4 24s9 20 20 20c11 0 19.5-8 19.5-20 0-1.2-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.1 7.9 3l5.7-5.7C34.6 6.2 29.6 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.5 0 10.5-2.1 14.2-5.5l-6.6-5.4c-2 1.4-4.6 2.3-7.6 2.3-5.3 0-9.7-3.4-11.3-8l-6.5 5c3.3 6.4 9.9 11.6 17.8 11.6z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4-4 5.4l6.6 5.4C41.9 35.7 44 30.2 44 24c0-1.2-.1-2.4-.4-3.5z" />
  </svg>
);

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (resp: { credential: string }) => void;
            ux_mode?: 'popup' | 'redirect';
            auto_select?: boolean;
            cancel_on_tap_outside?: boolean;
          }) => void;
          renderButton: (
            element: HTMLElement,
            config: {
              type?: 'standard' | 'icon';
              theme?: 'outline' | 'filled_blue' | 'filled_black';
              size?: 'large' | 'medium' | 'small';
              text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
              shape?: 'rectangular' | 'pill' | 'circle' | 'square';
              logo_alignment?: 'left' | 'center';
              width?: number;
              locale?: string;
            },
          ) => void;
          prompt: (listener?: (n: any) => void) => void;
        };
      };
    };
  }
}

const waitForGsi = (timeoutMs = 8000): Promise<boolean> =>
  new Promise(resolve => {
    if (window.google?.accounts?.id) return resolve(true);
    const start = Date.now();
    const t = setInterval(() => {
      if (window.google?.accounts?.id) {
        clearInterval(t);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(t);
        resolve(false);
      }
    }, 100);
  });

interface Props {
  onError?: (message: string) => void;
  onSigningChange?: (signing: boolean) => void;
}

// Native (APK) path: Google blocks OAuth inside the WebView, so we use the system
// account picker via @capacitor-firebase/authentication instead of the GIS widget.
const NativeGoogleSignInButton: React.FC<Props> = ({ onError, onSigningChange }) => {
  const [signing, setSigning] = useState(false);

  const handleNative = async () => {
    if (signing) return;
    setSigning(true);
    onSigningChange?.(true);
    try {
      await signInWithGoogleNative();
      // onAuthStateChanged takes over from here.
    } catch (e: any) {
      const code = e?.code as string | undefined;
      // User dismissing the native picker isn't an error worth surfacing loudly.
      const cancelled =
        code === 'auth/native-cancelled' ||
        /cancel/i.test(String(e?.message || '')) ||
        /1001|12501/.test(String(code || ''));
      if (!cancelled) onError?.(friendlyAuthError(code));
      setSigning(false);
      onSigningChange?.(false);
    }
  };

  return (
    <button
      onClick={handleNative}
      disabled={signing}
      className="btn-3d w-full h-14 flex items-center justify-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-60"
    >
      <GoogleGlyph />
      <span>{signing ? 'Connecting…' : 'Continue with Google'}</span>
    </button>
  );
};

const WebGoogleSignInButton: React.FC<Props> = ({ onError, onSigningChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [gsiReady, setGsiReady] = useState<boolean | null>(null);
  const [signing, setSigning] = useState(false);

  // Initialize GIS once
  useEffect(() => {
    let cancelled = false;
    waitForGsi().then(ok => {
      if (cancelled) return;
      setGsiReady(ok);
      if (!ok) return;
      try {
        window.google!.accounts.id.initialize({
          client_id: GOOGLE_OAUTH_CLIENT_ID,
          callback: async (resp) => {
            if (!resp?.credential) return;
            setSigning(true);
            onSigningChange?.(true);
            try {
              await signInWithGoogleCredential(resp.credential);
              // onAuthStateChanged takes over from here.
            } catch (e: any) {
              const msg = friendlyAuthError(e?.code);
              onError?.(msg);
              setSigning(false);
              onSigningChange?.(false);
            }
          },
          ux_mode: 'popup',
          auto_select: false,
          cancel_on_tap_outside: true,
        });
      } catch (e) {
        console.error('GIS initialize failed:', e);
        setGsiReady(false);
      }
    });
    return () => { cancelled = true; };
  }, [onError, onSigningChange]);

  // Render the Google-branded button once initialized
  useEffect(() => {
    if (!gsiReady || !containerRef.current) return;
    containerRef.current.innerHTML = '';
    try {
      window.google!.accounts.id.renderButton(containerRef.current, {
        type: 'standard',
        theme: 'filled_black',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        logo_alignment: 'left',
        width: Math.min(380, window.innerWidth - 48),
      });
    } catch (e) {
      console.error('GIS renderButton failed:', e);
      setGsiReady(false);
    }
  }, [gsiReady]);

  // Fallback path: tap-to-redirect when GIS isn't available (script blocked, offline, etc.)
  const handleFallback = async () => {
    if (signing) return;
    setSigning(true);
    onSigningChange?.(true);
    try {
      await signInWithGoogle();
    } catch (e: any) {
      onError?.(friendlyAuthError(e?.code));
      setSigning(false);
      onSigningChange?.(false);
    }
  };

  if (gsiReady === false) {
    return (
      <button
        onClick={handleFallback}
        disabled={signing}
        className="btn-3d w-full h-14 flex items-center justify-center gap-3 active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        <GoogleGlyph />
        <span>{signing ? 'Connecting…' : 'Continue with Google'}</span>
      </button>
    );
  }

  return (
    <div className="w-full flex flex-col items-center gap-3">
      <div ref={containerRef} className={signing ? 'pointer-events-none opacity-60' : ''} />
      {signing && <p className="text-xs text-text-dim">Connecting…</p>}
      {gsiReady === null && (
        <div className="h-14 w-full glass rounded-full animate-pulse" aria-hidden />
      )}
    </div>
  );
};

// Picks the right Google sign-in flow for the runtime: native account picker inside
// the installed app (WebViews block OAuth), GIS widget on web/PWA.
export const GoogleSignInButton: React.FC<Props> = (props) =>
  isNativeApp() ? <NativeGoogleSignInButton {...props} /> : <WebGoogleSignInButton {...props} />;
