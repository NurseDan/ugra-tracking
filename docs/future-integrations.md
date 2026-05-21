# Future Integrations

This document outlines planned future features for Guadalupe Sentinel. These features are not currently active but are mapped out for future development phases.

## Planned Future Features

- Google OAuth / Continue with Google
- Stripe subscriptions and paid plans
- SMS alerts
- Any future external integrations that make sense for this app

---

### Google OAuth / Continue with Google
Adding Google OAuth later will require:
- Google Cloud OAuth client setup (creating credentials in the Google Cloud Console).
- OAuth consent screen (configuring the consent screen for user approval).
- Authorized redirect URI (setting up the correct callback path for the application).
- Backend callback route (implementing an endpoint to handle the OAuth response).
- Railway environment variables (storing the Client ID and Secret securely).
- Account-linking logic with existing email/password users (handling users who have both an email account and sign in via Google).

### Stripe Subscriptions and Paid Plans
Adding Stripe integration later will require:
- Stripe account setup (creating and configuring a Stripe merchant account).
- Product and price IDs (defining the subscription tiers and obtaining their IDs).
- Webhook endpoint (implementing a secure endpoint to receive Stripe events like payment success or failure).
- Railway environment variables (storing the Stripe Secret Key and Webhook Secret securely).
- Database fields for plan/subscription status (updating the `users` table to track active subscriptions).
- Frontend billing/account management screens (creating UI for users to upgrade, manage, and cancel their plans).

### SMS Alerts
Adding SMS alerts later will require:
- SMS provider setup (e.g., Twilio, AWS SNS).
- User phone number collection and verification.
- Backend dispatch logic to format and send critical alerts via SMS.
