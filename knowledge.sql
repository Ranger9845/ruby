-- Ruby's SQLite database — free, no server, no API key.
-- This is her own knowledge base in SQL form. Load it with:
--   sqlite3 ruby.db < knowledge.sql
-- Then query it with, for example:
--   SELECT answer FROM knowledge WHERE keywords LIKE '%france%';
-- On Vercel serverless, a SQLite file is read-only and resets between
-- invocations, so the live site uses knowledge.json (same facts) for
-- reads, and this SQL file is the portable, editable database source.
-- To teach Ruby a new fact, add a row here AND to knowledge.json /
-- brain.js, then push and redeploy. If an answer is not in here, Ruby
-- says so instead of guessing.
CREATE TABLE IF NOT EXISTS knowledge (
  id INTEGER PRIMARY KEY,
  keywords TEXT NOT NULL,
  answer TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO knowledge (keywords, answer) VALUES
('capital france', 'The capital of France is Paris.'),
('capital england', 'The capital of the United Kingdom is London.'),
('capital germany', 'The capital of Germany is Berlin.'),
('capital italy', 'The capital of Italy is Rome.'),
('capital spain', 'The capital of Spain is Madrid.'),
('capital japan', 'The capital of Japan is Tokyo.'),
('capital australia', 'The capital of Australia is Canberra.'),
('capital canada', 'The capital of Canada is Ottawa.'),
('capital mexico', 'The capital of Mexico is Mexico City.'),
('capital oklahoma', 'The capital of Oklahoma is Oklahoma City.'),
('capital texas', 'The capital of Texas is Austin.'),
('planet closest sun', 'Mercury is the planet closest to the Sun.'),
('planet largest', 'Jupiter is the largest planet in our solar system.'),
('planet red', 'Mars is known as the Red Planet.'),
('water boil', 'Water boils at 100°C (212°F) at sea level.'),
('water freeze', 'Water freezes at 0°C (32°F).'),
('days week', 'There are 7 days in a week: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, and Sunday.'),
('months year', 'There are 12 months in a year: January, February, March, April, May, June, July, August, September, October, November, December.'),
('days year', 'There are 365 days in a normal year, and 366 in a leap year.'),
('egg boil', 'For a hard-boiled egg: put eggs in cold water, bring to a boil, then cover and leave for 9 to 12 minutes, then cool in cold water before peeling.'),
('alphabet', 'The English alphabet has 26 letters, from A to Z.'),
('rainbow', 'The colours of the rainbow are red, orange, yellow, green, blue, indigo, and violet.'),
('speed light', 'Light travels at about 299,792 kilometres per second in a vacuum.'),
('moon', 'The Moon is Earth''s only natural satellite, and it orbits Earth in about 27 days.'),
('sun star', 'The Sun is a star at the centre of our solar system.');
