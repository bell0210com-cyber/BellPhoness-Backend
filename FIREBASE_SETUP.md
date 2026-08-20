# BELL Firebase setup

1. Create a Firebase project and enable Email/Password and Google Authentication.
2. Copy `.env.example` to `.env` and add only Firebase web configuration values.
3. Copy `backend/.env.example` to `backend/.env` and add a Firebase service-account project ID, client email, private key, storage bucket, and client URL.
4. Deploy `firestore.rules`, `storage.rules`, and `firestore.indexes.json` with the Firebase CLI.
5. Set the administrator custom claim with a trusted server-side script: `admin.auth().setCustomUserClaims(uid, { admin: true })`.
6. Install and start the backend with `npm.cmd --prefix backend install` then `npm.cmd --prefix backend run dev`.
7. Set `VITE_API_BASE_URL` to the deployed API base URL and run the customer app with `npm.cmd run dev`.

The browser only uses Firebase web configuration. Firebase Admin credentials stay exclusively in `backend/.env`.
