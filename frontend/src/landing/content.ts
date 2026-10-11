/**
 * Every word and number the page shows, in one place.
 *
 * Claims are limited to what the AICA brochure and master reference already
 * state publicly (docs/): Tamil · English · Tanglish, 24/7, the hospital
 * front-desk workflows, human hand-off, on-premise or managed cloud. Anything
 * else stays out until it is confirmed — see the handoff's open questions.
 */

export const CONTACT = {
  phone: '+91 78289 14263',
  /* No spaces: some Android dialers mis-parse a tel: that has them. */
  phoneHref: 'tel:+917828914263',
  email: 'support@bitntech.in',
  emailHref: 'mailto:support@bitntech.in',
  whatsapp: '917828914263',
  instagram: 'https://www.instagram.com/bitntech.in/',
  linkedin: 'https://linkedin.com/company/bitntech',
  github: 'https://github.com/BitNTechadmin',
  site: 'https://bitntech.in',
} as const

/* The AICA console is part of the same frontend build as this page
   (app.html; see vite.config.ts), so its pages are plain paths. /login sends a visitor
   who is already signed in straight on to their own console. */
export const CONSOLE = {
  signIn: '/login',
  signUp: '/signup',
  home: '/login',
} as const

export const whatsappHref =(text: string) =>
  `https://wa.me/${CONTACT.whatsapp}?text=${encodeURIComponent(text)}`

export const WA_DEMO = 'Hi BitNTech, I would like to request a demo of AICA (AI Caller Agent) for my business.'

export const FILM = {
  webm: '/assets/media/aica-film.webm',
  mp4: '/assets/media/aica-film.mp4',
  poster: '/assets/media/aica-poster.jpg',
  captions: [
    { src: '/assets/media/aica-film.en.vtt', lang: 'en', label: 'English', default: true },
    { src: '/assets/media/aica-film.ta.vtt', lang: 'ta', label: 'தமிழ் (Tamil)', default: false },
  ],
  title: 'Meet AICA — the AI voice agent from BitNTech',
  seconds: 43,
} as const

export const HERO = {
  label: 'AI voice agent for inbound calls',
  lead:
    'AICA is an AI voice agent that handles inbound calls in Tamil, English and Tanglish — answering enquiries, completing tasks, and transferring the tricky ones to your team.',
}

/* ---- the problem, told the way the film tells it ---- */

export type LineStatus = 'ringing' | 'waiting' | 'hold'

/** The switchboard: what each line is doing while nobody gets to it. */
export const LINES: { n: string; status: LineStatus; t: number }[] = [
  { n: '01', status: 'ringing', t: 14 },
  { n: '02', status: 'hold', t: 153 },
  { n: '03', status: 'waiting', t: 47 },
  { n: '04', status: 'waiting', t: 212 },
  { n: '05', status: 'ringing', t: 6 },
  { n: '06', status: 'hold', t: 98 },
  { n: '07', status: 'waiting', t: 132 },
  { n: '08', status: 'ringing', t: 21 },
  { n: '09', status: 'hold', t: 337 },
  { n: '10', status: 'ringing', t: 3 },
  { n: '11', status: 'waiting', t: 64 },
  { n: '12', status: 'hold', t: 186 },
]

/** What the callers on those lines are asking. The film's own opener first. */
export const QUESTIONS = ['OP timing என்ன?', 'Report ready-ஆ?', 'Doctor இருக்காரா?', 'Fees எவ்வளவு?', 'Parking எங்க?']

export const PROBLEM = [
  {
    key: 'repeat',
    title: 'Repetitive enquiries',
    body: 'Timings, prices, status, directions. Over and over.',
    stat: '14',
    statLabel: 'calls waiting',
  },
  {
    key: 'missed',
    title: 'Missed calls',
    body: 'After hours, lunch breaks, peak rush. Every missed call is a missed customer.',
    stat: '11:48',
    statLabel: 'PM · no one picks up',
  },
  {
    key: 'lang',
    title: 'Language gap',
    body: 'Callers switch between Tamil and English mid-sentence. Most bots can’t keep up.',
    stat: '1',
    statLabel: 'language, if you’re a bot',
  },
] as const

/* ---- what AICA does, in the order a call happens ---- */

