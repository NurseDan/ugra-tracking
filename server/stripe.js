import { Router } from 'express'
import Stripe from 'stripe'
import { query } from './db.js'
import { isAuthenticated } from './auth.js'

const router = Router()

function getStripe() {
  if (!process.env.STRIPE_SECRET_KEY) return null
  return new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' })
}

router.post('/create-checkout-session', isAuthenticated, async (req, res) => {
  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured' })

  const userId = req.session?.userId
  if (!userId) return res.status(401).json({ error: 'Unauthorized' })

  const priceId = process.env.STRIPE_PRICE_ID
  if (!priceId) return res.status(503).json({ error: 'Stripe price ID is not configured' })

  try {
    const { rows } = await query('SELECT email, stripe_customer_id FROM users WHERE id = $1', [userId])
    if (!rows.length) return res.status(404).json({ error: 'User not found' })
    const user = rows[0]

    const publicUrl = process.env.PUBLIC_URL || req.headers.origin || 'http://localhost:5173'

    const sessionConfig = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${publicUrl}/account?session_id={CHECKOUT_SESSION_ID}&success=true`,
      cancel_url: `${publicUrl}/account?canceled=true`,
      client_reference_id: userId,
      customer_email: user.stripe_customer_id ? undefined : user.email,
      customer: user.stripe_customer_id || undefined,
    }

    const session = await stripe.checkout.sessions.create(sessionConfig)
    res.json({ url: session.url })
  } catch (err) {
    console.error('[stripe] checkout error:', err)
    res.status(500).json({ error: err.message })
  }
})

router.post('/portal-session', isAuthenticated, async (req, res) => {
  const stripe = getStripe()
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured' })
  
  const userId = req.session?.userId
  
  try {
    const { rows } = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [userId])
    if (!rows.length || !rows[0].stripe_customer_id) {
      return res.status(400).json({ error: 'No active subscription found' })
    }
    
    const publicUrl = process.env.PUBLIC_URL || req.headers.origin || 'http://localhost:5173'
    
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: rows[0].stripe_customer_id,
      return_url: `${publicUrl}/account`,
    })
    
    res.json({ url: portalSession.url })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// Webhook payload needs to be raw (handled in server.js)
router.post('/webhook', async (req, res) => {
  const stripe = getStripe()
  if (!stripe) return res.sendStatus(200)

  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    console.warn(`[stripe] webhook signature verification failed:`, err.message)
    return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object
      const userId = session.client_reference_id
      
      if (userId) {
        await query(
          `UPDATE users SET 
            plan = 'pro', 
            stripe_customer_id = $2, 
            stripe_subscription_id = $3,
            updated_at = now()
           WHERE id = $1`,
          [userId, session.customer, session.subscription]
        )
      }
    } else if (event.type === 'customer.subscription.updated') {
      const subscription = event.data.object
      const status = subscription.status
      
      if (status === 'active' || status === 'trialing') {
         await query(
          `UPDATE users SET plan = 'pro', plan_expires_at = to_timestamp($2), updated_at = now() 
           WHERE stripe_subscription_id = $1`,
          [subscription.id, subscription.current_period_end]
        )
      } else if (status === 'past_due' || status === 'canceled' || status === 'unpaid') {
         await query(
          `UPDATE users SET plan = 'free', updated_at = now() 
           WHERE stripe_subscription_id = $1`,
          [subscription.id]
        )
      }
    } else if (event.type === 'customer.subscription.deleted') {
      const subscription = event.data.object
      await query(
        `UPDATE users SET plan = 'free', stripe_subscription_id = null, updated_at = now() 
         WHERE stripe_subscription_id = $1`,
        [subscription.id]
      )
    }
  } catch (err) {
    console.error('[stripe] error processing webhook:', err)
  }

  res.json({ received: true })
})

export default router
