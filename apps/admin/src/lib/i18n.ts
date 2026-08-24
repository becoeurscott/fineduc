export type Locale = 'fr' | 'en'

export const DICT = {
  fr: {
    'nav.signups': 'Inscriptions',
    'nav.overview': 'Vue d’ensemble',

    'signups.title': 'Inscriptions',
    'signups.subtitle': 'Demandes d’inscription des écoles',
    'signups.school': 'École',
    'signups.contact': 'Contact',
    'signups.country': 'Pays',
    'signups.students': 'Élèves',
    'signups.status': 'Statut',
    'signups.date': 'Date',
    'signups.pending': 'En attente',
    'signups.approved': 'Approuvée',
    'signups.rejected': 'Refusée',
    'signups.setupComplete': 'Configurée',
    'signups.expired': 'Expirée',
    'signups.none': 'Aucune demande d’inscription.',
    'signups.approve': 'Approuver',
    'signups.reject': 'Refuser',
    'signups.rejectReason': 'Motif du refus',
    'signups.setupLink': 'Lien de configuration',
    'signups.tempId': 'Identifiant temporaire',
    'signups.copyLink': 'Copier le lien',
    'signups.copied': 'Copié !',
    'signups.actions': 'Actions',

    'common.search': 'Rechercher',
    'common.loading': 'Chargement…',
    'common.retry': 'Réessayer',
    'common.error': 'Une erreur est survenue',
    'common.cancel': 'Annuler',
    'common.confirm': 'Confirmer',
    'common.noResults': 'Aucun résultat',
  },
  en: {
    'nav.signups': 'Signups',
    'nav.overview': 'Overview',

    'signups.title': 'Signups',
    'signups.subtitle': 'School signup requests',
    'signups.school': 'School',
    'signups.contact': 'Contact',
    'signups.country': 'Country',
    'signups.students': 'Students',
    'signups.status': 'Status',
    'signups.date': 'Date',
    'signups.pending': 'Pending',
    'signups.approved': 'Approved',
    'signups.rejected': 'Rejected',
    'signups.setupComplete': 'Set up',
    'signups.expired': 'Expired',
    'signups.none': 'No signup requests.',
    'signups.approve': 'Approve',
    'signups.reject': 'Reject',
    'signups.rejectReason': 'Reason for rejection',
    'signups.setupLink': 'Setup link',
    'signups.tempId': 'Temporary ID',
    'signups.copyLink': 'Copy link',
    'signups.copied': 'Copied!',
    'signups.actions': 'Actions',

    'common.search': 'Search',
    'common.loading': 'Loading…',
    'common.retry': 'Retry',
    'common.error': 'Something went wrong',
    'common.cancel': 'Cancel',
    'common.confirm': 'Confirm',
    'common.noResults': 'No results',
  },
} as const

export type TranslationKey = keyof (typeof DICT)['fr']

export function translate(locale: Locale, key: TranslationKey, vars?: Record<string, string | number>): string {
  const raw: string = DICT[locale][key] ?? DICT.fr[key] ?? key
  if (!vars) return raw
  return Object.entries(vars).reduce((acc, [name, value]) => acc.replaceAll(`{${name}}`, String(value)), raw)
}

export function intlLocale(locale: Locale): string {
  return locale === 'fr' ? 'fr-CM' : 'en-GB'
}