export const CAPABILITIES = [
  {
    key: 'answer',
    at: '00:01',
    title: 'Answers enquiries',
    body: 'Handles common questions instantly, without hold music.',
  },
  {
    key: 'speak',
    at: '00:04',
    title: 'Speaks naturally',
    body: 'Understands Tamil, English and Tanglish — including switching mid-sentence.',
  },
  {
    key: 'workflow',
    at: '00:09',
    title: 'Runs your workflows',
    body: 'Completes defined tasks during the call: booking and rescheduling appointments, report-ready and billing status.',
  },
  {
    key: 'transfer',
    at: '00:21',
    title: 'Transfers smartly',
    body: 'Detects complex or sensitive calls and hands them to a human agent.',
  },
  {
    key: 'always',
    at: '23:48',
    title: 'Always available',
    body: 'Calls answered day and night. No breaks, no missed calls during peak hours.',
  },
  {
    key: 'deploy',
    at: 'SETUP',
    title: 'Runs where you need it',
    body: 'On-premise, on infrastructure you own, or as a managed cloud service.',
  },
] as const

export type CapabilityKey = (typeof CAPABILITIES)[number]['key']

/* ---- languages ---- */

export const SAMPLES = [
  {
    key: 'ta',
    tab: 'Tamil',
    tabNative: 'தமிழ்',
    caller: 'நாளைக்கு டாக்டர் இருப்பாரா?',
    callerLang: 'ta',
    reply: 'இருப்பார். நாளை காலை 10 மணி முதல் 1 மணி வரை. முன்பதிவு செய்யட்டுமா?',
    replyLang: 'ta',
    gloss: '“Will the doctor be in tomorrow?” — “Yes, 10 AM to 1 PM. Shall I book you in?”',
    /** Drop a clip path here and the card gets a play button. */
    audio: '',
  },
  {
    key: 'en',
    tab: 'English',
    tabNative: 'English',
    caller: 'Is my blood test report ready?',
    callerLang: 'en',
    reply: 'Let me check. Could you tell me the phone number you registered with?',
    replyLang: 'en',
    gloss: '',
    audio: '',
  },
  {
    key: 'mix',
    tab: 'Tanglish',
    tabNative: 'Tanglish',
    caller: 'வணக்கம், appointment book பண்ணணும்…',
    callerLang: 'ta',
    reply: 'Sure. எந்த department-க்கு? Tomorrow 10:30 AM slot free-ஆ இருக்கு.',
    replyLang: 'ta',
    gloss: '“Hello, I need to book an appointment…” — “Sure. Which department? There’s a 10:30 AM slot tomorrow.”',
    audio: '',
  },
] as const

/* ---- how it works ---- */

export const STEPS = [
  ['01', 'Tell us your workflows', 'What callers ask, what needs to happen, and when to involve a human.'],
  ['02', 'We set up AICA', 'Configured for your business, your FAQs and your call flow — tested against real call scenarios before go-live.'],
  ['03', 'AICA takes the calls', 'Handles routine calls end to end and transfers the rest to your team. We keep tuning it after launch.'],
] as const

/* ---- use cases ---- */

export const USES = [
  {
    key: 'health',
    name: 'Hospitals & clinics',
    tag: 'First deployment focus',
    body: 'Tanglish-first voice AI for hospital front desks in Tamil Nadu.',
    calls: [
      'Appointment booking and rescheduling',
      'OP timings, department and doctor enquiries',
      'Report-ready and billing status calls',
      'Missed-call and after-hours call handling',
    ],
  },
  {
    key: 'mobility',
    name: 'Mobility & logistics',
    tag: '',
    body: 'The same front desk, for partners and customers on the move.',
    calls: ['Driver and partner onboarding enquiries', 'Booking status', 'Support'],
  },
  {
    key: 'retail',
    name: 'Retail & services',
    tag: '',
    body: 'The questions every counter hears a hundred times a day.',
    calls: ['Store timings', 'Order status', 'Service bookings'],
  },
  {
    key: 'edu',
    name: 'Education',
    tag: '',
    body: 'Admission season, without the engaged tone.',
    calls: ['Admission enquiries', 'Fee questions', 'Schedule questions'],
  },
] as const

/* ---- demo form ---- */

export const INDUSTRIES = ['Hospital / clinic', 'Mobility / logistics', 'Retail / services', 'Education', 'Real estate', 'Other'] as const
export const VOLUMES = ['<50', '50–200', '200–1000', '1000+'] as const
