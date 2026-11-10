# CarromHub

## Temporary free demo

The frontend and API run together as one Node service. To publish the demo, open Render, choose **New + → Blueprint**, and connect this GitHub repository. Render reads `render.yaml` and deploys the service to an `onrender.com` URL.

This uses Render's free web-service plan. It sleeps after 15 minutes without traffic, and its filesystem is temporary: the SQLite database resets when the service sleeps, restarts, or redeploys. Use demo data only; do not enter real user information. OTP delivery is in development mode, so sign-in codes are exposed to the client and are not suitable for real accounts.

Persistent database storage and production OTP delivery are intentionally deferred.
