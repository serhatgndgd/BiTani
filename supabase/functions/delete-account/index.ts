import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return json({ error: 'method-not-allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    return json({ error: 'server-config-missing' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userError } = await userClient.auth.getUser()

  if (userError || !user?.id) {
    return json({ error: 'unauthorized' }, 401)
  }

  const adminClient = createClient(supabaseUrl, serviceRoleKey)
  const userId = user.id

  const cleanupTables = [
    'chat_history',
    'user_medications',
    'user_conditions',
    'consent_records',
    'rate_limits',
  ]

  for (const table of cleanupTables) {
    const { error } = await adminClient.from(table).delete().eq('user_id', userId)
    if (error && table !== 'rate_limits') {
      console.error('delete-account-cleanup:', { table, error })
      return json({ error: 'cleanup-failed' }, 500)
    }
  }

  const { error: profileError } = await adminClient.from('profiles').delete().eq('id', userId)
  if (profileError) {
    console.error('delete-account-cleanup:', { table: 'profiles', error: profileError })
    return json({ error: 'cleanup-failed' }, 500)
  }

  const { error: deleteError } = await adminClient.auth.admin.deleteUser(userId)
  if (deleteError) {
    console.error('delete-account-auth:', deleteError)
    return json({ error: 'auth-delete-failed' }, 500)
  }

  return json({ ok: true })
})
