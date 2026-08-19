/**
 * All marketing copy, French-first (PRD §8).
 *
 * One module rather than an i18n library: this is a static site with two
 * locales and no runtime negotiation — a library would be an abstraction
 * with one implementation, which AGENTS.md says to delete.
 *
 * IMPORTANT — nothing in here invents social proof. Fineduc has no
 * customers yet, and PRD §8 explicitly marks the numbers and the
 * testimonial as "real ones, once we have them". Those two sections read
 * from `PROOF` below, which is deliberately empty; the page renders an
 * honest "no customers yet" state instead of a fabricated director quote
 * or an invented "10 000 schools" figure. Fill `PROOF` only with figures a
 * real school has agreed to.
 */
export const LOCALES = ['fr', 'en'] as const
export type Locale = (typeof LOCALES)[number]

export const CONTENT = {
  fr: {
    meta: {
      title: 'Fineduc — Le logiciel de recouvrement des frais de scolarité',
      description:
        'Un dossier par élève, des échéances claires, des rappels automatiques WhatsApp et SMS, le paiement mobile money. Le directeur voit tout en temps réel.',
    },
    nav: {
      features: 'Fonctionnalités',
      pricing: 'Tarifs',
      security: 'Sécurité',
      demo: 'Demander une démo',
      demoShort: 'Démo',
      login: 'Se connecter',
      menuOpen: 'Ouvrir le menu',
      menuClose: 'Fermer le menu',
    },
    hero: {
      eyebrow: 'Pour les écoles privées d’Afrique',
      /** One line. The template stacks its two-word name; ours is three
          words, so a break would read as a wrap rather than a stack. */
      title: 'Fineduc AI Platform',
      /** Was the H1; now the subtitle, where the template puts its value line. */
      subtitle:
        'Arrêtez de courir après les frais de scolarité. Un dossier par élève, des échéances claires, des rappels automatiques WhatsApp et SMS, le paiement mobile money — et un directeur qui voit tout, en temps réel.',
      ctaPrimary: 'Commencer maintenant',
      /* Phones only. The template fits both hero buttons on one line at
         375px; French runs longer than English, so the primary label has
         to lose its adverb to keep that row intact. */
      ctaPrimaryShort: 'Commencer',
      ctaSecondary: 'Voir la démo',
      trust: [
        'Aucun fonds ne transite par Fineduc',
        'Mobile money via agrégateur agréé',
        'Vos données vous appartiennent',
      ],
    },
    trusted: {
      title: 'Des établissements et structures éducatives au Cameroun',
      /** Rendered as placeholder tiles until real partners sign off. */
      placeholders: [
        'Collège privé',
        'Groupe scolaire',
        'Complexe bilingue',
        'Institut technique',
        'École maternelle',
        'Lycée privé',
        'Fondation éducative',
        'Réseau d’écoles',
      ],
    },
    problem: {
      eyebrow: 'Le problème',
      title: 'Chaque année, des millions jamais recouvrés.',
      /** Red stat tiles in the "Before" state; green in "After". */
      beforeStats: [
        { value: '30 %', label: 'des frais jamais recouvrés en fin d’année' },
        { value: '3 sem.', label: 'de retard moyen sur chaque tranche' },
      ],
      afterStats: [
        { value: '+15 pts', label: 'de taux de recouvrement au premier trimestre' },
        { value: '72 h', label: 'pour encaisser après un rappel automatique' },
      ],
      subtitle:
        'Le registre est sur papier, et dans la tête d’une seule personne. Rien de tout cela ne peut être planifié, rappelé, rapproché, ni vu en temps réel.',
      beforeLabel: 'Avant Fineduc',
      afterLabel: 'Avec Fineduc',
      before: [
        {
          title: 'Courir après les parents',
          body: 'L’économe appelle un par un, liste de classe à la main. Le recouvrement dépend de la mémoire d’une seule personne.',
        },
        {
          title: 'Des retards permanents',
          body: 'Aucun échéancier visible par le parent, aucun rappel avant la date. L’argent arrive après les salaires et les fournisseurs.',
        },
        {
          title: 'Des espèces mal tracées',
          body: 'Les parents paient en billets au guichet, le reçu est un carnet à souche. Personne ne peut prouver ce qui a été encaissé.',
        },
        {
          title: 'Le directeur est aveugle',
          body: 'La position réelle n’est connue qu’après un rapprochement manuel, des semaines plus tard.',
        },
      ],
      after: [
        {
          title: 'Le système relance à votre place',
          body: 'Rappels automatiques avant, le jour et après l’échéance. Personne n’a besoin d’y penser.',
        },
        {
          title: 'Le parent sait, à l’avance',
          body: 'Chaque tranche a un montant et une date, communiqués dès l’inscription. Et un lien pour payer.',
        },
        {
          title: 'Chaque franc est tracé',
          body: 'Ouverture et clôture de caisse avec comptage. Tout écart exige un motif écrit, visible du directeur.',
        },
        {
          title: 'La position, en direct',
          body: 'Encaissé aujourd’hui, taux de recouvrement, impayés par classe, caisses ouvertes. Depuis votre téléphone.',
        },
      ],
    },
    features: {
      eyebrow: 'Fonctionnalités',
      title: 'Tout ce qu’il faut pour recouvrer, rien de plus.',
      subtitle:
        'Fineduc n’est pas un logiciel de gestion scolaire. Pas de notes, pas d’absences, pas d’emploi du temps. Uniquement le recouvrement — et il le fait bien.',
      items: [
        {
          title: 'Un dossier par élève',
          body: 'Identité, parents payeurs, ce qui est dû, ce qui est payé, ce qui reste. Remplace le registre, le carnet de reçus et la mémoire de l’économe.',
        },
        {
          title: 'Des échéances datées',
          body: 'La grille tarifaire se découpe en tranches dès l’inscription. Le paiement partiel est la norme, pas l’exception.',
        },
        {
          title: 'Rappels WhatsApp et SMS',
          body: 'Une échelle de relance douce puis ferme, avec un lien de paiement. Aucun rappel n’est envoyé à un parent déjà à jour.',
        },
        {
          title: 'Paiement mobile money',
          body: 'MTN, Orange, Moov, Wave et carte, via un agrégateur tiers. Le paiement arrive déjà rattaché à l’élève.',
        },
        {
          title: 'Contrôle de caisse',
          body: 'Le caissier ouvre avec un fonds, encaisse, puis clôture en comptant. L’écart est calculé et doit être justifié.',
        },
        {
          title: 'Vue directeur en temps réel',
          body: 'Encaissements, taux de recouvrement, ancienneté des impayés, part du mobile money. Conçu pour un téléphone.',
        },
      ],
    },
    showcase: {
      eyebrow: 'Le tableau de bord',
      title: 'Votre position, sans demander à personne.',
      subtitle:
        'Conçu d’abord pour un écran de téléphone, parce que c’est là que vous le consulterez — debout, entre deux rendez-vous.',
      stats: [
        { label: 'Encaissé aujourd’hui', value: '345 000 FCFA' },
        { label: 'Taux de recouvrement', value: '70,9 %' },
        { label: 'Reste à recouvrer', value: '6 330 000 FCFA' },
      ],
      caption: 'Écran réel du produit, avec des données de démonstration.',
    },
    how: {
      eyebrow: 'Mise en route',
      title: 'Opérationnel en 48 heures.',
      steps: [
        {
          n: '01',
          title: 'Nous importons vos élèves',
          body: 'Depuis vos registres, vos fichiers Excel ou vos carnets. Nous nous en chargeons pendant l’accompagnement.',
        },
        {
          n: '02',
          title: 'Vous fixez votre grille tarifaire',
          body: 'Par niveau : scolarité, inscription, examen, cantine, transport. Puis le découpage en tranches.',
        },
        {
          n: '03',
          title: 'Les rappels et les paiements tournent seuls',
          body: 'Vous n’intervenez plus que pour les cas particuliers. Le reste se fait sans vous.',
        },
      ],
    },
    security: {
      eyebrow: 'Sécurité et confiance',
      title: 'Conçu pour un directeur méfiant.',
      subtitle:
        'Vous avez déjà été déçu par un prestataire, ou par un employé. Ces garanties ne sont pas des cases à cocher — c’est le produit.',
      items: [
        {
          title: 'Nous ne touchons jamais votre argent',
          body: 'Les fonds vont de l’agrégateur directement sur le compte de l’école. Fineduc n’est pas un établissement de paiement et ne détient aucun fonds.',
        },
        {
          title: 'Chaque geste est journalisé',
          body: 'Qui a fait quoi, quand, depuis où, et ce que la donnée valait avant. Le journal ne peut être ni modifié ni supprimé, par personne.',
        },
        {
          title: 'Rien ne s’efface',
          body: 'Un paiement n’est jamais supprimé. Une correction est une nouvelle écriture, signée et motivée. Le compte d’un élève se relit comme un relevé bancaire.',
        },
        {
          title: 'Chaque rôle à sa place',
          body: 'Le caissier encaisse, l’économe recouvre, le directeur arbitre. Un remboursement ou une remise importante exige deux personnes différentes.',
        },
        {
          title: 'Vos données sont isolées',
          body: 'Les données de votre école sont cloisonnées au niveau de la base elle-même, pas seulement dans le code. Chiffrement en transit et au repos.',
        },
        {
          title: 'Vos données vous appartiennent',
          body: 'Export complet à tout moment, dans un format lisible. Sans négociation et sans frais de sortie.',
        },
      ],
    },
    audience: {
      eyebrow: 'Pour qui',
      title: 'Pensé pour les écoles privées africaines.',
      items: [
        { title: 'Maternelle et primaire', body: 'Beaucoup d’élèves, des montants unitaires modestes, des fratries nombreuses.' },
        { title: 'Collèges et lycées', body: 'Des tranches multiples, des frais d’examen, des arriérés qui roulent d’année en année.' },
        { title: 'Établissements bilingues', body: 'Deux langues, deux publics de parents. L’interface et les messages suivent.' },
        { title: 'Groupes multi-campus', body: 'Plusieurs sites, une seule vue consolidée pour le promoteur.' },
      ],
    },
    pricing: {
      eyebrow: 'Tarifs',
      title: 'Vous nous payez sur ce que nous récupérons.',
      subtitle:
        'Pour une école de 400 élèves à 250 000 FCFA par an, la formule Croissance annuelle représente 0,58 % des encaissements. Récupérer 3 % d’arriérés en plus rapporte 3 000 000 FCFA.',
      monthly: 'Mensuel',
      annual: 'Annuel (−20 %)',
      perMonth: '/ mois',
      cta: 'Demander une démo',
      mostPopular: 'Le plus choisi',
      plans: [
        {
          name: 'Essentiel',
          audience: "Jusqu'à 250 élèves",
          monthly: '25 000',
          annual: '20 000',
          features: [
            'Dossiers élèves et échéanciers',
            'Contrôle de caisse',
            'Paiement mobile money',
            'Tableau de bord directeur',
            '2 utilisateurs + 2 caissiers',
            '500 messages WhatsApp / mois',
          ],
        },
        {
          name: 'Croissance',
          audience: '251 à 800 élèves',
          monthly: '60 000',
          annual: '48 000',
          highlighted: true,
          features: [
            'Tout Essentiel, sans limite d’utilisateurs',
            'Échelle de relance complète',
            'Multi-caisses',
            'Exports Excel et PDF',
            '2 000 messages WhatsApp / mois',
            'Support prioritaire',
          ],
        },
        {
          name: 'Institution',
          audience: '800+ élèves, multi-campus',
          monthly: '120 000',
          annual: '96 000',
          fromPrefix: 'à partir de',
          features: [
            'Tout Croissance',
            'Consolidation multi-sites',
            'Modèles de messages sur mesure',
            'Accès API',
            'Chargé de compte dédié',
            'Accompagnement sur site',
          ],
        },
      ],
      walletTitle: 'Crédits de messages, payés d’avance',
      walletBody:
        'Les messages sont facturés à l’unité sur un crédit prépayé : jamais de facture surprise. WhatsApp 10 FCFA, SMS 30 FCFA. Vous fixez un plafond mensuel ; au plafond, l’envoi s’arrête et l’économe est prévenu.',
      onboardingTitle: 'Accompagnement au démarrage — 150 000 FCFA',
      onboardingBody:
        'Reprise de vos registres existants, paramétrage de la grille tarifaire et deux sessions de formation. Offert pour tout contrat annuel Croissance ou Institution.',
      feesNote:
        'Les frais de l’agrégateur de paiement (1,5 à 3,5 %) sont répercutés, au choix, sur le parent ou sur l’école. Fineduc ne prélève rien dessus.',
    },
    faq: {
      eyebrow: 'Questions fréquentes',
      title: 'Ce que les directeurs nous demandent.',
      items: [
        {
          q: 'Est-ce que notre argent passe par vous ?',
          a: 'Non, jamais. Les fonds vont de l’agrégateur de paiement directement sur le compte bancaire de l’école. Fineduc n’est pas un établissement de paiement, ne détient aucun fonds et ne prélève aucune commission sur vos encaissements.',
        },
        {
          q: 'Quels moyens de paiement mobile sont acceptés ?',
          a: 'MTN Mobile Money, Orange Money, Moov Money, Wave et la carte bancaire, via un agrégateur tiers agréé. Nous n’avons aucun contrat direct avec les opérateurs — c’est volontaire, et cela vous évite d’en dépendre.',
        },
        {
          q: 'Et si Internet tombe au guichet ?',
          a: 'L’encaissement en espèces et par virement ne dépend jamais de l’agrégateur. Le caissier continue d’encaisser et d’imprimer des reçus ; seul le mobile money nécessite une connexion.',
        },
        {
          q: 'Les parents peuvent-ils payer en plusieurs fois ?',
          a: 'Oui, et c’est prévu comme le cas normal, pas comme une exception. Un parent qui verse 12 000 sur une tranche de 45 000 est enregistré en une seule opération, et le solde restant est suivi automatiquement.',
        },
        {
          q: 'Nous utilisons déjà Excel. Pourquoi changer ?',
          a: 'Excel ne relance pas les parents, n’encaisse pas, et ne vous dit pas ce qu’il y a dans la caisse à 16 h. Nous reprenons vos fichiers existants pendant l’accompagnement — vous ne repartez pas de zéro.',
        },
        {
          q: 'À qui appartiennent les données ?',
          a: 'À l’école. Vous pouvez exporter l’intégralité de vos données à tout moment, dans un format lisible, sans frais et sans avoir à le négocier.',
        },
        {
          q: 'Le parent doit-il installer une application ?',
          a: 'Non. Le parent reçoit un message WhatsApp ou SMS, appuie sur un lien, paie, et reçoit son reçu sur la même conversation. Il n’a aucun compte à créer.',
        },
      ],
    },
    finalCta: {
      title: 'Voyons ce que votre école peut récupérer.',
      subtitle:
        'Une démonstration de 30 minutes, sur vos propres chiffres. Nous vous montrons ce que donnerait votre prochain trimestre.',
      cta: 'Demander une démo',
      whatsapp: 'Écrire sur WhatsApp',
    },
    footer: {
      tagline: 'Le logiciel de recouvrement des frais de scolarité, pour les écoles privées africaines.',
      product: 'Produit',
      company: 'Entreprise',
      legal: 'Légal',
      privacy: 'Confidentialité',
      terms: 'Conditions',
      rights: 'Tous droits réservés.',
      notPaymentInstitution:
        'Fineduc est un éditeur de logiciel. Fineduc n’est pas un établissement de paiement et ne détient jamais les fonds des écoles ni des familles.',
    },
    proof: {
      eyebrow: 'Témoignages',
      title: 'Ce que les directeurs disent de la plateforme.',
      empty:
        'Fineduc démarre avec ses premières écoles. Nous publierons des chiffres et des témoignages quand ils seront réels, vérifiables et autorisés par l’établissement concerné — pas avant.',
      cta: 'Devenir une école pilote',
    },
  },

  en: {
    meta: {
      title: 'Fineduc — School fee collection software',
      description:
        'One file per student, clear instalments, automatic WhatsApp and SMS reminders, mobile money payment. The director sees everything in real time.',
    },
    nav: {
      features: 'Features',
      pricing: 'Pricing',
      security: 'Security',
      demo: 'Request a demo',
      demoShort: 'Demo',
      login: 'Sign in',
      menuOpen: 'Open menu',
      menuClose: 'Close menu',
    },
    hero: {
      eyebrow: 'For private schools in Africa',
      title: 'Fineduc AI Platform',
      subtitle:
        'Stop chasing school fees. One file per student, clear instalments, automatic WhatsApp and SMS reminders, mobile money payment — and a director who sees everything, in real time.',
      ctaPrimary: 'Get started now',
      ctaPrimaryShort: 'Get started',
      ctaSecondary: 'View demo',
      trust: ['No funds ever pass through Fineduc', 'Mobile money via a licensed aggregator', 'Your data belongs to you'],
    },
    trusted: {
      title: 'Schools and education structures in Cameroon',
      placeholders: [
        'Private college',
        'School group',
        'Bilingual complex',
        'Technical institute',
        'Nursery school',
        'Private high school',
        'Education foundation',
        'School network',
      ],
    },
    problem: {
      eyebrow: 'The problem',
      title: 'Every year, millions never recovered.',
      beforeStats: [
        { value: '30%', label: 'of fees never recovered by year end' },
        { value: '3 wks', label: 'average delay on every instalment' },
      ],
      afterStats: [
        { value: '+15 pts', label: 'recovery rate in the first term' },
        { value: '72h', label: 'to collect after an automatic reminder' },
      ],
      subtitle:
        'The ledger lives on paper and in one person’s head. None of it can be scheduled, reminded, reconciled, or seen in real time.',
      beforeLabel: 'Before Fineduc',
      afterLabel: 'With Fineduc',
      before: [
        { title: 'Chasing parents by hand', body: 'The bursar calls one by one, class list in hand. Collection depends on one person’s memory.' },
        { title: 'Permanent lateness', body: 'No schedule the parent can see, no reminder before the date. Cash arrives after salaries and suppliers.' },
        { title: 'Untracked cash', body: 'Parents pay in banknotes at the desk, the receipt is a carbon pad. Nobody can prove what was collected.' },
        { title: 'The director is blind', body: 'The real position is known only after a manual reconciliation, weeks later.' },
      ],
      after: [
        { title: 'The system chases for you', body: 'Automatic reminders before, on, and after the due date. Nobody has to remember.' },
        { title: 'The parent knows in advance', body: 'Every instalment has an amount and a date, sent at enrolment. And a link to pay.' },
        { title: 'Every franc is traced', body: 'Desks open and close with a count. Any variance requires a written reason the director can see.' },
        { title: 'The position, live', body: 'Collected today, recovery rate, arrears by class, open cash desks. From your phone.' },
      ],
    },
    features: {
      eyebrow: 'Features',
      title: 'Everything you need to collect, nothing more.',
      subtitle:
        'Fineduc is not a school management system. No grades, no attendance, no timetable. Fee recovery only — and it does it well.',
      items: [
        { title: 'One file per student', body: 'Identity, paying guardians, what is owed, paid and outstanding. Replaces the register, the receipt book and the bursar’s memory.' },
        { title: 'Dated instalments', body: 'The fee schedule splits into instalments at enrolment. Partial payment is the norm, not the exception.' },
        { title: 'WhatsApp and SMS reminders', body: 'A gentle-then-firm ladder, each carrying a payment link. No reminder ever reaches a parent who has already paid.' },
        { title: 'Mobile money payment', body: 'MTN, Orange, Moov, Wave and card, through a third-party aggregator. Payments arrive already attached to a student.' },
        { title: 'Cash control', body: 'The cashier opens with a float, takes payments, then closes with a count. The variance is computed and must be justified.' },
        { title: 'Real-time director view', body: 'Collections, recovery rate, arrears ageing, mobile money share. Built for a phone.' },
      ],
    },
    showcase: {
      eyebrow: 'The dashboard',
      title: 'Your position, without asking anyone.',
      subtitle: 'Designed for a phone screen first, because that is where you will read it — standing up, between meetings.',
      stats: [
        { label: 'Collected today', value: '345,000 FCFA' },
        { label: 'Recovery rate', value: '70.9%' },
        { label: 'Outstanding', value: '6,330,000 FCFA' },
      ],
      caption: 'Real product screen, with demonstration data.',
    },
    how: {
      eyebrow: 'Getting started',
      title: 'Live in 48 hours.',
      steps: [
        { n: '01', title: 'We import your students', body: 'From your registers, spreadsheets or notebooks. We handle it during onboarding.' },
        { n: '02', title: 'You set your fee schedule', body: 'Per grade: tuition, registration, exams, canteen, transport. Then the instalment split.' },
        { n: '03', title: 'Reminders and payments run themselves', body: 'You only step in for the exceptions. The rest happens without you.' },
      ],
    },
    security: {
      eyebrow: 'Security and trust',
      title: 'Built for a sceptical director.',
      subtitle:
        'You have been let down by a vendor, or by a member of staff, before. These are not compliance checkboxes — they are the product.',
      items: [
        { title: 'We never touch your money', body: 'Funds settle from the aggregator straight into the school’s account. Fineduc is not a payment institution and holds no funds.' },
        { title: 'Every action is logged', body: 'Who did what, when, from where, and what the value was before. The log cannot be edited or deleted, by anyone.' },
        { title: 'Nothing is erased', body: 'A payment is never deleted. A correction is a new, signed, reason-coded entry. A student’s account reads like a bank statement.' },
        { title: 'Every role in its place', body: 'The cashier collects, the bursar recovers, the director arbitrates. A refund or a large discount requires two different people.' },
        { title: 'Your data is isolated', body: 'Your school’s data is separated at the database level, not merely in application code. Encrypted in transit and at rest.' },
        { title: 'Your data belongs to you', body: 'Full export at any time, in a readable format. No negotiation and no exit fee.' },
      ],
    },
    audience: {
      eyebrow: 'Who it is for',
      title: 'Built for African private schools.',
      items: [
        { title: 'Nursery and primary', body: 'Many students, modest unit amounts, large sibling groups.' },
        { title: 'Secondary schools', body: 'Multiple instalments, exam fees, arrears that roll from year to year.' },
        { title: 'Bilingual schools', body: 'Two languages, two parent audiences. The interface and the messages follow.' },
        { title: 'Multi-campus groups', body: 'Several sites, one consolidated view for the proprietor.' },
      ],
    },
    pricing: {
      eyebrow: 'Pricing',
      title: 'You pay us out of what we recover.',
      subtitle:
        'For a 400-student school charging 250,000 FCFA a year, the annual Croissance plan is 0.58% of collections. Recovering just 3% more arrears returns 3,000,000 FCFA.',
      monthly: 'Monthly',
      annual: 'Annual (−20%)',
      perMonth: '/ month',
      cta: 'Request a demo',
      mostPopular: 'Most chosen',
      plans: [
        {
          name: 'Essentiel',
          audience: 'Up to 250 students',
          monthly: '25,000',
          annual: '20,000',
          features: [
            'Student files and instalments',
            'Cash control',
            'Mobile money payment',
            'Director dashboard',
            '2 staff + 2 cashiers',
            '500 WhatsApp messages / month',
          ],
        },
        {
          name: 'Croissance',
          audience: '251 to 800 students',
          monthly: '60,000',
          annual: '48,000',
          highlighted: true,
          features: [
            'Everything in Essentiel, unlimited users',
            'Full escalation ladder',
            'Multi-desk cash control',
            'Excel and PDF exports',
            '2,000 WhatsApp messages / month',
            'Priority support',
          ],
        },
        {
          name: 'Institution',
          audience: '800+ students, multi-campus',
          monthly: '120,000',
          annual: '96,000',
          fromPrefix: 'from',
          features: [
            'Everything in Croissance',
            'Multi-site consolidation',
            'Custom message templates',
            'API access',
            'Named account manager',
            'On-site onboarding',
          ],
        },
      ],
      walletTitle: 'Message credits, paid up front',
      walletBody:
        'Messages are billed per unit from a prepaid balance: never a surprise invoice. WhatsApp 10 FCFA, SMS 30 FCFA. You set a monthly cap; at the cap, sending stops and the bursar is warned.',
      onboardingTitle: 'Onboarding — 150,000 FCFA',
      onboardingBody:
        'Migration from your existing registers, fee-schedule setup and two training sessions. Waived on any annual Croissance or Institution contract.',
      feesNote:
        'Payment aggregator fees (1.5–3.5%) are passed through, to either the parent or the school. Fineduc takes nothing from them.',
    },
    faq: {
      eyebrow: 'Frequently asked',
      title: 'What directors ask us.',
      items: [
        {
          q: 'Does our money pass through you?',
          a: 'No, never. Funds go from the payment aggregator straight to the school’s bank account. Fineduc is not a payment institution, holds no funds, and takes no commission on your collections.',
        },
        {
          q: 'Which mobile money operators are supported?',
          a: 'MTN Mobile Money, Orange Money, Moov Money, Wave and cards, through a licensed third-party aggregator. We hold no direct contract with the operators — that is deliberate, and it keeps you from depending on one.',
        },
        {
          q: 'What if the internet drops at the desk?',
          a: 'Cash and bank transfer never depend on the aggregator. The cashier keeps collecting and printing receipts; only mobile money needs a connection.',
        },
        {
          q: 'Can parents pay in instalments?',
          a: 'Yes, and it is treated as the normal case rather than an exception. A parent paying 12,000 against a 45,000 instalment is recorded in one operation, and the remaining balance is tracked automatically.',
        },
        {
          q: 'We already use Excel. Why change?',
          a: 'Excel does not chase parents, does not collect payments, and cannot tell you what is in the cash drawer at 4pm. We migrate your existing files during onboarding — you do not start from scratch.',
        },
        {
          q: 'Who owns the data?',
          a: 'The school does. You can export everything at any time, in a readable format, at no cost and without having to negotiate for it.',
        },
        {
          q: 'Does the parent need to install an app?',
          a: 'No. The parent receives a WhatsApp or SMS message, taps a link, pays, and gets the receipt back in the same thread. There is no account to create.',
        },
      ],
    },
    finalCta: {
      title: 'Let’s see what your school can recover.',
      subtitle: 'A 30-minute demonstration, on your own figures. We show you what your next term would look like.',
      cta: 'Request a demo',
      whatsapp: 'Message us on WhatsApp',
    },
    footer: {
      tagline: 'School fee collection software, for African private schools.',
      product: 'Product',
      company: 'Company',
      legal: 'Legal',
      privacy: 'Privacy',
      terms: 'Terms',
      rights: 'All rights reserved.',
      notPaymentInstitution:
        'Fineduc is a software vendor. Fineduc is not a payment institution and never holds funds belonging to schools or families.',
    },
    proof: {
      eyebrow: 'Testimonials',
      title: 'What directors say about the platform.',
      empty:
        'Fineduc is starting with its first schools. We will publish figures and testimonials once they are real, verifiable and cleared by the school concerned — not before.',
      cta: 'Become a pilot school',
    },
  },
} as const

/**
 * Social proof. EMPTY ON PURPOSE — see the note at the top of this file.
 *
 * Populating this with invented figures or a made-up head teacher would be
 * fabricated marketing content on a public page. Add an entry only when a
 * named school has agreed to the exact wording and the number behind it.
 */
export const PROOF: {
  stats: { label: string; value: string }[]
  /** Rendered as a right-to-left ticker of cards. One entry per real, signed-off quote. */
  testimonials: { quote: string; author: string; role: string; school: string }[]
} = {
  stats: [],
  testimonials: [],
}

export function contentFor(locale: Locale) {
  return CONTENT[locale]
}

/**
 * Contact channel — WhatsApp is how these buyers actually get in touch (PRD §8).
 *
 * E.164 digits only, no `+` and no leading zeros: that is the form wa.me
 * expects, and anything else silently lands the visitor on an error page
 * rather than in a chat.
 */
export const WHATSAPP_NUMBER = '12149303696'
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER}`
