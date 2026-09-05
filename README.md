# 🍜 Automated Foodie Tracker & Google Maps System

An automated foodie tracking system that operates **24/7 in the cloud**, detects when you stay at a food stall or restaurant for **more than 5 minutes**, alerts your **iPhone** with a push notification, collects your rating, review & food photos, and displays everything on an **interactive map** with **1-tap Google Maps integration**.

---

## 🌟 Key Features

- 🔋 **Zero Battery Drain iOS Background Tracking**: Uses Apple's native `CLVisit` / Region Monitoring via OwnTracks.
- ⏱️ **5-Minute Dwell Engine**: Automatically detects when you sit down at an eatery for 5+ minutes.
- 🗺️ **OpenStreetMap Place Resolution**: Automatically identifies the food stall/restaurant name and address (100% free, no credit card required).
- 🔔 **Instant iPhone Push Notifications**: Dispatched via `ntfy.sh` with direct action buttons.
- 📸 **Photo Reviews & Star Ratings**: Snap photos of your dish directly with your iPhone camera, tap 1–5 stars, and add tasting notes.
- 🧭 **1-Tap Google Maps Deep Linking**: Every saved food spot includes an instant link to open and bookmark it in the official Google Maps iOS app.
- 🏡 **Home & Work Exclusion Zones**: Never get prompted when eating at home or working at the office.
- 🌙 **Operates 24/7 with Computer Switched Off**: Deployed to free cloud hosting (Render.com / Railway).

---

## 🚀 Quick iPhone Setup (Takes 2 Minutes)

### Step 1: Install ntfy (For Push Notifications)
1. Download **ntfy** from the iOS App Store (100% Free).
2. Open the app, tap **+** to subscribe to a topic.
3. Enter your unique topic name (e.g. `foodie-tracker-john-828`).
4. That's it! Notifications will appear with a direct **"⭐ Rate & Review"** action button.

### Step 2: Install OwnTracks (For Background Tracking)
1. Download **OwnTracks** from the iOS App Store (100% Free).
2. Open OwnTracks -> Tap the **(i)** Info icon (top left) -> **Settings**.
3. Tap **Connection** -> Mode: **HTTP**.
4. Set **Host**: `https://your-app-name.onrender.com/api/location` (or your local ngrok/server URL).
5. Set **Monitoring Mode**: **Significant changes** with **Visits enabled** (ensures zero battery drain).

### Step 3: Add Foodie Map to iPhone Home Screen
1. In Mobile Safari, navigate to your app URL: `https://your-app-name.onrender.com`.
2. Tap the Safari **Share** icon (bottom center).
3. Tap **Add to Home Screen**.
4. The Foodie Map now acts and feels like a native iOS app with an interactive map, search, and list.

---

## ☁️ 24/7 Cloud Deployment (Render.com)

Since you want this project running while your computers are powered off:

1. **Push to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit of Foodie Tracker"
   git branch -M main
   git remote add origin https://github.com/<your-username>/foodie-tracker.git
   git push -u origin main
   ```
2. **Deploy on Render**:
   - Go to [dashboard.render.com](https://dashboard.render.com).
   - Click **New +** -> **Web Service**.
   - Select your GitHub `foodie-tracker` repository.
   - Set Environment Variables:
     - `NTFY_TOPIC`: (e.g. `foodie-tracker-john-828`)
     - `BASE_URL`: (e.g. `https://foodie-tracker-xxx.onrender.com`)
     - `HOME_LAT` & `HOME_LON`: (Your home GPS coordinates)
     - `WORK_LAT` & `WORK_LON`: (Your office GPS coordinates)
   - Click **Create Web Service**.

Render will build and run your app 24/7 for free!

---

## 🧪 Testing Locally

To test the entire system without leaving your desk:

```bash
# 1. Install dependencies
npm install

# 2. Run the end-to-end simulation
npm run simulate

# 3. Start the local server
npm start
```

Open `http://localhost:3000` in your browser to view the interactive map and submitted reviews.

---

## 📁 Project Structure

```
foodie-tracker/
├── package.json              # App dependencies & scripts
├── render.yaml               # 1-Click Render.com deployment manifest
├── .env.example              # Configuration template
├── server/
│   ├── index.js              # Express web server & health checks
│   ├── config.js             # Environment variable manager
│   ├── db.js                 # SQLite database & data access layer
│   ├── services/
│   │   ├── geoUtils.js       # Haversine distance & geofence checks
│   │   ├── osmService.js     # OpenStreetMap Overpass food stall finder
│   │   ├── dwellTracker.js   # 5-minute dwell & cooldown engine
│   │   └── notifier.js       # ntfy.sh push notification dispatcher
│   └── routes/
│       ├── location.js       # OwnTracks webhook ingestion
│       └── reviews.js        # Review CRUD & photo upload endpoints
├── public/
│   ├── index.html            # Interactive Foodie Map & Search Dashboard
│   ├── review.html           # Mobile review form with live camera/photo
│   ├── css/style.css         # Mobile-first responsive UI
│   ├── js/map.js             # Leaflet map logic & Google Maps links
│   └── js/review.js          # Rating logic & session loader
└── tests/
    └── simulate-visit.js     # End-to-end GPS & dwell test script
```
