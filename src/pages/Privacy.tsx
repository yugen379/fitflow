import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { LogoMark } from '../components/Logo';

// Replace these placeholders with your real legal entity before public launch.
const COMPANY = 'FitFlow, Inc.';
const COMPANY_ADDRESS = '[REPLACE WITH REGISTERED BUSINESS ADDRESS]';
const PRIVACY_EMAIL = 'fitflow2000@gmail.com';
const DPO_EMAIL = 'fitflow2000@gmail.com';
const LAST_UPDATED = '2026-06-15';

export const Privacy: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="pb-24 pt-4 px-5 min-h-screen max-w-2xl mx-auto">
      <header className="flex items-center gap-3 pt-2 mb-6">
        <button onClick={() => navigate(-1)} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label="Back">
          <ChevronLeft size={18} />
        </button>
        <LogoMark size={28} />
        <h1 className="font-display text-2xl font-bold text-white tracking-tight">Privacy Policy</h1>
      </header>

      <article className="space-y-5 text-white/80 text-sm leading-relaxed">
        <p className="text-text-dim text-xs">Last updated: {LAST_UPDATED}</p>

        <p>
          This Privacy Policy explains how {COMPANY} ("we", "us") collects, uses,
          shares, and protects information when you use the FitFlow mobile app,
          web app, and related services (the "Service").
        </p>

        <Section title="1. Information we collect">
          <SubHead>1.1 Information you provide</SubHead>
          <List items={[
            'Account: name, email, profile photo from Google Sign-In.',
            'Profile: age, height, weight, goal weight, training goal, dietary preferences, health conditions.',
            'Activity: workouts, meals, water, sleep, mood, weight history, GPS routes, posts and comments.',
            'Photos: meal images you upload for AI nutrition analysis; camera frames captured during AI form check.',
            'Billing: if you subscribe to Pro, payment info is handled by Stripe — we never see your card details.',
          ]} />

          <SubHead>1.2 Information collected automatically</SubHead>
          <List items={[
            'Device: model, OS, app version, timezone offset.',
            'Push token (FCM/APNs) when you enable notifications.',
            'Usage telemetry: page views, taps on key actions. We do not use third-party advertising trackers.',
            'Crash logs (Sentry) so we can fix bugs.',
          ]} />

          <SubHead>1.3 Health data from connected services</SubHead>
          <p>
            When you connect Health Connect (Android), Apple Health (iOS), or Google
            Fit, we read step count, calories, heart rate, sleep, exercise sessions,
            distance, and weight only with your explicit per-data-type permission.
            Health data is used solely to personalize your plan and insights.
          </p>
        </Section>

        <Section title="2. How we use information">
          <List items={[
            'Generate personalized AI workouts, nutrition, form coaching, and weekly recaps via Google Gemini.',
            'Show progress over time and adapt plans to your actual behavior.',
            'Send notifications at times you actually train (you can disable in Settings or your OS).',
            'Display aggregated, anonymized statistics for community leaderboards and challenges.',
            'Detect, investigate, and prevent abuse and fraud.',
            'Comply with legal obligations.',
          ]} />
        </Section>

        <Section title="3. Legal bases (EU/UK GDPR)">
          <List items={[
            'Performance of contract — to provide the Service you signed up for.',
            'Consent — for push notifications, health data, and optional analytics. You can withdraw at any time.',
            'Legitimate interest — for product analytics and security monitoring.',
            'Legal obligation — to comply with applicable laws.',
          ]} />
        </Section>

        <Section title="4. Sharing">
          <p>We do <strong>not</strong> sell or rent your personal data. We share data only with these processors:</p>
          <List items={[
            'Google Firebase — authentication, Firestore database, FCM push messaging, Cloud Functions.',
            'Google Gemini API — AI content generation. Per Google\'s terms, prompts are not used to train public models.',
            'Stripe — subscription billing (we never store your card details).',
            'Sentry — error and crash reporting.',
            'PostHog — product analytics (only if enabled).',
            'OpenFoodFacts — barcode lookup (no account data is shared, only the scanned barcode number).',
          ]} />
          <p>
            We may disclose data when required by law, court order, or to protect
            the rights, property, or safety of {COMPANY}, our users, or others.
          </p>
        </Section>

        <Section title="5. International transfers">
          <p>
            Your data is processed in the United States and the European Union.
            For transfers out of the EEA/UK we rely on Standard Contractual Clauses.
          </p>
        </Section>

        <Section title="6. Retention">
          <p>
            We keep your account data for as long as your account is active.
            On deletion we remove your profile and activity within 30 days,
            except where retention is required for legal, accounting, or security
            reasons (e.g. payment records).
          </p>
        </Section>

        <Section title="7. Your rights">
          <p>Depending on where you live (EU/UK GDPR, California CCPA/CPRA, Brazil LGPD, and others) you may have the right to:</p>
          <List items={[
            'Access the personal data we hold about you.',
            'Rectify inaccurate or incomplete data.',
            'Erase your data (Settings → Delete account).',
            'Restrict or object to certain processing.',
            'Receive a portable copy of your data (Settings → Export my data — JSON).',
            'Withdraw consent at any time without affecting prior lawful processing.',
            'Lodge a complaint with your local data protection authority.',
          ]} />
          <p>
            California residents: we have <strong>not</strong> sold or shared
            personal information in the preceding 12 months as those terms are
            defined under the CCPA/CPRA.
          </p>
        </Section>

        <Section title="8. Children">
          <p>
            FitFlow is not intended for users under 13. If you believe a child
            under 13 has provided us with personal data, contact us and we will
            delete it.
          </p>
        </Section>

        <Section title="9. Security">
          <p>
            We use TLS in transit, Firebase server-side encryption at rest,
            scoped Firestore Security Rules, and least-privilege service
            accounts. No system is 100% secure; report any vulnerability to
            <a href={`mailto:${PRIVACY_EMAIL}`} className="text-accent"> {PRIVACY_EMAIL}</a>.
          </p>
        </Section>

        <Section title="10. Changes">
          <p>
            We may update this policy. Material changes will be highlighted in
            the app at least 14 days before they take effect.
          </p>
        </Section>

        <Section title="11. Contact">
          <p>
            {COMPANY}<br/>
            {COMPANY_ADDRESS}<br/>
            Privacy: <a href={`mailto:${PRIVACY_EMAIL}`} className="text-accent">{PRIVACY_EMAIL}</a><br/>
            EU/UK Data Protection: <a href={`mailto:${DPO_EMAIL}`} className="text-accent">{DPO_EMAIL}</a>
          </p>
        </Section>
      </article>
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="space-y-2">
    <h2 className="font-display text-lg font-bold text-white tracking-tight">{title}</h2>
    {children}
  </section>
);

const SubHead: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h3 className="text-white/90 font-medium mt-3">{children}</h3>
);

const List: React.FC<{ items: string[] }> = ({ items }) => (
  <ul className="space-y-1.5 pl-4">
    {items.map((item, i) => (
      <li key={i} className="relative">
        <span className="absolute -left-4 top-2 w-1.5 h-1.5 rounded-full bg-accent" />
        {item}
      </li>
    ))}
  </ul>
);
