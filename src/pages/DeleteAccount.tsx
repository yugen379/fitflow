import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { LogoMark } from '../components/Logo';
import { t } from '../i18n/i18n';

const SUPPORT_EMAIL = 'fitflow2000@gmail.com';
const LAST_UPDATED = '2026-06-26';
/** Subject line the mailto link pre-fills; shown verbatim so the two always match. */
const DELETE_SUBJECT = 'Delete my FitFlow account';

/**
 * Put elements into a translated sentence at its {placeholders}, so the whole
 * sentence is one translation and each language can order it its own way.
 */
const splice = (text: string, parts: Record<string, React.ReactNode>) =>
  text.split(/(\{\w+\})/).map((piece, i) => {
    const key = /^\{(\w+)\}$/.exec(piece)?.[1];
    return <React.Fragment key={i}>{key && key in parts ? parts[key] : piece}</React.Fragment>;
  });

export const DeleteAccount: React.FC = () => {
  const navigate = useNavigate();
  return (
    <div className="pb-24 pt-4 px-5 min-h-screen max-w-2xl mx-auto">
      <header className="flex items-center gap-3 pt-2 mb-6">
        <button onClick={() => navigate(-1)} className="w-10 h-10 glass rounded-xl flex items-center justify-center text-text-dim hover:text-white" aria-label={t('Back')}>
          <ChevronLeft size={18} />
        </button>
        <LogoMark size={28} />
        <h1 className="font-display text-2xl font-bold text-white tracking-tight">{t('Delete your account')}</h1>
      </header>

      <article className="space-y-5 text-white/80 text-sm leading-relaxed">
        <p className="text-text-dim text-xs">{t('Last updated: {date}', { date: LAST_UPDATED })}</p>

        <p>
          {splice(t("This page explains how to delete your {app} account (developer: YUGENTIRAN) and what happens to your data. You can delete your account directly in the app, or request deletion by email if you can't access the app."), {
            app: <strong>FitFlow</strong>,
          })}
        </p>

        <Section title={t('Option 1 — Delete in the app (instant)')}>
          <List items={[
            t('Open FitFlow and sign in.'),
            t('Go to Profile → Settings.'),
            t('Tap "Delete account" (under the danger section).'),
            t('Confirm. Your account and associated data are permanently removed.'),
          ]} />
        </Section>

        <Section title={t('Option 2 — Request deletion by email')}>
          <p>
            {splice(t(`If you can't sign in, email {email} from the address on your account with the subject "{subject}". We verify ownership and delete your account within 30 days.`), {
              email: <a href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(DELETE_SUBJECT)}`} className="text-accent">{SUPPORT_EMAIL}</a>,
              subject: DELETE_SUBJECT,
            })}
          </p>
        </Section>

        <Section title={t('What gets deleted')}>
          <List items={[
            t('Your profile (name, email, photo, age, height, weight, goals, preferences).'),
            t('Your activity: workouts, meals, water, sleep, mood, weight history, GPS routes.'),
            t('Your community content: posts, comments, and likes.'),
            t('Device identifiers and push tokens linked to your account.'),
          ]} />
        </Section>

        <Section title={t('What may be retained, and for how long')}>
          <p>
            {t('We may retain a limited set of records where required for legal, security, fraud-prevention, or accounting reasons (for example, transaction/billing records). Any such data is kept only as long as the law requires and is not used to re-identify you. Backups containing your data are purged within 30 days of deletion.')}
          </p>
        </Section>

        <Section title={t('Subscriptions')}>
          <p>
            {splice(t('Deleting your account does not automatically cancel a Google Play subscription. Manage or cancel it in the Google Play Store → Subscriptions. See also our {privacy}.'), {
              privacy: <a href="/privacy" className="text-accent">{t('Privacy Policy')}</a>,
            })}
          </p>
        </Section>

        <Section title={t('Contact')}>
          <p>
            {splice(t('Questions about deletion: {email}'), {
              email: <a href={`mailto:${SUPPORT_EMAIL}`} className="text-accent">{SUPPORT_EMAIL}</a>,
            })}
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
