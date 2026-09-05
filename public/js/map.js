let map;
let allReviews = [];
let markers = [];
let currentRatingFilter = 'all';
let currentSearchQuery = '';

// Rating descriptions & pin colors
const ratingColors = {
  5: 'pin-5',
  4: 'pin-4',
  3: 'pin-3',
  2: 'pin-2',
  1: 'pin-1'
};

document.addEventListener('DOMContentLoaded', () => {
  initMap();
  loadReviews();
  checkPendingReviews();

  // Poll for pending reviews periodically (every 30 seconds)
  setInterval(checkPendingReviews, 30000);
});

function initMap() {
  // Default to central view (will re-center once reviews load)
  map = L.map('map', { zoomControl: false }).setView([1.3521, 103.8198], 13);

  // Position zoom controls in bottom-right so it doesn't overlap search bar
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // CartoDB Voyager Tile Layer (clean, modern, Google Maps look-and-feel)
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
  }).addTo(map);

  // Try to center on user's current location if no reviews yet
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (allReviews.length === 0) {
          map.setView([pos.coords.latitude, pos.coords.longitude], 14);
        }
      },
      () => {},
      { timeout: 5000 }
    );
  }
}

async function loadReviews() {
  try {
    const res = await fetch('/api/reviews');
    allReviews = await res.json();
    renderReviews(allReviews);
    updatePanelTitle(allReviews.length);

    // If there are reviews, fit map bounds to show all pins
    if (allReviews.length > 0) {
      const bounds = L.latLngBounds(allReviews.map(r => [r.lat, r.lon]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 16 });
    }
  } catch (err) {
    console.error('Failed to load reviews:', err);
  }
}

function renderReviews(reviews) {
  // Clear existing markers
  markers.forEach(m => map.removeLayer(m));
  markers = [];

  const listContainer = document.getElementById('reviewsList');
  listContainer.innerHTML = '';

  if (reviews.length === 0) {
    listContainer.innerHTML = `
      <div style="text-align: center; color: #94a3b8; padding: 30px 10px;">
        <span style="font-size: 32px; display: block; margin-bottom: 8px;">🍜</span>
        <p style="font-weight: 600; color: #64748b;">No foodie spots found</p>
        <span style="font-size: 12px;">Visit an eatery with your phone or tap "+ Log Food" to add one manually!</span>
      </div>
    `;
    return;
  }

  reviews.forEach(review => {
    // 1. Create Map Marker
    const pinClass = ratingColors[review.rating] || 'pin-5';
    const customIcon = L.divIcon({
      className: `food-pin ${pinClass}`,
      html: `<span>${review.rating}★</span>`,
      iconSize: [36, 36],
      iconAnchor: [18, 18],
      popupAnchor: [0, -18]
    });

    const marker = L.marker([review.lat, review.lon], { icon: customIcon });

    const stars = '★'.repeat(review.rating) + '☆'.repeat(5 - review.rating);
    const dateStr = new Date(review.created_at).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });

    const gmapsUrl = `https://www.google.com/maps/search/?api=1&query=${review.lat},${review.lon}`;

    const popupHtml = `
      <div class="popup-container">
        ${review.photo_url ? `<img src="${review.photo_url}" class="popup-img" alt="${escapeHtml(review.name)}">` : ''}
        <h3 class="popup-title">${escapeHtml(review.name)}</h3>
        <div class="popup-rating">${stars} <span style="color: #64748b; font-size: 11px;">&bull; ${dateStr}</span></div>
        ${review.address ? `<div style="font-size: 11px; color: #64748b; margin-bottom: 6px;">📍 ${escapeHtml(review.address)}</div>` : ''}
        ${review.comment ? `<p class="popup-comment">"${escapeHtml(review.comment)}"</p>` : ''}
        <a href="${gmapsUrl}" target="_blank" class="btn-gmaps">
          <span>🗺️ Open in Google Maps</span>
        </a>
      </div>
    `;

    marker.bindPopup(popupHtml);
    marker.addTo(map);
    markers.push(marker);

    // 2. Create Drawer Card
    const card = document.createElement('div');
    card.className = 'review-card';
    card.onclick = () => {
      map.setView([review.lat, review.lon], 16);
      marker.openPopup();
      // On mobile, collapse panel slightly when card is tapped
      if (window.innerWidth < 768) {
        document.getElementById('reviewsPanel').classList.remove('open');
      }
    };

    const photoHtml = review.photo_url 
      ? `<img src="${review.photo_url}" class="card-photo" alt="${escapeHtml(review.name)}">`
      : `<div class="card-photo" style="display: flex; align-items: center; justify-content: center; font-size: 24px;">🍱</div>`;

    card.innerHTML = `
      ${photoHtml}
      <div class="card-info">
        <div>
          <div class="card-name">${escapeHtml(review.name)}</div>
          <div class="card-stars">${stars}</div>
          ${review.comment ? `<div class="card-comment">${escapeHtml(review.comment)}</div>` : ''}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
          <span style="font-size: 11px; color: #94a3b8;">${dateStr}</span>
          <span style="font-size: 12px; color: #1a73e8; font-weight: 600;">View pin ↗</span>
        </div>
      </div>
    `;

    listContainer.appendChild(card);
  });
}

