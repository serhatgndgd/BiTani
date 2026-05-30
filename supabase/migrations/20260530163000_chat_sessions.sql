-- ─────────────────────────────────────────────────────────────────────────────
-- chat_history: Session-based conversation history
--
-- Adds Claude-style conversation grouping without changing existing row-per-
-- message storage, RLS policies, or message content semantics.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.chat_history
  ADD COLUMN IF NOT EXISTS session_id uuid DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_chat_history_session
  ON public.chat_history (session_id);

CREATE INDEX IF NOT EXISTS idx_chat_history_user_updated
  ON public.chat_history (user_id, updated_at DESC);
