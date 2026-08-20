# ⚙️ BellPhones – Backend API

<p align="center">
  <h2 align="center">BellPhones Backend.</h2>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white"/>
  <img src="https://img.shields.io/badge/Express.js-404D59?style=for-the-badge"/>
  <img src="https://img.shields.io/badge/Firebase-FFCA28?style=for-the-badge&logo=firebase&logoColor=black"/>
  <img src="https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black"/>
  <img src="https://img.shields.io/badge/License-MIT-brightgreen?style=for-the-badge"/>
</p>

<p align="center">
  <strong>BellPhones Backend</strong> is a robust, scalable REST API built with Node.js and Express. It serves as the core engine for the BellPhones eCommerce platform, handling secure product inventory, order processing, and customer management. It integrates seamlessly with the Firebase Admin SDK for secure database interactions and cloud storage.
</p>

---

## ✨ Features

| Feature | Description |
|---|---|
| ⚡ **Node.js + Express** | High-performance, non-blocking backend architecture. |
| 🔐 **Secure Routing** | Protected admin endpoints with Firebase JWT token verification. |
| 📦 **Order Management** | Complete RESTful endpoints for processing and updating customer orders. |
| 🔥 **Firebase Admin SDK** | Direct, secure server-side interaction with Firestore and Firebase Storage. |
| 🛡️ **CORS & Error Handling** | Pre-configured Cross-Origin policies and centralized global error handling. |

---

## 📦 Tech Stack

| Technology | Purpose |
|---|---|
| Node.js | JavaScript runtime environment |
| Express.js | Web framework for routing and middleware |
| Firebase Admin SDK | Secure database & storage access |
| dotenv | Environment variable management |
| CORS | Cross-origin resource sharing for the frontend |

---

## 💻 How to Run (For Developers)

Before you begin, make sure **Node.js** (v18+) is installed on your system.

### Step 1 — Clone the Repository
```bash
git clone https://github.com/HelloWorld-Farhan/BellPhones-Backend.git
cd BellPhones-Backend
```

### Step 2 — Install Dependencies
```bash
npm install
```

### Step 3 — Environment & Firebase Setup
1. Create a `.env` file in the root directory:
```env
PORT=5000
CLIENT_URL=http://localhost:5173
FIREBASE_STORAGE_BUCKET=your_storage_bucket.appspot.com
```
2. Obtain your **Firebase Admin SDK private key** from the Firebase Console.
3. Save it as `serviceAccountKey.json` in the root directory. *(Note: This file is intentionally git-ignored for security).*

### Step 4 — Run in Development Mode
```bash
npm run dev
```
*The server will start listening on `http://localhost:5000`.*

---

## 🔌 API Endpoints (Overview)

- **`GET /api/health`** - Server health check.
- **`/api/products`** - Public product catalog endpoints.
- **`/api/orders`** - Customer order placement and retrieval.
- **`/api/admin/*`** - Secured endpoints for managing products, users, and orders (Requires Admin Bearer Token).

---

## 👨‍💻 Author

**Farhan Khalid**  
📧 farhankhalid17968@gmail.com  
🔗 [LinkedIn](https://www.linkedin.com/in/farhan-khalid-117514259/)  
🐙 [GitHub](https://github.com/HelloWorld-Farhan)

---

## 📄 License

```text
MIT License

Copyright (c) 2026 Farhan Khalid

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is furnished
to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.
```

---

## 🌟 Support

If you found this project useful or impressive, please consider giving it a ⭐ on GitHub!

<p align="center">Made with ❤️ in India</p>
