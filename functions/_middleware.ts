import { Hono } from 'hono';
// Cloudflare Workers 타입
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}

interface D1PreparedStatement {
  bind(...values: any[]): D1PreparedStatement;
  first<T = any>(): any; // Promise<T | null>
  all<T = any>(): any; // Promise<{ results: T[] }>
}

type Env = {
  DB: D1Database;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  OAUTH_REDIRECT_URI: string;
  JWT_SECRET: string;
  ADMIN_EMAILS: string;
  GOOGLE_APPS_SCRIPT_WEBHOOK_URL?: string; // Google Apps Script 웹훅 URL (선택사항)
  ALLOWED_ORIGINS?: string; // 허용된 Origin 목록 (쉼표로 구분)
};

// Cloudflare Pages Functions 타입
interface PagesFunction<Env = any> {
  (context: {
    request: Request;
    env: Env;
    waitUntil: (promise: Promise<any>) => void;
    passThroughOnException: () => void;
    next: () => Promise<Response>;
    data: any;
  }): Response | Promise<Response>;
}

const app = new Hono<{ Bindings: Env }>();

// CORS 설정 - 환경 변수에서 허용된 Origin 가져오기
function getCorsOrigin(env: Env): string | string[] {
  if (env.ALLOWED_ORIGINS) {
    const origins = env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean);
    return origins.length > 0 ? origins : '*';
  }
  // 개발 환경에서는 모든 origin 허용 (프로덕션에서는 반드시 설정 필요)
  return '*';
}

app.use('*', async (c, next) => {
  const allowedOrigins = getCorsOrigin(c.env);
  const requestOrigin = c.req.header('Origin') || '';

  let originToSet = '*';
  if (Array.isArray(allowedOrigins)) {
    if (allowedOrigins.includes('*')) {
      originToSet = '*';
    } else if (allowedOrigins.includes(requestOrigin)) {
      originToSet = requestOrigin;
    } else {
      // 허용되지 않은 Origin이면 첫 번째 Origin으로 fallback (필요 시 null 처리 가능)
      originToSet = allowedOrigins[0] || 'null';
    }
  } else {
    originToSet = allowedOrigins === '*' ? '*' : allowedOrigins;
  }

  const corsHeaders = {
    'Access-Control-Allow-Origin': originToSet,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };

  if (c.req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  await next();
  Object.entries(corsHeaders).forEach(([key, value]) => {
    c.res.headers.set(key, value);
  });
});

// 유틸리티 함수: 고유 토큰 생성
function generateAccessToken(): string {
  // crypto.randomUUID() 사용 (Cloudflare Workers 지원)
  return crypto.randomUUID().replace(/-/g, '');
}

// 유틸리티 함수: CSV 파싱 (따옴표 처리 및 쉼표/탭 포함 필드 지원)
function parseCSV(csvText: string): Array<Record<string, string>> {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim());
  if (lines.length === 0) return [];

  // 구분자 감지 (탭 또는 쉼표)
  const firstLine = lines[0];
  const hasTabs = firstLine.includes('\t');
  const delimiter = hasTabs ? '\t' : ',';

  // CSV 행 파싱 함수 (따옴표 처리)
  function parseCSVLine(line: string, sep: string): string[] {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      const nextChar = line[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // 이스케이프된 따옴표
          current += '"';
          i++; // 다음 따옴표 건너뛰기
        } else {
          // 따옴표 시작/끝
          inQuotes = !inQuotes;
        }
      } else if (char === sep && !inQuotes) {
        // 필드 구분자 (탭 또는 쉼표)
        result.push(current.trim());
        current = '';
      } else {
        current += char;
      }
    }
    
    // 마지막 필드 추가
    result.push(current.trim());
    return result;
  }

  // 첫 줄을 헤더로 사용
  const headers = parseCSVLine(lines[0], delimiter).map(h => h.replace(/^"|"$/g, '').trim());
  const rows: Array<Record<string, string>> = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter).map(v => v.replace(/^"|"$/g, '').trim());
    if (values.length === 0 || values.every(v => !v)) continue; // 빈 행 스킵

    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] || '';
    });
    rows.push(row);
  }

  return rows;
}

// API 라우트
const api = new Hono<{ Bindings: Env }>();

// Admin API 라우트
const admin = new Hono<{ Bindings: Env }>();

// POST /api/admin/events/:id/participants/import-from-url
admin.post('/events/:id/participants/import-from-url', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    const body = await c.req.json();
    const csvUrl = body.csvUrl;

    if (!csvUrl) {
      return c.json({ error: 'CSV URL이 필요합니다.' }, 400);
    }

    // URL에서 CSV 데이터 가져오기
    const csvResponse = await fetch(csvUrl);
    if (!csvResponse.ok) {
      return c.json({ error: 'CSV 파일을 가져올 수 없습니다. 스프레드시트가 공개로 공유되어 있는지 확인하세요.' }, 400);
    }

    const csvText = await csvResponse.text();
    
    // 기존 CSV 파싱 로직 재사용
    return await processCSVImport(c, eventId, csvText);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('CSV URL Import 오류:', errorMessage);
    return c.json({ 
      error: 'CSV URL Import 중 오류가 발생했습니다.',
      details: errorMessage 
    }, 500);
  }
});

