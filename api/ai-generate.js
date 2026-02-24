// Vercel serverless funkce pro Mistral AI
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        const { transcript } = req.body;

        if (!transcript) {
            return res.status(400).json({ error: 'Transcript is required' });
        }

        const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${process.env.MISTRAL_API_KEY}`
            },
            body: JSON.stringify({
                model: 'mistral-large-latest',
                messages: [
                    {
                        role: 'system',
                        content: 'Jsi expert na psychologické zápisy. Vytvoř strukturovaný zápis z přepisu rozhovoru v psychologické poradně. Vrať POUZE platný JSON objekt, žádný další text.'
                    },
                    {
                        role: 'user',
                        content: `Přepis rozhovoru:\n\n${transcript}\n\nVytvoř strukturovaný psychologický zápis a vrať ho POUZE jako JSON objekt (bez markdown bloků, bez vysvětlování) v tomto formátu:\n{\n  "anamneza": "text",\n  "pozorovani": "text",\n  "metody": "text",\n  "zavery": "text",\n  "doporuceni": "text"\n}\n\nStruktura:\n1. Důvod návštěvy / Anamnéza\n2. Pozorování během schůzky\n3. Provedená vyšetření / Metody\n4. Zjištění a závěry\n5. Doporučení a další postup`
                    }
                ],
                temperature: 0.7,
                max_tokens: 4000,
                response_format: { type: 'json_object' }
            })
        });

        if (!response.ok) {
            const errorData = await response.text();
            console.error('Mistral API error:', errorData);
            return res.status(response.status).json({
                error: 'Mistral API error',
                details: errorData
            });
        }

        const data = await response.json();
        res.status(200).json(data);
    } catch (error) {
        console.error('Error calling Mistral AI:', error);
        res.status(500).json({ error: error.message });
    }
}
