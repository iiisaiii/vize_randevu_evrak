# VizeRadar

Randevuyu kaçırma, evrakı eksiksiz hazırla, tek ekrandan takip et.

## What this repo is
A lightweight static MVP (HTML/CSS/JS) based on the Steplify engine:
- Home landing (clean SaaS hero)
- Step-based wizard content via JSON files in `public/data/`
- Freemium lock (first 5 steps) + Premium placeholder page
- LocalStorage progress + notes
- Optional Supabase Auth modal (vendor script already included)

## Quick start
Just open `index.html` with a static server (or deploy to Vercel/Netlify).

## Content
Edit JSON files under `public/data/`:
- Schengen, UK

## Payments
`premium.html` includes placeholder purchase links. Replace with your Shopier payment links.
After payment, redirect user to `/premium-success.html` (or `/?unlock=1` if you keep the debug unlock).

## Notes
This is a template skeleton. Next step is to replace the demo steps with real wizard logic and wire Premium entitlements to Supabase.
