# Create the 5 App Groups and assign each to its app's identifiers
# (main + widget + watch + watch-extension) via the Developer Portal.
# Uses the persisted spaceship session (from `fastlane spaceauth`).
#
# Idempotent: existing groups are reused; associate_groups is a set-op.
# Usage:  ruby apple-app-groups.rb [appKey]   # optional single-app filter, e.g. "house"
require 'spaceship'

USER = 'a.tekhtelev@gmail.com'
TEAM = 'B2ZY5M2YW2'

Spaceship::Portal.login(USER)
Spaceship::Portal.client.team_id = TEAM

APPS = { 'house' => 'House', 'budget' => 'Budget', 'kaizen' => 'Kaizen',
         'language' => 'Language', 'health' => 'Health' }
only = ARGV[0]

def find_group(gid)
  # NOTE: AppGroup#app_group_id is Apple's internal ID (e.g. QYQ4Q6U633);
  # the reverse-DNS "group.com.symply.*" is the raw 'identifier' field (unmapped).
  Spaceship::Portal::AppGroup.all.find { |g| g.raw_data['identifier'] == gid }
end

def ensure_group(gid, name)
  found = find_group(gid)
  return found if found
  begin
    Spaceship::Portal::AppGroup.create!(group_id: gid, name: name)
  rescue => e
    # Race / stale list: the group already exists — refetch and reuse.
    again = find_group(gid)
    raise e unless again
    again
  end
end

fail = 0
APPS.each do |key, title|
  next if only && only != key
  gid = "group.com.symply.#{key}"
  begin
    group = ensure_group(gid, "Symply #{title} App Group")
    puts "── #{gid} (#{group.app_group_id})"
  rescue => e
    puts "  ✗ group #{gid}: #{e.message}"
    fail = 1
    next
  end
  ids = [
    "com.symply.#{key}",
    "com.symply.#{key}.widget",
    "com.symply.#{key}.watchkitapp",
    "com.symply.#{key}.watchkitapp.watchkitextension",
  ]
  ids.each do |bid|
    begin
      app = Spaceship::Portal::App.find(bid)
      if app.nil?
        puts "  ! not found: #{bid}"; fail = 1; next
      end
      app.associate_groups([group])
      puts "  + #{bid}"
    rescue => e
      puts "  ✗ #{bid}: #{e.message}"; fail = 1
    end
  end
end
exit(fail)
