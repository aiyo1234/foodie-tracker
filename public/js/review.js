const ratingLabels = {
  5: '⭐⭐⭐⭐⭐ Outstanding / Must Try!',
  4: '⭐⭐⭐⭐ Great food, will return!',
  3: '⭐⭐⭐ Decent / Average',
  2: '⭐⭐ Below expectations',
  1: '⭐ Disappointing'
};

let currentRating = 5;

document.addEventListener('DOMContentLoaded', () => {
  setupStarRating();
  loadSessionOrGeo();
  setupFormSubmit();
});

function setupStarRating() {
  const starButtons = document.querySelectorAll('.star-btn');
  const ratingDesc = document.getElementById('ratingDesc');
  const ratingValueInput = document.getElementById('ratingValue');

  function updateStars(val) {
    currentRating = val;
    ratingValueInput.value = val;
    ratingDesc.textContent = ratingLabels[val] || '';

    starButtons.forEach(btn => {
      const btnVal = parseInt(btn.dataset.value, 10);
      if (btnVal <= val) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }

  starButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.value, 10);
      updateStars(val);
    });
  });

  // Default to 5 stars
  updateStars(5);
}

async function loadSessionOrGeo() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get('session');

  if (sessionId) {
    document.getElementById('sessionId').value = sessionId;
    try {
      const res = await fetch(`/api/reviews/pending/${sessionId}`);
      if (res.ok) {
        const data = await res.json();
        document.getElementById('storeName').value = data.name || '';
        document.getElementById('lat').value = data.lat;
        document.getElementById('lon').value = data.lon;
        document.getElementById('address').value = data.address || '';
        document.getElementById('category').value = data.category || 'Restaurant';

        document.getElementById('visitSubtitle').textContent = `Detected at ${data.address || 'Food Stall'}`;
        showCoordsAndGoogleMapsLink(data.lat, data.lon);

        // Render suggestion candidate pills if available
        if (data.candidates && data.candidates.length > 1) {
          const container = document.getElementById('candidatePills');
          container.innerHTML = '';
          data.candidates.forEach(c => {
            const pill = document.createElement('button');
            pill.type = 'button';
            pill.className = 'candidate-pill';
            pill.textContent = `${c.name} (${c.distance}m)`;
            pill.onclick = () => {
              document.getElementById('storeName').value = c.name;
              document.getElementById('category').value = c.category;
            };
            container.appendChild(pill);
          });
          document.getElementById('candidatePillsContainer').style.display = 'block';
        }
        return;
      }
    } catch (err) {
      console.warn('Could not load session data:', err);
    }
  }

  // If no session ID, try getting current browser GPS location
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        document.getElementById('lat').value = pos.coords.latitude;
        document.getElementById('lon').value = pos.coords.longitude;
        showCoordsAndGoogleMapsLink(pos.coords.latitude, pos.coords.longitude);
      },
      () => {
        // Fallback default coordinates if location unavailable
        document.getElementById('lat').value = 1.3521;
        document.getElementById('lon').value = 103.8198;
      }
    );
  }
}

function showCoordsAndGoogleMapsLink(lat, lon) {
  const box = document.getElementById('gmapsLinkBox');
  const display = document.getElementById('coordsDisplay');
  const link = document.getElementById('gmapsExternalLink');

  box.style.display = 'block';
  display.textContent = `${parseFloat(lat).toFixed(4)}, ${parseFloat(lon).toFixed(4)}`;
  link.href = `https://www.google.com/maps/search/?api=1&query=${lat},${lon}`;
}

function handlePhotoSelect(event) {
  const file = event.target.files[0];
  if (file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      document.getElementById('photoPreview').src = e.target.result;
      document.getElementById('photoPreviewWrapper').style.display = 'block';
    };
    reader.readAsDataURL(file);
  }
}

function removePhoto() {
  document.getElementById('photoInput').value = '';
  document.getElementById('photoPreview').src = '';
  document.getElementById('photoPreviewWrapper').style.display = 'none';
}

function setupFormSubmit() {
  const form = document.getElementById('reviewForm');
  const submitBtn = document.getElementById('submitBtn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const name = document.getElementById('storeName').value.trim();
    if (!name) {
      alert('Please enter the food stall or restaurant name.');
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Saving review...';

    const formData = new FormData(form);

    try {
      const res = await fetch('/api/reviews', {
        method: 'POST',
        body: formData
      });

      if (res.ok) {
        // Redirect to interactive map
        window.location.href = '/';
      } else {
        const err = await res.json();
        alert('Error saving review: ' + (err.error || 'Server error'));
        submitBtn.disabled = false;
        submitBtn.textContent = '💾 Save to My Foodie Map';
      }
    } catch (err) {
      alert('Network error while saving review: ' + err.message);
      submitBtn.disabled = false;
      submitBtn.textContent = '💾 Save to My Foodie Map';
    }
  });
}

async function dismissSession() {
  const sessionId = document.getElementById('sessionId').value;
  if (sessionId) {
    try {
      await fetch(`/api/reviews/pending/${sessionId}/dismiss`, { method: 'POST' });
    } catch (e) {}
  }
  window.location.href = '/';
}
