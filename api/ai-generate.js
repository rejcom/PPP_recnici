// Vercel serverless funkce pro Mistral AI
export default async function handler(req, res) {
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
                model: 'open-mistral-7b',
                messages: [
                    {
                        role: 'system',
                        content: 'Jsi expert na psychologické zápisy. Vytvoř strukturovaný zápis z přepisu rozhovoru v psychologické poradně. Vrať POUZE platný JSON objekt, žádný další text, žádné markdown bloky.'
                    },
                    {
                        role: 'user',
                        content: `Přepis rozhovoru:\n\n${transcript}\n\nVytvoř strukturovaný psychologický zápis a vrať ho POUZE jako JSON objekt (bez markdown bloků, bez vysvětlování) v tomto formátu:\n{\n  "anamneza": "text",\n  "pozorovani": "text",\n  "metody": "text",\n  "zavery": "text",\n  "doporuceni": "text"\n}`
                    }
                ],
                temperature: 0.7,
                max_tokens: 4000
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
        const rawText = data.choices[0].message.content;

        // Extrahovat JSON z odpovědi
        let reportJson;
        try {
            const jsonMatch = rawText.match(/\{[\s\S]*\}/);
            reportJson = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(rawText);
        } catch (e) {
            console.error('JSON parse error:', e, 'Raw:', rawText);
            return res.status(500).json({ error: 'AI nevrátila platný JSON formát' });
        }

        res.status(200).json(reportJson);
    } catch (error) {
        console.error('Error calling Mistral AI:', error);
        res.status(500).json({ error: error.message });
    }
}
