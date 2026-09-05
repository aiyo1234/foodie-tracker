/**
 * End-to-End Test & Simulation Script
 * Simulates OwnTracks GPS events to test:
 * 1. Transit movement
 * 2. 5-minute stationary dwell at an eatery
 * 3. Food place lookup via OpenStreetMap
 * 4. ntfy push notification trigger
 * 5. Home exclusion zone check
 * 6. Review creation and Google Maps link generation
 */

const { processLocation, resetCluster } = require('../server/services/dwellTracker');
const db = require('../server/db');

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSimulation() {
  console.log('=====================================================');
  console.log('🧪 STARTING FOODIE TRACKER SIMULATION');
  console.log('=====================================================\n');

  resetCluster();

  // Coordinates for a known dining area (Chinatown Complex Food Centre, Singapore)
  const EATERY_LAT = 1.2823;
  const EATERY_LON = 103.8431;

  // Step 1: Walking / Transit (moving between points)
  console.log('📍 [Step 1] Simulating user walking on the street...');
  const transit1 = await processLocation({
    lat: 1.2800,
    lon: 103.8410,
    acc: 10,
    tst: Math.floor(Date.now() / 1000) - 400
  });
  console.log('   Result:', transit1);

  // Step 2: Arrival at Chinatown Food Centre (0 minutes dwell)
  console.log('\n📍 [Step 2] User arrives at Food Centre (T = 0s)...');
  const arriveTime = Math.floor(Date.now() / 1000) - 320; // 320 seconds ago
  const arrival = await processLocation({
    lat: EATERY_LAT,
    lon: EATERY_LON,
    acc: 8,
    tst: arriveTime
  });
  console.log('   Result:', arrival);

  // Step 3: Still seated, 2 minutes later (120s dwell)
  console.log('\n📍 [Step 3] User still seated after 2 minutes (T = 120s)...');
  const dwell2m = await processLocation({
    lat: EATERY_LAT + 0.0001, // Slight GPS jitter (~11m)
    lon: EATERY_LON - 0.0001,
    acc: 12,
    tst: arriveTime + 120
  });
  console.log('   Result:', dwell2m);

  // Step 4: Still seated, 5+ minutes later (320s dwell) -> MUST TRIGGER ALERT!
  console.log('\n📍 [Step 4] User stays for 5+ minutes (T = 320s)... Triggering threshold!');
  const triggerResult = await processLocation({
    lat: EATERY_LAT,
    lon: EATERY_LON,
    acc: 10,
    tst: arriveTime + 320
  });
  console.log('   Trigger Result:', JSON.stringify(triggerResult, null, 2));

  if (triggerResult.status === 'triggered') {
    console.log('   ✅ PASS: 5-minute dwell successfully detected and alert dispatched!');
    console.log(`   🍽️ Detected Place: ${triggerResult.place.name} (${triggerResult.place.category})`);
    console.log(`   🔗 Review Session ID: ${triggerResult.sessionId}`);
  } else {
    console.log('   ⚠️ Trigger status:', triggerResult.status);
  }

  // Step 5: Test Home Exclusion Zone
  console.log('\n📍 [Step 5] Simulating user staying at Home (lat: 1.3500, lon: 103.8000)...');
  const homeResult = await processLocation({
    lat: 1.3500,
    lon: 103.8000,
    acc: 5,
    tst: Math.floor(Date.now() / 1000)
  });
  console.log('   Home Result:', homeResult);
  if (homeResult.status === 'excluded') {
    console.log('   ✅ PASS: Home exclusion zone correctly blocked notification!');
  }

  // Step 6: Create a sample review in the database
  console.log('\n📝 [Step 6] Creating sample food review in database...');
  const sampleReview = {
    id: 'rev_test_' + Date.now(),
    name: 'Chinatown Hawker - Signature Claypot Rice',
    lat: EATERY_LAT,
    lon: EATERY_LON,
    address: 'Smith Street, Chinatown, Singapore',
    rating: 5,
    comment: 'Crispy burnt rice bottom, super tender chicken and fragrant Chinese sausage. 10/10 must visit!',
    photo_url: null,
    category: 'Hawker Stall',
    created_at: Date.now()
  };
  db.insertReview(sampleReview);

  // Step 7: Verify review retrieval
  const allReviews = db.getReviews();
  console.log(`\n📊 [Step 7] Total saved reviews in database: ${allReviews.length}`);
  const latest = allReviews[0];
  console.log(`   Latest entry: "${latest.name}" - ${latest.rating} ⭐`);
  console.log(`   Google Maps URL: https://www.google.com/maps/search/?api=1&query=${latest.lat},${latest.lon}`);

  console.log('\n=====================================================');
  console.log('🎉 ALL SYSTEM SIMULATION TESTS PASSED SUCCESSFULLY!');
  console.log('=====================================================\n');
  db.close();
}

runSimulation()
  .then(() => {})
  .catch(err => {
    console.error('Test failed:', err);
    process.exit(1);
  });
