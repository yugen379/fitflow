import React, { useState } from 'react';
import {
  signInWithFacebook,
  signInWithFacebookNative,
  signInWithApple,
  signInWithAppleNative,
  isNativeApp,
} from '../lib/firebase';
import { friendlyAuthError, isCancellation } from '../lib/authErrors';
import { isProviderAvailable } from '../lib/authProviders';

interface Props {
  onError?: (message: string) => void;
  onSigningChange?: (signing: boolean) => void;
  disabled?: boolean;
}

const FacebookGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.1 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.79-4.69 4.53-4.69 1.31 0 2.69.24 2.69.24v2.96H15.83c-1.49 0-1.96.93-1.96 1.89v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.1 24 18.1 24 12.07z"
    />
  </svg>
);

const AppleGlyph = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="currentColor"
      d="M17.05 12.53c-.03-2.6 2.12-3.85 2.22-3.91-1.21-1.77-3.09-2.01-3.76-2.04-1.6-.16-3.12.94-3.93.94-.81 0-2.06-.92-3.39-.9-1.74.03-3.35 1.01-4.25 2.57-1.81 3.14-.46 7.79 1.3 10.34.86 1.25 1.89 2.65 3.24 2.6 1.3-.05 1.79-.84 3.36-.84 1.57 0 2.01.84 3.38.81 1.4-.02 2.28-1.27 3.13-2.53.99-1.45 1.4-2.86 1.42-2.93-.03-.01-2.72-1.04-2.75-4.13M14.5 4.62c.71-.87 1.2-2.07 1.07-3.27-1.03.04-2.28.69-3.02 1.55-.66.77-1.24 2-1.08 3.18 1.15.09 2.32-.59 3.03-1.46"
    />
  </svg>
);

/**
 * One button, two runtimes.
 *
 * The web path goes through the Firebase JS SDK (popup on desktop, full-page
 * redirect on mobile/PWA). The installed app cannot: both Facebook and Apple
 * refuse OAuth inside an embedded WebView, so the shell hands off to the native
 * SDK and exchanges the returned credential for a JS-SDK session — the same
 * arrangement Google already uses, so `auth` stays the one source of truth for
 * onAuthStateChanged.
 */
const ProviderButton: React.FC<
  Props & {
    providerId: string;
    label: string;
    glyph: React.ReactNode;
    className: string;
    webSignIn: () => Promise<unknown>;
    nativeSignIn: () => Promise<unknown>;
  }
> = ({ providerId, label, glyph, className, webSignIn, nativeSignIn, onError, onSigningChange, disabled }) => {
  const [signing, setSigning] = useState(false);
  const native = isNativeApp();

  const handleClick = async () => {
    if (signing || disabled) return;
    setSigning(true);
    onSigningChange?.(true);
    try {
      await (native ? nativeSignIn() : webSignIn());
      // On success onAuthStateChanged swaps the screen, or the redirect has
      // already navigated away — either way this component is gone, so the
      // busy state is deliberately NOT cleared here.
    } catch (e: any) {
      // Backing out of the provider sheet is a decision, not a failure. Toasting
      // it teaches users to ignore this app's error messages.
      if (!isCancellation(e?.code) && !isCancellation(e?.message)) {
        onError?.(friendlyAuthError(e?.code));
      }
      setSigning(false);
      onSigningChange?.(false);
    }
  };

  // Render nothing rather than a button that cannot finish. See lib/authProviders.
  if (!isProviderAvailable(providerId, native)) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={signing || disabled}
      className={`w-full h-12 rounded-full flex items-center justify-center gap-2.5 text-sm font-semibold active:scale-[0.98] transition-transform disabled:opacity-60 ${className}`}
    >
      {glyph}
      <span>{signing ? 'Connecting…' : label}</span>
    </button>
  );
};

export const FacebookSignInButton: React.FC<Props> = (props) => (
  <ProviderButton
    {...props}
    providerId="facebook.com"
    label="Continue with Facebook"
    glyph={<FacebookGlyph />}
    /*
     * Facebook's brand blue, which their platform terms require for a
     * Facebook-branded login button — so this fill does NOT follow the theme,
     * and neither may its label.
     *
     * `text-white` would be wrong here despite looking right: index.css carries
     * a blanket light-mode rescue (`[data-theme="light"] :where(.text-white)`)
     * that repoints every .text-white to the dark ink token, on the reasonable
     * assumption that white text only ever sits on a dark app surface. On this
     * permanently-blue button that produced navy-on-blue — the label and the
     * glyph both, since the mark is drawn in currentColor. The literal is
     * outside that rescue's reach.
     */
    className="bg-[#1877F2] text-[#FFFFFF]"
    webSignIn={signInWithFacebook}
    nativeSignIn={signInWithFacebookNative}
  />
);

export const AppleSignInButton: React.FC<Props> = (props) => (
  <ProviderButton
    {...props}
    providerId="apple.com"
    label="Continue with Apple"
    glyph={<AppleGlyph />}
    // White-on-black or black-on-white are the only two Apple permits. The
    // white variant works in both themes, and — unlike `bg-white/…` — plain
    // `bg-white` is not caught by index.css's light-mode surface rescue, so it
    // stays white on a light page too.
    className="bg-white text-black"
    webSignIn={signInWithApple}
    nativeSignIn={signInWithAppleNative}
  />
);
