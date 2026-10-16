# SkillFarm 1.6.5 repaired v4

- Language selection no longer reads or writes `profiles.preferred_language` at runtime.
- English/Tamil/Hindi preference is stored locally and applied immediately.
- Selecting a language no longer triggers a blocking schema-cache alert.
- Continue routes completed accounts directly to their existing learner/provider area; new accounts go to role selection.
- Login and auth callback use the local language preference instead of requiring the optional profile column.
- Provider course list first reads the provider's own `courses` rows and falls back to `authenticated_courses`, still filtered by the signed-in provider id.
