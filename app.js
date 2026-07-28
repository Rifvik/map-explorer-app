/**
 * Map Explorer - Offline Tile Downloader & Fog of War Engine
 * IndexedDB Tile Cache, Leaflet Custom Layer, Canvas Fog Mask, and % Coverage Math.
 */

(function () {
  'use strict';

  // --- DOM Elements ---
  const mapElement = document.getElementById('map');
  const fogCanvas = document.getElementById('fogCanvas');
  const fogCtx = fogCanvas.getContext('2d');

  const onlineBadge = document.getElementById('onlineBadge');
  const onlineText = document.getElementById('onlineText');
  const gpsBtn = document.getElementById('gpsBtn');

  const coveragePercentEl = document.getElementById('coveragePercent');
  const targetAreaSizeEl = document.getElementById('targetAreaSize');
  const cachedTileCountEl = document.getElementById('cachedTileCount');

  const trackGpsBtn = document.getElementById('trackGpsBtn');
  const trackIcon = document.getElementById('trackIcon');
  const trackLabel = document.getElementById('trackLabel');

  const downloadAreaModeBtn = document.getElementById('downloadAreaModeBtn');
  const downloadGuide = document.getElementById('downloadGuide');
  const confirmDownloadBtn = document.getElementById('confirmDownloadBtn');
  const cancelDownloadBtn = document.getElementById('cancelDownloadBtn');

  const progressModal = document.getElementById('progressModal');
  const progressBar = document.getElementById('progressBar');
  const progressText = document.getElementById('progressText');
  const progressSub = document.getElementById('progressSub');

  const simGpsBtn = document.getElementById('simGpsBtn');
  const simNotice = document.getElementById('simNotice');
  const stopSimBtn = document.getElementById('stopSimBtn');
  const clearDataBtn = document.getElementById('clearDataBtn');

  // --- App State ---
  let map = null;
  let db = null;
  let isTrackingGPS = false;
  let isSimulating = false;
  let gpsWatchId = null;

  let currentPos = { lat: 37.7749, lng: -122.4194 }; // Default San Francisco
  let exploredPoints = JSON.parse(localStorage.getItem('map_exploredPoints') || '[]');
  let targetBounds = JSON.parse(localStorage.getItem('map_targetBounds') || 'null'); // { minLat, maxLat, minLng, maxLng }

  const REVEAL_RADIUS_METERS = 65; // Radius of fog cleared around user

  // --- 1. IndexedDB Tile Cache Setup ---
  function initDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('MapExplorerCache', 1);
      request.onupgradeneeded = (e) => {
        const database = e.target.result;
        if (!database.objectStoreNames.contains('tiles')) {
          database.createObjectStore('tiles');
        }
      };
      request.onsuccess = (e) => {
        db = e.target.result;
        updateCachedTileCount();
        resolve(db);
      };
      request.onerror = (e) => {
        console.error('IndexedDB Error:', e);
        resolve(null);
      };
    });
  }

  function getCachedTile(key) {
    return new Promise((resolve) => {
      if (!db) return resolve(null);
      const tx = db.transaction('tiles', 'readonly');
      const store = tx.objectStore('tiles');
      const req = store.get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  }

  function saveCachedTile(key, blob) {
    return new Promise((resolve) => {
      if (!db) return resolve();
      const tx = db.transaction('tiles', 'readwrite');
      const store = tx.objectStore('tiles');
      store.put(blob, key);
      tx.oncomplete = () => {
        updateCachedTileCount();
        resolve();
      };
    });
  }

  function updateCachedTileCount() {
    if (!db) return;
    const tx = db.transaction('tiles', 'readonly');
    const store = tx.objectStore('tiles');
    const countReq = store.count();
    countReq.onsuccess = () => {
      cachedTileCountEl.textContent = `${countReq.result} Tiles`;
    };
  }

  function clearAllCachedTiles() {
    if (!db) return;
    const tx = db.transaction('tiles', 'readwrite');
    const store = tx.objectStore('tiles');
    store.clear();
    tx.oncomplete = () => {
      updateCachedTileCount();
    };
  }

  // --- 2. Custom Offline Leaflet TileLayer ---
  const OfflineTileLayer = L.TileLayer.extend({
    createTile: function (coords, done) {
      const tile = document.createElement('img');
      tile.setAttribute('role', 'presentation');

      const tileKey = `${coords.z}_${coords.x}_${coords.y}`;
      const url = this.getTileUrl(coords);

      // Check IndexedDB cache first
      getCachedTile(tileKey).then((cachedBlob) => {
        if (cachedBlob) {
          tile.src = URL.createObjectURL(cachedBlob);
          done(null, tile);
        } else if (navigator.onLine) {
          // Fetch from network and store in cache
          fetch(url)
            .then((res) => res.blob())
            .then((blob) => {
              saveCachedTile(tileKey, blob);
              tile.src = URL.createObjectURL(blob);
              done(null, tile);
            })
            .catch(() => {
              tile.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="%230f172a"/><text x="128" y="128" fill="%23334155" text-anchor="middle" font-size="12">Offline Tile</text></svg>';
              done(null, tile);
            });
        } else {
          // Offline and not cached
          tile.src = 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" fill="%230f172a"/><text x="128" y="128" fill="%23334155" text-anchor="middle" font-size="12">Tile Not Cached</text></svg>';
          done(null, tile);
        }
      });

      return tile;
    }
  });

  // --- 3. Initialize Leaflet Map ---
  function initMap() {
    map = L.map('map', {
      center: [currentPos.lat, currentPos.lng],
      zoom: 15,
      zoomControl: false
    });

    // Dark Map Tiles URL (CartoDB Dark Matter with OSM fallback)
    const tileUrl = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    const offlineLayer = new OfflineTileLayer(tileUrl, {
      maxZoom: 18,
      subdomains: 'abcd',
      attribution: '&copy; OpenStreetMap &copy; CARTO'
    });
    offlineLayer.addTo(map);

    // Initial Location Marker
    updateUserMarker(currentPos);

    // Sync Fog Canvas on map movement/zoom
    map.on('move zoomend resize', syncFogCanvas);
    syncFogCanvas();

    // Map Click Listener for Simulator
    map.on('click', (e) => {
      if (isSimulating) {
        moveToPosition(e.latlng.lat, e.latlng.lng);
      }
    });

    // Try to get real current GPS position on start
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          currentPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          map.setView([currentPos.lat, currentPos.lng], 15);
          updateUserMarker(currentPos);
        },
        () => console.log('Initial location request denied/failed')
      );
    }
  }

  let userMarker = null;
  function updateUserMarker(pos) {
    if (!userMarker) {
      const userIcon = L.divIcon({
        className: 'user-location-marker',
        html: '<div style="width:16px;height:16px;background:#38bdf8;border:3px solid #ffffff;border-radius:50%;box-shadow:0 0 12px #38bdf8;"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
      });
      userMarker = L.marker([pos.lat, pos.lng], { icon: userIcon }).addTo(map);
    } else {
      userMarker.setLatLng([pos.lat, pos.lng]);
    }
  }

  // --- 4. Fog of War Canvas Engine ---
  function syncFogCanvas() {
    const size = map.getSize();
    fogCanvas.width = size.x;
    fogCanvas.height = size.y;

    renderFog();
  }

  function renderFog() {
    if (!map) return;
    const width = fogCanvas.width;
    const height = fogCanvas.height;

    // 1. Draw Full Dark Fog Shroud
    fogCtx.clearRect(0, 0, width, height);
    fogCtx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    fogCtx.fillRect(0, 0, width, height);

    // 2. Cut Out Holes Around Explored GPS Coordinates using destination-out
    fogCtx.globalCompositeOperation = 'destination-out';

    for (let pt of exploredPoints) {
      const containerPt = map.latLngToContainerPoint([pt.lat, pt.lng]);
      
      // Calculate pixel radius corresponding to REVEAL_RADIUS_METERS at current zoom
      const centerLatLng = map.containerPointToLatLng(containerPt);
      const edgeLatLng = L.GeometryUtil ? L.GeometryUtil.destination(centerLatLng, 90, REVEAL_RADIUS_METERS) : centerLatLng;
      const edgePt = map.latLngToContainerPoint([centerLatLng.lat, centerLatLng.lng + 0.0008]);
      const pixelRadius = Math.max(30, Math.hypot(edgePt.x - containerPt.x, edgePt.y - containerPt.y));

      fogCtx.beginPath();
      fogCtx.arc(containerPt.x, containerPt.y, pixelRadius, 0, Math.PI * 2);
      fogCtx.fill();
    }

    fogCtx.globalCompositeOperation = 'source-over';
    updateCoverageStats();
  }

  function addExploredPoint(lat, lng) {
    // Only add if at least 15 meters away from previous point to avoid memory bloat
    const lastPt = exploredPoints[exploredPoints.length - 1];
    if (lastPt) {
      const dist = map.distance([lat, lng], [lastPt.lat, lastPt.lng]);
      if (dist < 12) return;
    }

    exploredPoints.push({ lat, lng });
    localStorage.setItem('map_exploredPoints', JSON.stringify(exploredPoints));
    renderFog();
  }

  // --- 5. Exploration Coverage Percentage Calculation ---
  function updateCoverageStats() {
    if (!targetBounds) {
      coveragePercentEl.textContent = '0.0%';
      targetAreaSizeEl.textContent = 'Select Area';
      return;
    }

    // Target Area Size Calculation (in sq km)
    const bounds = L.latLngBounds(
      [targetBounds.minLat, targetBounds.minLng],
      [targetBounds.maxLat, targetBounds.maxLng]
    );

    const widthMeters = bounds.getSouthWest().distanceTo(L.latLng(bounds.getSouthWest().lat, bounds.getNorthEast().lng));
    const heightMeters = bounds.getSouthWest().distanceTo(L.latLng(bounds.getNorthEast().lat, bounds.getSouthWest().lng));
    const areaSqKm = (widthMeters * heightMeters) / 1000000;
    targetAreaSizeEl.textContent = `${areaSqKm.toFixed(2)} km²`;

    // Subdivide Target Bounds into a 35x35 Grid
    const GRID_SIZE = 35;
    const latStep = (targetBounds.maxLat - targetBounds.minLat) / GRID_SIZE;
    const lngStep = (targetBounds.maxLng - targetBounds.minLng) / GRID_SIZE;

    let exploredCells = 0;
    const totalCells = GRID_SIZE * GRID_SIZE;

    for (let r = 0; r < GRID_SIZE; r++) {
      const cellLat = targetBounds.minLat + (r + 0.5) * latStep;
      for (let c = 0; c < GRID_SIZE; c++) {
        const cellLng = targetBounds.minLng + (c + 0.5) * lngStep;
        const cellLatLng = L.latLng(cellLat, cellLng);

        // Check if cell is within REVEAL_RADIUS_METERS of any explored point
        const isExplored = exploredPoints.some(pt => cellLatLng.distanceTo([pt.lat, pt.lng]) <= REVEAL_RADIUS_METERS);
        if (isExplored) {
          exploredCells++;
        }
      }
    }

    const percentage = ((exploredCells / totalCells) * 100).toFixed(1);
    coveragePercentEl.textContent = `${percentage}%`;
  }

  // --- 6. Region Downloader ---
  function startDownloadRegionProcess() {
    const bounds = map.getBounds();
    const minZoom = Math.max(13, map.getZoom());
    const maxZoom = Math.min(17, minZoom + 2);

    targetBounds = {
      minLat: bounds.getSouth(),
      maxLat: bounds.getNorth(),
      minLng: bounds.getWest(),
      maxLng: bounds.getEast()
    };
    localStorage.setItem('map_targetBounds', JSON.stringify(targetBounds));

    // Gather Tile Coordinates across zoom levels
    const tilesToFetch = [];
    for (let z = minZoom; z <= maxZoom; z++) {
      const minTile = latLngToTileXY(targetBounds.maxLat, targetBounds.minLng, z);
      const maxTile = latLngToTileXY(targetBounds.minLat, targetBounds.maxEast || targetBounds.maxLng, z);

      for (let x = Math.min(minTile.x, maxTile.x); x <= Math.max(minTile.x, maxTile.x); x++) {
        for (let y = Math.min(minTile.y, maxTile.y); y <= Math.max(minTile.y, maxTile.y); y++) {
          tilesToFetch.push({ z, x, y });
        }
      }
    }

    if (tilesToFetch.length === 0) {
      alert('Selected region is too small. Please zoom out slightly.');
      return;
    }

    if (tilesToFetch.length > 1200) {
      alert('Selected area contains over 1,200 tiles. Please zoom in to select a smaller region.');
      return;
    }

    // Show Progress Modal
    progressModal.classList.remove('hidden');
    progressBar.style.width = '0%';
    progressSub.textContent = `Downloading ${tilesToFetch.length} map tiles...`;

    let completed = 0;
    const tileUrlTemplate = 'https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png';

    function fetchNextBatch() {
      if (completed >= tilesToFetch.length) {
        progressSub.textContent = 'Download Complete! Map ready offline.';
        setTimeout(() => {
          progressModal.classList.add('hidden');
          renderFog();
        }, 1200);
        return;
      }

      const item = tilesToFetch[completed];
      const key = `${item.z}_${item.x}_${item.y}`;
      const url = tileUrlTemplate.replace('{z}', item.z).replace('{x}', item.x).replace('{y}', item.y);

      fetch(url)
        .then(res => res.blob())
        .then(blob => saveCachedTile(key, blob))
        .catch(err => console.log('Tile fetch error:', err))
        .finally(() => {
          completed++;
          const pct = Math.round((completed / tilesToFetch.length) * 100);
          progressBar.style.width = `${pct}%`;
          progressText.textContent = `${completed} / ${tilesToFetch.length} Tiles (${pct}%)`;
          setTimeout(fetchNextBatch, 15);
        });
    }

    fetchNextBatch();
  }

  function latLngToTileXY(lat, lng, zoom) {
    const latRad = lat * Math.PI / 180;
    const n = Math.pow(2, zoom);
    const x = Math.floor((lng + 180) / 360 * n);
    const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
    return { x, y };
  }

  // --- 7. Position Updates & Simulators ---
  function moveToPosition(lat, lng) {
    currentPos = { lat, lng };
    updateUserMarker(currentPos);
    addExploredPoint(lat, lng);
  }

  function toggleGPSTracking() {
    if (isTrackingGPS) {
      isTrackingGPS = false;
      if (gpsWatchId) navigator.geolocation.clearWatch(gpsWatchId);
      trackIcon.textContent = '📍';
      trackLabel.textContent = 'START TRACKING';
      trackGpsBtn.classList.remove('accent');
    } else {
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your browser.');
        return;
      }

      isTrackingGPS = true;
      trackIcon.textContent = '⏹️';
      trackLabel.textContent = 'STOP TRACKING';
      trackGpsBtn.classList.add('accent');

      gpsWatchId = navigator.geolocation.watchPosition(
        (pos) => {
          moveToPosition(pos.coords.latitude, pos.coords.longitude);
          map.panTo([pos.coords.latitude, pos.coords.longitude]);
        },
        (err) => console.error('GPS Watch error:', err),
        { enableHighAccuracy: true, maximumAge: 2000 }
      );
    }
  }

  // --- Event Listeners ---
  gpsBtn.addEventListener('click', () => {
    map.flyTo([currentPos.lat, currentPos.lng], 16);
  });

  trackGpsBtn.addEventListener('click', toggleGPSTracking);

  downloadAreaModeBtn.addEventListener('click', () => {
    downloadGuide.classList.remove('hidden');
  });

  cancelDownloadBtn.addEventListener('click', () => {
    downloadGuide.classList.add('hidden');
  });

  confirmDownloadBtn.addEventListener('click', () => {
    downloadGuide.classList.add('hidden');
    startDownloadRegionProcess();
  });

  simGpsBtn.addEventListener('click', () => {
    isSimulating = true;
    simNotice.classList.remove('hidden');
  });

  stopSimBtn.addEventListener('click', () => {
    isSimulating = false;
    simNotice.classList.add('hidden');
  });

  clearDataBtn.addEventListener('click', () => {
    if (confirm('Reset all explored fog data and clear cached tiles?')) {
      exploredPoints = [];
      localStorage.removeItem('map_exploredPoints');
      clearAllCachedTiles();
      renderFog();
    }
  });

  // Online / Offline Network Status Listener
  function updateOnlineStatus() {
    if (navigator.onLine) {
      onlineBadge.className = 'status-badge online';
      onlineText.textContent = 'ONLINE';
    } else {
      onlineBadge.className = 'status-badge offline';
      onlineText.textContent = 'OFFLINE';
    }
  }

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // Initialization
  initDB().then(initMap);

})();
