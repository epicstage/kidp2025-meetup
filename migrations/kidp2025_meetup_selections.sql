-- KIDP2025 밋업 신청 선택 테이블
CREATE TABLE IF NOT EXISTS kidp2025_meetup_selections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_email TEXT NOT NULL,
  selected_company_name TEXT NOT NULL,
  priority INTEGER NOT NULL CHECK(priority >= 1 AND priority <= 7),
  list_type TEXT NOT NULL CHECK(list_type IN ('tech', 'design')),
  company_data TEXT NOT NULL, -- JSON 형태로 전체 기업 정보 저장
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(user_email, priority, list_type)
);

-- 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_kidp2025_selections_email ON kidp2025_meetup_selections(user_email);
CREATE INDEX IF NOT EXISTS idx_kidp2025_selections_email_type ON kidp2025_meetup_selections(user_email, list_type);

