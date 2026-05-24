-- ─────────────────────────────────────────────────────────────────────────────
-- chat_history: Kullanıcı sohbet geçmişi
--
-- Pipeline'a DOKUNMAZ — condition_medications, medications, conditions_catalog
-- tablolarında hiçbir değişiklik yapmaz.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS chat_history (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id    uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  role       text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text        NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Kullanıcı başına mesaj listesi (DESC = en yeni önce)
CREATE INDEX IF NOT EXISTS idx_chat_history_user_created
  ON chat_history (user_id, created_at DESC);

-- RLS
ALTER TABLE chat_history ENABLE ROW LEVEL SECURITY;

-- Her kullanıcı sadece kendi mesajlarını görür / ekleyebilir / silebilir
CREATE POLICY "chat_history_own"
  ON chat_history
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
