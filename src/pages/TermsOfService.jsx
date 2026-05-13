import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function TermsOfService() {
  return (
    <div className="policy-container">
      <nav className="policy-nav">
        <Link to="/" className="landing-btn landing-btn--outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowLeft size={16} /> Back to Home
        </Link>
      </nav>
      <div className="policy-content glass-panel">
        <h1>Terms of Service</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>

        <h2>1. Agreement to Terms</h2>
        <p>By viewing or using Guadalupe Sentinel / Track the Guad, you agree to be bound by these Terms of Service. If you do not agree with any of these terms, you are prohibited from using or accessing this site.</p>

        <h2>2. Data Accuracy and Liability</h2>
        <p>The information provided by this application is sourced from public data feeds (such as the USGS) and predictive models. We do not guarantee the accuracy, completeness, or timeliness of this data.</p>
        <p><strong>IMPORTANT:</strong> This application is for informational purposes only and should NEVER be relied upon for life-safety decisions. Always follow the guidance of local emergency management officials and the National Weather Service during flood events.</p>

        <h2>3. Use License</h2>
        <p>Permission is granted to temporarily download one copy of the materials (information or software) on Guadalupe Sentinel for personal, non-commercial transitory viewing only.</p>

        <h2>4. User Accounts</h2>
        <p>If you create an account using Google Authentication, you are responsible for maintaining the security of your account. You must notify us immediately of any unauthorized uses of your account or any other breaches of security.</p>

        <h2>5. API Keys and Third-Party Services</h2>
        <p>If you choose to provide a third-party API key (such as an OpenAI or Anthropic key) for AI briefings, you are solely responsible for any charges incurred on that account. Your key is stored securely in your browser and is never sent to our servers.</p>

        <h2>6. Modifications</h2>
        <p>We may revise these terms of service for its website at any time without notice. By using this website you are agreeing to be bound by the then current version of these terms of service.</p>

        <h2>7. Governing Law</h2>
        <p>These terms and conditions are governed by and construed in accordance with the laws of Texas, USA, and you irrevocably submit to the exclusive jurisdiction of the courts in that State or location.</p>
        
        <h2>8. Contact</h2>
        <p>If you have any questions about these Terms, please contact us at support@guadalupesentinel.com.</p>
      </div>
    </div>
  )
}
