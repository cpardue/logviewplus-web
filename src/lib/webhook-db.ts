import { db } from './db'
import { sanitizeWebhook, type WebhookConfig } from './webhook'

const STORE = 'webhooks'
const KEY = 'default'

interface WebhookRecord {
  id: string
  config: WebhookConfig
}

/** The configured webhook target (empty/disarmed when none has been saved yet). */
export async function loadWebhook(): Promise<WebhookConfig> {
  const d = await db()
  const rec = (await d.get(STORE, KEY)) as WebhookRecord | undefined
  return sanitizeWebhook(rec?.config)
}

/** Replace the stored webhook config (an empty URL disarms the hook). */
export async function saveWebhook(config: WebhookConfig): Promise<void> {
  const d = await db()
  await d.put(STORE, { id: KEY, config })
}