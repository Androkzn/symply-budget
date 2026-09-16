#!/usr/bin/env ruby
# frozen_string_literal: true
#
# Idempotent: ensure per-brand Debug-/Release- configurations exist so Xcode
# schemes can select a brand without running prepare:xcode:*.
#
# Project-level brand configs override the four SYMPLY_* leaf values from
# brands/<id>/brand.cjs. Legacy Debug/Release stay House defaults for EAS/CI.
#
#   ruby scripts/ios/ensure-brand-configurations.rb
#
require 'json'
require 'open3'
require 'xcodeproj'

ROOT = File.expand_path('../..', __dir__)
PROJ_PATH = File.join(ROOT, 'ios', 'SymplyEcosystem.xcodeproj')

BRAND_IDS = %w[
  symply-house
  symply-budget
  symply-kaizen
  symply-language
  symply-health
].freeze

LEAF_KEYS = %w[
  SYMPLY_BRAND_ID
  SYMPLY_DISPLAY_NAME
  SYMPLY_URL_SCHEME
  SYMPLY_GOOGLE_URL_SCHEME
  SYMPLY_MARKETING_VERSION
  SYMPLY_BUILD_NUMBER
  SYMPLY_HEALTHKIT_SHARE_USAGE
  SYMPLY_HEALTHKIT_UPDATE_USAGE
].freeze

# ---------------------------------------------------------------------------
# HealthKit — Symply Health ONLY.
#
# The five apps share one native tree, so HealthKit cannot live in the shared
# Info.plist / entitlements: House, Budget, Kaizen and Language would start asking
# for health data, and their App IDs carry no HealthKit capability so code signing
# would fail outright. Instead both halves are pinned to the two configurations only
# the Health schemes build:
#
#   * the purpose strings, via SYMPLY_HEALTHKIT_SHARE_USAGE /
#     SYMPLY_HEALTHKIT_UPDATE_USAGE, which SymplyEcosystem/Info.plist expands into
#     NSHealthShareUsageDescription / NSHealthUpdateUsageDescription. Health's real
#     copy here; every other brand falls back to ios/Brand.xcconfig's generic
#     "does not read/write" default — NOT empty, because App Store Connect's binary
#     validator (error 90683) requires the key non-empty whenever HealthKit APIs
#     are referenced in the compiled binary, regardless of entitlement, and this
#     pod links into all five brands. Actual access still turns on the entitlement
#     below, not on this string.
#   * the entitlement, via CODE_SIGN_ENTITLEMENTS pointing at the
#     SymplyEcosystem-Health*.entitlements pair.
#
# Keeping both in this one script is what stops them drifting: an entitlement
# without the purpose string crashes on requestAuthorization, and a purpose string
# without the entitlement is a promise the build cannot keep.
# ---------------------------------------------------------------------------
HEALTHKIT_BRAND_SHORT_ID = 'health'

HEALTHKIT_SHARE_USAGE = 'Symply Health reads your steps, active energy, sleep, ' \
  'heart rate and weight from Apple Health so you do not have to type them in. ' \
  'It is optional, it is read-only, and nothing is ever written back to Apple Health.'

HEALTHKIT_UPDATE_USAGE = 'Symply Health does not write any data back to Apple Health.'

# Configuration name => entitlements file, for the SymplyEcosystem app target.
HEALTHKIT_ENTITLEMENTS = {
  "Debug-#{HEALTHKIT_BRAND_SHORT_ID}" => 'SymplyEcosystem/SymplyEcosystem-Health.entitlements',
  "Release-#{HEALTHKIT_BRAND_SHORT_ID}" => 'SymplyEcosystem/SymplyEcosystem-Health-Release.entitlements',
}.freeze

