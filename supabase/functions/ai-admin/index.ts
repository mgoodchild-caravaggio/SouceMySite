// Ask Hub settings, for admins: store or remove the Anthropic API key, switch Ask Hub on or off,
// and set the monthly spend cap. The key is encrypted and never sent back to the browser.
import { Anthropic, loadSettings } from '../_shared/ai.ts';
import { encrypt } from '../_shared/crypto.ts';
import { adminClient, HttpError, jsonHandler, requireUser } from '../_shared/supabase.ts';

Deno.serve(
  jsonHandler(async (req) => {
    const user = await requireUser(req);
    const db = adminClient();
    const { data: profile } = await db.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') throw new HttpError(403, 'Only an admin can change Ask Hub settings.');
    const b = await req.json().catch(() => ({}));

    switch (b.action) {
      case 'set_key': {
        const apiKey = String(b.apiKey ?? '').trim();
        if (!/^sk-ant-[\w-]{20,}$/.test(apiKey)) throw new HttpError(400, 'That doesn’t look like an Anthropic API key (it starts with sk-ant-).');
        // Check the key works before storing it. Listing models is free.
        try {
          await new Anthropic({ apiKey, maxRetries: 1 }).models.list({ limit: 1 });
        } catch (e) {
          if (e instanceof Anthropic.AuthenticationError) throw new HttpError(400, 'Anthropic rejected that key. Check it was copied in full.');
          if (e instanceof Anthropic.PermissionDeniedError) throw new HttpError(400, 'That key isn’t allowed to use the API. Check its workspace in the Anthropic Console.');
          throw new HttpError(502, 'Couldn’t reach Anthropic to check the key. Try again in a minute.');
        }
        const { error } = await db.from('ai_secrets').upsert({ id: true, api_key_enc: await encrypt(apiKey) });
        if (error) throw new Error(error.message);
        await db.from('ai_settings').update({ key_set: true, key_hint: apiKey.slice(-4), updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', true);
        break;
      }
      case 'remove_key': {
        await db.from('ai_secrets').delete().eq('id', true);
        await db.from('ai_settings').update({ key_set: false, key_hint: '', enabled: false, updated_by: user.id, updated_at: new Date().toISOString() }).eq('id', true);
        break;
      }
      case 'update': {
        const patch: Record<string, unknown> = { updated_by: user.id, updated_at: new Date().toISOString() };
        if (typeof b.enabled === 'boolean') {
          if (b.enabled && !(await loadSettings(db)).key_set) throw new HttpError(400, 'Add an Anthropic API key first.');
          patch.enabled = b.enabled;
        }
        if (b.monthlyCapUsd !== undefined) {
          const cap = Number(b.monthlyCapUsd);
          if (!Number.isFinite(cap) || cap < 0 || cap > 10_000) throw new HttpError(400, 'Set a monthly cap between $0 and $10,000.');
          patch.monthly_cap_usd = Math.round(cap * 100) / 100;
        }
        const { error } = await db.from('ai_settings').update(patch).eq('id', true);
        if (error) throw new Error(error.message);
        break;
      }
      default:
        throw new HttpError(400, 'Unknown action');
    }
    const s = await loadSettings(db);
    return { enabled: s.enabled, monthlyCapUsd: s.monthly_cap_usd, keySet: s.key_set, keyHint: s.key_hint, model: s.model };
  }),
);
