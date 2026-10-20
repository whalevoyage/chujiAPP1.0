// Leave empty for same-origin deployments. Set VITE_SERVER_URL to an HTTPS
// API origin when the frontend and backend are hosted separately.
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL?.trim() ?? ''
