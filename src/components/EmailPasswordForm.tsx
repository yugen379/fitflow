import React, { useCallback, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Mail, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { signInWithEmail, signUpWithEmail, sendPasswordReset } from '../lib/firebase';
import {
  friendlyAuthError,
  validateEmail,
  validatePassword,
  passwordStrength,
  PASSWORD_MIN_LENGTH,
  type PasswordStrength,
} from '../lib/authErrors';

export type EmailAuthMode = 'signin' | 'signup' | 'reset';

interface Props {
  /** Raised for anything the user must act on. The login screen toasts it. */
  onError?: (message: string) => void;
  /** True whenever a network call is in flight, so siblings can disable. */
  onBusyChange?: (busy: boolean) => void;
  initialMode?: EmailAuthMode;
}

/** Shared field chrome. `modal-input` is referenced elsewhere but never defined
 *  in index.css, so this states its own styling rather than inheriting a class
 *  that resolves to nothing. */
const FIELD_CLASS =
  'w-full h-12 rounded-2xl bg-white/[0.04] border border-white/10 px-4 text-[15px] text-text ' +
  'placeholder:text-text-mute outline-none transition-colors ' +
  'focus:border-accent/60 focus:bg-white/[0.06] disabled:opacity-60';

const STRENGTH_META: Record<PasswordStrength, { label: string; bars: number; className: string }> = {
  weak: { label: 'Weak', bars: 1, className: 'bg-accent-2' },
  fair: { label: 'Fair', bars: 2, className: 'bg-accent-4' },
  strong: { label: 'Strong', bars: 3, className: 'bg-accent' },
};

const Field: React.FC<{
  label: string;
  htmlFor: string;
  error?: string | null;
  children: React.ReactNode;
}> = ({ label, htmlFor, error, children }) => (
  <div>
    <label htmlFor={htmlFor} className="block text-[11px] font-bold uppercase tracking-[0.16em] text-text-mute mb-2">
      {label}
    </label>
    {children}
    {error && (
      <p id={`${htmlFor}-error`} role="alert" className="mt-1.5 text-xs text-accent-2">
        {error}
      </p>
    )}
  </div>
);

/**
 * Manual email + password sign-in, account creation and password reset.
 *
 * Three modes in one component rather than three screens: every real failure
 * here moves the user BETWEEN them ("no account" → create one, "wrong
 * password" → reset it), and a router hop at that moment loses whatever they
 * had already typed. The email survives every transition for exactly that
 * reason.
 *
 * Validation runs client-side before the network call, but never as the only
 * check — Firebase's answer always wins, and its codes are mapped in
 * lib/authErrors. Client validation exists to save a round trip and to point at
 * the field that is wrong, which a top-level toast cannot do.
 */
export const EmailPasswordForm: React.FC<Props> = ({ onError, onBusyChange, initialMode = 'signin' }) => {
  const [mode, setMode] = useState<EmailAuthMode>(initialMode);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  /** Field-level errors. Only ever set after a submit or a blur — never while typing. */
  const [errors, setErrors] = useState<{ email?: string; password?: string; name?: string }>({});
  const emailRef = useRef<HTMLInputElement>(null);

  const isSignup = mode === 'signup';
  const isReset = mode === 'reset';
  const strength = useMemo(() => passwordStrength(password), [password]);

  const setBusyBoth = useCallback(
    (v: boolean) => {
      setBusy(v);
      onBusyChange?.(v);
    },
    [onBusyChange],
  );

  const switchMode = (next: EmailAuthMode) => {
    setMode(next);
    setErrors({});
    setResetSent(false);
    // Password never carries across a mode change: a value typed as a new
    // password should not be silently submitted as an existing one.
    setPassword('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;

    const emailCheck = validateEmail(email);
    const nextErrors: typeof errors = {};
    if (!emailCheck.ok) nextErrors.email = emailCheck.message;

    if (!isReset) {
      const passwordCheck = isSignup
        ? validatePassword(password)
        : // Signing IN must not apply the new-password policy. An account made
          // before the rule (or by an admin) can hold a 6-character password,
          // and refusing to even TRY it locks a real user out of their own data.
          password
          ? { ok: true as const }
          : { ok: false as const, message: 'Enter your password.' };
      if (!passwordCheck.ok) nextErrors.password = passwordCheck.message;
    }

    if (isSignup && !name.trim()) nextErrors.name = 'What should the coach call you?';

    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setBusyBoth(true);
    try {
      if (isReset) {
        await sendPasswordReset(email);
        setResetSent(true);
      } else if (isSignup) {
        await signUpWithEmail(email, password, name);
        // onAuthStateChanged takes over from here.
      } else {
        await signInWithEmail(email, password);
      }
    } catch (err: any) {
      const code = err?.code as string | undefined;
      const message = friendlyAuthError(code);
      // Attach the failure to the field it belongs to where that is knowable —
      // a toast alone leaves the user re-reading both boxes.
      if (code === 'auth/email-already-in-use' || code === 'auth/invalid-email' || code === 'auth/user-not-found') {
        setErrors({ email: message });
        emailRef.current?.focus();
      } else if (
        code === 'auth/wrong-password' ||
        code === 'auth/weak-password' ||
        code === 'auth/missing-password'
      ) {
        setErrors({ password: message });
      } else {
        onError?.(message);
      }
    } finally {
      // Only in the failure case does this component still exist to be
      // re-enabled; on success the app has already swapped the whole screen.
      setBusyBoth(false);
    }
  };

  if (isReset && resetSent) {
    return (
      <div className="w-full text-center py-2">
        <CheckCircle2 className="w-8 h-8 text-accent mx-auto" aria-hidden />
        <p className="mt-3 text-sm text-text font-semibold">Check your inbox</p>
        {/*
          Deliberately says "if". Confirming that an address HAS an account is
          an enumeration oracle — anyone could test a list of emails against
          FitFlow. lib/firebase.sendPasswordReset swallows user-not-found for
          the same reason.
        */}
        <p className="mt-1.5 text-xs text-text-dim leading-relaxed max-w-[280px] mx-auto">
          If {email} has a FitFlow account, a reset link is on its way. It expires in an hour.
        </p>
        <button
          type="button"
          onClick={() => switchMode('signin')}
          className="mt-5 inline-flex items-center gap-1.5 text-xs font-semibold text-accent active:opacity-70"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden />
          Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full space-y-3.5" noValidate>
      {isSignup && (
        <Field label="Name" htmlFor="ff-name" error={errors.name}>
          <input
            id="ff-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Alex"
            autoComplete="name"
            autoCapitalize="words"
            disabled={busy}
            aria-invalid={!!errors.name}
            aria-describedby={errors.name ? 'ff-name-error' : undefined}
            className={FIELD_CLASS}
          />
        </Field>
      )}

      <Field label="Email" htmlFor="ff-email" error={errors.email}>
        <input
          id="ff-email"
          ref={emailRef}
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@email.com"
          autoComplete="email"
          inputMode="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          disabled={busy}
          aria-invalid={!!errors.email}
          aria-describedby={errors.email ? 'ff-email-error' : undefined}
          className={FIELD_CLASS}
        />
      </Field>

      {!isReset && (
        <Field label="Password" htmlFor="ff-password" error={errors.password}>
          <div className="relative">
            <input
              id="ff-password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isSignup ? `At least ${PASSWORD_MIN_LENGTH} characters` : '••••••••'}
              // The right token matters: with `current-password` on a sign-up
              // form a password manager offers the OLD password instead of
              // generating a new one.
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              disabled={busy}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'ff-password-error' : undefined}
              className={`${FIELD_CLASS} pr-12`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              // Typos are the main cause of failed sign-ins on a phone
              // keyboard, and this is the only way to catch one before
              // spending a round trip on it.
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-pressed={showPassword}
              className="absolute right-1 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-text-mute active:text-text"
            >
              {showPassword ? <EyeOff className="w-4 h-4" aria-hidden /> : <Eye className="w-4 h-4" aria-hidden />}
            </button>
          </div>

          {isSignup && password.length > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 flex gap-1" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-colors ${
                      i < STRENGTH_META[strength].bars ? STRENGTH_META[strength].className : 'bg-white/10'
                    }`}
                  />
                ))}
              </div>
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-mute">
                {STRENGTH_META[strength].label}
              </span>
            </div>
          )}
        </Field>
      )}

      <button
        type="submit"
        disabled={busy}
        className="btn-3d w-full h-14 flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60"
      >
        {busy && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />}
        <span>
          {busy
            ? isReset
              ? 'Sending…'
              : isSignup
                ? 'Creating account…'
                : 'Signing in…'
            : isReset
              ? 'Send reset link'
              : isSignup
                ? 'Create account'
                : 'Sign in'}
        </span>
      </button>

      <div className="flex items-center justify-between pt-0.5">
        <button
          type="button"
          onClick={() => switchMode(isSignup ? 'signin' : 'signup')}
          disabled={busy}
          className="text-xs text-text-dim active:opacity-70 disabled:opacity-40"
        >
          {isSignup ? (
            <>
              Have an account? <span className="text-accent font-semibold">Sign in</span>
            </>
          ) : (
            <>
              New here? <span className="text-accent font-semibold">Create account</span>
            </>
          )}
        </button>

        {!isSignup && (
          <button
            type="button"
            onClick={() => switchMode(isReset ? 'signin' : 'reset')}
            disabled={busy}
            className="text-xs text-text-mute underline underline-offset-4 active:opacity-70 disabled:opacity-40"
          >
            {isReset ? 'Back to sign in' : 'Forgot password?'}
          </button>
        )}
      </div>

      {isReset && (
        <p className="flex items-start gap-2 text-[11px] text-text-mute leading-relaxed">
          <Mail className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden />
          We will email you a link to set a new password.
        </p>
      )}
    </form>
  );
};
