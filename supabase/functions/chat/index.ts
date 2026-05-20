import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Profile {
  full_name: string | null
  birth_date: string | null
  gender: string | null
  height_cm: number | null
  weight_kg: number | null
}

interface ApiMessage {
  role: 'user' | 'assistant'
  content: string
}

function computeAge(birthDate: string | null): string {
  if (!birthDate) return 'belirtilmemiş'
  const birth = new Date(birthDate)
  if (isNaN(birth.getTime())) return 'belirtilmemiş'
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return `${age} yaşında`
}

function genderTr(gender: string | null): string {
  if (gender === 'male') return 'erkek'
  if (gender === 'female') return 'kadın'
  return 'belirtilmemiş'
}

function buildSystemPrompt(
  profile: Profile | null,
  conditions: string[],
  medications: string[],
): string {
  const name = profile?.full_name ?? 'Kullanıcı'
  const age = computeAge(profile?.birth_date ?? null)
  const gender = genderTr(profile?.gender ?? null)
  const height = profile?.height_cm != null ? `${profile.height_cm} cm` : 'belirtilmemiş'
  const weight = profile?.weight_kg != null ? `${profile.weight_kg} kg` : 'belirtilmemiş'
  const conditionsList = conditions.length > 0 ? conditions.join(', ') : 'yok'
  const medicationsList = medications.length > 0 ? medications.join(', ') : 'yok'

  return `Sen BiTanı uygulamasının Türkçe sağlık asistanısın. Kullanıcıyla samimi, sıcak ve anlayışlı bir dille konuşursun. Sağlık konularında genel bilgi ve rehberlik sağlarsın.

ÖNEMLİ KISITLAMALAR:
- Kesinlikle doktor değilsin; tıbbi tanı koymaz, ilaç reçete etmez veya mevcut tedaviyi değiştirmeyi önermezsin.
- Acil durumlarda her zaman 112'yi veya en yakın sağlık kuruluşunu yönlendirirsin.
- Gerektiğinde mutlaka bir doktora başvurmasını hatırlatırsın.
- Yanıtlarını kısa, anlaşılır ve Türkçe tut.

Kullanıcı Profili:
- Ad: ${name}
- Yaş: ${age}
- Cinsiyet: ${gender}
- Boy: ${height}
- Kilo: ${weight}
- Kronik hastalıklar: ${conditionsList}
- Düzenli kullandığı ilaçlar: ${medicationsList}

Bu profil bilgilerini dikkate alarak kişiselleştirilmiş ve güvenli sağlık rehberliği sun.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages, userId } = (await req.json()) as {
      messages: ApiMessage[]
      userId: string
    }

    if (!Array.isArray(messages) || !userId) {
      return new Response(
        JSON.stringify({ error: 'messages ve userId gerekli' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    const [profileRes, condRes, medRes] = await Promise.all([
      supabaseAdmin
        .from('profiles')
        .select('full_name, birth_date, gender, height_cm, weight_kg')
        .eq('id', userId)
        .maybeSingle(),
      supabaseAdmin
        .from('user_conditions')
        .select('conditions_catalog(name)')
        .eq('user_id', userId),
      supabaseAdmin
        .from('user_medications')
        .select('dosage, medications(ilac_adi)')
        .eq('user_id', userId),
    ])

    const profile = profileRes.data as Profile | null

    type CondRow = { conditions_catalog: { name: string } | null }
    const conditions = ((condRes.data ?? []) as CondRow[])
      .map((r) => r.conditions_catalog?.name)
      .filter((n): n is string => !!n)

    type MedRow = { dosage: string | null; medications: { ilac_adi: string } | null }
    const medications = ((medRes.data ?? []) as MedRow[])
      .map((r) => {
        const name = r.medications?.ilac_adi
        if (!name) return null
        return r.dosage ? `${name} (${r.dosage})` : name
      })
      .filter((n): n is string => !!n)

    const groqKey = Deno.env.get('GROQ_API_KEY')
    if (!groqKey) {
      return new Response(
        JSON.stringify({ error: 'GROQ_API_KEY yapılandırılmamış' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const groqRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: 1024,
        messages: [
          { role: 'system', content: buildSystemPrompt(profile, conditions, medications) },
          ...messages,
        ],
      }),
    })

    if (!groqRes.ok) {
      const errData = await groqRes.json()
      return new Response(
        JSON.stringify({ error: errData.error?.message ?? `Groq hatası: ${groqRes.status}` }),
        { status: groqRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const groqData = await groqRes.json()
    const reply: string = groqData.choices?.[0]?.message?.content ?? ''

    if (!reply) {
      return new Response(
        JSON.stringify({ error: 'Groq boş yanıt döndürdü' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ reply }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Bilinmeyen hata'
    return new Response(
      JSON.stringify({ error: message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