def load_brand_leaves(brand_id)
  script = <<~JS
    const b = require(#{File.join(ROOT, 'brands', brand_id, 'brand.cjs').inspect});
    const short = #{brand_id.inspect}.replace(/^symply-/, '');
    const ios = b.integrations && b.integrations.googleAuth && b.integrations.googleAuth.iosClientId;
    const google = ios
      ? 'com.googleusercontent.apps.' + ios.replace(/\\.apps\\.googleusercontent\\.com$/, '')
      : '$(SYMPLY_BUNDLE_ID)';
    process.stdout.write(JSON.stringify({
      shortId: short,
      displayName: b.displayName,
      scheme: b.scheme,
      googleUrlScheme: google,
      marketingVersion: b.iosVersion || '1.0.0',
      buildNumber: (b.iosBuildNumber != null ? String(b.iosBuildNumber) : null),
    }));
  JS
  out, status = Open3.capture2('node', '-e', script, chdir: ROOT)
  abort("[ensure-brand-configurations] failed to load #{brand_id}: #{out}") unless status.success?
  JSON.parse(out)
end

def deep_clone_settings(settings)
  # xcodeproj build_settings values may be String or Array
  settings.each_with_object({}) do |(k, v), acc|
    acc[k] = v.is_a?(Array) ? v.dup : v
  end
end

# Returns [config, created?]. `created?` is false when the config already existed —
# callers use it to avoid clobbering settings that `pod install` owns after creation
# (e.g. the brand-named Pods xcconfig base reference).
def ensure_config(project, config_list, source_name, dest_name)
  existing = config_list.build_configurations.find { |c| c.name == dest_name }
  return [existing, false] if existing

  source = config_list.build_configurations.find { |c| c.name == source_name }
  abort("[ensure-brand-configurations] missing source config #{source_name}") unless source

  dup = project.new(Xcodeproj::Project::Object::XCBuildConfiguration)
  dup.name = dest_name
  dup.build_settings = deep_clone_settings(source.build_settings)
  dup.base_configuration_reference = source.base_configuration_reference
  config_list.build_configurations << dup
  puts "[ensure-brand-configurations] + #{dest_name} (from #{source_name})"
  [dup, true]
end

def apply_leaf_overrides(config, leaves)
  config.build_settings['SYMPLY_BRAND_ID'] = leaves['shortId']
  config.build_settings['SYMPLY_DISPLAY_NAME'] = leaves['displayName']
  config.build_settings['SYMPLY_URL_SCHEME'] = leaves['scheme']
  config.build_settings['SYMPLY_GOOGLE_URL_SCHEME'] = leaves['googleUrlScheme']
  # Per-app version identity — pins each brand's version/build at the project-config
  # level so it follows the SCHEME (Release-<brand>), independent of whichever brand
  # the gitignored Brand.generated.xcconfig override currently points at. App + widget
  # + watch all inherit these, so they always ship the same version (App Store rule).
  config.build_settings['SYMPLY_MARKETING_VERSION'] = leaves['marketingVersion']
  build_number = leaves['buildNumber']
  if build_number
    config.build_settings['SYMPLY_BUILD_NUMBER'] = build_number
  else
    config.build_settings.delete('SYMPLY_BUILD_NUMBER') # fall back to Brand.xcconfig default
  end

  # Apple Health purpose strings — Health only. Deleted (not blanked) on the other
  # four so Brand.xcconfig's generic "does not read/write" default wins instead.
  if leaves['shortId'] == HEALTHKIT_BRAND_SHORT_ID
    config.build_settings['SYMPLY_HEALTHKIT_SHARE_USAGE'] = HEALTHKIT_SHARE_USAGE
    config.build_settings['SYMPLY_HEALTHKIT_UPDATE_USAGE'] = HEALTHKIT_UPDATE_USAGE
  else
    config.build_settings.delete('SYMPLY_HEALTHKIT_SHARE_USAGE')
    config.build_settings.delete('SYMPLY_HEALTHKIT_UPDATE_USAGE')
  end
end

def sync_pods_base_ref(brand_config, source_config)
  # Keep brand configs pointed at the same Pods xcconfig as Debug/Release until
  # `pod install` rewrites them to brand-named Pods xcconfigs.
  brand_config.base_configuration_reference = source_config.base_configuration_reference
end

project = Xcodeproj::Project.open(PROJ_PATH)
leaves_by_short = {}

BRAND_IDS.each do |brand_id|
  leaves = load_brand_leaves(brand_id)
  short = leaves['shortId']
  leaves_by_short[short] = leaves

  %w[Debug Release].each do |base|
    dest = "#{base}-#{short}"

    # Project-level: inherit Brand.xcconfig + override leaf values
    proj_cfg, = ensure_config(project, project.build_configuration_list, base, dest)
    apply_leaf_overrides(proj_cfg, leaves)
    # Project base must stay Brand.xcconfig
    brand_xc = project.files.find { |f| f.path == 'Brand.xcconfig' }
    proj_cfg.base_configuration_reference = brand_xc if brand_xc

    # Every native target: clone Debug/Release settings (incl. Pods base ref)
    project.targets.each do |target|
      src = target.build_configurations.find { |c| c.name == base }
      next unless src

      cfg, created = ensure_config(project, target.build_configuration_list, base, dest)
      # Only point a NEW brand config at the generic Pods xcconfig (pod install then
      # rewrites it to the brand-named one). Re-running must not clobber an existing
      # config's brand-named Pods base ref — that would silently regress pod settings.
      sync_pods_base_ref(cfg, src) if created
      # Targets inherit SYMPLY_* from project-level overrides; do not pin leaf
      # keys on targets (keeps a single source of truth at project level).
      LEAF_KEYS.each { |k| cfg.build_settings.delete(k) }
      # Watch follows SYMPLY_BRAND_ID the same way as the iOS app icon.
      if target.name == 'SymplyEcosystemWatchApp Watch App'
        cfg.build_settings['ASSETCATALOG_COMPILER_APPICON_NAME'] = 'AppIcon-$(SYMPLY_BRAND_ID)'
      end

      # Widget PRODUCT_BUNDLE_IDENTIFIER is a LITERAL here, not the
      # `$(SYMPLY_WIDGET_BUNDLE_ID)` macro every other config uses. `eas build`'s
      # local credential-resolution step (`getBundleIdentifierFromPbxproj` in
      # @expo/config-plugins) only reads the literal PRODUCT_BUNDLE_IDENTIFIER
      # string out of THIS exact (target, configuration) build-settings dict — it
      # never opens an .xcconfig file and never falls back to the project-level
      # setting, so a macro that only resolves via Brand.xcconfig (as it does for
      # xcodebuild) reads as unresolvable and `eas build` fails before upload with
      # "Could not read bundle identifier ... target = SymplyEcosystemWidgetExtension".
      # The main app and watch app targets already carry literal per-brand bundle
      # ids for the same reason; this closes the one target that did not.
      if target.name == 'SymplyEcosystemWidgetExtension'
        cfg.build_settings['PRODUCT_BUNDLE_IDENTIFIER'] = "com.symply.#{short}.widget"
      end

      # HealthKit entitlement — the Health app target's two configurations only.
      # Nothing is done for the widget or the watch app: neither reads HealthKit
      # (the donor's widget did not either), and an unused entitlement on an
      # extension is one more App ID capability to keep in sync for no gain.
      if target.name == 'SymplyEcosystem' && HEALTHKIT_ENTITLEMENTS.key?(dest)
        cfg.build_settings['CODE_SIGN_ENTITLEMENTS'] = HEALTHKIT_ENTITLEMENTS[dest]
      end
    end
  end
end

project.save
puts "[ensure-brand-configurations] saved #{PROJ_PATH}"
puts "[ensure-brand-configurations] brands: #{leaves_by_short.keys.sort.join(', ')}"
