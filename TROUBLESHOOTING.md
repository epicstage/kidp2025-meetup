# solutions.epicstage.co.kr 접속 문제 해결 가이드

## 현재 상태
✅ DNS 설정: 정상 (solutions.epicstage.co.kr → kidp2025-meetup.pages.dev)
✅ 서버 응답: 정상 (HTTP 200)
✅ SSL 인증서: 정상 (Google Trust Services 발급)

## 해결 방법

### 방법 1: 브라우저 캐시 및 쿠키 삭제
1. Chrome에서 **Cmd + Shift + Delete** (Mac) 또는 **Ctrl + Shift + Delete** (Windows)
2. **시간 범위**: "전체 기간" 선택
3. 다음 항목 체크:
   - ✅ 쿠키 및 기타 사이트 데이터
   - ✅ 캐시된 이미지 및 파일
4. **데이터 삭제** 클릭
5. 브라우저 재시작 후 다시 접속

### 방법 2: 시크릿 모드로 접속
1. Chrome에서 **Cmd + Shift + N** (Mac) 또는 **Ctrl + Shift + N** (Windows)
2. 시크릿 창에서 https://solutions.epicstage.co.kr 접속
3. 정상 작동하면 브라우저 캐시 문제입니다

### 방법 3: DNS 캐시 플러시 (Mac)
터미널에서 다음 명령어 실행:
```bash
sudo dscacheutil -flushcache
sudo killall -HUP mDNSResponder
```

### 방법 4: 다른 브라우저로 시도
- Safari, Firefox 등 다른 브라우저로 접속 시도
- 정상 작동하면 특정 브라우저 설정 문제일 수 있습니다

### 방법 5: Cloudflare 설정 확인
Cloudflare Dashboard에서 확인:
1. **epicstage.co.kr** 도메인 선택
2. **Security** > **WAF** 메뉴 확인
   - 특정 IP나 지역이 차단되어 있지 않은지 확인
3. **Firewall Rules** 확인
   - solutions.epicstage.co.kr에 대한 차단 규칙이 있는지 확인

### 방법 6: 임시로 기본 도메인 사용
문제가 계속되면 임시로 기본 도메인 사용:
- https://kidp2025-meetup.pages.dev

## 추가 확인사항

### Cloudflare Pages 커스텀 도메인 설정
1. Cloudflare Dashboard > **Workers & Pages** > **kidp2025-meetup2**
2. **Custom domains** 탭 확인
3. **solutions.epicstage.co.kr**이 목록에 있고 **Active** 상태인지 확인

### SSL/TLS 설정
1. **epicstage.co.kr** 도메인 > **SSL/TLS**
2. **Encryption mode**: **Full** 또는 **Full (strict)** 확인
3. **Edge Certificates** > **Always Use HTTPS** 활성화 확인

## 디버깅 정보

현재 확인된 정보:
- DNS: solutions.epicstage.co.kr → kidp2025-meetup2.pages.dev ✅
- IP: 172.66.47.83, 172.66.44.173 ✅
- SSL 인증서: Google Trust Services 발급 ✅
- 서버 응답: HTTP 200 ✅

## 문의
문제가 계속되면 Cloudflare 지원팀에 문의하거나, 임시로 기본 도메인(kidp2025-meetup2.pages.dev)을 사용하세요.


