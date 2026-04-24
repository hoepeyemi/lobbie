# mogause Frontend

Frontend dashboard for the mogause autonomous agent economy on Stellar.

## Local development

```bash
cd frontend
npm install
npm run dev
```

Open:

- [http://localhost:3000](http://localhost:3000)

## Environment

Use your frontend env file (`frontend/.env` or `.env.local`) with:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_STELLAR_NETWORK`
- `NEXT_PUBLIC_HORIZON_URL`
- `NEXT_PUBLIC_EXPLORER_URL`

## Production build output (`build/`)

This frontend is configured for static export. Running:

```bash
npm run build
```

produces a deployable static folder at:

- `frontend/build/`

You can host this folder with Nginx, S3/CloudFront, Netlify, or any static file server.

## Notes

- App logo + favicon are sourced from:
  - `public/mogause.png`
