// API endpoint: Pokrok klienta v čase
import { createClient } from '@supabase/supabase-js';

function getSupabase(authHeader) {
    return createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        { global: { headers: { Authorization: authHeader } } }
    );
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase(authHeader);

    try {
        // GET - pokrok klienta (timeline)
        if (req.method === 'GET') {
            const { client_id, category } = req.query;

            if (!client_id) {
                return res.status(400).json({ error: 'client_id is required' });
            }

            let query = supabase
                .from('client_progress_timeline')
                .select('*')
                .eq('client_id', client_id)
                .order('noted_at', { ascending: true });

            if (category) {
                query = query.eq('category', category);
            }

            const { data, error } = await query;
            if (error) throw error;

            // Seskupit podle kategorie pro graf
            const grouped = {};
            data.forEach(note => {
                if (!grouped[note.category]) {
                    grouped[note.category] = [];
                }
                grouped[note.category].push({
                    date: note.noted_at,
                    rating: note.rating,
                    description: note.description,
                    session_type: note.session_type,
                    professional: note.professional_name
                });
            });

            return res.status(200).json({
                data: data,
                timeline: data,
                grouped,
                categories: Object.keys(grouped)
            });
        }

        // POST - přidat hodnocení pokroku
        if (req.method === 'POST') {
            const notes = Array.isArray(req.body) ? req.body : [req.body];

            const { data, error } = await supabase
                .from('progress_notes')
                .insert(notes)
                .select();
            if (error) throw error;

            return res.status(201).json({ data });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Progress API error:', error);
        return res.status(500).json({ error: error.message });
    }
}
