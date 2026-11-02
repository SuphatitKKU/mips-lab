-- Port the classroom workflow from b5ce5b7 / 8a82064 to D1.
-- Existing students and their scores stay intact.
CREATE TABLE classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  year INTEGER NOT NULL CHECK(year BETWEEN 2500 AND 2700),
  term INTEGER NOT NULL CHECK(term IN (1,2,3)), code TEXT NOT NULL UNIQUE,
  archived INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL,
  UNIQUE(name,year,term)
);
ALTER TABLE users ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL;
CREATE INDEX users_class ON users(class_id);
CREATE TABLE roster (ident TEXT PRIMARY KEY, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE, added_at INTEGER NOT NULL);
CREATE TABLE assignments (
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id), due_at INTEGER NOT NULL,
  PRIMARY KEY(class_id,problem_id)
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', due_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  board TEXT NOT NULL, code TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', submitted_at INTEGER NOT NULL,
  score REAL CHECK(score IS NULL OR score BETWEEN 0 AND 1000), feedback TEXT, graded_at INTEGER,
  UNIQUE(project_id,user_id)
);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL);
-- The existing section field remains the legacy exercise visibility key.
INSERT INTO classes(name,year,term,code,created_at)
SELECT DISTINCT section,CAST((SELECT value FROM settings WHERE key='academicYear') AS INTEGER),
  CASE WHEN CAST(strftime('%m','now','+7 hours') AS INTEGER) BETWEEN 6 AND 10 THEN 1
       WHEN CAST(strftime('%m','now','+7 hours') AS INTEGER) IN (4,5) THEN 3 ELSE 2 END,
  upper(hex(randomblob(3))),CAST(strftime('%s','now') AS INTEGER)*1000
FROM users WHERE role='student' AND section<>'' GROUP BY section;
UPDATE users SET class_id=(SELECT id FROM classes WHERE classes.name=users.section) WHERE role='student' AND section<>'';
