#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Adds the "SymplyEcosystemWidgetExtension" WidgetKit app-extension target to the
# SymplyEcosystem Xcode project, wires its sources/resources, embeds it into the
# main app, and writes a shared scheme. Idempotent: safe to re-run.
#
# Run from the repo root:  bundle exec ruby ios/add_widget_target.rb

require 'xcodeproj'

PROJECT_PATH   = File.join(__dir__, 'SymplyEcosystem.xcodeproj')
APP_TARGET     = 'SymplyEcosystem'
WIDGET_TARGET  = 'SymplyEcosystemWidgetExtension'
WIDGET_GROUP   = 'SymplyEcosystemWidget'
BUNDLE_ID      = 'com.symply.house.widget'
DEV_TEAM       = 'B2ZY5M2YW2'
DEPLOY_TARGET  = '17.0'

project = Xcodeproj::Project.open(PROJECT_PATH)

app_target = project.targets.find { |t| t.name == APP_TARGET }
raise "App target #{APP_TARGET.inspect} not found" unless app_target

if project.targets.any? { |t| t.name == WIDGET_TARGET }
  puts "⚠️  Target #{WIDGET_TARGET.inspect} already exists — nothing to do."
  exit 0
end

puts "Creating app-extension target #{WIDGET_TARGET.inspect}…"
widget_target = project.new_target(
  :app_extension,
  WIDGET_TARGET,
  :ios,
  DEPLOY_TARGET,
  nil,
  :swift
)

# ---------------------------------------------------------------------------
# Build settings (Debug + Release)
# ---------------------------------------------------------------------------
common = {
  'PRODUCT_NAME'                      => '$(TARGET_NAME)',
  'PRODUCT_BUNDLE_IDENTIFIER'         => BUNDLE_ID,
  'INFOPLIST_FILE'                    => "#{WIDGET_GROUP}/Info.plist",
  'CODE_SIGN_ENTITLEMENTS'            => "#{WIDGET_GROUP}/#{WIDGET_GROUP}.entitlements",
  'CODE_SIGN_STYLE'                   => 'Automatic',
  'DEVELOPMENT_TEAM'                  => DEV_TEAM,
  'IPHONEOS_DEPLOYMENT_TARGET'        => DEPLOY_TARGET,
  'TARGETED_DEVICE_FAMILY'            => '1,2',
  'SWIFT_VERSION'                     => '5.0',
  'SWIFT_EMIT_LOC_STRINGS'            => 'YES',
  'GENERATE_INFOPLIST_FILE'          => 'NO',
  # NOTE: the actual widget CFBundleVersion/CFBundleShortVersionString are the
  # literals in SymplyEcosystemWidget/Info.plist (must match the parent app exactly);
  # these build settings are not referenced by that Info.plist.
  'CURRENT_PROJECT_VERSION'           => '26',
  'MARKETING_VERSION'                 => '1.0.0',
  'SDKROOT'                           => 'iphoneos',
  'SKIP_INSTALL'                      => 'YES',
  'CLANG_ANALYZER_NONNULL'            => 'YES',
  'CLANG_ENABLE_OBJC_ARC'             => 'YES',
  'CLANG_ENABLE_MODULES'              => 'YES',
  'ENABLE_PREVIEWS'                   => 'YES',
  'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME' => 'AccentColor',
  'ASSETCATALOG_COMPILER_WIDGET_BACKGROUND_COLOR_NAME' => 'WidgetBackground',
  'LD_RUNPATH_SEARCH_PATHS'           => '$(inherited) @executable_path/Frameworks @executable_path/../../Frameworks',
  'MTL_FAST_MATH'                     => 'YES'
}

debug = common.merge(
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => 'DEBUG',
  'SWIFT_OPTIMIZATION_LEVEL'            => '-Onone',
  'GCC_OPTIMIZATION_LEVEL'              => '0',
  'DEBUG_INFORMATION_FORMAT'            => 'dwarf',
  'MTL_ENABLE_DEBUG_INFO'               => 'INCLUDE_SOURCE',
  'ONLY_ACTIVE_ARCH'                    => 'YES'
)

release = common.merge(
  'SWIFT_OPTIMIZATION_LEVEL'  => '-O',
  'DEBUG_INFORMATION_FORMAT'  => 'dwarf-with-dsym',
  'COPY_PHASE_STRIP'          => 'NO',
  'MTL_ENABLE_DEBUG_INFO'     => 'NO'
)

widget_target.build_configurations.each do |config|
  settings = config.name == 'Release' ? release : debug
  settings.each { |k, v| config.build_settings[k] = v }
end

# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
group = project.main_group[WIDGET_GROUP] || project.main_group.new_group(WIDGET_GROUP, WIDGET_GROUP)

source_files = %w[
  SymplyEcosystemWidgetBundle.swift
  WidgetModels.swift
  WidgetDataService.swift
  WidgetTheme.swift
  WidgetLink.swift
  WidgetProvider.swift
  MiraWidgetViews.swift
]

puts 'Adding source files…'
source_files.each do |name|
  ref = group.files.find { |f| f.path == name } || group.new_file(name)
  widget_target.add_file_references([ref])
  puts "  + #{name}"
end

puts 'Adding asset catalog…'
assets_ref = group.files.find { |f| f.path == 'Assets.xcassets' } || group.new_file('Assets.xcassets')
widget_target.add_resources([assets_ref])

puts 'Referencing Info.plist / entitlements (not compiled)…'
%w[Info.plist SymplyEcosystemWidget.entitlements].each do |name|
  group.new_file(name) unless group.files.any? { |f| f.path == name }
end

puts 'Linking system frameworks (WidgetKit, SwiftUI)…'
widget_target.add_system_framework(%w[WidgetKit SwiftUI])

# ---------------------------------------------------------------------------
# Embed into the app + build dependency
# ---------------------------------------------------------------------------
puts 'Embedding widget into the app target…'
app_target.add_dependency(widget_target)

embed_name = 'Embed Foundation Extensions'
embed_phase = app_target.copy_files_build_phases.find { |p| p.name == embed_name }
unless embed_phase
  embed_phase = app_target.new_copy_files_build_phase(embed_name)
  embed_phase.symbol_dst_subfolder_spec = :plug_ins
end

already_embedded = embed_phase.files_references.include?(widget_target.product_reference)
unless already_embedded
  build_file = embed_phase.add_file_reference(widget_target.product_reference, true)
  build_file.settings = { 'ATTRIBUTES' => ['RemoveHeadersOnCopy'] }
end

# ---------------------------------------------------------------------------
# Save + shared scheme
# ---------------------------------------------------------------------------
puts 'Saving project…'
project.save

puts 'Writing shared scheme…'
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(widget_target)
scheme.save_as(PROJECT_PATH, WIDGET_TARGET, true)

puts "✅ Done. Added #{WIDGET_TARGET} (bundle id #{BUNDLE_ID}) and embedded it in #{APP_TARGET}."
