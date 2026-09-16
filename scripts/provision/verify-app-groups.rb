# Verify: confirm the 5 App Groups exist and each of the 20 identifiers has its
# app's group assigned. Read-only. Uses the persisted spaceship session.
#
# NOTE: AppGroup#app_group_id is Apple's internal ID; the reverse-DNS
# "group.com.symply.*" is #identifier. Assignments are read authoritatively from
# the app-detail endpoint (client.details_for_app), not the lazy App attribute.
require 'spaceship'

USER = 'a.tekhtelev@gmail.com'
TEAM = 'B2ZY5M2YW2'
Spaceship::Portal.login(USER)
Spaceship::Portal.client.team_id = TEAM

APPS = { 'house' => 'House', 'budget' => 'Budget', 'kaizen' => 'Kaizen',
         'language' => 'Language', 'health' => 'Health' }

groups = Spaceship::Portal::AppGroup.all
missing = 0

APPS.each do |key, _title|
  gid = "group.com.symply.#{key}"
  g = groups.find { |x| x.raw_data['identifier'] == gid }
  unless g
    puts "✗ group MISSING: #{gid}"; missing += 1; next
  end
  puts "── #{gid} (#{g.app_group_id})"
  ids = ["com.symply.#{key}", "com.symply.#{key}.widget",
         "com.symply.#{key}.watchkitapp", "com.symply.#{key}.watchkitapp.watchkitextension"]
  ids.each do |bid|
    app = Spaceship::Portal::App.find(bid)
    det = app && Spaceship::Portal.client.details_for_app(app)
    assigned = det && (det['associatedApplicationGroups'] || []).any? { |ag| ag['identifier'] == gid }
    if assigned
      puts "  ✓ #{bid}"
    else
      puts "  ✗ #{bid} — group NOT assigned"; missing += 1
    end
  end
end
puts "\n" + (missing.zero? ? '✓ All 5 groups exist and all 20 identifiers assigned.' : "⚠ #{missing} gap(s).")
exit(missing.zero? ? 0 : 1)
