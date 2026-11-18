// Runs every few minutes (Supabase scheduled job): starts scheduled campaigns that are due and
// keeps sending queued recipients, staying within Resend's limits.
import { processQueued } from '../_shared/campaign.ts';
import { adminClient } from '../_shared/supabase.ts';

Deno.serve(async (req) => {
  if (req.headers.get('x-worker-secret') !== Deno.env.get('WORKER_SECRET')) return new Response('Forbidden', { status: 403 });
  const db = adminClient();
  const now = new Date().toISOString();
  await db.from('campaigns').update({ status: 'sending', started_at: now }).eq('status', 'scheduled').lte('scheduled_for', now);

  const { data: active } = await db.from('campaigns').select('id').eq('status', 'sending').order('started_at');
  const report: Record<string, unknown> = {};
  for (const c of active ?? []) {
    // A few batches per run; stop for this run as soon as Resend says we've hit a limit.
    for (let i = 0; i < 5; i++) {
      const r = await processQueued(db, c.id, 100);
      report[c.id] = r;
      if (r.done || r.limited) break;
    }
    if ((report[c.id] as { limited?: boolean })?.limited) break;
  }
  return Response.json({ ok: true, report });
});
