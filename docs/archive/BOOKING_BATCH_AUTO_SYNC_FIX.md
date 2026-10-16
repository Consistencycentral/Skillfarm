# Booking batch auto-sync fix

Learner course detail now retries the server-side `ensure_learner_batch` compatibility RPC when a course has no batch rows. If the RPC is deployed, an older Learning Partner course with published event fields is materialized as a real Batch 1, then the normal 40-seat theatre seat map loads from `public.batches`.

This does not create local/fake seats. If the RPC/migrations are not deployed in the client's Supabase project, the app will still show the publish/refresh state and the client must deploy the included migrations.
