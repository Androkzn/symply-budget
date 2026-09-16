#!/usr/bin/env ruby
# One-time (idempotent) structural migration: make project.pbxproj brand-neutral.
#
# - Registers ios/Brand.xcconfig and sets it as the PROJECT-level base configuration
#   (both Debug and Release), so every target inherits the SYMPLY_* brand variables.
# - Rewrites every target's PRODUCT_BUNDLE_IDENTIFIER to derive from those variables
#   instead of carrying a literal `com.symply.<brand>` (the source of baseline drift).
# - Points the Watch app's CFBundleDisplayName at $(SYMPLY_DISPLAY_NAME) (was the
#   hardcoded "SymplyEcosystemWatchApp" that shipped on every brand).
#
# Safe to re-run: it only sets the target values, so a second run is a no-op.
require 'xcodeproj'

proj_path = File.join(__dir__, 'SymplyEcosystem.xcodeproj')
project = Xcodeproj::Project.open(proj_path)

# --- 1. Brand.xcconfig file reference (create once) ---
xcconfig_ref = project.files.find { |f| f.path == 'Brand.xcconfig' }
unless xcconfig_ref
  xcconfig_ref = project.main_group.new_reference('Brand.xcconfig')
  xcconfig_ref.last_known_file_type = 'text.xcconfig'
  puts '[migrate] added Brand.xcconfig file reference'
end

# --- 2. Project-level base configuration → Brand.xcconfig (Debug + Release) ---
project.build_configuration_list.build_configurations.each do |cfg|
  unless cfg.base_configuration_reference == xcconfig_ref
    cfg.base_configuration_reference = xcconfig_ref
    puts "[migrate] project #{cfg.name} base config → Brand.xcconfig"
  end
end

# --- 3. Variable-ize PRODUCT_BUNDLE_IDENTIFIER per target ---
BUNDLE_IDS = {
  'SymplyEcosystem'                             => '$(SYMPLY_BUNDLE_ID)',
  'SymplyEcosystemWidgetExtension'              => '$(SYMPLY_WIDGET_BUNDLE_ID)',
  'SymplyEcosystemWatchApp Watch App'           => '$(SYMPLY_WATCH_BUNDLE_ID)',
  'SymplyEcosystemWatchApp Watch AppTests'      => '$(SYMPLY_BUNDLE_ID).SymplyEcosystemWatchApp-Watch-AppTests',
  'SymplyEcosystemWatchApp Watch AppUITests'    => '$(SYMPLY_BUNDLE_ID).SymplyEcosystemWatchApp-Watch-AppUITests',
}.freeze

project.targets.each do |target|
  new_id = BUNDLE_IDS[target.name]
  next unless new_id
  target.build_configurations.each do |cfg|
    bs = cfg.build_settings
    if bs['PRODUCT_BUNDLE_IDENTIFIER'] != new_id
      bs['PRODUCT_BUNDLE_IDENTIFIER'] = new_id
      puts "[migrate] #{target.name} (#{cfg.name}) bundle id → #{new_id}"
    end
    # Watch app: brand display name (was hardcoded SymplyEcosystemWatchApp) and the
    # companion iOS app id, which MUST equal the main app's bundle id to pair.
    if target.name == 'SymplyEcosystemWatchApp Watch App'
      if bs['INFOPLIST_KEY_CFBundleDisplayName'] != '$(SYMPLY_DISPLAY_NAME)'
        bs['INFOPLIST_KEY_CFBundleDisplayName'] = '$(SYMPLY_DISPLAY_NAME)'
        puts "[migrate] #{target.name} (#{cfg.name}) display name → $(SYMPLY_DISPLAY_NAME)"
      end
      if bs['INFOPLIST_KEY_WKCompanionAppBundleIdentifier'] != '$(SYMPLY_BUNDLE_ID)'
        bs['INFOPLIST_KEY_WKCompanionAppBundleIdentifier'] = '$(SYMPLY_BUNDLE_ID)'
        puts "[migrate] #{target.name} (#{cfg.name}) companion app id → $(SYMPLY_BUNDLE_ID)"
      end
    end
  end
end

project.save
puts '[migrate] saved project.pbxproj'
