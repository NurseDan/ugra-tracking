import { tick } from '../../server/poller.js'

export default async function handler(req, res) {
  // Verify Vercel Cron Authorization header in production
  if (
    process.env.VERCEL && 
    req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`
  ) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    await tick()
    res.status(200).json({ success: true, message: 'Poller tick executed successfully' })
  } catch (err) {
    console.error('[cron] poller tick failed:', err)
    res.status(500).json({ error: 'Poller tick failed', details: err.message })
  }
}
