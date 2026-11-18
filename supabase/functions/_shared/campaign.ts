// Shared campaign logic: who may receive marketing email, rendering (merge fields + CASL footer),
// and sending queued recipients through Resend in batches.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';

export const APP_URL = () => ((Deno.env.get('APP_ORIGINS') ?? '').split(',')[0] ?? '').trim();
const FUNCTIONS_URL = () => `${Deno.env.get('SUPABASE_URL')}/functions/v1`;
const SENDING_DOMAIN = 'caravaggiorealestate.ca';

export interface ContactRow {
  id: string;
  business: string;
  first_name: string;
  last_name: string;
  company: string;
  title: string;
  email: string | null;
  regions: string[];
  email_consent: string;
  consent_expires_on: string | null;
  unsubscribed_at: string | null;
  archived_at: string | null;
  properties?: { address: string }[];
}

export interface OrgSettings {
  brokerage_name: string;
  mailing_address: string;
  contact_line: string;
}

export const footerComplete = (o: OrgSettings | null) => !!o && !!o.brokerage_name.trim() && !!o.mailing_address.trim() && !!o.contact_line.trim();

const torontoToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());

/** Why a contact can't receive marketing email today, or null if they can. Mirrors can_email_marketing(). */
export function exclusionReason(c: ContactRow, suppressed: Set<string>): string | null {
  if (!c.email) return 'no email address';
  if (c.archived_at) return 'archived';
  if (c.unsubscribed_at || suppressed.has(c.email.toLowerCase())) return 'unsubscribed or on the do-not-email list';
  if (c.email_consent !== 'express' && c.email_consent !== 'implied') return 'no consent';
  if (c.consent_expires_on && c.consent_expires_on < torontoToday()) return 'consent expired';
  return null;
}

export function mergeValues(c: ContactRow | null, senderName: string): Record<string, string> {
  return {
    first_name: c?.first_name ?? '',
    last_name: c?.last_name ?? '',
    full_name: c ? `${c.first_name} ${c.last_name}`.trim() : '',
    company: c && c.company !== 'tbd' ? c.company : '',
    title: c?.title ?? '',
    property_address: c?.properties?.[0]?.address ?? '',
    region: c?.regions?.[0] ?? '',
    my_name: senderName,
  };
}

export const fill = (text: string, values: Record<string, string>) =>
  text.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, k: string) => (k in values ? values[k] : m));

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const linkify = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#0f766e">$1</a>');

export function unsubscribePageUrl(token: string) {
  return `${APP_URL()}/unsubscribe?t=${token}`;
}
export function oneClickUrl(token: string) {
  return `${FUNCTIONS_URL()}/unsubscribe?t=${token}`;
}

/** Builds the HTML and plain-text versions, with the sender's signature and the CASL footer. */
export function render(opts: { subject: string; body: string; signature: string; org: OrgSettings; values: Record<string, string>; unsubUrl: string }) {
  const subject = fill(opts.subject, opts.values);
  const body = fill(opts.body, opts.values);
  const paragraphs = body.split(/\n{2,}/).map((p) => `<p style="margin:0 0 14px">${linkify(p).replace(/\n/g, '<br>')}</p>`).join('');
  const sig = opts.signature.trim() ? `<p style="margin:18px 0 0">${linkify(opts.signature.trim()).replace(/\n/g, '<br>')}</p>` : '';
  const footer = `${esc(opts.org.brokerage_name)} · ${esc(opts.org.mailing_address)} · ${linkify(opts.org.contact_line)}`;
  const html = `<!doctype html><html><body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#16202a">
${paragraphs}${sig}
<hr style="border:0;border-top:1px solid #e2e6eb;margin:28px 0 14px">
<p style="margin:0;font-size:12px;line-height:1.5;color:#5f6b78">${footer}<br>
You're receiving this because of your past dealings or inquiries with us. <a href="${opts.unsubUrl}" style="color:#5f6b78">Unsubscribe</a>.</p>
</div></body></html>`;
  const text = `${body}${opts.signature.trim() ? `\n\n${opts.signature.trim()}` : ''}\n\n--\n${opts.org.brokerage_name} · ${opts.org.mailing_address} · ${opts.org.contact_line}\nUnsubscribe: ${opts.unsubUrl}`;
  return { subject, html, text };
}

/** "Eric Caravaggio <eric@caravaggiorealestate.ca>", only ever on Hub's verified sending domain. */
export function fromAddress(name: string, email: string) {
  const addr = email.toLowerCase().endsWith(`@${SENDING_DOMAIN}`) ? email : `noreply@${SENDING_DOMAIN}`;
  return { from: `${name.replace(/[<>"]/g, '')} <${addr}>`, replyTo: email };
}

