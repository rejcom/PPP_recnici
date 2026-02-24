// API endpoint: Správa klientů (CRUD)
import { getSupabase } from './_supabase.js';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase(authHeader);

    try {
        // GET - seznam klientů nebo detail
        if (req.method === 'GET') {
            const { id, search } = req.query;

            if (id) {
                // Detail klienta
                const { data, error } = await supabase
                    .from('clients')
                    .select('*')
                    .eq('id', id)
                    .single();
                if (error) throw error;
                return res.status(200).json({ data });
            }

            // Seznam klientů
            let query = supabase
                .from('clients')
                .select('*')
                .eq('is_active', true)
                .order('last_name');

            if (search) {
                query = query.or(`last_name.ilike.%${search}%,first_name.ilike.%${search}%`);
            }

            const { data, error } = await query;
            if (error) throw error;
            return res.status(200).json({ data });
        }

        // POST - nový klient
        if (req.method === 'POST') {
            const { data, error } = await supabase
                .from('clients')
                .insert(req.body)
                .select()
                .single();
            if (error) throw error;
            return res.status(201).json({ data });
        }

        // PUT - aktualizace klienta
        if (req.method === 'PUT') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'ID is required' });

            const { data, error } = await supabase
                .from('clients')
                .update(req.body)
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return res.status(200).json({ data });
        }

        // DELETE - deaktivace klienta (soft delete)
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'ID is required' });

            const { data, error } = await supabase
                .from('clients')
                .update({ is_active: false })
                .eq('id', id)
                .select()
                .single();
            if (error) throw error;
            return res.status(200).json({ data });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Clients API error:', error);
        return res.status(500).json({ error: error.message });
    }
}
