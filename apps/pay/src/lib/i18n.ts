/**
 * French first, English behind the same keys.
 *
 * The school's locale decides, not the browser's: a Cameroonian parent on a
 * phone set to English is still receiving a French school's message, and the
 * page must read like the message that brought them here.
 *
 * Every string a parent sees is written to be read aloud. Short sentences,
 * no jargon, no "instalment #2 of fee schedule v3".
 */
export type Locale = 'fr' | 'en'

export const DICTIONARY = {
  fr: {
    greeting: (school: string) => `Bonjour, ici ${school}.`,
    owed: (label: string, name: string, amount: string, date: string) =>
      `La ${label} de ${name} est de ${amount}, à régler avant le ${date}.`,
    askDelay: 'Vous avez besoin de plus de temps ? Choisissez un délai.',
    weeks: (n: number) => (n === 7 ? '1 semaine' : n === 14 ? '2 semaines' : `${n} jours`),
    weeksThree: '3 semaines',
    untilShort: (date: string) => `jusqu'au ${date}`,
    confirmTitle: (date: string) => `Vous demandez un délai jusqu'au ${date}.`,
    confirmOnce: 'Un seul délai est possible par tranche.',
    collision: (date: string) => `Attention : la tranche suivante est due le ${date}.`,
    reasonLabel: 'Une raison ? (facultatif)',
    reasonPlaceholder: 'Ex. : salaire versé en fin de mois',
    confirm: 'Confirmer ma demande',
    back: 'Choisir un autre délai',
    grantedTitle: (date: string) => `C'est accordé. Vous avez jusqu'au ${date}.`,
    grantedBody: 'Nous vous rappellerons une semaine avant, puis la veille.',
    pendingTitle: 'Votre demande est enregistrée.',
    pendingBody: "L'école vous répondra. Rien n'est encore accordé.",
    unavailable: {
      disabled: "Cette école ne propose pas de délai de paiement. Contactez le secrétariat.",
      settled: 'Cette tranche est déjà réglée. Merci !',
      already_used: 'Un délai a déjà été demandé pour cette tranche.',
      too_early: "C'est encore un peu tôt. Revenez plus près de l'échéance.",
      too_late: "Le délai n'est plus possible pour cette tranche. Contactez le secrétariat.",
      zero_amount: "Il n'y a rien à régler pour cette tranche.",
    },
    rejected: 'Ce délai n\'est pas disponible.',
    mayAskAgain: 'Vous pouvez faire une nouvelle demande.',
    mayNotAskAgain: "Vous ne pouvez plus faire de demande pour cette tranche.",
    expired: 'Ce lien n\'est plus valable.',
    expiredBody: "Contactez le secrétariat de l'école.",
    error: "Une erreur s'est produite. Réessayez dans un instant.",
  },
  en: {
    greeting: (school: string) => `Hello, this is ${school}.`,
    owed: (label: string, name: string, amount: string, date: string) =>
      `${name}'s ${label} is ${amount}, due by ${date}.`,
    askDelay: 'Need more time? Choose a delay.',
    weeks: (n: number) => (n === 7 ? '1 week' : n === 14 ? '2 weeks' : `${n} days`),
    weeksThree: '3 weeks',
    untilShort: (date: string) => `until ${date}`,
    confirmTitle: (date: string) => `You are asking for a delay until ${date}.`,
    confirmOnce: 'Only one delay is possible per instalment.',
    collision: (date: string) => `Note: the next instalment is due on ${date}.`,
    reasonLabel: 'A reason? (optional)',
    reasonPlaceholder: 'e.g. paid at the end of the month',
    confirm: 'Confirm my request',
    back: 'Choose a different delay',
    grantedTitle: (date: string) => `Granted. You have until ${date}.`,
    grantedBody: 'We will remind you a week before, then the day before.',
    pendingTitle: 'Your request has been recorded.',
    pendingBody: 'The school will reply. Nothing has been granted yet.',
    unavailable: {
      disabled: 'This school does not offer payment delays. Please contact the office.',
      settled: 'This instalment is already paid. Thank you!',
      already_used: 'A delay has already been requested for this instalment.',
      too_early: 'It is a little early. Come back closer to the due date.',
      too_late: 'A delay is no longer possible for this instalment. Please contact the office.',
      zero_amount: 'There is nothing to pay for this instalment.',
    },
    rejected: 'That delay is not available.',
    mayAskAgain: 'You can make a new request.',
    mayNotAskAgain: 'You cannot make another request for this instalment.',
    expired: 'This link is no longer valid.',
    expiredBody: 'Please contact the school office.',
    error: 'Something went wrong. Please try again in a moment.',
  },
} as const

export function t(locale: Locale) {
  return DICTIONARY[locale]
}

/** `2026-10-06` → `6 octobre 2026`. Never computed in the browser from a timestamp. */
export function longDate(calendarDate: string, locale: Locale): string {
  const [year, month, day] = calendarDate.split('-').map(Number)
  const months =
    locale === 'fr'
      ? ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
      : ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  return `${day} ${months[(month ?? 1) - 1]} ${year}`
}
