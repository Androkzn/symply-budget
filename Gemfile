source 'https://rubygems.org'

# You may use http://rbenv.org/ or https://rvm.io/ to install and use this version
ruby ">= 2.6.10"

# Exclude problematic versions of cocoapods and activesupport that causes build failures.
# CocoaPods floor is 1.17.0, NOT 1.16.x: only 1.17+ wires Expo's ExpoModulesMacros
# Swift macro plugin into the generated Pods project. On 1.16.x the
# `-load-plugin-executable` flag is never emitted and every target using
# `@OptimizedFunction` (expo-crypto, …) fails to compile — but only on a CLEAN
# build, since warm DerivedData reuses the previously-built objects and hides it.
# Enforced at runtime by scripts/ios/pod.sh, which every script must use.
gem 'cocoapods', '>= 1.17.0'
gem 'activesupport', '>= 6.1.7.5', '!= 7.1.0'
gem 'xcodeproj', '>= 1.27.0'
gem 'concurrent-ruby', '< 1.3.4'

# Ruby 3.4.0 has removed some libraries from the standard library.
gem 'bigdecimal'
gem 'logger'
gem 'benchmark'
gem 'mutex_m'
