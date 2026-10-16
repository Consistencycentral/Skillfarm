-- SkillFarm compatibility: restore the public review projection used by the client.
-- Safe to re-run. This does not expose the profiles table itself.
create or replace view public.public_course_reviews
with (security_invoker = false) as
select
  r.id,
  r.course_id,
  r.learner_id,
  r.rating,
  r.body,
  r.created_at,
  p.full_name as learner_name,
  rr.id as reply_id,
  rr.review_id as reply_review_id,
  rr.partner_id as reply_partner_id,
  rr.body as reply_body,
  rr.created_at as reply_created_at
from public.reviews r
left join public.profiles p on p.id = r.learner_id
left join public.review_replies rr on rr.review_id = r.id;

grant select on public.public_course_reviews to anon, authenticated;
