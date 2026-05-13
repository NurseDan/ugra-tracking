import React from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
  return (
    <div className="policy-container">
      <nav className="policy-nav">
        <Link to="/" className="landing-btn landing-btn--outline" style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem' }}>
          <ArrowLeft size={16} /> Back to Home
        </Link>
      </nav>
      <div className="policy-content glass-panel">
        <h1>Privacy Policy</h1>
        <p>Last updated: {new Date().toLocaleDateString()}</p>

        <h2>1. Introduction</h2>
        <p>Welcome to Guadalupe Sentinel / Track the Guad ("we", "our", or "us"). We are committed to protecting your personal information and your right to privacy. If you have any questions or concerns about this privacy notice, or our practices with regards to your personal information, please contact us.</p>

        <h2>2. Information We Collect</h2>
        <p>When you use our application, we may collect the following personal information provided by Google when you sign in:</p>
        <ul>
          <li><strong>Name:</strong> We collect your first and last name to personalize your experience.</li>
          <li><strong>Email Address:</strong> We collect your email address to establish your account and send important alert notifications if you subscribe to them.</li>
          <li><strong>Profile Picture:</strong> We may collect your Google profile picture to display in your account settings.</li>
        </ul>

        <h2>3. How We Use Your Information</h2>
        <p>We use the personal information collected to:</p>
        <ul>
          <li>Provide, operate, and maintain our application.</li>
          <li>Send you push notifications or email alerts about river conditions (only if you explicitly opt-in).</li>
          <li>Improve and personalize your user experience.</li>
        </ul>

        <h2>4. Data Retention and Deletion</h2>
        <p>We retain your personal information only for as long as is necessary for the purposes set out in this Privacy Policy. You can request the deletion of your account and associated data at any time by contacting us.</p>

        <h2>5. Sharing Your Information</h2>
        <p>We do not share, sell, rent, or trade any of your information with third parties for their promotional purposes. Your data is used exclusively to provide the core functionality of the Guadalupe Sentinel application.</p>

        <h2>6. Third-Party Services</h2>
        <p>We use Google Authentication to allow you to securely sign in. Google's privacy policy applies to their authentication service. We also fetch public river data from the USGS National Water Information System.</p>

        <h2>7. Changes to This Policy</h2>
        <p>We may update this privacy policy from time to time. The updated version will be indicated by an updated "Last updated" date and the updated version will be effective as soon as it is accessible.</p>

        <h2>8. Contact Us</h2>
        <p>If you have questions or comments about this notice, you may email us at support@guadalupesentinel.com.</p>
      </div>
    </div>
  )
}
