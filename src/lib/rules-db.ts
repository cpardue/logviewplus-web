import { db } from './db'
import { sanitizeRules, type Rule } from './rules'

const STORE = 'rules'
const KEY = 'working'

interface RulesRecord {
  id: string
  rules: Rule[]
}

/** The working rule set (empty when none has been saved yet). */
export async function loadRules(): Promise<Rule[]> {
  const d = await db()
  const rec = (await d.get(STORE, KEY)) as RulesRecord | undefined
  return sanitizeRules(rec?.rules)
}

/** Replace the stored working rule set (pass [] to clear). */
export async function saveRules(rules: Rule[]): Promise<void> {
  const d = await db()
  await d.put(STORE, { id: KEY, rules })
}
