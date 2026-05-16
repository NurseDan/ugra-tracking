import Stripe from 'stripe'
import { query } from './db.js'

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

export async function createCheckoutSession(userId, email, origin) {
  if (!stripe) throw new Error('Stripe not configured')
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
    customer_email: email,
    metadata: { userId },
    success_url: `${origin}/account?upgraded=1`,
    cancel_url: `${origin}/account`,
  })
  return session.url
}

export async function createPortalSession(userId, origin) {
  if (!stripe) throw new Error('Stripe not configured')
  const r = await query('SELECT stripe_customer_id FROM users WHERE id=$1', [userId])
  const customerId = r.rows[0]?.stripe_customer_id
  if (!customerId) throw new Error('No subscription found')
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin}/account`,
  })
  return session.url
}

export async function handleStripeWebhook(rawBody, sig) {
  if (!stripe) throw new Error('Stripe not configured')
  const event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)

  if (event.type === 'checkout.session.completed') {
    const s = event.data.object
    await query(
      `UPDATE users SET plan='pro', stripe_customer_id=$1, stripe_subscription_id=$2, updated_at=now() WHERE id=$3`,
      [s.customer, s.subscription, s.metadata.userId]
    )
  }

  if (event.type === 'customer.subscription.deleted') {
    await query(
      `UPDATE users SET plan='free', stripe_subscription_id=NULL, updated_at=now() WHERE stripe_customer_id=$1`,
      [event.data.object.customer]
    )
  }

  if (event.type === 'invoice.payment_failed') {
    await query(
      `UPDATE users SET plan='free', updated_at=now() WHERE stripe_customer_id=$1`,
      [event.data.object.customer]
    )
  }
}