function filterReviews() {
  const query = document.getElementById('searchInput').value.toLowerCase().trim();
  currentSearchQuery = query;

  const filtered = allReviews.filter(r => {
    // Rating match
    let matchRating = true;
    if (currentRatingFilter === 'photo') {
      matchRating = !!r.photo_url;
    } else if (currentRatingFilter !== 'all') {
      matchRating = r.rating >= parseInt(currentRatingFilter, 10);
    }

    // Query match
    let matchQuery = true;
    if (query) {
      const inName = r.name.toLowerCase().includes(query);
      const inComment = (r.comment || '').toLowerCase().includes(query);
      const inAddr = (r.address || '').toLowerCase().includes(query);
      matchQuery = inName || inComment || inAddr;
    }

    return matchRating && matchQuery;
  });

  renderReviews(filtered);
  updatePanelTitle(filtered.length);
}

function setRatingFilter(filter, btn) {
  currentRatingFilter = filter;
  document.querySelectorAll('.filter-chips .chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');
  filterReviews();
}

function updatePanelTitle(count) {
  document.getElementById('panelTitle').textContent = `My Foodie Spots (${count})`;
}

function toggleReviewsPanel() {
  const panel = document.getElementById('reviewsPanel');
  panel.classList.toggle('open');
}

// Pending Reviews logic
async function checkPendingReviews() {
  try {
    const res = await fetch('/api/reviews/pending/all');
    const pendings = await res.json();
    const btn = document.getElementById('pendingBtn');
    const countBadge = document.getElementById('pendingCount');

    if (pendings.length > 0) {
      btn.style.display = 'flex';
      countBadge.textContent = pendings.length;
      renderPendingModal(pendings);
    } else {
      btn.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to check pending reviews:', err);
  }
}

function renderPendingModal(pendings) {
  const list = document.getElementById('pendingList');
  list.innerHTML = '';

  pendings.forEach(p => {
    const item = document.createElement('div');
    item.style = 'border: 1px solid var(--border); border-radius: 12px; padding: 12px; display: flex; justify-content: space-between; align-items: center; background: #f8fafc;';
    
    const timeAgo = formatTimeAgo(p.created_at);

    item.innerHTML = `
      <div>
        <strong style="display: block; font-size: 15px; color: var(--text-main);">${escapeHtml(p.name)}</strong>
        <span style="font-size: 12px; color: var(--text-muted);">${escapeHtml(p.address || 'Detected location')} &bull; ${timeAgo}</span>
      </div>
      <a href="/review.html?session=${p.id}" style="background: var(--primary); color: white; text-decoration: none; padding: 6px 12px; border-radius: 8px; font-size: 12px; font-weight: 700; white-space: nowrap;">
        Rate Now
      </a>
    `;

    list.appendChild(item);
  });
}

function openPendingModal() {
  document.getElementById('pendingModal').style.display = 'flex';
}

function closePendingModal() {
  document.getElementById('pendingModal').style.display = 'none';
}

function formatTimeAgo(timestamp) {
  const diffSec = Math.round((Date.now() - timestamp) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.round(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
