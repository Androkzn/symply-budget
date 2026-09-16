# List App Store Connect (iTunes Connect) teams for the persisted spaceship session.
require 'spaceship'
require 'json'
Spaceship::Tunes.login('a.tekhtelev@gmail.com')
teams = Spaceship::Tunes.client.teams
puts "ASC teams (#{teams.length}):"
teams.each_with_index do |t, i|
  puts "--- team #{i} ---"
  puts JSON.pretty_generate(t)
end