/** Sends one email through Resend (used for test sends). */
export async function resendSingle(payload: Record<string, unknown>) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.message ?? `Resend error ${res.status}`);
  return body as { id: string };
}

/**
 * Sends up to `max` queued recipients of a campaign through Resend's batch API.
 * Stops quietly when Resend's rate or daily limit is reached; the worker resumes later.
 */
export async function processQueued(db: SupabaseClient, campaignId: string, max = 100): Promise<{ sent: number; failed: number; limited: boolean; done: boolean }> {
  const { data: campaign } = await db.from('campaigns').select('*').eq('id', campaignId).single();
  if (!campaign || campaign.status !== 'sending') return { sent: 0, failed: 0, limited: false, done: true };
  const [{ data: org }, { data: sender }] = await Promise.all([
    db.from('org_settings').select('brokerage_name, mailing_address, contact_line').single(),
    db.from('profiles').select('display_name, email, signature').eq('id', campaign.sender_id).maybeSingle(),
  ]);
  if (!footerComplete(org) || !sender) throw new Error('Brokerage details or sender missing');

  const { data: queued } = await db.from('campaign_sends').select('id, contact_id, email, unsub_token').eq('campaign_id', campaignId).eq('status', 'queued').limit(Math.min(max, 100));
  if (!queued?.length) {
    await db.from('campaigns').update({ status: 'sent', finished_at: new Date().toISOString() }).eq('id', campaignId).eq('status', 'sending');
    return { sent: 0, failed: 0, limited: false, done: true };
  }

  // Re-check consent right before sending: someone may have unsubscribed since the campaign started.
  const ids = queued.map((q) => q.contact_id).filter(Boolean);
  const [{ data: contacts }, { data: supp }] = await Promise.all([
    db.from('contacts').select('*, properties(address)').in('id', ids),
    db.from('email_suppressions').select('email').in('email', queued.map((q) => q.email.toLowerCase())),
  ]);
  const byId = new Map((contacts as ContactRow[] ?? []).map((c) => [c.id, c]));
  const suppressed = new Set((supp ?? []).map((s) => s.email));
  const { from, replyTo } = fromAddress(sender.display_name || sender.email, sender.email);

  const ready: { send: (typeof queued)[number]; payload: Record<string, unknown> }[] = [];
  for (const q of queued) {
    const c = q.contact_id ? byId.get(q.contact_id) ?? null : null;
    const why = c ? exclusionReason(c, suppressed) : 'contact deleted';
    if (why) {
      await db.from('campaign_sends').update({ status: 'skipped', error: why }).eq('id', q.id);
      continue;
    }
    const msg = render({
      subject: campaign.subject,
      body: campaign.body,
      signature: sender.signature ?? '',
      org: org!,
      values: mergeValues(c, sender.display_name || sender.email),
      unsubUrl: unsubscribePageUrl(q.unsub_token),
    });
    ready.push({
      send: q,
      payload: {
        from,
        reply_to: replyTo,
        to: [q.email],
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
        headers: { 'List-Unsubscribe': `<${oneClickUrl(q.unsub_token)}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        tags: [{ name: 'campaign', value: campaignId.replace(/-/g, '_') }],
      },
    });
  }
  if (!ready.length) return processQueued(db, campaignId, max);

  const res = await fetch('https://api.resend.com/emails/batch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(ready.map((r) => r.payload)),
  });
  const body = await res.json().catch(() => ({}));
  if (res.status === 429) return { sent: 0, failed: 0, limited: true, done: false };
  if (!res.ok) {
    const error = body.message ?? `Resend error ${res.status}`;
    await db.from('campaign_sends').update({ status: 'failed', error }).in('id', ready.map((r) => r.send.id));
    return { sent: 0, failed: ready.length, limited: false, done: false };
  }

  const now = new Date().toISOString();
  const results: { id: string }[] = body.data ?? [];
  await Promise.all(
    ready.map((r, i) =>
      db.from('campaign_sends').update({ status: 'sent', resend_id: results[i]?.id ?? null, sent_at: now, error: null }).eq('id', r.send.id),
    ),
  );
  await db.from('activities').insert(
    ready.map((r) => ({ contact_id: r.send.contact_id, kind: 'campaign_sent', body: `Campaign “${campaign.name}”: ${r.payload.subject}`, created_by: campaign.sender_id })),
  );
  return { sent: ready.length, failed: 0, limited: false, done: false };
}
