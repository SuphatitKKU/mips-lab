CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, student_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, section TEXT NOT NULL DEFAULT '', email TEXT,
  role TEXT NOT NULL CHECK(role IN ('student','teacher')), pw_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1, year_override INTEGER, created_at INTEGER NOT NULL,
  last_active INTEGER
);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE login_limits (key TEXT PRIMARY KEY, failures INTEGER NOT NULL, until_at INTEGER NOT NULL);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO settings VALUES ('academicYear','2569');
CREATE TABLE problems (
  id INTEGER PRIMARY KEY AUTOINCREMENT, body TEXT NOT NULL, published INTEGER NOT NULL DEFAULT 0,
  section TEXT NOT NULL DEFAULT '', due_at INTEGER, created_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE drafts (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, problem_id INTEGER NOT NULL REFERENCES problems(id), code TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,problem_id));
CREATE TABLE attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  problem_id INTEGER NOT NULL REFERENCES problems(id), kind TEXT NOT NULL CHECK(kind IN ('test','submit')),
  code TEXT NOT NULL, passed INTEGER NOT NULL, total INTEGER NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX attempts_user_problem ON attempts(user_id,problem_id,id);
CREATE INDEX attempts_problem ON attempts(problem_id,created_at);
CREATE TABLE solves (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, problem_id INTEGER NOT NULL REFERENCES problems(id),
  points INTEGER NOT NULL, first_try INTEGER NOT NULL, revealed INTEGER NOT NULL DEFAULT 0, solved_at INTEGER NOT NULL,
  PRIMARY KEY(user_id,problem_id)
);
