#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Adds the "SymplyEcosystemWidgetTests" unit-test target to the SymplyEcosystem
# Xcode project. The widget extension had NO test target at all, so the Kaizen
# widget's App Group decode path (`KaizenWidgetData`) was entirely unverified —
# which is how `widget_kaizen_today` shipped with no producer writing it.
#
# The bundle is host-less (no TEST_HOST): `KaizenWidgetData.load(from:)` takes an
# injectable `UserDefaults`, so the tests run headless with no App Group
# entitlement and no simulator app install. It compiles the widget sources under
# test directly rather than linking the extension, because app-extension targets
# cannot be used as a unit-test host.
#
# Idempotent: safe to re-run.
#
# Run from the repo root:  bundle exec ruby ios/add_widget_test_target.rb

require 'xcodeproj'

PROJECT_PATH  = File.join(__dir__, 'SymplyEcosystem.xcodeproj')
TEST_TARGET   = 'SymplyEcosystemWidgetTests'
TEST_GROUP    = 'SymplyEcosystemWidgetTests'
WIDGET_GROUP  = 'SymplyEcosystemWidget'
BUNDLE_ID     = 'com.symply.house.widgettests'
DEV_TEAM      = 'B2ZY5M2YW2'
DEPLOY_TARGET = '17.0'

# Widget sources compiled into the test bundle. Kept minimal — just the units
# under test plus what they need to compile.
WIDGET_SOURCES = %w[
  SymplyKaizenWidgetContent.swift
  WidgetTheme.swift
  WidgetDataService.swift
  WidgetModels.swift
  DesignTokens.generated.swift
].freeze

TEST_SOURCES = %w[
  KaizenWidgetDataTests.swift
].freeze

project = Xcodeproj::Project.open(PROJECT_PATH)

if project.targets.any? { |t| t.name == TEST_TARGET }
  puts "⚠️  Target #{TEST_TARGET.inspect} already exists — nothing to do."
  exit 0
end

puts "Creating unit-test target #{TEST_TARGET.inspect}…"
test_target = project.new_target(:unit_test_bundle, TEST_TARGET, :ios, DEPLOY_TARGET, nil, :swift)

common = {
  'PRODUCT_NAME'               => '$(TARGET_NAME)',
  'PRODUCT_BUNDLE_IDENTIFIER'  => BUNDLE_ID,
  'CODE_SIGN_STYLE'            => 'Automatic',
  'DEVELOPMENT_TEAM'           => DEV_TEAM,
  'IPHONEOS_DEPLOYMENT_TARGET' => DEPLOY_TARGET,
  'TARGETED_DEVICE_FAMILY'     => '1,2',
  'SWIFT_VERSION'              => '5.0',
  'GENERATE_INFOPLIST_FILE'    => 'YES',
  'SDKROOT'                    => 'iphoneos',
  'SKIP_INSTALL'               => 'YES',
  # Host-less: nothing to inject into, so the bundle runs standalone.
  'TEST_HOST'                  => '',
  'BUNDLE_LOADER'              => '',
  'LD_RUNPATH_SEARCH_PATHS'    => '$(inherited) @executable_path/Frameworks @loader_path/Frameworks',
  # `@testable import SymplyEcosystemWidgetExtension` needs the module name to
  # match the extension target's, since we compile its sources in here.
  'PRODUCT_MODULE_NAME'        => 'SymplyEcosystemWidgetExtension'
}

debug = common.merge(
  'SWIFT_ACTIVE_COMPILATION_CONDITIONS' => 'DEBUG',
  'SWIFT_OPTIMIZATION_LEVEL'            => '-Onone',
  'ONLY_ACTIVE_ARCH'                    => 'YES',
  'ENABLE_TESTABILITY'                  => 'YES'
)

release = common.merge(
  'SWIFT_OPTIMIZATION_LEVEL' => '-O',
  'ENABLE_TESTABILITY'       => 'YES'
)

test_target.build_configurations.each do |config|
  (config.name == 'Release' ? release : debug).each { |k, v| config.build_settings[k] = v }
end

# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------
widget_group = project.main_group[WIDGET_GROUP] || project.main_group.new_group(WIDGET_GROUP, WIDGET_GROUP)
test_group   = project.main_group[TEST_GROUP]   || project.main_group.new_group(TEST_GROUP, TEST_GROUP)

puts 'Adding widget sources under test…'
WIDGET_SOURCES.each do |name|
  ref = widget_group.files.find { |f| f.path == name } || widget_group.new_file(name)
  test_target.add_file_references([ref])
  puts "  + #{WIDGET_GROUP}/#{name}"
end

puts 'Adding test sources…'
TEST_SOURCES.each do |name|
  ref = test_group.files.find { |f| f.path == name } || test_group.new_file(name)
  test_target.add_file_references([ref])
  puts "  + #{TEST_GROUP}/#{name}"
end

# ---------------------------------------------------------------------------
# Scheme — so `xcodebuild test -scheme SymplyEcosystemWidgetTests` works.
# ---------------------------------------------------------------------------
project.save
puts "✅ Saved #{PROJECT_PATH}"

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(test_target)
scheme.add_test_target(test_target)
scheme.save_as(PROJECT_PATH, TEST_TARGET, true)
puts "✅ Wrote shared scheme #{TEST_TARGET.inspect}"

puts <<~NEXT

  Next:
    xcodebuild test -project ios/SymplyEcosystem.xcodeproj \\
      -scheme #{TEST_TARGET} -destination 'platform=iOS Simulator,name=Kaizen-A'
NEXT
