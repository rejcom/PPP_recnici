-- =====================================================
-- FIX: Přidání chybějících INSERT políc pro registraci
-- Spusťte v Supabase → SQL Editor → New query → Run
-- =====================================================

-- 1. Povolit autentizovaným uživatelům vytvořit instituci
CREATE POLICY "Authenticated users can insert institutions" ON institutions
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 2. Povolit uživatelům vytvořit svůj vlastní profil profesionála
CREATE POLICY "Users can insert own professional profile" ON professionals
    FOR INSERT WITH CHECK (auth_user_id = auth.uid());

-- 3. Povolit uživatelům vidět svůj vlastní profil (i bez institution_id)
CREATE POLICY "Users can view own profile" ON professionals
    FOR SELECT USING (auth_user_id = auth.uid());
