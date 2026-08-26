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
    'signups.credentials': 'Accès à envoyer',
    'signups.credentialsOnce':
      'Notez ce code maintenant : il n’est pas conservé en clair et ne pourra plus être affiché.',
    'signups.tempEmail': 'E-mail temporaire',
    'signups.tempCode': 'Code d’accès',
    'signups.sendWhatsapp': 'Envoyer sur WhatsApp',
    'signups.reissue': 'Régénérer le code',
    'signups.reissueWarning':
      'Régénérer invalide le code précédent. À faire seulement si l’école ne l’a jamais reçu.',
    'signups.sent': 'Accès envoyés',
    'signups.copyAll': 'Tout copier',
    'signups.loginLink': 'Lien de connexion',
    'signups.progress': 'Progression',
    'signups.step.pending': 'En attente',
    'signups.step.approved': 'Lien envoyé',
    'signups.step.first_login': 'Connectée',
    'signups.step.email_replaced': 'E-mail vérifié',
    'signups.step.phone_verified': 'Tél. vérifié',
    'signups.step.complete': 'Terminé',
    'signups.step.rejected': 'Refusée',
    'signups.step.expired': 'Expirée',

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
    'signups.credentials': 'Access to send',
    'signups.credentialsOnce':
      'Write this code down now — it is not stored in readable form and cannot be shown again.',
    'signups.tempEmail': 'Temporary email',
    'signups.tempCode': 'Access code',
    'signups.sendWhatsapp': 'Send on WhatsApp',
    'signups.reissue': 'Reissue code',
    'signups.reissueWarning':
      'Reissuing invalidates the previous code. Only do this if the school never received it.',
    'signups.sent': 'Access sent',
    'signups.copyAll': 'Copy all',
    'signups.loginLink': 'Login link',
    'signups.progress': 'Progress',
    'signups.step.pending': 'Pending',
    'signups.step.approved': 'Link sent',
    'signups.step.first_login': 'Signed in',
    'signups.step.email_replaced': 'Email verified',
    'signups.step.phone_verified': 'Phone verified',
    'signups.step.complete': 'Complete',
    'signups.step.rejected': 'Rejected',
    'signups.step.expired': 'Expired',

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
