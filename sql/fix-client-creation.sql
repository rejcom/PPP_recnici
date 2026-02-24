-- =====================================================
-- FIX: Oprava RLS pro vytváření klientů
-- Spusťte v Supabase → SQL Editor → New query → Run
-- =====================================================

-- 1. Ověřit, že funkce get_user_institution_id existuje
CREATE OR REPLACE FUNCTION get_user_institution_id()
RETURNS UUID AS $$
    SELECT institution_id FROM professionals WHERE auth_user_id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- 2. Smazat a znovu vytvořit policies pro clients
-- (DROP IF EXISTS zabrání chybě, pokud policy neexistuje)
DROP POLICY IF EXISTS "View clients in own institution" ON clients;
DROP POLICY IF EXISTS "Insert clients in own institution" ON clients;
DROP POLICY IF EXISTS "Update clients in own institution" ON clients;

CREATE POLICY "View clients in own institution" ON clients
    FOR SELECT USING (institution_id = get_user_institution_id());

CREATE POLICY "Insert clients in own institution" ON clients
    FOR INSERT WITH CHECK (institution_id = get_user_institution_id());

CREATE POLICY "Update clients in own institution" ON clients
    FOR UPDATE USING (institution_id = get_user_institution_id());

-- 3. Zajistit policies pro professionals
DROP POLICY IF EXISTS "Users can view own profile" ON professionals;
DROP POLICY IF EXISTS "Professionals can view own institution" ON professionals;
DROP POLICY IF EXISTS "Users can insert own professional profile" ON professionals;
DROP POLICY IF EXISTS "Professionals can update self" ON professionals;

CREATE POLICY "Users can view own profile" ON professionals
    FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "Professionals can view own institution" ON professionals
    FOR SELECT USING (institution_id = get_user_institution_id());

CREATE POLICY "Users can insert own professional profile" ON professionals
    FOR INSERT WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Professionals can update self" ON professionals
    FOR UPDATE USING (auth_user_id = auth.uid());

-- 4. Zajistit policies pro institutions
DROP POLICY IF EXISTS "View own institution" ON institutions;
DROP POLICY IF EXISTS "Authenticated users can insert institutions" ON institutions;

CREATE POLICY "View own institution" ON institutions
    FOR SELECT USING (id = get_user_institution_id());

CREATE POLICY "Authenticated users can insert institutions" ON institutions
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 5. Zajistit policies pro sessions
DROP POLICY IF EXISTS "View sessions in own institution" ON sessions;
DROP POLICY IF EXISTS "Insert sessions in own institution" ON sessions;
DROP POLICY IF EXISTS "Update sessions in own institution" ON sessions;

CREATE POLICY "View sessions in own institution" ON sessions
    FOR SELECT USING (institution_id = get_user_institution_id());

CREATE POLICY "Insert sessions in own institution" ON sessions
    FOR INSERT WITH CHECK (institution_id = get_user_institution_id());

CREATE POLICY "Update sessions in own institution" ON sessions
    FOR UPDATE USING (institution_id = get_user_institution_id());

-- 6. Ověřit, že RLS je zapnutý
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_notes ENABLE ROW LEVEL SECURITY;
