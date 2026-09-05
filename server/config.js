const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  
  // Telegram Bot Token (from @BotFather)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8879257487:AAG9x0emOL8ivVVQclVT1tMhkBAUqEvRw30',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

  // Turso Cloud Persistent Database
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL || 'libsql://foodie-aiyo1234.aws-ap-northeast-1.turso.io',
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN || 'eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJpYXQiOjE3ODg2MDE1ODMsImlkIjoiMDFhMDcwZjUtOTUwMS03Nzg5LTk5YWMtZGE0YWVlM2Q1MjkxIiwia2lkIjoiSENIQVkyMnYyMWhjWTZob1FRbXczWlNpQnItZ1FHYWc0MmpDaHUtSVJkUSIsInJpZCI6IjA2YzE5MDlmLWEzOTYtNDBmNC1iYWQyLTZjYjk0OWVjMzFjZSJ9.Q9M0dRa1c9jk_U9tHJBdexNO74h7e88W50tHtECHa3z1eyccKmjNAo8nytAKEH6yw0uTH0An5ozQgqkPaHJXCQ',

  // ntfy.sh fallback topic
  NTFY_TOPIC: process.env.NTFY_TOPIC || 'foodie-tracker-alert',
  NTFY_SERVER: process.env.NTFY_SERVER || 'https://ntfy.sh',

  // Dwell threshold in seconds: lowered to 150 seconds (2.5 minutes) for faster detection
  DWELL_THRESHOLD_SECONDS: parseInt(process.env.DWELL_THRESHOLD_SECONDS, 10) || 150,

  // Maximum stationary drift radius in meters
  STATIONARY_RADIUS_METERS: parseInt(process.env.STATIONARY_RADIUS_METERS, 10) || 75,

  // Cooldown in hours before prompting for the same place again
  PROMPT_COOLDOWN_HOURS: parseInt(process.env.PROMPT_COOLDOWN_HOURS, 10) || 8,

  // Home Geofence (Exclusion)
  HOME_LAT: process.env.HOME_LAT ? parseFloat(process.env.HOME_LAT) : null,
  HOME_LON: process.env.HOME_LON ? parseFloat(process.env.HOME_LON) : null,
  HOME_RADIUS_METERS: parseInt(process.env.HOME_RADIUS_METERS, 10) || 150,

  // Work Geofence (Exclusion)
  WORK_LAT: process.env.WORK_LAT ? parseFloat(process.env.WORK_LAT) : null,
  WORK_LON: process.env.WORK_LON ? parseFloat(process.env.WORK_LON) : null,
  WORK_RADIUS_METERS: parseInt(process.env.WORK_RADIUS_METERS, 10) || 150,

  // Data directories
  DB_PATH: process.env.DB_PATH || path.join(__dirname, '../data/foodie.db'),
  UPLOADS_DIR: path.join(__dirname, '../uploads'),
};
