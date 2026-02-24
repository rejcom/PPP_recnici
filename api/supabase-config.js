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
    const url = (process.env.SUPABASE_URL || '').trim();
    const anonKey = (process.env.SUPABASE_ANON_KEY || '').trim();

    // Správný anon key (JWT formát) - fallback pokud env var obsahuje starý publishable key
    const CORRECT_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Indxbmh2ZHlhb2h6bmxheGFpbGZkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE4NTE4ODcsImV4cCI6MjA4NzQyNzg4N30.Or-wwAE31LO-fcV38dzQcTHZXcW6MhCHEGvc3pFkKfE';

    // Použít správný klíč - env var nebo fallback
    const finalKey = anonKey.startsWith('eyJ') ? anonKey : CORRECT_ANON_KEY;

    res.status(200).json({
        url: url || 'https://wqnhvdyaohznlaxailfd.supabase.co',
        anonKey: finalKey
    });
}