// CSV 처리 공통 함수
async function processCSVImport(c: any, eventId: number, csvText: string) {
  console.log('CSV Import 시작:', { eventId, csvTextLength: csvText.length });
  
  const rows = parseCSV(csvText);
  console.log('CSV 파싱 결과:', { rowsCount: rows.length });

  if (rows.length === 0) {
    console.error('CSV 파싱 실패: 데이터가 없음');
    return c.json({ error: 'CSV 파일에 데이터가 없습니다.' }, 400);
  }

  // 참가자 데이터 준비 및 토큰 생성
  const participants: Array<{
    event_id: number;
    name: string;
    company: string;
    email: string;
    phone?: string;
    group_type?: string;
    access_token: string;
    industry_tags?: string;
    interests?: string;
    business_type?: string;
    team_info?: string;
    representative?: string;
  }> = [];

  // 중복 토큰 방지를 위한 Set
  const tokenSet = new Set<string>();

  // 헤더 정규화 함수 (공백, 특수문자 제거, 소문자 변환)
  const normalizeHeader = (header: string): string => {
    return header
      .trim()
      .replace(/\s+/g, '') // 모든 공백 제거
      .replace(/[()]/g, '') // 괄호 제거
      .toLowerCase();
  };

  // 헤더에서 필드명 찾기 (유연한 매칭)
  const findField = (row: Record<string, string>, patterns: string[]): string => {
    // 먼저 정확한 매칭 시도
    for (const pattern of patterns) {
      if (row[pattern]) return row[pattern].trim();
    }
    
    // 정규화된 헤더 맵 생성
    const normalizedRow: Record<string, string> = {};
    for (const key of Object.keys(row)) {
      normalizedRow[normalizeHeader(key)] = row[key];
    }
    
    // 정규화된 패턴으로 매칭
    for (const pattern of patterns) {
      const normalizedPattern = normalizeHeader(pattern);
      if (normalizedRow[normalizedPattern]) {
        return normalizedRow[normalizedPattern].trim();
      }
    }
    
    // 부분 매칭 시도 (정규화된 키에서 패턴 포함 여부 확인)
    for (const pattern of patterns) {
      const normalizedPattern = normalizeHeader(pattern);
      for (const [normalizedKey, value] of Object.entries(normalizedRow)) {
        if (normalizedKey.includes(normalizedPattern) || normalizedPattern.includes(normalizedKey)) {
          return value.trim();
        }
      }
    }
    
    // 키워드 기반 매칭 (이름, 회사명 등)
    for (const pattern of patterns) {
      const normalizedPattern = normalizeHeader(pattern);
      const keywords = normalizedPattern.split(/[^가-힣a-z0-9]+/).filter(k => k.length > 1);
      
      for (const [normalizedKey, value] of Object.entries(normalizedRow)) {
        // 키워드가 모두 포함되어 있는지 확인
        if (keywords.every(keyword => normalizedKey.includes(keyword))) {
          return value.trim();
        }
      }
    }
    
    return '';
  };

  // 디버깅: 첫 번째 row 로깅 (민감 정보 제외)
  if (rows.length > 0) {
    const firstRowSample = { ...rows[0] };
    // 이메일, 전화번호 등 민감 정보 제거
    Object.keys(firstRowSample).forEach(key => {
      const lowerKey = key.toLowerCase();
      if (lowerKey.includes('email') || lowerKey.includes('이메일') || 
          lowerKey.includes('phone') || lowerKey.includes('연락처') || 
          lowerKey.includes('전화')) {
        firstRowSample[key] = '[REDACTED]';
      }
    });
    console.log('CSV 첫 번째 row 샘플 (민감 정보 제거):', JSON.stringify(firstRowSample));
    console.log('CSV 헤더:', Object.keys(rows[0]));
    console.log('CSV 헤더 개수:', Object.keys(rows[0]).length);
    console.log('CSV 전체 rows 수:', rows.length);
  }

  for (const row of rows) {
    // 필수 필드 확인 (다양한 필드명 변형 지원)
    // 이름: 참석자 성함(직위), 이름, name 등
    const name = findField(row, [
      '참석자 성함(직위)', '참석자 성함', '참석자성함직위', '참석자성함',
      '성함', '이름', 'name', 'Name', 'NAME',
      '참석자', '담당자', '담당자명', '참가자', '참가자명'
    ]) || '';
    
    // 회사명: 기업명, 회사명, company 등
    const company = findField(row, [
      '기업명', '회사명', '회사', 'company', 'Company', 'COMPANY',
      '기업', '기업이름', '회사이름', '소속', '소속기관'
    ]) || '';
    
    // 이메일: 이메일 주소, 담당자 이메일 주소, email 등
    const email = findField(row, [
      '이메일 주소', '담당자 이메일 주소', '이메일', 'email', 'Email', 'EMAIL',
      '이메일 ', ' email', 'Email '
    ]) || '';

    // 이름에서 직위 제거 (예: "홍길동(대표)" -> "홍길동")
    const cleanName = name.replace(/\s*\([^)]*\)\s*$/, '').trim();

    if (!cleanName || !company) {
      console.log('스킵된 row (name 또는 company 없음):', { 
        availableFields: Object.keys(row),
        fieldCount: Object.keys(row).length
      });
      continue; // 필수 필드가 없으면 스킵
    }
    
    // 민감 정보 없이 로깅
    console.log('유효한 참가자 발견:', { name: cleanName, company });

    // 고유 토큰 생성 (중복 방지)
    let token = generateAccessToken();
    let attempts = 0;
    while (tokenSet.has(token) && attempts < 10) {
      token = generateAccessToken();
      attempts++;
    }
    tokenSet.add(token);

    // 추가 필드 추출
    const phone = findField(row, [
      '담당자 연락처', '전화번호', '연락처', 'phone', 'Phone', 'PHONE'
    ]) || null;
    
    const groupType = findField(row, [
      '기업 구분', '그룹', 'group_type', 'Group', 'GROUP'
    ]) || 'A';
    
    const businessType = findField(row, [
      '주요 사업 분야', '사업 분야', '사업유형', 'business_type', 'Business Type'
    ]) || null;
    
    const industryTags = findField(row, [
      '주요 기술/디자인 역량(주요 제품군 또는 실적 기재)', 
      '주요 기술/디자인 역량', '기술 역량', '디자인 역량',
      'industry_tags', 'Industry Tags'
    ]) || null;
    
    const interests = findField(row, [
      '밋업 참가 목적', '참가 목적', 'interests', 'Interests'
    ]) || null;
    
    const designInterests = findField(row, [
      '협력에 관심있는 디자인 분야', '관심 디자인 분야', '디자인 분야'
    ]) || null;
    
    const teamSize = findField(row, [
      '희망 참석인원', '참석인원', '인원'
    ]) || null;

    // 참가자 데이터 구성
    participants.push({
      event_id: eventId,
      name: cleanName,
      company,
      email: email || null,
      phone: phone ? phone.trim() : null,
      group_type: groupType.trim().toUpperCase() || 'A',
      access_token: token,
      industry_tags: industryTags ? industryTags.trim() : null,
      interests: interests ? interests.trim() : null,
      business_type: businessType ? businessType.trim() : null,
      team_info: teamSize ? teamSize.trim() : null,
      representative: null, // 참석자 성함에서 이미 추출됨
    });
  }

  if (participants.length === 0) {
    console.log('파싱된 rows 수:', rows.length);
    console.log('첫 번째 row 존재 여부:', rows.length > 0);
    
    // 첫 번째 row에서 필드 매칭 테스트
    if (rows.length > 0) {
      const testRow = rows[0];
      const testName = findField(testRow, [
        '참석자 성함(직위)', '참석자 성함', '성함', '이름', 'name', 'Name', 'NAME',
        '이름 ', ' name', 'Name ', '참석자', '담당자'
      ]);
      const testCompany = findField(testRow, [
        '기업명', '회사명', '회사', 'company', 'Company', 'COMPANY',
        '회사 ', ' company', 'Company ', '기업'
      ]);
      console.log('첫 번째 row 필드 매칭 테스트:', { 
        testNameFound: !!testName, 
        testCompanyFound: !!testCompany, 
        allKeys: Object.keys(testRow),
        keyCount: Object.keys(testRow).length
      });
    }
    
    return c.json({ 
      error: '유효한 참가자 데이터가 없습니다.',
      details: `CSV에서 ${rows.length}개의 행을 읽었지만, 이름과 회사명이 모두 있는 행이 없습니다. CSV 형식을 확인해주세요. (필수: 이름, 회사명)`,
      sampleHeaders: rows.length > 0 ? Object.keys(rows[0]) : [],
      debugInfo: rows.length > 0 ? {
        firstRowSample: Object.fromEntries(Object.entries(rows[0]).slice(0, 5)),
        allHeaders: Object.keys(rows[0]),
        firstRowFull: rows[0]
      } : null
    }, 400);
  }

  // Bulk Insert (배치 처리로 최적화)
  const batchSize = 100;
  let insertedCount = 0;
  let errorCount = 0;
  const errors: string[] = [];

  console.log(`참가자 등록 시작: ${participants.length}명`);

  for (let i = 0; i < participants.length; i += batchSize) {
    const batch = participants.slice(i, i + batchSize);
    
    // 각 배치를 트랜잭션으로 처리
    for (const participant of batch) {
      try {
        const result = await c.env.DB.prepare(
          `INSERT INTO participants (
            event_id, name, company, email, phone, group_type, 
            access_token, industry_tags, interests, business_type, 
            team_info, representative
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            participant.event_id,
            participant.name,
            participant.company,
            participant.email || null,
            participant.phone || null,
            participant.group_type || 'A',
            participant.access_token,
            participant.industry_tags || null,
            participant.interests || null,
            participant.business_type || null,
            participant.team_info || null,
            participant.representative || null
          )
          .run();

        insertedCount++;
      } catch (error: any) {
        errorCount++;
        const errorMsg = `${participant.name} (${participant.company}): ${error?.message || '저장 실패'}`;
        errors.push(errorMsg);
        // @ts-ignore
        console.error('참가자 등록 실패:', errorMsg, error);
      }
    }
  }

  // @ts-ignore
  console.log(`참가자 등록 완료: ${insertedCount}명 성공, ${errorCount}명 실패`);

  return c.json({
    success: true,
    total: participants.length,
    inserted: insertedCount,
    errors: errorCount,
    errorDetails: errors.length > 0 ? errors : undefined,
    message: `${insertedCount}명의 참가자가 등록되었습니다.${errorCount > 0 ? ` (${errorCount}건 실패)` : ''}`,
  });
}

// POST /api/admin/events/:id/participants/import
admin.post('/events/:id/participants/import', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    // FormData에서 CSV 파일 받기
    const formData = await c.req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return c.json({ error: 'CSV 파일이 필요합니다.' }, 400);
    }

    // CSV 텍스트 읽기
    const csvText = await file.text();
    
    // 공통 CSV 처리 함수 사용
    return await processCSVImport(c, eventId, csvText);
  } catch (error: any) {
    // @ts-ignore
    console.error('CSV Import 오류:', error);
    return c.json({ 
      error: 'CSV Import 중 오류가 발생했습니다.',
      details: error.message 
    }, 500);
  }
});

// GET /api/events/:id/participants?token= (참가자 목록 조회)
api.get('/events/:id/participants', async (c) => {
  const eventId = c.req.param('id');
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: '토큰이 필요합니다.' }, 400);
  }

  try {
    // 먼저 토큰으로 현재 참가자 인증
    const currentParticipant = await c.env.DB.prepare(
      'SELECT id, event_id FROM participants WHERE access_token = ? AND event_id = ?'
    )
      .bind(token, eventId)
      .first<{ id: number; event_id: number }>();

    if (!currentParticipant) {
      return c.json({ error: '유효하지 않은 토큰입니다.' }, 401);
    }

    // 같은 이벤트의 다른 참가자 목록 조회 (자신 제외)
    const participants = await c.env.DB.prepare(
      `SELECT 
        id, name, company, email, group_type, 
        industry_tags, interests, business_type, team_info, representative
      FROM participants 
      WHERE event_id = ? AND id != ?
      ORDER BY name ASC`
    )
      .bind(eventId, currentParticipant.id)
      .all<{
        id: number;
        name: string;
        company: string;
        email: string;
        group_type: string;
        industry_tags: string | null;
        interests: string | null;
        business_type: string | null;
        team_info: string | null;
        representative: string | null;
      }>();

    return c.json({
      participants: participants.results || [],
    });
  } catch (error) {
    // @ts-ignore
    console.error('참가자 목록 조회 오류:', error);
    return c.json({ error: '서버 오류가 발생했습니다.' }, 500);
  }
});

// GET /api/events/:id/preferences/form?token=
api.get('/events/:id/preferences/form', async (c) => {
  const eventId = c.req.param('id');
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: '토큰이 필요합니다.' }, 400);
  }

  try {
    // D1 데이터베이스에서 토큰으로 참가자 조회
    const participant = await c.env.DB.prepare(
      'SELECT id, event_id, name, company, email, group_type FROM participants WHERE access_token = ? AND event_id = ?'
    )
      .bind(token, eventId)
      .first<{
        id: number;
        event_id: number;
        name: string;
        company: string;
        email: string;
        group_type: string;
      }>();

    if (!participant) {
      return c.json({ error: '유효하지 않은 토큰입니다.' }, 401);
    }

    // 참가자 정보 반환 (프론트엔드에서 사용)
    return c.json({
      participant: {
        id: participant.id,
        name: participant.name,
        company: participant.company,
        email: participant.email,
        groupType: participant.group_type,
      },
    });
  } catch (error) {
    // Cloudflare Workers 환경에서 console 사용 가능
    // @ts-ignore
    console.error('토큰 검증 오류:', error);
    return c.json({ error: '서버 오류가 발생했습니다.' }, 500);
  }
});

// POST /api/events/:id/preferences?token=
api.post('/events/:id/preferences', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  const token = c.req.query('token');

  if (!token) {
    return c.json({ error: '토큰이 필요합니다.' }, 400);
  }

  try {
    // 토큰으로 참가자 인증
    const participant = await c.env.DB.prepare(
      'SELECT id, event_id FROM participants WHERE access_token = ? AND event_id = ?'
    )
      .bind(token, eventId)
      .first<{ id: number; event_id: number }>();

    if (!participant) {
      return c.json({ error: '유효하지 않은 토큰입니다.' }, 401);
    }

    const body = await c.req.json<{
      rankings: Record<string, number>; // {1: targetId, 2: targetId, ...}
      special_flag: string | null;
    }>();

    // 기존 preferences 삭제
    await c.env.DB.prepare(
      'DELETE FROM preferences WHERE event_id = ? AND participant_id = ?'
    )
      .bind(eventId, participant.id)
      .run();

    // special_flag가 NONE인 경우
    if (body.special_flag === 'NONE') {
      await c.env.DB.prepare(
        'INSERT INTO preferences (event_id, participant_id, target_id, rank, special_flag) VALUES (?, ?, ?, ?, ?)'
      )
        .bind(eventId, participant.id, null, null, 'NONE')
        .run();

      return c.json({
        success: true,
        message: '선호가 저장되었습니다.',
      });
    }

    // rankings 저장
    const rankings = body.rankings || {};
    
    // 1순위 필수 검증
    if (!rankings['1'] && body.special_flag !== 'NONE') {
      return c.json({ error: '1순위는 필수입니다.' }, 400);
    }

    // rank 유효성 검증
    const validRanks = new Set<number>();
    for (const [rankStr, targetId] of Object.entries(rankings)) {
      const rank = parseInt(rankStr);
      
      // rank 범위 검증 (1~5)
      if (rank < 1 || rank > 5) {
        return c.json({ error: `유효하지 않은 순위입니다: ${rank}. 순위는 1~5 사이여야 합니다.` }, 400);
      }
      
      // targetId 검증
      if (!targetId || typeof targetId !== 'number') {
        return c.json({ error: `유효하지 않은 참가자 ID입니다: ${targetId}` }, 400);
      }
      
      // 중복 rank 검증
      if (validRanks.has(rank)) {
        return c.json({ error: `중복된 순위입니다: ${rank}` }, 400);
      }
      
      validRanks.add(rank);
    }

    // target_id가 실제 참가자인지 검증
    for (const [rankStr, targetId] of Object.entries(rankings)) {
      const target = await c.env.DB.prepare(
        'SELECT id FROM participants WHERE id = ? AND event_id = ?'
      )
        .bind(targetId, eventId)
        .first<{ id: number }>();
      
      if (!target) {
        return c.json({ error: `참가자를 찾을 수 없습니다: ${targetId}` }, 400);
      }
    }

    let insertedCount = 0;

    for (const [rankStr, targetId] of Object.entries(rankings)) {
      const rank = parseInt(rankStr);
      try {
        await c.env.DB.prepare(
          'INSERT INTO preferences (event_id, participant_id, target_id, rank, special_flag) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(eventId, participant.id, targetId, rank, null)
          .run();
        insertedCount++;
      } catch (error: any) {
        // @ts-ignore
        console.error(`순위 ${rank} 저장 오류:`, error);
        // 개별 실패는 무시하고 계속 진행 (이미 유효성 검증 완료)
      }
    }

    return c.json({
      success: true,
      message: `${insertedCount}개의 선호가 저장되었습니다.`,
      count: insertedCount,
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('선호 저장 오류:', error);
    return c.json({
      error: '선호 저장 중 오류가 발생했습니다.',
      details: error.message,
    }, 500);
  }
});

// POST /api/admin/events/:id/matching/score
admin.post('/events/:id/matching/score', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    // 가중치 정의
    const WEIGHTS: Record<number, number> = {
      1: 100,
      2: 80,
      3: 60,
      4: 40,
      5: 20,
    };

    // 모든 참가자 조회
    const participants = await c.env.DB.prepare(
      'SELECT id, name, company, group_type FROM participants WHERE event_id = ?'
    )
      .bind(eventId)
      .all<{
        id: number;
        name: string;
        company: string;
        group_type: string;
      }>();

    if (!participants.results || participants.results.length === 0) {
      return c.json({ error: '참가자가 없습니다.' }, 400);
    }

    // 모든 preferences 조회
    const preferences = await c.env.DB.prepare(
      'SELECT participant_id, target_id, rank, special_flag FROM preferences WHERE event_id = ?'
    )
      .bind(eventId)
      .all<{
        participant_id: number;
        target_id: number | null;
        rank: number | null;
        special_flag: string | null;
      }>();

    // 참가자별 preferences 맵 생성
    const prefMap = new Map<number, Map<number, number>>();
    const noneFlags = new Set<number>();

    preferences.results?.forEach(pref => {
      if (pref.special_flag === 'NONE') {
        noneFlags.add(pref.participant_id);
        return;
      }

      if (pref.target_id && pref.rank) {
        if (!prefMap.has(pref.participant_id)) {
          prefMap.set(pref.participant_id, new Map());
        }
        prefMap.get(pref.participant_id)!.set(pref.target_id, pref.rank);
      }
    });

    // 매칭 점수 계산
    const scores: Array<{
      participant_id: number;
      participant_name: string;
      participant_company: string;
      target_id: number;
      target_name: string;
      target_company: string;
      score: number;
      participant_rank: number | null;
      target_rank: number | null;
    }> = [];

    for (const p1 of participants.results) {
      // NONE 플래그가 있으면 스킵
      if (noneFlags.has(p1.id)) continue;

      const p1Prefs = prefMap.get(p1.id);
      if (!p1Prefs) continue;

      for (const p2 of participants.results) {
        // 자기 자신은 스킵
        if (p1.id === p2.id) continue;
        
        // 같은 그룹만 매칭 (A그룹은 A그룹과, B그룹은 B그룹과)
        if (p1.group_type !== p2.group_type) continue;

        // NONE 플래그가 있으면 스킵
        if (noneFlags.has(p2.id)) continue;

        const p1Rank = p1Prefs.get(p2.id);
        const p2Prefs = prefMap.get(p2.id);
        const p2Rank = p2Prefs?.get(p1.id) || null;

        // 양방향 점수 계산
        let score = 0;
        if (p1Rank) {
          score += WEIGHTS[p1Rank] || 0;
        }
        if (p2Rank) {
          score += WEIGHTS[p2Rank] || 0;
        }

        // 점수가 0보다 큰 경우만 추가
        if (score > 0) {
          scores.push({
            participant_id: p1.id,
            participant_name: p1.name,
            participant_company: p1.company,
            target_id: p2.id,
            target_name: p2.name,
            target_company: p2.company,
            score,
            participant_rank: p1Rank || null,
            target_rank: p2Rank || null,
          });
        }
      }
    }

    // 점수 내림차순 정렬
    scores.sort((a, b) => b.score - a.score);

    return c.json({
      success: true,
      scores,
      total: scores.length,
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('스코어링 오류:', error);
    return c.json({
      error: '스코어링 중 오류가 발생했습니다.',
      details: error.message,
    }, 500);
  }
});

// POST /api/admin/events/:id/matching/approve
admin.post('/events/:id/matching/approve', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    const body = await c.req.json<{
      matches: Array<{
        participant_id: number;
        target_id: number;
        score: number;
      }>;
    }>();

    if (!body.matches || !Array.isArray(body.matches)) {
      return c.json({ error: '매칭 데이터가 필요합니다.' }, 400);
    }

    // 기존 matching_results 삭제 (트랜잭션)
    await c.env.DB.prepare(
      'DELETE FROM matching_results WHERE event_id = ?'
    )
      .bind(eventId)
      .run();

    // 새로운 매칭 결과 저장
    let insertedCount = 0;
    for (const match of body.matches) {
      try {
        await c.env.DB.prepare(
          'INSERT INTO matching_results (event_id, participant_id, target_id, score, created_at) VALUES (?, ?, ?, ?, ?)'
        )
          .bind(eventId, match.participant_id, match.target_id, match.score, new Date().toISOString())
          .run();
        insertedCount++;
      } catch (error: any) {
        // @ts-ignore
        console.error(`매칭 저장 오류 (${match.participant_id}-${match.target_id}):`, error);
      }
    }

    // Fallback JSON 생성
    const matchingResults = await c.env.DB.prepare(
      `SELECT 
        mr.participant_id,
        mr.target_id,
        mr.score,
        p1.name as participant_name,
        p1.company as participant_company,
        p1.group_type as participant_group,
        p2.name as target_name,
        p2.company as target_company,
        p2.group_type as target_group
      FROM matching_results mr
      JOIN participants p1 ON mr.participant_id = p1.id
      JOIN participants p2 ON mr.target_id = p2.id
      WHERE mr.event_id = ?`
    )
      .bind(eventId)
      .all<{
        participant_id: number;
        target_id: number;
        score: number;
        participant_name: string;
        participant_company: string;
        participant_group: string;
        target_name: string;
        target_company: string;
        target_group: string;
      }>();

    const jsonData = {
      event_id: eventId,
      generated_at: new Date().toISOString(),
      matches: matchingResults.results || [],
    };

    // JSON 파일을 public/static 폴더에 저장하기 위해 반환
    // 실제로는 Cloudflare Pages의 빌드 프로세스에서 처리되거나,
    // R2/KV에 저장하거나, Functions에서 직접 반환하는 방식 사용
    // 여기서는 JSON 데이터를 반환하고, 클라이언트에서 다운로드하도록 함

    return c.json({
      success: true,
      message: `${insertedCount}개의 매칭이 확정되었습니다.`,
      count: insertedCount,
      json_data: jsonData, // Fallback JSON 데이터 포함
      json_url: `/static/matching_results_${eventId}.json`,
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('매칭 확정 오류:', error);
    return c.json({
      error: '매칭 확정 중 오류가 발생했습니다.',
      details: error.message,
    }, 500);
  }
});

// GET /static/matching_results_{id}.json (Fallback JSON)
app.get('/static/matching_results_:id.json', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    const matchingResults = await c.env.DB.prepare(
      `SELECT 
        mr.participant_id,
        mr.target_id,
        mr.score,
        p1.name as participant_name,
        p1.company as participant_company,
        p1.group_type as participant_group,
        p2.name as target_name,
        p2.company as target_company,
        p2.group_type as target_group
      FROM matching_results mr
      JOIN participants p1 ON mr.participant_id = p1.id
      JOIN participants p2 ON mr.target_id = p2.id
      WHERE mr.event_id = ?`
    )
      .bind(eventId)
      .all<{
        participant_id: number;
        target_id: number;
        score: number;
        participant_name: string;
        participant_company: string;
        participant_group: string;
        target_name: string;
        target_company: string;
        target_group: string;
      }>();

    const jsonData = {
      event_id: eventId,
      generated_at: new Date().toISOString(),
      matches: matchingResults.results || [],
    };

    // JSON 파일로 반환 (헤더 설정)
    c.header('Content-Type', 'application/json');
    c.header('Cache-Control', 'public, max-age=3600');
    return c.json(jsonData);
  } catch (error: any) {
    // @ts-ignore
    console.error('Fallback JSON 조회 오류:', error);
    return c.json({
      error: '매칭 결과를 불러올 수 없습니다.',
      details: error.message,
    }, 500);
  }
});

// GET /api/events/:id/lookup?name= (이름/회사명 검색)
api.get('/events/:id/lookup', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  const name = c.req.query('name');

  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  if (!name || name.trim() === '') {
    return c.json({ error: '검색어를 입력하세요.' }, 400);
  }

  try {
    const searchTerm = `%${name.trim()}%`;

    // 먼저 matching_results에서 조회 시도
    const matchingResults = await c.env.DB.prepare(
      `SELECT 
        mr.participant_id,
        mr.target_id,
        mr.score,
        p1.name as participant_name,
        p1.company as participant_company,
        p1.group_type as participant_group,
        p2.name as target_name,
        p2.company as target_company,
        p2.group_type as target_group
      FROM matching_results mr
      JOIN participants p1 ON mr.participant_id = p1.id
      JOIN participants p2 ON mr.target_id = p2.id
      WHERE mr.event_id = ? 
        AND (p1.name LIKE ? OR p1.company LIKE ? OR p2.name LIKE ? OR p2.company LIKE ?)`
    )
      .bind(eventId, searchTerm, searchTerm, searchTerm, searchTerm)
      .all<{
        participant_id: number;
        target_id: number;
        score: number;
        participant_name: string;
        participant_company: string;
        participant_group: string;
        target_name: string;
        target_company: string;
        target_group: string;
      }>();

    if (matchingResults.results && matchingResults.results.length > 0) {
      // 매칭 결과를 참가자별로 그룹화
      const resultsByParticipant = new Map<number, {
        participant_id: number;
        participant_name: string;
        participant_company: string;
        participant_group: string;
        matches: Array<{
          target_id: number;
          target_name: string;
          target_company: string;
          target_group: string;
          score: number;
        }>;
      }>();

      matchingResults.results.forEach(mr => {
        if (!resultsByParticipant.has(mr.participant_id)) {
          resultsByParticipant.set(mr.participant_id, {
            participant_id: mr.participant_id,
            participant_name: mr.participant_name,
            participant_company: mr.participant_company,
            participant_group: mr.participant_group,
            matches: [],
          });
        }
        resultsByParticipant.get(mr.participant_id)!.matches.push({
          target_id: mr.target_id,
          target_name: mr.target_name,
          target_company: mr.target_company,
          target_group: mr.target_group,
          score: mr.score,
        });
      });

      return c.json({
        success: true,
        results: Array.from(resultsByParticipant.values()),
        source: 'database',
      });
    }

    // 매칭 결과가 없으면 빈 결과 반환
    return c.json({
      success: true,
      results: [],
      source: 'database',
      message: '검색 결과가 없습니다.',
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('조회 오류:', error);
    return c.json({
      error: '조회 중 오류가 발생했습니다.',
      details: error.message,
    }, 500);
  }
});

// GET /api/admin/events/:id/export/participants (참가자 목록 조회)
admin.get('/events/:id/export/participants', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    // @ts-ignore
    console.log(`참가자 목록 조회 시작: eventId=${eventId}`);
    
    const result = await c.env.DB.prepare(
      `SELECT 
        id, name, company, email, phone, group_type, access_token
      FROM participants 
      WHERE event_id = ?
      ORDER BY name ASC`
    )
      .bind(eventId)
      .all();

    // @ts-ignore
    console.log(`참가자 목록 조회 결과: ${result?.results?.length || 0}명`);

    // 결과가 없거나 null인 경우 빈 배열 반환
    const participants = result?.results || [];

    return c.json({
      success: true,
      participants: participants,
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('참가자 목록 조회 오류:', error);
    // @ts-ignore
    console.error('에러 상세:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name
    });
    
    // 테이블이 없는 경우 빈 배열 반환
    if (error?.message && error.message.includes('no such table')) {
      // @ts-ignore
      console.log('participants 테이블이 없습니다. 빈 배열 반환.');
      return c.json({
        success: true,
        participants: [],
      });
    }
    
    return c.json({
      error: '참가자 목록을 불러올 수 없습니다.',
      details: error?.message || '알 수 없는 오류',
    }, 500);
  }
});

// GET /api/admin/events/:id/export/matching (매칭 결과 조회)
admin.get('/events/:id/export/matching', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    // @ts-ignore
    console.log(`매칭 결과 조회 시작: eventId=${eventId}`);
    
    // matching_results 테이블이 없을 수 있으므로 LEFT JOIN 사용
    const result = await c.env.DB.prepare(
      `SELECT 
        mr.participant_id,
        mr.target_id,
        mr.score,
        mr.session_num,
        mr.table_num,
        p1.name as participant_name,
        p1.company as participant_company,
        p1.group_type as participant_group,
        p2.name as target_name,
        p2.company as target_company,
        p2.group_type as target_group
      FROM matching_results mr
      LEFT JOIN participants p1 ON mr.participant_id = p1.id
      LEFT JOIN participants p2 ON mr.target_id = p2.id
      WHERE mr.event_id = ?
      ORDER BY mr.score DESC`
    )
      .bind(eventId)
      .all();

    // @ts-ignore
    console.log(`매칭 결과 조회 결과: ${result?.results?.length || 0}개`);

    return c.json({
      success: true,
      matches: result?.results || [],
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('매칭 결과 조회 오류:', error);
    // @ts-ignore
    console.error('에러 상세:', {
      message: error?.message,
      stack: error?.stack,
      name: error?.name
    });
    
    // 매칭 결과가 없을 수도 있으므로 빈 배열 반환
    if (error?.message && error.message.includes('no such table')) {
      // @ts-ignore
      console.log('matching_results 테이블이 없습니다. 빈 배열 반환.');
      return c.json({
        success: true,
        matches: [],
      });
    }
    return c.json({
      error: '매칭 결과를 불러올 수 없습니다.',
      details: error?.message || '알 수 없는 오류',
    }, 500);
  }
});

// GET /api/admin/events (이벤트 목록 조회)
admin.get('/events', async (c) => {
  try {
    const events = await c.env.DB.prepare(
      'SELECT id, name, description, start_date, end_date, created_at FROM events ORDER BY created_at DESC'
    )
      .all<{
        id: number;
        name: string;
        description: string | null;
        start_date: string | null;
        end_date: string | null;
        created_at: string;
      }>();

    return c.json({
      success: true,
      events: events.results || [],
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('이벤트 목록 조회 오류:', error);
    return c.json({
      error: '이벤트 목록을 불러올 수 없습니다.',
      details: error.message,
    }, 500);
  }
});

// GET /api/admin/events/:id (이벤트 상세 조회)
admin.get('/events/:id', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    const event = await c.env.DB.prepare(
      `SELECT 
        id, name, description, start_date, end_date, 
        group_a_name, group_b_name, group_a_color, group_b_color,
        session_count, table_count, config_json, created_at
      FROM events 
      WHERE id = ?`
    )
      .bind(eventId)
      .first<{
        id: number;
        name: string;
        description: string | null;
        start_date: string | null;
        end_date: string | null;
        group_a_name: string | null;
        group_b_name: string | null;
        group_a_color: string | null;
        group_b_color: string | null;
        session_count: number | null;
        table_count: number | null;
        config_json: string | null;
        created_at: string;
      }>();

    if (!event) {
      return c.json({ error: '이벤트를 찾을 수 없습니다.' }, 404);
    }

    return c.json({
      success: true,
      event,
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('이벤트 조회 오류:', error);
    return c.json({
      error: '이벤트를 불러올 수 없습니다.',
      details: error.message,
    }, 500);
  }
});

// POST /api/admin/events (이벤트 생성)
admin.post('/events', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      start_date?: string;
      end_date?: string;
      group_a_name?: string;
      group_b_name?: string;
      group_a_color?: string;
      group_b_color?: string;
      session_count?: number;
      table_count?: number;
      config_json?: string;
    }>();

    if (!body.name || body.name.trim() === '') {
      return c.json({ error: '이벤트 이름은 필수입니다.' }, 400);
    }

    const result = await c.env.DB.prepare(
      `INSERT INTO events (
        name, description, start_date, end_date,
        group_a_name, group_b_name, group_a_color, group_b_color,
        session_count, table_count, config_json, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        body.name.trim(),
        body.description?.trim() || null,
        body.start_date || null,
        body.end_date || null,
        body.group_a_name?.trim() || 'A그룹',
        body.group_b_name?.trim() || 'B그룹',
        body.group_a_color?.trim() || '#3B82F6',
        body.group_b_color?.trim() || '#10B981',
        body.session_count || 1,
        body.table_count || 10,
        body.config_json || null,
        new Date().toISOString()
      )
      .run();

    return c.json({
      success: true,
      event_id: result.meta.last_row_id,
      message: '이벤트가 생성되었습니다.',
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('이벤트 생성 오류:', error);
    return c.json({
      error: '이벤트 생성 중 오류가 발생했습니다.',
      details: error.message,
    }, 500);
  }
});

// PUT /api/admin/events/:id/config (이벤트 설정 업데이트)
admin.put('/events/:id/config', async (c) => {
  const eventId = parseInt(c.req.param('id'));
  
  if (isNaN(eventId)) {
    return c.json({ error: '유효하지 않은 이벤트 ID입니다.' }, 400);
  }

  try {
    const body = await c.req.json<{
      name?: string;
      description?: string;
      start_date?: string;
      end_date?: string;
      group_a_name?: string;
      group_b_name?: string;
      group_a_color?: string;
      group_b_color?: string;
      session_count?: number;
      table_count?: number;
      config_json?: string;
    }>();

    // 업데이트할 필드만 동적으로 구성
    const updates: string[] = [];
    const values: any[] = [];

    if (body.name !== undefined) {
      updates.push('name = ?');
      values.push(body.name.trim());
    }
    if (body.description !== undefined) {
      updates.push('description = ?');
      values.push(body.description?.trim() || null);
    }
    if (body.start_date !== undefined) {
      updates.push('start_date = ?');
      values.push(body.start_date || null);
    }
    if (body.end_date !== undefined) {
      updates.push('end_date = ?');
      values.push(body.end_date || null);
    }
    if (body.group_a_name !== undefined) {
      updates.push('group_a_name = ?');
      values.push(body.group_a_name?.trim() || 'A그룹');
    }
    if (body.group_b_name !== undefined) {
      updates.push('group_b_name = ?');
      values.push(body.group_b_name?.trim() || 'B그룹');
    }
    if (body.group_a_color !== undefined) {
      updates.push('group_a_color = ?');
      values.push(body.group_a_color?.trim() || '#3B82F6');
    }
    if (body.group_b_color !== undefined) {
      updates.push('group_b_color = ?');
      values.push(body.group_b_color?.trim() || '#10B981');
    }
    if (body.session_count !== undefined) {
      updates.push('session_count = ?');
      values.push(body.session_count || 1);
    }
    if (body.table_count !== undefined) {
      updates.push('table_count = ?');
      values.push(body.table_count || 10);
    }
    if (body.config_json !== undefined) {
      updates.push('config_json = ?');
      values.push(body.config_json || null);
    }

    if (updates.length === 0) {
      return c.json({ error: '업데이트할 필드가 없습니다.' }, 400);
    }

    values.push(eventId);

    await c.env.DB.prepare(
      `UPDATE events SET ${updates.join(', ')} WHERE id = ?`
    )
      .bind(...values)
      .run();

    return c.json({
      success: true,
      message: '이벤트 설정이 업데이트되었습니다.',
    });
  } catch (error: any) {
    // @ts-ignore
    console.error('이벤트 설정 업데이트 오류:', error);
    return c.json({
      error: '이벤트 설정 업데이트 중 오류가 발생했습니다.',
      details: error.message,
    }, 500);
  }
});

// Admin 라우트를 API에 연결
api.route('/admin', admin);

// 이메일 검증 함수
function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

// 문자열 길이 검증
function validateStringLength(str: string, maxLength: number, fieldName: string): { valid: boolean; error?: string } {
  if (str.length > maxLength) {
    return { valid: false, error: `${fieldName}은(는) ${maxLength}자를 초과할 수 없습니다.` };
  }
  return { valid: true };
}

// ===== KIDP2025 밋업 신청 API =====
// POST /api/kidp2025/meetup/selections - 선택 저장/업데이트
api.post('/kidp2025/meetup/selections', async (c) => {
  try {
    console.log('=== 선택 저장 요청 시작 ===');
    
    const body = await c.req.json<{
      email: string;
      companyName: string;
      priority: number;
      listType: 'tech' | 'design';
      companyData: Record<string, any>; // 전체 기업 정보 (JSON)
    }>();

    // 필수 필드 검증
    if (!body.email || !body.companyName || !body.priority || !body.listType) {
      console.error('필수 필드 누락');
      return c.json({ error: '필수 필드가 누락되었습니다.' }, 400);
    }

    // 이메일 형식 검증
    const email = body.email.toLowerCase().trim();
    if (!isValidEmail(email)) {
      console.error('이메일 형식 오류');
      return c.json({ error: '유효하지 않은 이메일 형식입니다.' }, 400);
    }

    // 문자열 길이 검증
    const emailLengthCheck = validateStringLength(email, 255, '이메일');
    if (!emailLengthCheck.valid) {
      return c.json({ error: emailLengthCheck.error }, 400);
    }

    const companyNameLengthCheck = validateStringLength(body.companyName, 200, '기업명');
    if (!companyNameLengthCheck.valid) {
      return c.json({ error: companyNameLengthCheck.error }, 400);
    }

    // 우선순위 범위 검증
    if (body.priority < 1 || body.priority > 7) {
      console.error('우선순위 범위 오류:', body.priority);
      return c.json({ error: '우선순위는 1-7 사이여야 합니다.' }, 400);
    }

    // listType 검증
    if (body.listType !== 'tech' && body.listType !== 'design') {
      return c.json({ error: 'listType은 "tech" 또는 "design"이어야 합니다.' }, 400);
    }

    // companyData를 JSON 문자열로 변환 (안전하게)
    let companyDataJson: string;
    try {
      companyDataJson = JSON.stringify(body.companyData || {});
      // JSON 크기 제한 (예: 1MB)
      if (companyDataJson.length > 1024 * 1024) {
        return c.json({ error: '기업 데이터가 너무 큽니다. (최대 1MB)' }, 400);
      }
    } catch (jsonError: unknown) {
      const errorMessage = jsonError instanceof Error ? jsonError.message : '알 수 없는 오류';
      console.error('companyData JSON 변환 실패:', errorMessage);
      return c.json({ 
        error: '기업 데이터 변환 중 오류가 발생했습니다.',
        details: errorMessage 
      }, 400);
    }

    // D1 데이터베이스 연결 확인
    if (!c.env.DB) {
      console.error('D1 데이터베이스가 설정되지 않았습니다.');
      return c.json({
        error: '데이터베이스 연결 오류',
        details: 'D1 데이터베이스가 설정되지 않았습니다.',
        type: 'DatabaseNotConfigured',
      }, 500);
    }

    const now = new Date().toISOString();

    // 기존 선택 확인 (같은 이메일, 같은 우선순위)
    const existing = await c.env.DB.prepare(
      `SELECT id FROM kidp2025_meetup_selections 
       WHERE user_email = ? AND priority = ? AND list_type = ?`
    )
      .bind(email, body.priority, body.listType)
      .first<{ id: number }>();

    if (existing) {
      // 업데이트
      await c.env.DB.prepare(
        `UPDATE kidp2025_meetup_selections 
         SET selected_company_name = ?, company_data = ?, updated_at = ?
         WHERE id = ?`
      )
        .bind(
          body.companyName,
          companyDataJson,
          now,
          existing.id
        )
        .run();
    } else {
      // 새로 삽입
      await c.env.DB.prepare(
        `INSERT INTO kidp2025_meetup_selections 
         (user_email, selected_company_name, priority, list_type, company_data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(
          email,
          body.companyName,
          body.priority,
          body.listType,
          companyDataJson,
          now,
          now
        )
        .run();
    }

    // 같은 기업이 다른 우선순위에 있으면 제거
    await c.env.DB.prepare(
      `DELETE FROM kidp2025_meetup_selections 
       WHERE user_email = ? AND selected_company_name = ? AND priority != ? AND list_type = ?`
    )
      .bind(email, body.companyName, body.priority, body.listType)
      .run();

    // Google Apps Script 웹훅으로 데이터 동기화 (선택사항)
    if (c.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL) {
      try {
        const webhookPayload = {
          email: body.email.toLowerCase().trim(),
          companyName: body.companyName,
          priority: body.priority,
          listType: body.listType,
          companyData: body.companyData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        
        // 타임아웃 설정 (5초)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);
        
        try {
          const webhookResponse = await fetch(c.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(webhookPayload),
            redirect: 'follow',
            signal: controller.signal,
          });
          
          clearTimeout(timeoutId);
          
          const responseText = await webhookResponse.text();
          
          if (!webhookResponse.ok) {
            console.error('Google Sheets 웹훅 응답 오류:', {
              status: webhookResponse.status,
              statusText: webhookResponse.statusText,
            });
          } else {
            console.log('Google Sheets 동기화 성공');
          }
        } catch (fetchError: unknown) {
          clearTimeout(timeoutId);
          if (fetchError instanceof Error && fetchError.name === 'AbortError') {
            console.error('Google Sheets 웹훅 타임아웃');
          } else {
            const errorMessage = fetchError instanceof Error ? fetchError.message : '알 수 없는 오류';
            console.error('Google Sheets 동기화 실패:', errorMessage);
          }
        }
      } catch (error: unknown) {
        // Google Sheets 동기화 실패해도 DB 저장은 성공으로 처리
        const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
        console.error('Google Sheets 동기화 실패:', errorMessage);
      }
    }

    console.log('=== 선택 저장 성공 ===');
    
    // 웹훅 호출 여부를 응답에 포함 (민감 정보 제외)
    const webhookCalled = !!c.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL;
    return c.json({ 
      success: true, 
      message: '선택이 저장되었습니다.',
      webhookCalled: webhookCalled,
    });
  } catch (error: unknown) {
    console.error('=== 선택 저장 오류 ===');
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
    const errorType = error instanceof Error ? error.constructor.name : 'Unknown';
    
    console.error('오류 타입:', errorType);
    console.error('오류 메시지:', errorMessage);
    
    return c.json({
      error: '선택 저장 중 오류가 발생했습니다.',
      details: errorMessage,
      type: errorType,
    }, 500);
  }
});

// GET /api/kidp2025/meetup/selections?email=xxx&listType=tech|design - 사용자의 선택 조회
// GET /api/kidp2025/meetup/selections (email 없으면 전체 조회 - 관리자용)
api.get('/kidp2025/meetup/selections', async (c) => {
  try {
    const email = c.req.query('email');
    const listType = c.req.query('listType') as 'tech' | 'design' | undefined;

    // 이메일이 없으면 전체 데이터 조회 (관리자용) - 이메일별로 그룹화
    // company_data는 제외하고 필요한 필드만 가져오기 (성능 최적화)
    if (!email) {
      let query = `SELECT user_email, selected_company_name, priority, list_type, created_at, updated_at FROM kidp2025_meetup_selections`;
      const params: any[] = [];

      if (listType) {
        query += ` WHERE list_type = ?`;
        params.push(listType);
      }

      query += ` ORDER BY user_email, list_type, priority ASC`;

      let result;
      try {
        result = await c.env.DB.prepare(query)
          .bind(...params)
          .all<{
            user_email: string;
            selected_company_name: string;
            priority: number;
            list_type: string;
            created_at: string;
            updated_at: string;
          }>();
      } catch (dbError: unknown) {
        const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        // 테이블이 없는 경우 빈 결과 반환
        if (dbErrorMessage.includes('no such table')) {
          console.warn('kidp2025_meetup_selections 테이블이 없습니다. 빈 결과를 반환합니다.');
          return c.json({ success: true, selections: [] });
        }
        throw dbError;
      }

      // 이메일별로 그룹화 (company_data 파싱 제거 - admin 페이지에서 CSV로부터 userCompany를 가져옴)
      interface GroupedSelection {
        email: string;
        listType: string;
        selections: { [priority: number]: string }; // companyName만 저장
        createdAt: string;
        updatedAt: string;
      }

      const grouped: Map<string, GroupedSelection> = new Map();

      for (const row of result.results || []) {
        const key = `${row.user_email}|${row.list_type}`;
        
        if (!grouped.has(key)) {
          grouped.set(key, {
            email: row.user_email,
            listType: row.list_type,
            selections: {},
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          });
        }

        const group = grouped.get(key)!;
        group.selections[row.priority] = row.selected_company_name;
        // 가장 최근 업데이트 시간 사용
        if (new Date(row.updated_at) > new Date(group.updatedAt)) {
          group.updatedAt = row.updated_at;
        }
      }

      // 그룹화된 데이터를 배열로 변환
      const groupedSelections = Array.from(grouped.values()).map(group => ({
        email: group.email,
        userCompany: '', // admin 페이지에서 CSV로부터 가져옴
        listType: group.listType,
        priority1: group.selections[1] || '',
        priority2: group.selections[2] || '',
        priority3: group.selections[3] || '',
        priority4: group.selections[4] || '',
        priority5: group.selections[5] || '',
        priority6: group.selections[6] || '',
        priority7: group.selections[7] || '',
        createdAt: group.createdAt,
        updatedAt: group.updatedAt,
      }));

      return c.json({ success: true, selections: groupedSelections });
    }

    // 개별 사용자 조회도 필요한 필드만 가져오기 (company_data 제외)
    let query = `SELECT user_email, selected_company_name, priority, list_type, created_at, updated_at FROM kidp2025_meetup_selections WHERE user_email = ?`;
    const params: any[] = [email.toLowerCase().trim()];

    if (listType) {
      query += ` AND list_type = ?`;
      params.push(listType);
    }

    query += ` ORDER BY priority ASC`;

    const result = await c.env.DB.prepare(query)
      .bind(...params)
      .all<{
        user_email: string;
        selected_company_name: string;
        priority: number;
        list_type: string;
        created_at: string;
        updated_at: string;
      }>();

    const selections = (result.results || []).map(row => ({
      email: row.user_email,
      companyName: row.selected_company_name,
      priority: row.priority,
      listType: row.list_type,
      companyData: {}, // company_data는 가져오지 않음
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return c.json({ success: true, selections });
  } catch (error: any) {
    // @ts-ignore
    console.error('선택 조회 오류:', error);
    return c.json({
      error: '선택 조회 중 오류가 발생했습니다.',
      details: error.message,
    }, 500);
  }
});

// DELETE /api/kidp2025/meetup/selections?email=xxx&priority=x&listType=tech|design - 선택 삭제
api.delete('/kidp2025/meetup/selections', async (c) => {
  try {
    // @ts-ignore
    console.log('=== 선택 삭제 요청 시작 ===');
    
    const email = c.req.query('email');
    const priority = c.req.query('priority');
    const listType = c.req.query('listType') as 'tech' | 'design' | undefined;

    // @ts-ignore
    console.log('삭제 요청 파라미터:', { email, priority, listType });

    if (!email) {
      // @ts-ignore
      console.error('이메일 누락');
      return c.json({ error: '이메일이 필요합니다.' }, 400);
    }

    if (!c.env.DB) {
      // @ts-ignore
      console.error('D1 데이터베이스가 설정되지 않았습니다.');
      return c.json({
        error: '데이터베이스 연결 오류',
        details: 'D1 데이터베이스가 설정되지 않았습니다.',
      }, 500);
    }

    let query = `DELETE FROM kidp2025_meetup_selections WHERE user_email = ?`;
    const params: any[] = [email.toLowerCase().trim()];

    if (priority) {
      query += ` AND priority = ?`;
      params.push(parseInt(priority));
    }

    if (listType) {
      query += ` AND list_type = ?`;
      params.push(listType);
    }

    // @ts-ignore
    console.log('삭제 쿼리 실행:', query, params);
    
    const result = await c.env.DB.prepare(query)
      .bind(...params)
      .run();

    // @ts-ignore
    console.log('삭제 완료:', result);
    return c.json({ success: true, message: '선택이 삭제되었습니다.' });
  } catch (error: any) {
    // @ts-ignore
    console.error('=== 선택 삭제 오류 ===');
    // @ts-ignore
    console.error('오류 타입:', error?.constructor?.name);
    // @ts-ignore
    console.error('오류 메시지:', error?.message);
    // @ts-ignore
    console.error('오류 스택:', error?.stack);
    // @ts-ignore
    console.error('전체 오류 객체:', error);
    
    return c.json({
      error: '선택 삭제 중 오류가 발생했습니다.',
      details: error?.message || '알 수 없는 오류',
      type: error?.constructor?.name || 'Unknown',
    }, 500);
  }
});

// GET /api/kidp2025/meetup/selections/export - D1 데이터를 CSV로 내보내기 (이메일별 그룹화)
api.get('/kidp2025/meetup/selections/export', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    let result;
    try {
      result = await c.env.DB.prepare(
        `SELECT * FROM kidp2025_meetup_selections ORDER BY user_email, list_type, priority ASC`
      ).all<{
        id: number;
        user_email: string;
        selected_company_name: string;
        priority: number;
        list_type: string;
        company_data: string;
        created_at: string;
        updated_at: string;
      }>();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      // 테이블이 없는 경우 빈 CSV 반환
      if (dbErrorMessage.includes('no such table')) {
        console.warn('kidp2025_meetup_selections 테이블이 없습니다. 빈 CSV를 반환합니다.');
        const headers = [
          '이메일',
          '소속 기업명',
          '목록 타입',
          '1순위',
          '2순위',
          '3순위',
          '4순위',
          '5순위',
          '6순위',
          '7순위',
          '생성 시간',
          '수정 시간'
        ];
        const csvContent = headers.join(',') + '\n';
        const bom = '\uFEFF';
        return new Response(bom + csvContent, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': `attachment; filename="kidp2025_meetup_selections_${new Date().toISOString().split('T')[0]}.csv"`,
          },
        });
      }
      throw dbError;
    }

    const rows = result.results || [];

    // 이메일별로 그룹화
    interface GroupedSelection {
      email: string;
      userCompany: string; // 사용자 소속 기업명
      listType: string;
      selections: { [priority: number]: string }; // priority -> company name
      createdAt: string;
      updatedAt: string;
    }

    const grouped: Map<string, GroupedSelection> = new Map();

    for (const row of rows) {
      const key = `${row.user_email}|${row.list_type}`;
      
      if (!grouped.has(key)) {
        // company_data에서 사용자 소속 기업명 추출 시도
        let userCompany = '';
        try {
          const companyData = JSON.parse(row.company_data || '{}');
          // 사용자 소속 기업명은 첫 번째 선택의 정보에서 추출
          // 또는 별도 필드가 있다면 사용
          userCompany = companyData['사용자 소속 기업'] || companyData['소속 기업'] || '';
        } catch (e) {
          // JSON 파싱 실패 시 무시
        }

        grouped.set(key, {
          email: row.user_email,
          userCompany: userCompany,
          listType: row.list_type,
          selections: {},
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        });
      }

      const group = grouped.get(key)!;
      group.selections[row.priority] = row.selected_company_name;
      // 가장 최근 업데이트 시간 사용
      if (new Date(row.updated_at) > new Date(group.updatedAt)) {
        group.updatedAt = row.updated_at;
      }
    }

    // CSV 헤더
    const headers = [
      '이메일',
      '소속 기업명',
      '목록 타입',
      '1순위',
      '2순위',
      '3순위',
      '4순위',
      '5순위',
      '6순위',
      '7순위',
      '생성 시간',
      '수정 시간'
    ];

    // CSV 행 생성
    const csvRows = [headers.join(',')];

    for (const group of Array.from(grouped.values())) {
      const csvRow = [
        `"${(group.email || '').replace(/"/g, '""')}"`,
        `"${(group.userCompany || '').replace(/"/g, '""')}"`,
        group.listType === 'tech' ? '기술기업' : '디자인전문기업',
        `"${(group.selections[1] || '').replace(/"/g, '""')}"`,
        `"${(group.selections[2] || '').replace(/"/g, '""')}"`,
        `"${(group.selections[3] || '').replace(/"/g, '""')}"`,
        `"${(group.selections[4] || '').replace(/"/g, '""')}"`,
        `"${(group.selections[5] || '').replace(/"/g, '""')}"`,
        `"${(group.selections[6] || '').replace(/"/g, '""')}"`,
        `"${(group.selections[7] || '').replace(/"/g, '""')}"`,
        `"${group.createdAt}"`,
        `"${group.updatedAt}"`
      ];
      csvRows.push(csvRow.join(','));
    }

    const csvContent = csvRows.join('\n');
    const bom = '\uFEFF'; // UTF-8 BOM (Excel 호환)

    return new Response(bom + csvContent, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="kidp2025_meetup_selections_${new Date().toISOString().split('T')[0]}.csv"`,
      },
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
    console.error('CSV 내보내기 오류:', errorMessage);
    return c.json({
      error: 'CSV 내보내기 중 오류가 발생했습니다.',
      details: errorMessage,
    }, 500);
  }
});

// GET /api/kidp2025/meetup/matching - 매칭 우선순위 계산
api.get('/kidp2025/meetup/matching', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    // 모든 선택 데이터 가져오기 (매칭 계산에 필요한 필드만 선택 - company_data 제외)
    let result;
    try {
      result = await c.env.DB.prepare(
        `SELECT user_email, selected_company_name, priority, list_type 
         FROM kidp2025_meetup_selections 
         ORDER BY user_email, list_type, priority ASC`
      ).all<{
        user_email: string;
        selected_company_name: string;
        priority: number;
        list_type: string;
      }>();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      // 테이블이 없는 경우 빈 결과 반환
      if (dbErrorMessage.includes('no such table')) {
        console.warn('kidp2025_meetup_selections 테이블이 없습니다. 빈 결과를 반환합니다.');
        return c.json({ success: true, matchings: [] });
      }
      throw dbError;
    }

    const rows = result.results || [];

    // 우선순위를 점수로 변환 (1순위=7점, 2순위=6점, ..., 7순위=1점)
    function priorityToScore(priority: number): number {
      if (priority >= 1 && priority <= 7) {
        return 8 - priority; // 1순위=7점, 2순위=6점, ..., 7순위=1점
      }
      return 0;
    }

    // 기업명 정규화 함수 (공백, 괄호 등 제거하여 비교)
    function normalizeCompanyName(name: string): string {
      if (!name) return '';
      return name.replace(/\s+/g, '').replace(/\(주\)/g, '').replace(/주식회사/g, '').toLowerCase();
    }

    // 기술기업 -> 디자인기업 매핑 (기술기업 이메일 -> {디자인기업명: 점수})
    const techToDesign: Map<string, Map<string, { score: number; priority: number }>> = new Map();
    
    // 디자인기업 -> 기술기업 매핑 (디자인기업 이메일 -> {기술기업명: 점수})
    const designToTech: Map<string, Map<string, { score: number; priority: number }>> = new Map();

    // 이메일 -> 소속 기업명 매핑 (모든 선택 데이터에서 추출)
    // 기술기업 이메일 -> 기술기업명
    // 디자인기업 이메일 -> 디자인기업명
    const emailToCompanyName: Map<string, string> = new Map();
    // CSV에 있는 기업명 Set (정규화된 기업명으로 저장) - 선택된 기업명 검증용
    const validCompanyNames: Set<string> = new Set();

    // CSV에서 사용자 소속 기업 정보 로드 시도
    const TECH_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTdxkwUoTKh5y5xLeMwerXez9IpL6_QEY09ipRULpS-R60XiiSVMWC3LEjgVzHU57_EjlIVvg1LfSw_/pub?output=csv';
    const DESIGN_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRH6aVLkutbRv8_gv9kSdHS62fmcYV6_sLBRjGoPQyHHahyWMBdEm7nLVLPlkrnGccKXB462N9ZgKyK/pub?output=csv';

    try {
      // 기술기업 CSV에서 이메일 -> 기업명 매핑 생성
      const techCsvRes = await fetch(TECH_CSV_URL);
      const techCsvText = await techCsvRes.text();
      const techLines = techCsvText.split(/\r?\n/).filter(line => line.trim());
      if (techLines.length > 1) {
        const techHeaders = techLines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const userEmailIdx = techHeaders.findIndex(h => h === '사용자 이름' || h === '이메일');
        const companyNameIdx = techHeaders.findIndex(h => h === '기업명' || h === '멘토명' || h === '기술기업명');
        
        if (userEmailIdx >= 0 && companyNameIdx >= 0) {
          for (let i = 1; i < techLines.length; i++) {
            const values = techLines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const email = (values[userEmailIdx] || '').toLowerCase().trim();
            const companyName = values[companyNameIdx] || '';
            if (email && companyName) {
              emailToCompanyName.set(email, companyName);
              // 정규화된 기업명도 Set에 추가
              validCompanyNames.add(normalizeCompanyName(companyName));
            }
          }
        }
      }

      // 디자인전문기업 CSV에서 이메일 -> 기업명 매핑 생성
      const designCsvRes = await fetch(DESIGN_CSV_URL);
      const designCsvText = await designCsvRes.text();
      const designLines = designCsvText.split(/\r?\n/).filter(line => line.trim());
      if (designLines.length > 1) {
        const designHeaders = designLines[0].split(',').map(h => h.trim().replace(/"/g, ''));
        const userEmailIdx = designHeaders.findIndex(h => h === '사용자 이름' || h === '이메일');
        const companyNameIdx = designHeaders.findIndex(h => h === '기업명' || h === '멘토명' || h === '디자인전문기업');
        
        if (userEmailIdx >= 0 && companyNameIdx >= 0) {
          for (let i = 1; i < designLines.length; i++) {
            const values = designLines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
            const email = (values[userEmailIdx] || '').toLowerCase().trim();
            const companyName = values[companyNameIdx] || '';
            if (email && companyName) {
              emailToCompanyName.set(email, companyName);
              // 정규화된 기업명도 Set에 추가
              validCompanyNames.add(normalizeCompanyName(companyName));
            }
          }
        }
      }
    } catch (csvError) {
      console.warn('CSV에서 사용자 소속 기업 정보를 로드하는 중 오류:', csvError);
    }

    for (const row of rows) {
      const email = row.user_email.toLowerCase().trim();
      const selectedCompany = row.selected_company_name;
      const score = priorityToScore(row.priority);

      // 사용자 소속 기업명은 CSV에서만 가져옴 (company_data는 로드하지 않음)

      // 선택된 기업명이 CSV에 있는지 확인 (CSV에서 삭제된 기업은 제외)
      const normalizedSelectedCompany = normalizeCompanyName(selectedCompany);
      if (!validCompanyNames.has(normalizedSelectedCompany)) {
        // CSV에 없는 기업명을 선택한 경우 스킵
        continue;
      }
      
      if (row.list_type === 'design') {
        // 기술기업이 디자인기업을 선택한 경우
        if (!techToDesign.has(email)) {
          techToDesign.set(email, new Map());
        }
        const techMap = techToDesign.get(email)!;
        techMap.set(selectedCompany, { score, priority: row.priority });
      } else if (row.list_type === 'tech') {
        // 디자인기업이 기술기업을 선택한 경우
        if (!designToTech.has(email)) {
          designToTech.set(email, new Map());
        }
        const designMap = designToTech.get(email)!;
        designMap.set(selectedCompany, { score, priority: row.priority });
      }
    }

    // 매칭 쌍 생성 및 점수 계산
    interface MatchingPair {
      techCompany: string;
      techEmail: string;
      designCompany: string;
      designEmail: string;
      techToDesignScore: number;
      designToTechScore: number;
      totalScore: number;
      techPriority: number | null;
      designPriority: number | null;
    }

    const matchingPairs: MatchingPair[] = [];
    const processedPairs = new Set<string>(); // 중복 방지용

    // 모든 기술기업-디자인기업 쌍에 대해 점수 계산 (양방향 + 일방향 모두 포함)
    // CSV에 있는 기술기업만 처리 (CSV에서 삭제된 기업은 제외)
    for (const [techEmail, techSelections] of techToDesign.entries()) {
      const techCompany = emailToCompanyName.get(techEmail);
      
      // emailToCompanyName에 없는 경우 (CSV에 없는 기업)는 스킵
      if (!techCompany) {
        continue;
      }
      
      for (const [selectedDesignCompany, techData] of techSelections.entries()) {
        // 해당 디자인기업명을 소속으로 가진 디자인기업 이메일 찾기
        let foundDesignEmail: string | null = null;
        let foundDesignCompany: string | null = null;
        let designData: { score: number; priority: number } | null = null;
        let matchedCompanyName: string | null = null;
        
        // CSV에 있는 디자인기업만 매칭 (CSV에서 삭제된 기업은 제외)
        for (const [designEmail, designSelections] of designToTech.entries()) {
          const designCompany = emailToCompanyName.get(designEmail);
          
          // emailToCompanyName에 없는 경우 (CSV에 없는 기업)는 스킵
          if (!designCompany) {
            continue;
          }
          
          // 디자인기업의 소속 기업명이 기술기업이 선택한 디자인기업명과 일치하는지 확인
          if (normalizeCompanyName(designCompany) === normalizeCompanyName(selectedDesignCompany)) {
            foundDesignEmail = designEmail;
            foundDesignCompany = designCompany;
            
            // 해당 디자인기업이 기술기업을 선택했는지 확인 (양방향 매칭)
            for (const [selectedTechCompany, data] of designSelections.entries()) {
              if (normalizeCompanyName(selectedTechCompany) === normalizeCompanyName(techCompany)) {
                designData = data;
                matchedCompanyName = selectedTechCompany;
                break;
              }
            }
            break;
          }
        }
        
        // 디자인기업을 찾았으면 매칭 쌍 생성 (양방향 또는 일방향)
        if (foundDesignEmail && foundDesignCompany) {
          const pairKey = `${techEmail}|${foundDesignEmail}`;
          if (!processedPairs.has(pairKey)) {
            processedPairs.add(pairKey);
            
            if (designData) {
              // 양방향 매칭
              matchingPairs.push({
                techCompany: techCompany,
                techEmail: techEmail,
                designCompany: foundDesignCompany,
                designEmail: foundDesignEmail,
                techToDesignScore: techData.score,
                designToTechScore: designData.score,
                totalScore: techData.score + designData.score,
                techPriority: techData.priority,
                designPriority: designData.priority,
              });
            } else {
              // 일방향 매칭 (기술기업만 선택)
              matchingPairs.push({
                techCompany: techCompany,
                techEmail: techEmail,
                designCompany: foundDesignCompany,
                designEmail: foundDesignEmail,
                techToDesignScore: techData.score,
                designToTechScore: 0,
                totalScore: techData.score, // 일방향이므로 해당 점수만
                techPriority: techData.priority,
                designPriority: null,
              });
            }
          }
        }
      }
    }
    
    // 일방향 매칭 (디자인기업만 선택한 경우) 추가
    for (const [designEmail, designSelections] of designToTech.entries()) {
      const designCompany = emailToCompanyName.get(designEmail);
      
      // emailToCompanyName에 없는 경우 (CSV에 없는 기업)는 스킵
      if (!designCompany) {
        continue;
      }
      
      for (const [selectedTechCompany, designData] of designSelections.entries()) {
        // 해당 기술기업명을 소속으로 가진 기술기업 이메일 찾기
        let foundTechEmail: string | null = null;
        let foundTechCompany: string | null = null;
        let techData: { score: number; priority: number } | null = null;
        
        // CSV에 있는 기술기업만 매칭 (CSV에서 삭제된 기업은 제외)
        for (const [techEmail, techSelections] of techToDesign.entries()) {
          const techCompany = emailToCompanyName.get(techEmail);
          
          // emailToCompanyName에 없는 경우 (CSV에 없는 기업)는 스킵
          if (!techCompany) {
            continue;
          }
          
          // 기술기업의 소속 기업명이 디자인기업이 선택한 기술기업명과 일치하는지 확인
          if (normalizeCompanyName(techCompany) === normalizeCompanyName(selectedTechCompany)) {
            foundTechEmail = techEmail;
            foundTechCompany = techCompany;
            
            // 해당 기술기업이 디자인기업을 선택했는지 확인 (이미 처리된 양방향 매칭인지 확인)
            for (const [selectedDesignCompany, data] of techSelections.entries()) {
              if (normalizeCompanyName(selectedDesignCompany) === normalizeCompanyName(designCompany)) {
                techData = data;
                break;
              }
            }
            break;
          }
        }
        
        // 기술기업을 찾았고, 양방향 매칭이 아닌 경우만 추가 (일방향 매칭)
        if (foundTechEmail && foundTechCompany && !techData) {
          const pairKey = `${foundTechEmail}|${designEmail}`;
          if (!processedPairs.has(pairKey)) {
            processedPairs.add(pairKey);
            
            // 일방향 매칭 (디자인기업만 선택)
            matchingPairs.push({
              techCompany: foundTechCompany,
              techEmail: foundTechEmail,
              designCompany: designCompany,
              designEmail: designEmail,
              techToDesignScore: 0,
              designToTechScore: designData.score,
              totalScore: designData.score, // 일방향이므로 해당 점수만
              techPriority: null,
              designPriority: designData.priority,
            });
          }
        }
      }
    }

    // 총점 순으로 정렬 (내림차순)
    matchingPairs.sort((a, b) => b.totalScore - a.totalScore);

    return c.json({ success: true, matchings: matchingPairs });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : '알 수 없는 오류';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('매칭 우선순위 계산 오류:', errorMessage);
    console.error('오류 스택:', errorStack);
    console.error('전체 오류 객체:', error);
    return c.json({
      error: '매칭 우선순위 계산 중 오류가 발생했습니다.',
      details: errorMessage,
      stack: errorStack,
    }, 500);
  }
});

// POST /api/kidp2025/meetup/assignments - 라운드 배정 저장 (임시, 확정 전)
api.post('/kidp2025/meetup/assignments', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    const body = await c.req.json<{
      assignments: Array<{
        round: number;
        table: number;
        techCompany: string;
        techEmail: string;
        designCompany: string;
        designEmail: string;
        score: number;
      }>;
      roundCount: number;
      tableCount: number;
    }>();

    if (!body.assignments || !Array.isArray(body.assignments)) {
      return c.json({ error: '배정 데이터가 올바르지 않습니다.' }, 400);
    }

    // 임시 배정 데이터는 저장하지 않음 (확정 시에만 저장)
    return c.json({ success: true, message: '라운드 배정이 생성되었습니다. 확정하기 버튼을 눌러주세요.' });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('라운드 배정 저장 오류:', errorMessage);
    return c.json({
      error: '라운드 배정 저장 중 오류가 발생했습니다.',
      details: errorMessage,
    }, 500);
  }
});

// POST /api/kidp2025/meetup/assignments/confirm - 라운드 배정 확정
api.post('/kidp2025/meetup/assignments/confirm', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    const body = await c.req.json<{
      assignments: Array<{
        round: number;
        table: number;
        techCompany: string;
        techEmail: string;
        designCompany: string;
        designEmail: string;
        score: number;
      }>;
      roundCount: number;
      tableCount: number;
    }>();

    if (!body.assignments || !Array.isArray(body.assignments)) {
      return c.json({ error: '배정 데이터가 올바르지 않습니다.' }, 400);
    }

    // 다음 버전 번호 가져오기
    let versionResult;
    try {
      versionResult = await c.env.DB.prepare(
        'SELECT MAX(version) as maxVersion FROM kidp2025_meetup_assignment_versions'
      ).first<{ maxVersion: number | null }>();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (dbErrorMessage.includes('no such table')) {
        versionResult = { maxVersion: null };
      } else {
        throw dbError;
      }
    }
    
    const nextVersion = (versionResult?.maxVersion || 0) + 1;
    const now = new Date().toISOString();

    // 버전 정보 저장
    try {
      await c.env.DB.prepare(
        `INSERT INTO kidp2025_meetup_assignment_versions 
         (version, round_count, table_count, confirmed_at, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
        .bind(nextVersion, body.roundCount, body.tableCount, now, now)
        .run();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (dbErrorMessage.includes('no such table')) {
        return c.json({ error: '데이터베이스 테이블이 준비되지 않았습니다. 마이그레이션을 실행해주세요.' }, 500);
      }
      throw dbError;
    }

    // 확정된 배정 데이터 저장
    for (const assignment of body.assignments) {
      try {
        await c.env.DB.prepare(
          `INSERT OR REPLACE INTO kidp2025_meetup_assignments 
           (version, round_num, table_num, tech_company, tech_email, design_company, design_email, score, created_at, confirmed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
          .bind(
            nextVersion,
            assignment.round,
            assignment.table,
            assignment.techCompany,
            assignment.techEmail,
            assignment.designCompany,
            assignment.designEmail,
            assignment.score,
            now,
            now
          )
          .run();
      } catch (dbError: unknown) {
        const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
        if (dbErrorMessage.includes('no such table')) {
          return c.json({ error: '데이터베이스 테이블이 준비되지 않았습니다. 마이그레이션을 실행해주세요.' }, 500);
        }
        console.error('배정 데이터 저장 오류:', dbErrorMessage);
        throw dbError;
      }
    }

    return c.json({ 
      success: true, 
      version: nextVersion,
      message: `라운드 배정이 확정되었습니다. (버전: ${nextVersion})` 
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('라운드 배정 확정 오류:', errorMessage);
    console.error('스택 트레이스:', errorStack);
    return c.json({
      error: '라운드 배정 확정 중 오류가 발생했습니다.',
      details: errorMessage,
      stack: errorStack,
    }, 500);
  }
});

// POST /api/kidp2025/meetup/assignments/noshow - 노쇼 처리 (확정된 배정에서 제외)
api.post('/kidp2025/meetup/assignments/noshow', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    const body = await c.req.json();
    const { companyName } = body;

    if (!companyName || typeof companyName !== 'string' || !companyName.trim()) {
      return c.json({ error: '기업명이 필요합니다.' }, 400);
    }

    // 최신 버전 번호 가져오기
    let versionResult;
    try {
      versionResult = await c.env.DB.prepare(
        'SELECT MAX(version) as maxVersion FROM kidp2025_meetup_assignment_versions'
      ).first<{ maxVersion: number | null }>();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (dbErrorMessage.includes('no such table')) {
        return c.json({ error: '확정된 배정이 없습니다.' }, 404);
      }
      throw dbError;
    }

    const latestVersion = versionResult?.maxVersion;
    if (!latestVersion) {
      return c.json({ error: '확정된 배정이 없습니다.' }, 404);
    }

    // 해당 기업명을 가진 배정 삭제 (tech_company 또는 design_company가 일치하는 경우)
    try {
      const deleteResult = await c.env.DB.prepare(
        `DELETE FROM kidp2025_meetup_assignments 
         WHERE version = ? 
         AND (tech_company = ? OR design_company = ?)`
      )
        .bind(latestVersion, companyName.trim(), companyName.trim())
        .run();

      return c.json({ 
        success: true, 
        message: '노쇼 처리 완료',
        deletedCount: deleteResult.meta.changes || 0,
      });
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      console.error('노쇼 처리 중 데이터베이스 오류:', dbErrorMessage);
      return c.json({
        error: '노쇼 처리 중 오류가 발생했습니다.',
        details: dbErrorMessage,
      }, 500);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('노쇼 처리 오류:', errorMessage);
    return c.json({
      error: '노쇼 처리 중 오류가 발생했습니다.',
      details: errorMessage,
    }, 500);
  }
});

// GET /api/kidp2025/meetup/assignments/confirmed - 확정된 배정 정보 조회
api.get('/kidp2025/meetup/assignments/confirmed', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    // 최신 버전 정보 가져오기
    let versionResult;
    try {
      versionResult = await c.env.DB.prepare(
        'SELECT * FROM kidp2025_meetup_assignment_versions ORDER BY version DESC LIMIT 1'
      ).first<{
        id: number;
        version: number;
        round_count: number;
        table_count: number;
        confirmed_at: string;
        created_at: string;
      }>();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (dbErrorMessage.includes('no such table')) {
        return c.json({ success: true, version: null });
      }
      throw dbError;
    }

    if (!versionResult) {
      return c.json({ success: true, version: null });
    }

    return c.json({ 
      success: true, 
      version: versionResult.version,
      roundCount: versionResult.round_count,
      tableCount: versionResult.table_count,
      confirmedAt: versionResult.confirmed_at,
    });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('확정된 배정 정보 조회 오류:', errorMessage);
    return c.json({
      error: '확정된 배정 정보 조회 중 오류가 발생했습니다.',
      details: errorMessage,
    }, 500);
  }
});

// GET /api/kidp2025/meetup/assignments - 라운드 배정 조회 (확정된 최신 버전만)
api.get('/kidp2025/meetup/assignments', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    // 최신 버전 번호 가져오기
    let versionResult;
    try {
      versionResult = await c.env.DB.prepare(
        'SELECT MAX(version) as maxVersion FROM kidp2025_meetup_assignment_versions'
      ).first<{ maxVersion: number | null }>();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (dbErrorMessage.includes('no such table')) {
        return c.json({ success: true, assignments: [] });
      }
      throw dbError;
    }

    const latestVersion = versionResult?.maxVersion;
    if (!latestVersion) {
      return c.json({ success: true, assignments: [] });
    }

    let result;
    try {
      result = await c.env.DB.prepare(
        `SELECT * FROM kidp2025_meetup_assignments 
         WHERE version = ? 
         ORDER BY round_num, table_num ASC`
      )
        .bind(latestVersion)
        .all<{
          id: number;
          version: number;
          round_num: number;
          table_num: number;
          tech_company: string;
          tech_email: string;
          design_company: string;
          design_email: string;
          score: number;
          created_at: string;
          confirmed_at: string | null;
        }>();
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (dbErrorMessage.includes('no such table')) {
        console.warn('kidp2025_meetup_assignments 테이블이 없습니다. 빈 결과를 반환합니다.');
        return c.json({ success: true, assignments: [] });
      }
      throw dbError;
    }

    const assignments = (result.results || []).map(row => ({
      round: row.round_num,
      table: row.table_num,
      techCompany: row.tech_company,
      techEmail: row.tech_email,
      designCompany: row.design_company,
      designEmail: row.design_email,
      score: row.score,
    }));

    return c.json({ success: true, assignments, version: latestVersion });
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('라운드 배정 조회 오류:', errorMessage);
    return c.json({
      error: '라운드 배정 조회 중 오류가 발생했습니다.',
      details: errorMessage,
    }, 500);
  }
});

// DELETE /api/kidp2025/meetup/assignments/confirmed - 확정된 배정 삭제 (초기화)
api.delete('/kidp2025/meetup/assignments/confirmed', async (c) => {
  try {
    if (!c.env.DB) {
      return c.json({ error: '데이터베이스 연결 오류' }, 500);
    }

    let totalDeletedAssignments = 0;
    let totalDeletedVersions = 0;

    try {
      // 모든 배정 데이터 삭제 (버전과 관계없이)
      const deleteAllAssignmentsResult = await c.env.DB.prepare(
        `DELETE FROM kidp2025_meetup_assignments`
      ).run();
      totalDeletedAssignments = deleteAllAssignmentsResult.meta.changes || 0;

      // 모든 버전 정보 삭제
      const deleteAllVersionsResult = await c.env.DB.prepare(
        `DELETE FROM kidp2025_meetup_assignment_versions`
      ).run();
      totalDeletedVersions = deleteAllVersionsResult.meta.changes || 0;

      console.log(`모든 배정 데이터 삭제 완료: 배정 ${totalDeletedAssignments}개, 버전 ${totalDeletedVersions}개`);

      return c.json({ 
        success: true, 
        message: '모든 확정된 배정이 삭제되었습니다.',
        deletedAssignmentsCount: totalDeletedAssignments,
        deletedVersionsCount: totalDeletedVersions,
      });
    } catch (dbError: unknown) {
      const dbErrorMessage = dbError instanceof Error ? dbError.message : String(dbError);
      if (dbErrorMessage.includes('no such table')) {
        // 테이블이 없으면 이미 삭제된 것으로 간주
        return c.json({ 
          success: true, 
          message: '삭제할 확정된 배정이 없습니다.',
          deletedAssignmentsCount: 0,
          deletedVersionsCount: 0,
        });
      }
      console.error('확정된 배정 삭제 중 데이터베이스 오류:', dbErrorMessage);
      return c.json({
        error: '확정된 배정 삭제 중 오류가 발생했습니다.',
        details: dbErrorMessage,
      }, 500);
    }
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error('확정된 배정 삭제 오류:', errorMessage, errorStack);
    return c.json({
      error: '확정된 배정 삭제 중 오류가 발생했습니다.',
      details: errorMessage,
    }, 500);
  }
});

app.route('/api', api);

// 환경 변수 검증 함수
function validateEnv(env: Env): { valid: boolean; missing: string[] } {
  const required: (keyof Env)[] = ['DB', 'JWT_SECRET', 'ADMIN_EMAILS'];
  const missing: string[] = [];
  
  for (const key of required) {
    if (!env[key]) {
      missing.push(key);
    }
  }
  
  return {
    valid: missing.length === 0,
    missing,
  };
}

// Cloudflare Pages Functions는 onRequest 핸들러를 사용해야 함
export const onRequest: PagesFunction<Env> = async (context) => {
  // 환경 변수 검증 (프로덕션 환경에서만 엄격하게)
  const envCheck = validateEnv(context.env);
  if (!envCheck.valid) {
    console.error('필수 환경 변수가 설정되지 않았습니다:', envCheck.missing);
    // 개발 환경에서는 경고만, 프로덕션에서는 에러 반환
    // return new Response('서버 설정 오류', { status: 500 });
  }
  
  const url = new URL(context.request.url);
  
  // API 경로만 처리하고, 나머지는 정적 파일로 넘김
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/static/')) {
    return app.fetch(context.request, context.env, context);
  }
  
  // 정적 파일은 그대로 제공
  return context.next();
};

