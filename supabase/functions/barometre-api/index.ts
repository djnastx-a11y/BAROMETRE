import { createClient } from 'npm:@supabase/supabase-js@2'

const ALLOWED_ORIGINS = new Set(['https://djnastx-a11y.github.io'])

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

  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return bytesToHex(new Uint8Array(digest))
}

async function sessionUser(req: Request, supabase: ReturnType<typeof adminClient>) {
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
  if (!/^[a-f0-9]{64}$/i.test(token)) return null

  const tokenHash = await sha256(token)
  const now = new Date().toISOString()

  const { data: session, error: sessionError } = await supabase
    .from('barometre_sessions')
    .select('user_id,expires_at,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (sessionError || !session || session.revoked_at || session.expires_at <= now) return null

  const { data: user, error: userError } = await supabase
    .from('barometre_users')
    .select('id,name,role,active')
    .eq('id', session.user_id)
    .maybeSingle()

  if (userError || !user?.active) return null

  await supabase.from('barometre_sessions').update({ last_seen_at: now }).eq('token_hash', tokenHash)
  return user
}

function isAdmin(user: any) { return user?.role === 'admin' }
function canWriteStock(user: any) { return user && (user.role === 'admin' || user.role === 'employee') }

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { message: 'Méthode non autorisée.' }, 405)

  const origin = req.headers.get('origin') || ''
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(req, { message: 'Origine non autorisée.' }, 403)

  const supabase = adminClient()
  const user = await sessionUser(req, supabase)
  if (!user) return json(req, { message: 'Session invalide ou expirée.' }, 401)

  try {
    const body = await req.json().catch(() => null)
    const action = String(body?.action || '')
    const payload = body?.payload || {}

    if (action === 'bootstrap') {
      const [{ data: users, error: usersError }, { data: shifts, error: shiftsError }, { data: stock, error: stockError }] = await Promise.all([
        supabase.from('barometre_users').select('id,name,role,active').order('name'),
        supabase.from('barometre_shifts').select('id,user_id,shift_date,start_time,end_time,type,note').order('shift_date').order('start_time'),
        supabase.from('barometre_stock').select('id,name,category,unit,qty,min_qty,supplier,buy_price,active').eq('active', true).order('name'),
      ])
      if (usersError || shiftsError || stockError) throw usersError || shiftsError || stockError

      let requestQuery = supabase.from('barometre_requests').select('id,user_id,kind,request_date,note,status').order('request_date', { ascending: false })
      if (!isAdmin(user)) requestQuery = requestQuery.eq('user_id', user.id)
      const { data: requests, error: requestsError } = await requestQuery
      if (requestsError) throw requestsError

      return json(req, { user, users, shifts, stock, requests })
    }

    if (action === 'save_shift') {
      if (!isAdmin(user)) return json(req, { message: 'Accès refusé.' }, 403)
      const id = String(payload.id || crypto.randomUUID())
      const row = {
        id,
        user_id: String(payload.userId || ''),
        shift_date: String(payload.date || ''),
        start_time: payload.start || null,
        end_time: payload.end || null,
        type: String(payload.type || 'work'),
        note: String(payload.note || ''),
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('barometre_shifts').upsert(row, { onConflict: 'id' })
      if (error) throw error
      return json(req, { ok: true, id })
    }

    if (action === 'save_product') {
      if (!isAdmin(user)) return json(req, { message: 'Accès refusé.' }, 403)
      const id = String(payload.id || crypto.randomUUID())
      const row = {
        id,
        name: String(payload.name || '').trim(),
        category: String(payload.category || ''),
        unit: String(payload.unit || 'unités'),
        qty: Number(payload.qty || 0),
        min_qty: Number(payload.min || 0),
        supplier: String(payload.supplier || 'AUTRE'),
        buy_price: Number(payload.buy || 0),
        active: true,
        created_by: user.id,
        updated_at: new Date().toISOString(),
      }
      if (!row.name) return json(req, { message: 'Produit obligatoire.' }, 400)
      const { error } = await supabase.from('barometre_stock').upsert(row, { onConflict: 'id' })
      if (error) throw error
      return json(req, { ok: true, id })
    }

    if (action === 'adjust_stock') {
      if (!canWriteStock(user)) return json(req, { message: 'Accès refusé.' }, 403)
      const productId = String(payload.productId || '')
      const nextQty = Number(payload.qty)
      const reason = String(payload.reason || 'Inventaire')
      if (!productId || !Number.isFinite(nextQty) || nextQty < 0) return json(req, { message: 'Quantité invalide.' }, 400)

      const { data: current, error: readError } = await supabase.from('barometre_stock').select('qty').eq('id', productId).maybeSingle()
      if (readError || !current) return json(req, { message: 'Produit introuvable.' }, 404)

      const before = Number(current.qty)
      const { error: updateError } = await supabase.from('barometre_stock').update({ qty: nextQty, updated_at: new Date().toISOString() }).eq('id', productId)
      if (updateError) throw updateError

      const { error: logError } = await supabase.from('barometre_stock_log').insert({
        product_id: productId,
        qty_before: before,
        qty_after: nextQty,
        reason,
        user_id: user.id,
      })
      if (logError) throw logError
      return json(req, { ok: true })
    }

    if (action === 'save_request') {
      const id = String(payload.id || crypto.randomUUID())
      const targetUserId = isAdmin(user) && payload.userId ? String(payload.userId) : user.id
      const row = {
        id,
        user_id: targetUserId,
        kind: String(payload.kind || '').trim(),
        request_date: String(payload.date || ''),
        note: String(payload.note || ''),
        status: isAdmin(user) ? 'accepted' : 'pending',
        updated_at: new Date().toISOString(),
      }
      if (!row.kind || !row.request_date) return json(req, { message: 'Demande incomplète.' }, 400)
      const { error } = await supabase.from('barometre_requests').upsert(row, { onConflict: 'id' })
      if (error) throw error
      return json(req, { ok: true, id })
    }

    if (action === 'logout') {
      const auth = req.headers.get('authorization') || ''
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : ''
      if (/^[a-f0-9]{64}$/i.test(token)) {
        const tokenHash = await sha256(token)
        await supabase.from('barometre_sessions').update({ revoked_at: new Date().toISOString() }).eq('token_hash', tokenHash)
      }
      return json(req, { ok: true })
    }

    return json(req, { message: 'Action inconnue.' }, 400)
  } catch (error) {
    console.error('barometre-api', error)
    return json(req, { message: 'Service temporairement indisponible.' }, 500)
  }
})
