import { Router } from 'express'
import Stripe from 'stripe'
import { query } from './db.js'
import { isAuthenticated, userId } from './auth.js'

// Billing is optional: if STRIPE_SECRET_KEY is not set the router returns
// 503 on every endpoint so the rest of the app still works.
const stripeEnabled = !!process.env.STRIPE_SECRET_KEY
const stripe = stripeEnabled ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

export const FREE_SUBSCRIPTION_LIMIT = 1

const router = Router()

function notConfigured(res) {
  return res.status(503).json({ error: 'Billing not configured on this deployment' })
}

// POST /api/billing/create-checkout-session
// Creates (or reuses) a Stripe Customer for the user then starts a hosted
// Checkout session for the Pro subscription plan.
router.post('/create-checkout-session', isAuthenticated, async (req, res) => {
  if (!stripeEnabled) return notConfigured(res)
  if (!process.env.STRIPE_PRICE_ID_PRO) return notConfigured(res)

  const uid = userId(req)
  const r = await query(
    'SELECT email, stripe_customer_id, plan FROM users WHERE id = $1',
    [uid]
  )
  if (!r.rowCount) return res.status(404).json({ error: 'User not found' })
  const u = r.rows[0]

  if (u.plan === 'pro') {
    return res.status(400).json({ error: 'Already on Pro plan' })
  }

  let customerId = u.stripe_customer_id
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: u.email,
      metadata: { user_id: uid }
    })
    customerId = customer.id
    await query('UPDATE users SET stripe_customer_id = $1 WHERE id = $2', [customerId, uid])
  }

  const baseUrl = process.env.PUBLIC_URL ||
    `${req.protocol}://${req.hostname}`

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRICE_ID_PRO, quantity: 1 }],
    mode: 'subscription',
    success_url: `${baseUrl}/my-alerts?billing=success`,
    cancel_url: `${baseUrl}/pricing`,
    allow_promotion_codes: true
  })

  res.json({ url: session.url })
})

// POST /api/billing/portal
// Redirects the user to the Stripe Customer Portal to manage their subscription.
router.post('/portal', isAuthenticated, async (req, res) => {
  if (!stripeEnabled) return notConfigured(res)

  const uid = userId(req)
  const r = await query('SELECT stripe_customer_id FROM users WHERE id = $1', [uid])
  const customerId = r.rows[0]?.stripe_customer_id
  if (!customerId) return res.status(400).json({ error: 'No billing account found. Subscribe first.' })

  const baseUrl = process.env.PUBLIC_URL ||
    `${req.protocol}://${req.hostname}`

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${baseUrl}/my-alerts`
  })
  res.json({ url: session.url })
})

// POST /api/billing/webhook  (raw body required — mounted before express.json)
// Handles Stripe events to keep user plan columns in sync.
export async function handleStripeWebhook(req, res) {
  if (!stripeEnabled) return notConfigured(res)

  const sig = req.headers['stripe-signature']
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!secret) return res.status(500).json({ error: 'STRIPE_WEBHOOK_SECRET not set' })

  let event
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, secret)
  } catch (err) {
    return res.status(400).send(`Webhook signature error: ${err.message}`)
  }

  const obj = event.data.object
  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        const plan = obj.status === 'active' || obj.status === 'trialing' ? 'pro' : 'free'
        await query(
          `UPDATE users
             SET plan = $1, stripe_subscription_id = $2, plan_status = $3
           WHERE stripe_customer_id = $4`,
          [plan, obj.id, obj.status, obj.customer]
        )
        break
      }
      case 'customer.subscription.deleted': {
        await query(
          `UPDATE users
             SET plan = 'free', stripe_subscription_id = NULL, plan_status = 'canceled'
           WHERE stripe_customer_id = $1`,
          [obj.customer]
        )
        break
      }
      case 'invoice.payment_failed': {
        await query(
          `UPDATE users SET plan_status = 'past_due' WHERE stripe_customer_id = $1`,
          [obj.customer]
        )
        break
      }
    }
  } catch (err) {
    console.error('[billing] webhook handler error:', err.message)
    return res.status(500).json({ error: 'Internal error' })
  }

  res.json({ received: true })
}

export default router
