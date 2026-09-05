const { createClient } = require('@libsql/client');

const client = createClient({
  url: 'libsql://foodie-aiyo1234.aws-ap-northeast-1.turso.io',
  authToken: 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg2MDE1ODMsImlkIjoiMDFhMDcwZjUtOTUwMS03Nzg5LTk5YWMtZGE0YWVlM2Q1MjkxIiwia2lkIjoiSENIQVkyMnYyMWhjWTZob1FRbXczWlNpQnItZ1FHYWc0MmpDaHUtSVJkUSIsInJpZCI6IjA2YzE5MDlmLWEzOTYtNDBmNC1iYWQyLTZjYjk0OWVjMzFjZSJ9.Q9M0dRa1c9jk_U9tHJBdexNO74h7e88W50tHtECHa3z1eyccKmjNAo8nytAKEH6yw0uTH0An5ozQgqkPaHJXCQ'
});

async function test() {
  console.log('Connecting to Turso Cloud DB...');
  await client.batch([
    `CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      address TEXT,
      rating INTEGER NOT NULL,
      comment TEXT,
      photo_url TEXT,
      category TEXT,
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS pending_reviews (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      candidates_json TEXT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      address TEXT,
      category TEXT,
      status TEXT DEFAULT 'pending',
      created_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS prompted_places (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lat REAL NOT NULL,
      lon REAL NOT NULL,
      name TEXT,
      prompted_at INTEGER NOT NULL
    );`,
    `CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );`
  ]);

  await client.execute({
    sql: `INSERT OR REPLACE INTO reviews (id, name, lat, lon, address, rating, comment, category, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      'rev_sibu_kolo_mee',
      'Sarawak Laksa & Kolo Mee Stall',
      2.30206,
      111.86868,
      'Lor Old Oya 22, Sibu',
      5,
      'Rich aromatic broth with fresh prawns and springy handmade noodles. Outstanding!',
      'Food Stall',
      Date.now()
    ]
  });

  const res = await client.execute('SELECT * FROM reviews');
  console.log('✅ Turso Cloud DB connected & initialized successfully!');
  console.log('Total Reviews in Cloud:', res.rows.length);
  console.log('Review 1:', res.rows[0].name, '->', res.rows[0].rating, 'stars');
}

test()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('Turso test error:', err);
    process.exit(1);
  });
