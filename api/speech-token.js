// Vercel serverless funkce pro Azure Speech token
export default async function handler(req, res) {
    // CORS headers
    res.setHeader('Access-Control-Allow-Credentials', true);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.status(200).end();
        return;
    }

    try {
        // Získat token z Azure
        const response = await fetch(
            `https://${process.env.AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
            {
                method: 'POST',
                headers: {
                    'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY
                }
            }
        );

        const token = await response.text();

        res.status(200).json({
            token: token,
            region: process.env.AZURE_REGION
        });
    } catch (error) {
        console.error('Error getting Azure token:', error);
        res.status(500).json({ error: error.message });
    }
}
