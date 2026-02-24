-- =====================================================
-- PPP Platform - Supabase PostgreSQL Schema
-- Databáze pro pedagogicko-psychologické poradny
-- =====================================================

-- 1. INSTITUCE (PPP poradny, školy apod.)
CREATE TABLE institutions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('ppp', 'skola', 'spc', 'jina')),
    address TEXT,
    city TEXT,
    zip TEXT,
    phone TEXT,
    email TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. PSYCHOLOGOVÉ / PRACOVNÍCI
CREATE TABLE professionals (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    auth_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('psycholog', 'etoped', 'logoped', 'specialni_pedagog', 'socialní_pracovnik', 'admin')),
    email TEXT UNIQUE NOT NULL,
    phone TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. KLIENTI (žáci / studenti)
CREATE TABLE clients (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    birth_date DATE,
    gender TEXT CHECK (gender IN ('M', 'F', 'other')),
    school_name TEXT,
    school_class TEXT,
    parent_name TEXT,
    parent_phone TEXT,
    parent_email TEXT,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. SEZENÍ / SCHŮZKY
CREATE TABLE sessions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,
    institution_id UUID REFERENCES institutions(id) ON DELETE SET NULL,
    session_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    session_type TEXT NOT NULL CHECK (session_type IN ('prvni', 'nasledna', 'kontrola', 'diagnostika', 'intervence')),
    duration_minutes INTEGER,
    -- Strukturovaný zápis (AI generovaný + upravený)
    anamneza TEXT,
    pozorovani TEXT,
    metody TEXT,
    zavery TEXT,
    doporuceni TEXT,
    poznamky TEXT,
    -- Surový přepis
    transcript TEXT,
    -- Metadata
    ai_generated BOOLEAN DEFAULT FALSE,
    ai_model TEXT,
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'final', 'archived')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. DOKUMENTY (Word soubory, PDF, přílohy)
CREATE TABLE documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    session_id UUID REFERENCES sessions(id) ON DELETE CASCADE,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,
    file_name TEXT NOT NULL,
    file_type TEXT NOT NULL, -- 'application/msword', 'application/pdf', etc.
    file_size INTEGER,
    storage_path TEXT NOT NULL, -- cesta v Supabase Storage
    version INTEGER DEFAULT 1,
    is_latest BOOLEAN DEFAULT TRUE,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. HODNOCENÍ POKROKU (sledování vývoje žáka v čase)
CREATE TABLE progress_notes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    session_id UUID REFERENCES sessions(id) ON DELETE SET NULL,
    professional_id UUID REFERENCES professionals(id) ON DELETE SET NULL,
    category TEXT NOT NULL CHECK (category IN (
        'chovani', 'soustredeni', 'matematika', 'cteni', 'psani',
        'komunikace', 'socialni_dovednosti', 'emoce', 'motorika', 'jine'
    )),
    rating INTEGER CHECK (rating >= 1 AND rating <= 5), -- 1=velmi špatné, 5=výborné
    description TEXT,
    noted_at TIMESTAMPTZ DEFAULT NOW()
);

-- =====================================================
-- INDEXY pro výkon
-- =====================================================
CREATE INDEX idx_professionals_institution ON professionals(institution_id);
CREATE INDEX idx_professionals_auth ON professionals(auth_user_id);
CREATE INDEX idx_clients_institution ON clients(institution_id);
CREATE INDEX idx_clients_name ON clients(last_name, first_name);
CREATE INDEX idx_sessions_client ON sessions(client_id);
CREATE INDEX idx_sessions_professional ON sessions(professional_id);
CREATE INDEX idx_sessions_date ON sessions(session_date DESC);
CREATE INDEX idx_documents_client ON documents(client_id);
CREATE INDEX idx_documents_session ON documents(session_id);
CREATE INDEX idx_progress_client ON progress_notes(client_id);
CREATE INDEX idx_progress_category ON progress_notes(client_id, category);

-- =====================================================
-- ROW LEVEL SECURITY (RLS)
-- Každá instituce vidí pouze svá data
-- =====================================================
ALTER TABLE institutions ENABLE ROW LEVEL SECURITY;
ALTER TABLE professionals ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE progress_notes ENABLE ROW LEVEL SECURITY;

