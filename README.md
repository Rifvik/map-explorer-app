# 🗺️ Map Explorer - Offline Android Map & Fog-of-War Tracker

An Android-compatible offline map application featuring online map tile downloading, high-accuracy GPS tracking, Fog-of-War terrain discovery, and real-time area exploration percentage calculations.

---

## 🌟 Key Features

1. **Online Tile Downloader into IndexedDB**:
   - Select any region on the map while connected to the internet.
   - Download tiles across zoom levels directly into local device storage (`IndexedDB`).
   - Navigate and render the entire downloaded area when **100% offline**.

2. **Fog of War Terrain Discovery**:
   - Unexplored map regions are covered in a dark fog overlay.
   - As you move around with GPS active, a circular radius (65m) clears out fog in real-time.

3. **Exploration Percentage Calculation**:
   - Subdivides the selected target region into grid cells.
   - Computes live percentage of explored territory (e.g. `Explored: 34.8%`).

4. **Built-in GPS Simulator**:
   - Test walking routes on desktop or mobile by tapping any target point on the map.

5. **Android Ready**:
   - Optimized touch UI, standalone PWA support, and Android Capacitor APK configuration.

---

## 📱 How to Run & Test

### Option 1: Run Web Version
Run in PowerShell:
```powershell
cd C:\Users\ritga\.gemini\antigravity\scratch\map-explorer-app
python -m http.server 8000
```
Open **[http://localhost:8000](http://localhost:8000)** in your browser.

### Option 2: One-Click Android APK Export (PWABuilder)
1. Host or launch your app (or deploy to Netlify/Vercel/GitHub Pages).
2. Go to **[pwabuilder.com](https://www.pwabuilder.com/)**.
3. Paste your URL and click **Package for Android** to generate a signed `.apk` or `.aab` file!

### Option 3: Build Android APK with Capacitor CLI
```powershell
cd C:\Users\ritga\.gemini\antigravity\scratch\map-explorer-app
npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap add android
npx cap open android
```
*(In Android Studio, click **Build > Build APK**)*.
