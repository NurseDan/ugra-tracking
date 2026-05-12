# Guadalupe Sentinel

**Upper Guadalupe River Flood Awareness Dashboard**

Guadalupe Sentinel is an independent situational awareness tool for monitoring river conditions across the upper Guadalupe River watershed in the Texas Hill Country.

## Public Dashboard

Access the public dashboard at: `/public`

The public view provides:
- Real-time gauge readings from USGS stations
- Rate-of-rise analysis and early-warning alerts
- Interactive map showing upstream-to-downstream flow
- Plain-language status updates
- Mobile-first responsive design

## Data Sources

- **USGS Real-Time Gauge Network** - Primary water level and flow data
- **NOAA / National Water Prediction Service** - Flood forecasts and stage predictions
- **Upper Guadalupe River Authority (UGRA)** - Local reference context

## Important Disclaimer

**Guadalupe Sentinel is an independent situational awareness tool using public data.**

It does not replace:
- Official emergency alerts
- Evacuation orders
- National Weather Service warnings
- Local emergency management instructions
- 911

During emergencies, follow official guidance and move to higher ground if conditions change quickly.

**Never enter flooded low-water crossings. Call 911 for emergencies.**

## Features

### Real-Time Monitoring
- 6 USGS gauges across the upper Guadalupe River
- 5-minute, 15-minute, and 1-hour rate-of-rise tracking
- Stale data detection and offline warnings
- Automatic refresh every 1-5 minutes

### Alert System
- **GREEN**: Normal conditions
- **YELLOW**: Early rise detected
- **ORANGE**: Rapid rise warning
- **RED**: Dangerous rise
- **BLACK**: Critical / catastrophic conditions

### Notifications (Phase 1)
- Browser push notifications for RED and BLACK alerts
- Deduplication and rate limiting (10-minute window)
- Automatic permission request on first visit

### Public Safety Dashboard
- Hero status panel with plain-language explanations
- Compact gauge cards optimized for mobile
- Leaflet map with color-coded markers
- Surge detection and downstream impact warnings

## Technology Stack

- **Frontend**: React 18 + Vite
- **Routing**: React Router v7
- **Maps**: Leaflet + react-leaflet
- **Backend**: Node.js + Express v5
- **Database**: PostgreSQL
- **Auth**: Google OAuth (Passport.js)
- **Notifications**: Web Push API + Nodemailer
- **Deployment**: Railway

## Development

```bash
# Install dependencies
npm install

# Run dev server (frontend + backend)
npm run dev

# Build for production
npm run build

# Run tests
npm test
```

## Environment Variables

See `.env.example` for required configuration.

## Roadmap

- ✅ Live gauge dashboard
- ✅ Rate-of-rise detection
- ✅ Mobile-first public view
- ✅ Browser push notifications (RED/BLACK)
- ⏳ Email/SMS notifications
- ⏳ Custom alert zones
- ⏳ Historical data archive
- ⏳ Subscription tiers (SaaS)

## License

MIT

## Contact

For questions or feedback, open an issue on GitHub.

---

**Deployment marker**: Public dashboard ready for beta launch.