-- Pomocná funkce: získat institution_id přihlášeného uživatele
CREATE OR REPLACE FUNCTION get_user_institution_id()
RETURNS UUID AS $$
    SELECT institution_id FROM professionals WHERE auth_user_id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;

-- Policies: professionals
CREATE POLICY "Professionals can view own institution" ON professionals
    FOR SELECT USING (institution_id = get_user_institution_id());

CREATE POLICY "Users can view own profile" ON professionals
    FOR SELECT USING (auth_user_id = auth.uid());

CREATE POLICY "Users can insert own professional profile" ON professionals
    FOR INSERT WITH CHECK (auth_user_id = auth.uid());

CREATE POLICY "Professionals can update self" ON professionals
    FOR UPDATE USING (auth_user_id = auth.uid());

-- Policies: clients
CREATE POLICY "View clients in own institution" ON clients
    FOR SELECT USING (institution_id = get_user_institution_id());

CREATE POLICY "Insert clients in own institution" ON clients
    FOR INSERT WITH CHECK (institution_id = get_user_institution_id());

CREATE POLICY "Update clients in own institution" ON clients
    FOR UPDATE USING (institution_id = get_user_institution_id());

-- Policies: sessions
CREATE POLICY "View sessions in own institution" ON sessions
    FOR SELECT USING (institution_id = get_user_institution_id());

CREATE POLICY "Insert sessions in own institution" ON sessions
    FOR INSERT WITH CHECK (institution_id = get_user_institution_id());

CREATE POLICY "Update sessions in own institution" ON sessions
    FOR UPDATE USING (institution_id = get_user_institution_id());

-- Policies: documents
CREATE POLICY "View documents for own clients" ON documents
    FOR SELECT USING (client_id IN (SELECT id FROM clients WHERE institution_id = get_user_institution_id()));

CREATE POLICY "Insert documents for own clients" ON documents
    FOR INSERT WITH CHECK (client_id IN (SELECT id FROM clients WHERE institution_id = get_user_institution_id()));

-- Policies: progress_notes
CREATE POLICY "View progress for own clients" ON progress_notes
    FOR SELECT USING (client_id IN (SELECT id FROM clients WHERE institution_id = get_user_institution_id()));

CREATE POLICY "Insert progress for own clients" ON progress_notes
    FOR INSERT WITH CHECK (client_id IN (SELECT id FROM clients WHERE institution_id = get_user_institution_id()));

-- Policies: institutions (users can see their own institution)
CREATE POLICY "View own institution" ON institutions
    FOR SELECT USING (id = get_user_institution_id());

CREATE POLICY "Authenticated users can insert institutions" ON institutions
    FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- =====================================================
-- VIEWS pro snadné dotazy
-- =====================================================

-- Přehled klienta se počtem sezení
CREATE VIEW client_overview AS
SELECT
    c.*,
    COUNT(DISTINCT s.id) AS total_sessions,
    MAX(s.session_date) AS last_session_date,
    MIN(s.session_date) AS first_session_date,
    COUNT(DISTINCT d.id) AS total_documents
FROM clients c
LEFT JOIN sessions s ON s.client_id = c.id
LEFT JOIN documents d ON d.client_id = c.id
GROUP BY c.id;

-- Vývoj klienta v čase
CREATE VIEW client_progress_timeline AS
SELECT
    pn.client_id,
    c.first_name || ' ' || c.last_name AS client_name,
    pn.category,
    pn.rating,
    pn.description,
    pn.noted_at,
    s.session_type,
    p.first_name || ' ' || p.last_name AS professional_name
FROM progress_notes pn
JOIN clients c ON c.id = pn.client_id
LEFT JOIN sessions s ON s.id = pn.session_id
LEFT JOIN professionals p ON p.id = pn.professional_id
ORDER BY pn.client_id, pn.category, pn.noted_at;

-- =====================================================
-- STORAGE BUCKET pro dokumenty
-- (spustit v Supabase Dashboard → Storage → New bucket)
-- =====================================================
-- Bucket name: documents
-- Public: false (private)
-- File size limit: 50MB
-- Allowed MIME types: application/msword, application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/pdf, image/*

-- =====================================================
-- TRIGGER pro automatický updated_at
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_institutions_updated_at BEFORE UPDATE ON institutions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_professionals_updated_at BEFORE UPDATE ON professionals
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_sessions_updated_at BEFORE UPDATE ON sessions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
