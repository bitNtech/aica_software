import type { Credential, KnowledgeSource, Passage } from '../types'
import { ago } from './runtime'

/** Sample passages for the sample knowledge, and a word-overlap stand-in
 * for retrieval. The real search runs on AICA's servers. */

const SAMPLE: Record<string, string[]> = {
  kb_doctors: [
    'Dr. R. Ramachandran, Cardiology: Monday, Wednesday and Friday, 10 AM to 1 PM, OPD block A, room 4.',
    'Dr. S. Meenakshi, General medicine: Monday to Saturday, 9 AM to 12 noon and 5 PM to 7 PM, OPD block A, room 1.',
    'Dr. K. Arvind, Orthopaedics: Tuesday and Thursday, 11 AM to 2 PM, OPD block B, room 2.',
    'Dr. P. Lakshmi, Paediatrics: Monday to Friday, 9 AM to 1 PM. Saturday 9 AM to 11 AM.',
    'Dr. V. Senthil, ENT: Wednesday and Saturday, 2 PM to 5 PM, OPD block B, room 6.',
    'Sunday: only the emergency department and the duty doctor. No OPD consultations.',
  ],
  kb_prices: [
    'General medicine consultation: ₹400. Specialist consultation: ₹600. Review within 7 days: free.',
    'Complete blood count (CBC): ₹350. Results the same evening.',
    'Lipid profile: ₹650. Fasting for 10 to 12 hours needed.',
    'Thyroid profile (T3, T4, TSH): ₹700.',
    'Master health check-up: ₹3,200, includes 28 tests, ECG, chest X-ray and a physician consultation.',
    'Prices may change. The billing counter confirms the final amount.',
  ],
  kb_insurance: [
    'Cashless treatment is available with Star Health, ICICI Lombard, HDFC ERGO and New India Assurance.',
    'TPAs: Medi Assist, MD India and Health India.',
    'Bring the insurance card and a photo ID to the insurance desk, ground floor, before admission.',
  ],
}

/** The passages a source was split into (a sample of them). */
export function passagesOf(k: KnowledgeSource): Passage[] {
  // An FAQ is its own questions, as edited; other kinds use the samples.
  const texts = k.faq?.length
    ? k.faq.map((f) => `${f.q} ${f.a}`)
    : (SAMPLE[k.id] ?? [
        `${k.name}: ${k.description || 'no description given.'}`,
        `Sample section from ${k.origin}. In this demo, files aren't read: real sources show their own text here.`,
      ])
  return texts.map((text) => ({ sourceId: k.id, sourceName: k.name, text }))
}

const SYNONYMS: [RegExp, string][] = [
  [/timing|time|open|hours|when/i, 'timings hours monday saturday'],
  [/park/i, 'parking basement'],
  [/price|cost|fee|charge|how much|evlo/i, 'consultation price ₹'],
  [/heart|cardio/i, 'cardiology'],
  [/bone|ortho|knee/i, 'orthopaedics'],
  [/child|kid|baby|paediatric|pediatric/i, 'paediatrics'],
  [/insurance|claim|cashless|tpa/i, 'insurance cashless tpas'],
  [/report|result|lab/i, 'lab reports'],
  [/sunday/i, 'sunday'],
]

/** Words too common to say anything about a match. */
const STOP = new Set('the and for are you can what when where how does there any with this that from have has our your who which will was were into about please tell need want'.split(' '))
const words = (s: string) => (s.toLowerCase().match(/[a-z₹]{3,}|\d+/g) ?? []).filter((w) => !STOP.has(w))

/** Passages that share the most words with the question, best first. */
export function search(sources: KnowledgeSource[], question: string, top = 4): Passage[] {
  const asked = new Set([...words(question), ...SYNONYMS.filter(([re]) => re.test(question)).flatMap(([, w]) => words(w))])
  if (!asked.size) return []
  return sources
    .filter((k) => k.status === 'ready')
    .flatMap(passagesOf)
    .map((p) => {
      const have = new Set(words(p.text))
      const hits = [...asked].filter((w) => have.has(w)).length
      return { ...p, score: Math.min(0.95, hits / Math.max(3, asked.size) + (hits ? 0.25 : 0)) }
    })
    .filter((p) => p.score > 0.3)
    .sort((a, b) => b.score - a.score)
    .slice(0, top)
}

export function seedCredentials(): Credential[] {
  return [
    { name: 'HIS_API_KEY', setAt: ago(40), setBy: 'Karthik R' },
    { name: 'LIS_TOKEN', setAt: ago(12), setBy: 'Karthik R' },
  ]
}
