export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }
  
  const apiKey = process.env.OPENAI_API_KEY || process.env.VITE_OPENAI_API_KEY
  if (!apiKey) {
    return res.status(503).json({ error: 'Missing OPENAI_API_KEY in Vercel environment' })
  }

  try {
    const fetchRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(req.body)
    })
    
    const data = await fetchRes.json()
    res.status(fetchRes.status).json(data)
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
}
