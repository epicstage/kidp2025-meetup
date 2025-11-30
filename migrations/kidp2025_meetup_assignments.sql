-- KIDP2025 밋업 라운드 배정 테이블
CREATE TABLE IF NOT EXISTS kidp2025_meetup_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL DEFAULT 1,
  round_num INTEGER NOT NULL,
  table_num INTEGER NOT NULL,
  tech_company TEXT NOT NULL,
  tech_email TEXT NOT NULL,
  design_company TEXT NOT NULL,
  design_email TEXT NOT NULL,
  score INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  UNIQUE(version, round_num, table_num)
);

-- 배정 버전 관리 테이블
CREATE TABLE IF NOT EXISTS kidp2025_meetup_assignment_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  version INTEGER NOT NULL UNIQUE,
  round_count INTEGER NOT NULL,
  table_count INTEGER NOT NULL,
  confirmed_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_kidp2025_assignments_round ON kidp2025_meetup_assignments(round_num);
CREATE INDEX IF NOT EXISTS idx_kidp2025_assignments_tech_email ON kidp2025_meetup_assignments(tech_email);
CREATE INDEX IF NOT EXISTS idx_kidp2025_assignments_design_email ON kidp2025_meetup_assignments(design_email);

