# SkillFarm repaired v5

- Profile self-read uses `select(*)` to avoid malformed/stale profile projections.
- Language selection is local-first and never reads `preferred_language` during selection.
- Browse/course detail/provider course list use the canonical `courses` table directly.
- Provider Courses now shows real errors/retry and a cleaner summary UI.
