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

interface ChatHistoryRow {
  role: string
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

Kullanıcı Profili (her mesajda veritabanından anlık çekilir, kesin ve günceldir):
- Ad: ${name}
- Yaş: ${age}
- Cinsiyet: ${gender}
- Boy: ${height}
- Kilo: ${weight}
- Kronik hastalıklar: ${conditionsList}
- Düzenli kullandığı ilaçlar: ${medicationsList}

ZORUNLU KURAL: Kullanıcı ilaçlarını, hastalıklarını veya kişisel bilgilerini sorduğunda YALNIZCA yukarıdaki güncel profil bilgilerini kullan. Konuşma geçmişinde farklı bilgiler geçmiş olsa bile geçmişi değil bu profili esas al.

Bu profil bilgilerini dikkate alarak kişiselleştirilmiş ve güvenli sağlık rehberliği sun.`
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { messages, userId } = (await req.json()) as {
      messages: ApiMessage[]
      userId: string | null | undefined
    }

    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: 'messages gerekli' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    )

    // ── Kullanıcı profili, hastalıklar, ilaçlar ──────────────────────────────
    let profile: Profile | null = null
    let conditions: string[] = []
    let medications: string[] = []

    if (userId) {
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
          .eq('user_id', userId)
          .eq('is_active', true),
      ])

      profile = profileRes.data as Profile | null

      type CondRow = { conditions_catalog: { name: string } | null }
      conditions = ((condRes.data ?? []) as CondRow[])
        .map((r) => r.conditions_catalog?.name)
        .filter((n): n is string => !!n)

      type MedRow = { dosage: string | null; medications: { ilac_adi: string } | null }
      medications = ((medRes.data ?? []) as MedRow[])
        .map((r) => {
          const medName = r.medications?.ilac_adi
          if (!medName) return null
          return r.dosage ? `${medName} (${r.dosage})` : medName
        })
        .filter((n): n is string => !!n)
    }

    // ── chat_history: son 20 mesajı çek ──────────────────────────────────────
    // Strateji: DB geçmişi (önceki oturumlar) + client'ın son mesajı (bu oturum).
    // Client tüm oturum geçmişini gönderir; sadece son elemanı alarak
    // DB geçmişiyle birleştiririz — böylece duplikasyon olmaz.
    let historyMessages: ApiMessage[] = []

    if (userId) {
      try {
        const { data: historyRows } = await supabaseAdmin
          .from('chat_history')
          .select('role, content')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(20)

        if (historyRows && historyRows.length > 0) {
          // DESC'ten ASC'ye çevir (en eski önce → Groq için doğru sıra)
          historyMessages = (historyRows as ChatHistoryRow[])
            .reverse()
            .map((r) => ({
              role: r.role as 'user' | 'assistant',
              content: r.content,
            }))
        }
      } catch {
        // Geçmiş çekilemezse boş array ile devam et
        historyMessages = []
      }
    }

    // ── Groq'a gönderilecek mesaj dizisi ──────────────────────────────────────
    // DB geçmişi + bu oturumun son (yeni) kullanıcı mesajı
    const currentMessage = messages[messages.length - 1]
    const groqMessages: ApiMessage[] = [...historyMessages, currentMessage]

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
          ...groqMessages,
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

    // ── chat_history'e kaydet (user + assistant) ──────────────────────────────
    if (userId) {
      try {
        await supabaseAdmin.from('chat_history').insert([
          { user_id: userId, role: 'user', content: currentMessage.content },
          { user_id: userId, role: 'assistant', content: reply },
        ])
      } catch {
        // Kayıt başarısız olursa asıl cevabı yine de döndür
      }
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
