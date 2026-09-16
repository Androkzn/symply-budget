# Create ONE clean team-scoped APNs auth key "Symply APNs" (works for all 5 apps)
# and download the .p8. Uses the persisted spaceauth session. The .p8 is downloadable
# only once — we save it immediately to credentials/apple/ (gitignored).
require 'spaceship'

USER = 'a.tekhtelev@gmail.com'
TEAM = 'B2ZY5M2YW2'
NAME = 'Symply APNs'
ROOT = File.expand_path('../..', __dir__)
DIR  = File.join(ROOT, 'credentials', 'apple')

Spaceship::Portal.login(USER)
Spaceship::Portal.client.team_id = TEAM

existing = Spaceship::Portal::Key.all.find { |k| k.name == NAME }
if existing
  puts "= already exists: #{existing.id} (#{NAME}) — .p8 is NOT re-downloadable; reusing id only."
  puts "KEY_ID=#{existing.id}"
  exit 0
end

key = Spaceship::Portal::Key.create(name: NAME, apns: true)
puts "+ created key: #{key.id} (#{NAME})"

# Download the .p8 (only possible right after creation).
content = nil
begin
  content = key.download
rescue => e
  begin
    content = Spaceship::Portal.client.download_key(key.id)
  rescue => e2
    puts "✗ download failed: #{e.message} / #{e2.message}"
  end
end

if content && content.include?('BEGIN PRIVATE KEY')
  require 'fileutils'
  FileUtils.mkdir_p(DIR)
  path = File.join(DIR, "AuthKey_#{key.id}.p8")
  File.write(path, content)
  File.chmod(0o600, path)
  puts "  saved #{path}"
  puts "KEY_ID=#{key.id}"
  puts "KEY_PATH=#{path}"
else
  puts "✗ could not capture .p8 content — key created (#{key.id}) but NOT saved. Download manually from the portal."
  exit 1
end
