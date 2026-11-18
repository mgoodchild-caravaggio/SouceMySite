// Sends a one-off email to a contact from the signed-in person's own Outlook mailbox
// (so it appears in their Sent Items and replies come back to them), then logs it on the contact.
import { graph, graphToken } from '../_shared/microsoft.ts';
import { adminClient, HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
// Plain text → simple HTML: escape, keep line breaks, and make web addresses clickable.
const toHtml = (text: string) =>
  esc(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, '<br>');

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const b = await req.json().catch(() => ({}));
    const subject = String(b.subject ?? '').trim().slice(0, 250);
    const body = String(b.body ?? '').trim().slice(0, 20_000);
    if (!subject) throw new HttpError(400, 'Add a subject');
    if (!body) throw new HttpError(400, 'Write a message');

    const db = adminClient();
    const { data: contact } = await db.from('contacts').select('id, first_name, last_name, email, archived_at').eq('id', String(b.contactId)).maybeSingle();
    if (!contact || contact.archived_at) throw new HttpError(404, 'Contact not found');
    if (!contact.email) throw new HttpError(400, 'This contact has no email address');

    // People on the do-not-email list asked not to get marketing; a one-off message needs a deliberate confirm.
    const { data: suppressed } = await db.from('email_suppressions').select('reason').eq('email', contact.email.toLowerCase()).maybeSingle();
    if (suppressed && !b.confirmSuppressed) {
      throw new HttpError(409, `${contact.email} is on the do-not-email list (${suppressed.reason}). Only send if this is a personal message about a specific deal.`);
    }

    const { data: profile } = await db.from('profiles').select('signature').eq('id', user.id).single();
    const signature = (profile?.signature ?? '').trim();
    const html = `<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5">${toHtml(body)}${
      signature ? `<br><br>${toHtml(signature)}` : ''
    }</div>`;

    const token = await graphToken(user.id);
    await graph(token, '/me/sendMail', {
      method: 'POST',
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: [{ emailAddress: { address: contact.email, name: `${contact.first_name} ${contact.last_name}`.trim() } }],
        },
        saveToSentItems: true,
      }),
    });

    const { data: activity } = await db
      .from('activities')
      .insert({ contact_id: contact.id, kind: 'email', body: `${subject}\n\n${body}`, created_by: user.id })
      .select('id, occurred_at')
      .single();
    return { ok: true, activity };
  }),
);
