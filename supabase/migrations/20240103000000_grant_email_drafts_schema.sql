-- Grant PostgREST roles access to the email_drafts schema
-- Without this, supabase-js inserts/selects silently fail (schema invisible to service_role)

GRANT USAGE ON SCHEMA email_drafts TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA email_drafts TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA email_drafts TO service_role;

-- Ensure future tables in this schema are also accessible
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA email_drafts
  GRANT ALL ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA email_drafts
  GRANT ALL ON SEQUENCES TO service_role;

-- Reload PostgREST schema cache so it picks up the email_drafts schema
NOTIFY pgrst, 'reload schema';
