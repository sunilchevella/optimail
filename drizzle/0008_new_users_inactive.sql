-- A new Supabase login gets a profile that is switched OFF (no access) and has the lowest
-- role. Only an owner/admin can turn it on from Users & access. This keeps the data safe
-- even if public sign-ups are left enabled in Supabase.
CREATE OR REPLACE FUNCTION public.handle_new_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, email, role, is_active)
  VALUES (
    NEW.id,
    coalesce(NEW.raw_user_meta_data ->> 'full_name', split_part(NEW.email, '@', 1)),
    NEW.email,
    'viewer',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;
