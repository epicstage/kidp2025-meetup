# 정식 런칭 체크리스트

## ✅ 도메인 설정
- [x] **solutions.epicstage.co.kr** 도메인이 kidp2025-meetup2 프로젝트에 연결됨
- [x] 기본 도메인: https://kidp2025-meetup2.pages.dev
- [x] 커스텀 도메인: https://solutions.epicstage.co.kr

## 📋 런칭 전 확인사항

### 1. 데이터베이스 상태
- [x] 테스트 데이터 삭제 완료
- [ ] 실제 참가기업 데이터 확인 (CSV에서)
- [ ] D1 데이터베이스 백업 권장

### 2. 환경 변수 확인
다음 환경 변수들이 Cloudflare Pages 프로젝트에 설정되어 있는지 확인:
- [ ] `GOOGLE_CLIENT_ID`
- [ ] `GOOGLE_CLIENT_SECRET`
- [ ] `OAUTH_REDIRECT_URI` (https://solutions.epicstage.co.kr/auth/callback)
- [ ] `JWT_SECRET`
- [ ] `ADMIN_EMAILS` (pd@epicstage.co.kr)
- [ ] `GOOGLE_APPS_SCRIPT_WEBHOOK_URL` (선택사항)

### 3. 기능 확인
- [ ] 메인 페이지 접속 확인: https://solutions.epicstage.co.kr
- [ ] 기술기업 목록 페이지: https://solutions.epicstage.co.kr/tech-companies.html
- [ ] 디자인기업 목록 페이지: https://solutions.epicstage.co.kr/design-companies.html
- [ ] 좌석 배치도: https://solutions.epicstage.co.kr/floor-plan.html
- [ ] 어드민 페이지: https://solutions.epicstage.co.kr/admin.html
- [ ] Google OAuth 로그인 작동 확인
- [ ] 기업 선택 기능 (7개까지) 작동 확인
- [ ] 매칭 우선순위 계산 확인
- [ ] 라운드 배정 기능 확인
- [ ] 좌석 배치도 표시 확인

### 4. 보안 확인
- [ ] 어드민 페이지 접근 제한 (Google OAuth)
- [ ] CORS 설정 확인
- [ ] API 엔드포인트 보안 확인
- [ ] 사용자 데이터 보호 확인

### 5. 성능 확인
- [ ] 페이지 로딩 속도 확인
- [ ] CSV 데이터 로딩 속도 확인
- [ ] 대량 데이터 처리 성능 확인

### 6. 사용자 안내
- [ ] 사용자 가이드 준비 (선택사항)
- [ ] 문의 채널 안내 (선택사항)

## 🚀 배포 방법

### 자동 배포 (GitHub Actions)
```bash
git add .
git commit -m "정식 런칭 준비 완료"
git push origin main
```
→ GitHub Actions가 자동으로 배포합니다.

### 수동 배포
```bash
npm run deploy
```

## 📍 주요 URL

- **메인 페이지**: https://solutions.epicstage.co.kr
- **기술기업 목록**: https://solutions.epicstage.co.kr/tech-companies.html
- **디자인기업 목록**: https://solutions.epicstage.co.kr/design-companies.html
- **좌석 배치도**: https://solutions.epicstage.co.kr/floor-plan.html
- **어드민 페이지**: https://solutions.epicstage.co.kr/admin.html

## 🔧 환경 변수 설정 방법

1. Cloudflare Dashboard 접속: https://dash.cloudflare.com
2. **Workers & Pages** > **kidp2025-meetup2** 프로젝트 선택
3. **Settings** > **Environment variables** 클릭
4. **Production** 환경에 다음 변수 추가:
   - `GOOGLE_CLIENT_ID`: Google OAuth 클라이언트 ID
   - `GOOGLE_CLIENT_SECRET`: Google OAuth 클라이언트 시크릿
   - `OAUTH_REDIRECT_URI`: https://solutions.epicstage.co.kr/auth/callback
   - `JWT_SECRET`: JWT 토큰 서명용 시크릿 키
   - `ADMIN_EMAILS`: pd@epicstage.co.kr
   - `GOOGLE_APPS_SCRIPT_WEBHOOK_URL`: (선택사항) Google Apps Script 웹훅 URL

## ⚠️ 주의사항

1. **데이터 백업**: 정기적으로 D1 데이터베이스 백업 권장
2. **모니터링**: Cloudflare Dashboard에서 에러 로그 확인
3. **사용자 데이터 보호**: 참가기업 데이터는 안전하게 보관됨
4. **도메인 SSL**: Cloudflare가 자동으로 SSL 인증서 발급 및 관리

## 📞 문제 발생 시

1. Cloudflare Dashboard에서 배포 로그 확인
2. 브라우저 개발자 도구에서 콘솔 에러 확인
3. D1 데이터베이스 상태 확인
4. 환경 변수 설정 확인


