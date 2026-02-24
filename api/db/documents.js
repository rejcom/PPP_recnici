// API endpoint: Správa dokumentů (upload/download/list)
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
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Unauthorized' });

    const supabase = getSupabase(authHeader);

    try {
        // GET - seznam dokumentů klienta nebo download URL
        if (req.method === 'GET') {
            const { client_id, session_id, download_id } = req.query;

            // Získat signed URL pro stažení
            if (download_id) {
                const { data: doc, error: docError } = await supabase
                    .from('documents')
                    .select('storage_path, file_name')
                    .eq('id', download_id)
                    .single();
                if (docError) throw docError;

                const { data: signedUrl, error: urlError } = await supabase
                    .storage
                    .from('documents')
                    .createSignedUrl(doc.storage_path, 3600); // 1 hodina platnost
                if (urlError) throw urlError;

                return res.status(200).json({
                    url: signedUrl.signedUrl,
                    fileName: doc.file_name
                });
            }

            // Seznam dokumentů
            let query = supabase
                .from('documents')
                .select(`*, sessions(session_date, session_type), professionals(first_name, last_name)`)
                .order('created_at', { ascending: false });

            if (client_id) query = query.eq('client_id', client_id);
            if (session_id) query = query.eq('session_id', session_id);

            const { data, error } = await query;
            if (error) throw error;
            return res.status(200).json(data);
        }

        // POST - nahrát dokument (metadata + upload do Storage)
        if (req.method === 'POST') {
            const { client_id, session_id, professional_id, file_name, file_type, file_base64, notes } = req.body;

            if (!client_id || !file_name || !file_base64) {
                return res.status(400).json({ error: 'client_id, file_name and file_base64 are required' });
            }

            // Dekódovat base64
            const fileBuffer = Buffer.from(file_base64, 'base64');
            const fileSize = fileBuffer.length;

            // Cesta v storage: institution/client_id/timestamp_filename
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const storagePath = `${client_id}/${timestamp}_${file_name}`;

            // Upload do Supabase Storage
            const { error: uploadError } = await supabase
                .storage
                .from('documents')
                .upload(storagePath, fileBuffer, {
                    contentType: file_type || 'application/octet-stream',
                    upsert: false
                });
            if (uploadError) throw uploadError;

            // Zjistit verzi (kolik dokumentů se stejným jménem existuje)
            const { data: existingDocs } = await supabase
                .from('documents')
                .select('id, version')
                .eq('client_id', client_id)
                .ilike('file_name', `%${file_name.split('.')[0]}%`)
                .order('version', { ascending: false })
                .limit(1);

            const version = existingDocs && existingDocs.length > 0
                ? existingDocs[0].version + 1
                : 1;

            // Označit předchozí verze jako not-latest
            if (version > 1) {
                await supabase
                    .from('documents')
                    .update({ is_latest: false })
                    .eq('client_id', client_id)
                    .ilike('file_name', `%${file_name.split('.')[0]}%`);
            }

            // Uložit metadata do DB
            const { data: doc, error: dbError } = await supabase
                .from('documents')
                .insert({
                    session_id,
                    client_id,
                    professional_id,
                    file_name,
                    file_type: file_type || 'application/msword',
                    file_size: fileSize,
                    storage_path: storagePath,
                    version,
                    is_latest: true,
                    notes
                })
                .select()
                .single();
            if (dbError) throw dbError;

            return res.status(201).json(doc);
        }

        // DELETE - smazat dokument
        if (req.method === 'DELETE') {
            const { id } = req.query;
            if (!id) return res.status(400).json({ error: 'ID is required' });

            // Získat storage path
            const { data: doc, error: docError } = await supabase
                .from('documents')
                .select('storage_path')
                .eq('id', id)
                .single();
            if (docError) throw docError;

            // Smazat ze storage
            await supabase.storage.from('documents').remove([doc.storage_path]);

            // Smazat z DB
            const { error: deleteError } = await supabase
                .from('documents')
                .delete()
                .eq('id', id);
            if (deleteError) throw deleteError;

            return res.status(200).json({ success: true });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        console.error('Documents API error:', error);
        return res.status(500).json({ error: error.message });
    }
}
