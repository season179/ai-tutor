-- Align the seeded reasoning defaults with the single-worker optimization pass.
-- Only rows still on the old defaults are changed; user-selected alternatives are left alone.

UPDATE provider_settings
SET provider = 'openai',
    value = 'gpt-5.4-mini',
    updated_at = CURRENT_TIMESTAMP
WHERE type = 'gate_check_model'
  AND provider = 'openai'
  AND value = 'gpt-5.5';

UPDATE provider_settings
SET provider = 'openrouter',
    value = 'google/gemini-3.5-flash',
    updated_at = CURRENT_TIMESTAMP
WHERE type = 'tutor_model'
  AND provider = 'openrouter'
  AND value = 'nvidia/nemotron-3-ultra-550b-a55b';
