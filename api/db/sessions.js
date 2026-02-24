// API endpoint: Správa sezení (CRUD) + pokrok klienta
import { getSupabase } from './_supabase.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase(authHeader);

    try {
        // GET - seznam sezení klienta nebo detail sezení
        if (req.method === 'GET') {
            const { id, client_id, limit: queryLimit } = req.query;

            if (id) {
                // Detail sezení
                const { data, error } = await supabase
                    .from('sessions')
                    .select(`*, professionals(first_name, last_name, role)`)
                    .eq('id', id)
                    .single();
                if (error) throw error;
                return res.status(200).json({ data });
            }

            if (client_id) {
                // Všechna sezení klienta (chronologicky)
                const { data, error } = await supabase
                    .from('sessions')
                    .select(`*, professionals(first_name, last_name, role)`)
                    .eq('client_id', client_id)
                    .order('session_date', { ascending: false })
                    .limit(parseInt(queryLimit) || 50);
                if (error) throw error;
                return res.status(200).json({ data });
            }

            // Poslední sezení (dashboard)
            const { data, error } = await supabase
                .from('sessions')
                .select(`*, clients(first_name, last_name), professionals(first_name, last_name)`)
                .order('session_date', { ascending: false })
                .limit(parseInt(queryLimit) || 20);
            if (error) throw error;
            return res.status(200).json({ data });
        }

        // POST - nové sezení
        if (req.method === 'POST') {
            const sessionData = req.body;

            // Vložit sezení
            const { data: session, error: sessionError } = await supabase
                .from('sessions')
                .insert({
                    client_id: sessionData.client_id,
                    professional_id: sessionData.professional_id,
                    institution_id: sessionData.institution_id,
                    session_date: sessionData.session_date || new Date().toISOString(),
                    session_type: sessionData.session_type || 'nasledna',
                    duration_minutes: sessionData.duration_minutes,
                    anamneza: sessionData.anamneza,
                    pozorovani: sessionData.pozorovani,
                    metody: sessionData.metody,
                    zavery: sessionData.zavery,
                    doporuceni: sessionData.doporuceni,
                    poznamky: sessionData.poznamky,
                    transcript: sessionData.transcript,
                    ai_generated: sessionData.ai_generated || false,
                    ai_model: sessionData.ai_model,
                    status: sessionData.status || 'draft'
                })
                .select()
                .single();
            if (sessionError) throw sessionError;

            // Pokud jsou přiložena hodnocení pokroku, vložit je
            if (sessionData.progress_notes && sessionData.progress_notes.length > 0) {
                const progressData = sessionData.progress_notes.map(note => ({
                    client_id: sessionData.client_id,
                    session_id: session.id,
                    professional_id: sessionData.professional_id,
                    category: note.category,
                    rating: note.rating,
                    description: note.description
                }));

                const { error: progressError } = await supabase
                    .from('progress_notes')
                    .insert(progressData);
                if (progressError) console.error('Progress notes error:', progressError);
            }

            return res.status(201).json({ data: session });
        }

        // PUT - aktualizace sezení
        if (req.method === 'PUT') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'ID is required' });

            const { data, error } = await supabase
                .from('sessions')
                .update(req.body)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return res.status(200).json({ data });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Sessions API error:', error);
        return res.status(500).json({ error: error.message });
    }
}
