const {
  withInfoPlist,
  createRunOncePlugin,
} = require('@expo/config-plugins');

/**
 * Ensures RoomPlan camera usage copy is present. Deployment target ≥16 is set
 * via existing expo-build-properties / Podfile (platform ios 16.4).
 */
function withRoomPlan(config) {
  return withInfoPlist(config, (cfg) => {
    cfg.modResults.NSCameraUsageDescription =
      cfg.modResults.NSCameraUsageDescription ||
      'Symply House uses the camera for LiDAR room scanning with Apple RoomPlan.';
    return cfg;
  });
}

module.exports = createRunOncePlugin(withRoomPlan, 'roomplan', '1.0.0');
