// The publisher's legal identity — the single source of truth for it.
//
// Privacy.tsx and Terms.tsx each carried their own copy, both asserting
// "FitFlow, Inc." with a bracketed placeholder address. Two problems, and the
// duplication was the smaller one:
//
//   • Naming a corporation that does not exist misstates who the data
//     controller is. Under UK/EU GDPR Art. 13 the controller's identity and
//     contact details are mandatory, and Google Play's User Data policy
//     requires the listed developer to match. An inaccurate entity is not a
//     cosmetic defect — it is the part of the policy that has legal effect.
//   • "[REPLACE WITH REGISTERED BUSINESS ADDRESS]" was rendered to users.
//
// `scripts/check-legal.mjs` fails a release build while any field below is
// still a placeholder, so this cannot reach production unset again.

/** Marks a value as not yet supplied. The build guard greps for this. */
const UNSET = '__UNSET__';

export type PublisherKind = 'individual' | 'company';

export interface LegalIdentity {
  /** Individual developer, or an incorporated company. Changes the wording. */
  kind: PublisherKind;
  /** Legal name: the person's full name, or the registered company name. */
  name: string;
  /** The trading/app name shown to users. Safe to differ from `name`. */
  tradingName: string;
  /** Postal address of the controller. Required by GDPR Art. 13. */
  address: string;
  /** Company registration number, when incorporated. */
  registrationNumber?: string;
  /** Jurisdiction whose law governs the Terms, e.g. "Malaysia". */
  governingLaw: string;
  privacyEmail: string;
  /** EU/UK data-protection contact. Often the same mailbox. */
  dataProtectionEmail: string;
  supportEmail: string;
  lastUpdated: string;
}

export const LEGAL: LegalIdentity = {
  // Confirmed by the publisher 2026-08-27: personal Play developer account,
  // not an incorporated entity, based in Malaysia.
  kind: 'individual',
  // STILL REQUIRED — your full legal name as it appears on the Play developer
  // account, and a postal address. Both are mandatory controller-identity
  // fields (GDPR Art. 13; Malaysia's PDPA s.7 notice requirement), and the
  // release build refuses to ship while they are UNSET. That refusal is the
  // feature: the previous version simply printed a placeholder to users.
  name: UNSET,
  tradingName: 'FitFlow',
  address: UNSET,
  governingLaw: 'Malaysia',
  privacyEmail: 'fitflow2000@gmail.com',
  dataProtectionEmail: 'fitflow2000@gmail.com',
  supportEmail: 'fitflow2000@gmail.com',
  lastUpdated: '2026-08-27',
};

/** True while any required field is still a placeholder. */
export const legalIdentityIncomplete = (): boolean =>
  [LEGAL.name, LEGAL.address, LEGAL.governingLaw].some((v) => v === UNSET) ||
  (LEGAL.kind === 'company' && !LEGAL.registrationNumber);

/**
 * How the publisher refers to itself in prose.
 *
 * An individual developer is not a corporation: they have no officers or
 * directors, and a Terms document that says otherwise describes a party that
 * does not exist. The distinction is carried here so both documents stay
 * accurate for whichever the publisher actually is.
 */
export const publisherNoun = (): string =>
  LEGAL.kind === 'company' ? 'the company' : 'the developer';

/** The display block used in the contact section of both legal documents. */
export const publisherBlock = (): string[] => {
  const lines = [LEGAL.name];
  if (LEGAL.kind === 'company' && LEGAL.registrationNumber) {
    lines.push(`Company no. ${LEGAL.registrationNumber}`);
  }
  if (LEGAL.tradingName && LEGAL.tradingName !== LEGAL.name) {
    lines.push(`trading as ${LEGAL.tradingName}`);
  }
  lines.push(LEGAL.address);
  return lines;
};
