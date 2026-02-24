// Supabase konfigurace pro klientské volání
// SUPABASE_URL a SUPABASE_ANON_KEY jsou veřejné (anon key je bezpečný s RLS)
export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    // Vrátit veřejnou konfiguraci (anon key je bezpečný díky RLS)
    res.status(200).json({
        url: (process.env.SUPABASE_URL || '').trim(),
        anonKey: (process.env.SUPABASE_ANON_KEY || '').trim()
    });
}
