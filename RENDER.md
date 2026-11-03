# Deploy to Render

1. Push this repository to GitHub.
2. In Render, select **New +** → **Blueprint**, then select the repository. Render reads `render.yaml`.
3. Deploy the static site. No API key or backend service is required.

Render builds with `npm ci && npm run build` and publishes the `dist` directory. Resume parsing and scoring run in the browser.

For local development, run `npm run dev`.
