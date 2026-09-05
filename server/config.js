const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

module.exports = {
  PORT: process.env.PORT || 3000,
  BASE_URL: process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`,
  
  // Telegram Bot Token (from @BotFather)
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '8879257487:AAG9x0emOL8ivVVQclVT1tMhkBAUqEvRw30',
  TELEGRAM_CHAT_ID: process.env.TELEGRAM_CHAT_ID || '',

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
