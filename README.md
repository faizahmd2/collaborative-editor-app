# 📝 Collaborative Editor App

A lightweight collaborative text editor built with **Node.js**, **Express**, and **Socket.IO**.  
When you visit the base URL, a unique editor session is generated. Anyone with the same link can view and edit the content in real-time.

---

## 🚀 Features

- Real-time collaborative editing using **Socket.IO**
- Unique session-based editors (auto-generated on visit)
- Live syncing of content across clients
- Optional persistent storage using **MongoDB**

---

## 🌐 Live Demo

Visit: [https://notespot.site](https://notespot.site)

---

## 📦 Environment Variables

Create a `.env` file in the project root with the following variables:

```env
PORT=5829
MONGO_URI=mongodb://localhost:27017
ENCRYPTION_KEY=your-secret-key  # Optional, for content encryption
```

## 🛠️ Local Setup
```bash
# 1. Clone the repository
git clone https://github.com/your-username/collaborative-editor-app.git
cd collaborative-editor-app

# 2. Install dependencies
npm install

# 3. Add environment variables

# 4. Start the app in development mode
npm run dev
```

## 🐳 Production Setup (Docker Compose)
### Make sure you have Docker and Docker Compose installed.
```bash
# 1. Clone the repository
git clone https://github.com/your-username/collaborative-editor-app.git
cd collaborative-editor-app

# 2. Add environment variables

# 3. Build and run the container
docker compose up --build -d

```






