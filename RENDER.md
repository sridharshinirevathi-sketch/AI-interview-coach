# Deploy to Render

1. Push this repository to GitHub.
2. In Render, select **New +** → **Blueprint**, then select the repository. Render reads `render.yaml`.
3. Enter `GEMINI_API_KEY` as a secret environment variable when prompted.
4. Deploy.

Render builds with `npm ci && npm run build`, then runs `npm start`. The Express server uses Render's `PORT`, serves the React build, and provides `/api/health` for health checks.

For local development, run `npm run server` and `npm run dev` in separate terminals. Vite proxies `/api` calls to port 3001.
