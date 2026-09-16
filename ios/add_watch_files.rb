#!/usr/bin/env ruby

require 'xcodeproj'

project_path = 'SymplyEcosystem.xcodeproj'
project = Xcodeproj::Project.open(project_path)

# Find targets
ios_target = project.targets.find { |t| t.name == 'SymplyEcosystem' }
watch_extension_target = project.targets.find { |t| t.name == 'SymplyEcosystemWatch Extension' }
watch_app_target = project.targets.find { |t| t.name == 'SymplyEcosystemWatch App' }

puts "Found targets:"
puts "  iOS: #{ios_target&.name || 'NOT FOUND'}"
puts "  Watch Extension: #{watch_extension_target&.name || 'NOT FOUND'}"
puts "  Watch App: #{watch_app_target&.name || 'NOT FOUND'}"
puts ""

# Create or find Shared group
shared_group = project.main_group['Shared'] || project.main_group.new_group('Shared')
models_group = shared_group['Models'] || shared_group.new_group('Models')
utilities_group = shared_group['Utilities'] || shared_group.new_group('Utilities')

# Create or find SymplyEcosystemWatch group
watch_group = project.main_group['SymplyEcosystemWatch'] || project.main_group.new_group('SymplyEcosystemWatch')
services_group = watch_group['Services'] || watch_group.new_group('Services')
views_group = watch_group['Views'] || watch_group.new_group('Views')
complications_group = watch_group['Complications'] || watch_group.new_group('Complications')

# Create or find SymplyEcosystemWatch Extension group
watch_ext_group = project.main_group['SymplyEcosystemWatch Extension'] || project.main_group.new_group('SymplyEcosystemWatch Extension')

puts "Adding Shared files..."

# Add Shared files (iOS + Watch Extension targets)
shared_files = [
  { path: 'Shared/Models/SharedTask.swift', group: models_group },
  { path: 'Shared/Models/SharedSubtask.swift', group: models_group },
  { path: 'Shared/Utilities/AppGroup.swift', group: utilities_group }
]

shared_files.each do |file_info|
  file_path = file_info[:path]
  group = file_info[:group]

  # Check if file already exists in project
  existing_ref = group.files.find { |f| f.path == File.basename(file_path) }

  if existing_ref
    puts "  ✓ #{file_path} (already in project)"
  else
    file_ref = group.new_file(file_path)
    puts "  + #{file_path}"

    # Add to both iOS and Watch Extension targets
    if ios_target
      ios_target.add_file_references([file_ref])
    end
    if watch_extension_target
      watch_extension_target.add_file_references([file_ref])
    end
  end
end

puts ""
puts "Adding Watch Extension files..."

# Add Watch Extension files (Watch Extension target only)
watch_files = [
  # Services
  { path: 'SymplyEcosystemWatch/Services/WatchAPIClient.swift', group: services_group },
  { path: 'SymplyEcosystemWatch/Services/WatchConnectivityManager.swift', group: services_group },
  { path: 'SymplyEcosystemWatch/Services/WatchVoiceService.swift', group: services_group },

  # Views
  { path: 'SymplyEcosystemWatch/Views/TaskListView.swift', group: views_group },
  { path: 'SymplyEcosystemWatch/Views/TaskDetailView.swift', group: views_group },
  { path: 'SymplyEcosystemWatch/Views/TaskRowView.swift', group: views_group },
  { path: 'SymplyEcosystemWatch/Views/TaskCompletionSheet.swift', group: views_group },
  { path: 'SymplyEcosystemWatch/Views/VoiceInputView.swift', group: views_group },
  { path: 'SymplyEcosystemWatch/Views/AihousekeeperGlanceView.swift', group: views_group },

  # Complications
  { path: 'SymplyEcosystemWatch/Complications/TaskCountProvider.swift', group: complications_group },

  # Root files
  { path: 'SymplyEcosystemWatch/SymplyEcosystemWatchApp.swift', group: watch_group },
  { path: 'SymplyEcosystemWatch/ExtensionDelegate.swift', group: watch_group }
]

watch_files.each do |file_info|
  file_path = file_info[:path]
  group = file_info[:group]

  # Check if file already exists in project
  existing_ref = group.files.find { |f| f.path == File.basename(file_path) }

  if existing_ref
    puts "  ✓ #{file_path} (already in project)"
  else
    file_ref = group.new_file(file_path)
    puts "  + #{file_path}"

    # Add to Watch Extension target only
    if watch_extension_target
      watch_extension_target.add_file_references([file_ref])
    end
  end
end

puts ""
puts "Adding Notification handlers..."

# Add Notification handlers to Watch Extension group and target
notification_files = [
  { path: 'SymplyEcosystemWatch Extension/NotificationController.swift', group: watch_ext_group },
  { path: 'SymplyEcosystemWatch Extension/NotificationActionHandler.swift', group: watch_ext_group }
]

notification_files.each do |file_info|
  file_path = file_info[:path]
  group = file_info[:group]

  # Check if file already exists in project
  existing_ref = group.files.find { |f| f.path == File.basename(file_path) }

  if existing_ref
    puts "  ✓ #{file_path} (already in project)"
  else
    file_ref = group.new_file(file_path)
    puts "  + #{file_path}"

    # Add to Watch Extension target only
    if watch_extension_target
      watch_extension_target.add_file_references([file_ref])
    end
  end
end

puts ""
puts "Saving project..."
project.save

puts "✅ Done! All Swift files have been added to the Xcode project."
puts ""
puts "Next steps:"
puts "  1. Open the project: open ios/SymplyEcosystem.xcworkspace"
puts "  2. Build the Watch Extension scheme to verify"
