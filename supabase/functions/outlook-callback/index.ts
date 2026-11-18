// Microsoft redirects here after someone approves "Connect Outlook". Stores their encrypted
// refresh token and sends them back to Hub's Settings page.
import { encrypt, verifyState } from '../_shared/crypto.ts';
import { graph, redeemCode } from '../_shared/microsoft.ts';
import { adminClient } from '../_shared/supabase.ts';

function back(ret: string | null, result: string) {
  const fallback = (Deno.env.get('APP_ORIGINS') ?? '').split(',')[0]?.trim() + '/settings';
  const u = new URL(ret ?? fallback);
  u.searchParams.set('outlook', result);
  return Response.redirect(u.toString(), 302);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const stateParam = url.searchParams.get('state') ?? '';
  let ret: string | null = null;
  try {
    const state = await verifyState<{ uid: string; ret: string; exp: number }>(stateParam);
    ret = state.ret;
    const msError = url.searchParams.get('error_description') ?? url.searchParams.get('error');
    if (msError) return back(ret, `error:${msError.split('\r\n')[0].slice(0, 200)}`);
    const code = url.searchParams.get('code');
    if (!code) return back(ret, 'error:Microsoft did not return a code');

    const tokens = await redeemCode(code);
    if (!tokens.refresh_token) return back(ret, 'error:Microsoft did not allow offline access');
    const me = await graph<{ mail?: string; userPrincipalName: string; displayName?: string }>(tokens.access_token, '/me?$select=mail,userPrincipalName,displayName');

    const { error } = await adminClient().from('outlook_connections').upsert({
      user_id: state.uid,
      mailbox: (me.mail ?? me.userPrincipalName).toLowerCase(),
      display_name: me.displayName ?? '',
      refresh_token: await encrypt(tokens.refresh_token),
      scopes: tokens.scope,
      connected_at: new Date().toISOString(),
      last_error: null,
    });
    if (error) throw error;
    return back(ret, 'connected');
  } catch (e) {
    console.error(e);
    return back(ret, `error:${e instanceof Error ? e.message : 'Could not connect Outlook'}`);
  }
});
