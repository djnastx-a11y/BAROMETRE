import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = new Set([
  'https://djnastx-a11y.github.io',
])

const SESSION_HOURS = 12
const MAX_FAILURES = 5
const LOCK_MINUTES = 15

function cors(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin) ? origin : 'https://djnastx-a11y.github.io',
    'Access-Control-Allow-Headers': 'content-type, authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

function newToken() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

function adminClient() {
  const url = Deno.env.get('SUPABASE_URL')
  if (!url) throw new Error('Missing SUPABASE_URL')

  let key = ''
  const modern = Deno.env.get('SUPABASE_SECRET_KEYS')
  if (modern) {
    try { key = JSON.parse(modern)?.default || '' } catch {}
  }
  key ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
  if (!key) throw new Error('Missing Supabase server key')

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { message: 'Méthode non autorisée.' }, 405)

  const origin = req.headers.get('origin') || ''
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return json(req, { message: 'Origine non autorisée.' }, 403)
  }

  try {
    const body = await req.json().catch(() => null)
    const userId = String(body?.userId || '').trim().toLowerCase()
    const pin = String(body?.pin || '').trim()

    if (!['max', 'charlotte', 'amaury', 'extra1'].includes(userId) || !/^\d{4}$/.test(pin)) {
      return json(req, { message: 'Code incorrect.' }, 401)
    }

    const supabase = adminClient()
    const now = new Date()

    const { data: guard, error: guardError } = await supabase
      .from('barometre_login_guard')
      .select('failures,locked_until')
      .eq('user_id', userId)
      .maybeSingle()

    if (guardError) throw guardError

    if (guard?.locked_until) {
      const lockedUntil = new Date(guard.locked_until)
      if (lockedUntil > now) {
        const retryAfter = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000))
        return json(req, { message: 'Trop de tentatives. Réessaie dans quelques minutes.', retryAfter }, 429)
      }
    }

    const { data: verified, error: verifyError } = await supabase
      .rpc('barometre_verify_pin', { p_user_id: userId, p_pin: pin })

    if (verifyError) throw verifyError

    const user = Array.isArray(verified) ? verified[0] : null

    if (!user) {
      const failures = Number(guard?.failures || 0) + 1
      const shouldLock = failures >= MAX_FAILURES
      const lockedUntil = shouldLock
        ? new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString()
        : null

      const { error: updateGuardError } = await supabase
        .from('barometre_login_guard')
        .upsert({
          user_id: userId,
          failures: shouldLock ? 0 : failures,
          locked_until: lockedUntil,
          updated_at: now.toISOString(),
        }, { onConflict: 'user_id' })

      if (updateGuardError) throw updateGuardError

      await supabase.from('barometre_audit_log').insert({
        user_id: userId,
        action: shouldLock ? 'login_locked' : 'login_failed',
        details: { failures: shouldLock ? MAX_FAILURES : failures },
      })

      return json(req, {
        message: shouldLock
          ? 'Trop de tentatives. Compte temporairement verrouillé.'
          : 'Code incorrect.',
      }, shouldLock ? 429 : 401)
    }

    const token = newToken()
    const tokenHash = await sha256(token)
    const expiresAt = new Date(now.getTime() + SESSION_HOURS * 60 * 60_000)

    const { error: sessionError } = await supabase.from('barometre_sessions').insert({
      token_hash: tokenHash,
      user_id: user.id,
      expires_at: expiresAt.toISOString(),
      last_seen_at: now.toISOString(),
    })
    if (sessionError) throw sessionError

    await supabase
      .from('barometre_login_guard')
      .upsert({ user_id: user.id, failures: 0, locked_until: null, updated_at: now.toISOString() }, { onConflict: 'user_id' })

    await supabase.from('barometre_audit_log').insert({
      user_id: user.id,
      action: 'login_success',
      details: {},
    })

    return json(req, {
      token,
      user: { id: user.id, name: user.name, role: user.role },
      expiresAt: expiresAt.toISOString(),
    })
  } catch (error) {
    console.error('barometre-auth', error)
    return json(req, { message: 'Connexion temporairement indisponible.' }, 500)
  }
})
