# solutions.epicstage.co.kr 도메인 설정 가이드

## 문제 상황
solutions.epicstage.co.kr에 접속 시 "사이트에 연결할 수 없음" (ERR_FAILED) 에러 발생

## 해결 방법

### 1단계: Cloudflare Dashboard에서 도메인 확인

1. **Cloudflare Dashboard** 접속: https://dash.cloudflare.com
2. **Workers & Pages** > **kidp2025-meetup2** 프로젝트 선택
3. **Custom domains** 탭 클릭
4. **solutions.epicstage.co.kr** 도메인이 목록에 있는지 확인

### 2단계: 도메인이 없으면 추가

1. **Custom domains** 탭에서 **Set up a custom domain** 클릭
2. **solutions.epicstage.co.kr** 입력
3. **Continue** 클릭
4. DNS 설정 안내를 따름

### 3단계: DNS 설정 확인 (epicstage.co.kr 도메인 관리)

**중요**: epicstage.co.kr 도메인이 Cloudflare에서 관리되고 있어야 합니다.

1. Cloudflare Dashboard에서 **epicstage.co.kr** 도메인 선택
2. **DNS** > **Records** 메뉴로 이동
3. 다음 CNAME 레코드가 있는지 확인:
   - **Type**: CNAME
   - **Name**: solutions
   - **Target**: kidp2025-meetup2.pages.dev
   - **Proxy status**: Proxied (주황색 구름 아이콘)

### 4단계: DNS 레코드가 없으면 추가

1. **DNS** > **Records**에서 **Add record** 클릭
2. 다음 정보 입력:
   - **Type**: CNAME
   - **Name**: solutions
   - **Target**: kidp2025-meetup2.pages.dev
   - **Proxy status**: Proxied (주황색 구름) ✅
3. **Save** 클릭

### 5단계: SSL/TLS 설정 확인

1. **SSL/TLS** 메뉴로 이동
2. **Encryption mode**가 **Full** 또는 **Full (strict)**로 설정되어 있는지 확인
3. **Edge Certificates** 탭에서 **Always Use HTTPS** 활성화

### 6단계: 대기 시간

- DNS 변경사항이 전파되는 데 최대 24시간이 걸릴 수 있습니다
- 일반적으로 몇 분에서 몇 시간 내에 전파됩니다
- Cloudflare를 사용하는 경우 보통 더 빠르게 전파됩니다

### 7단계: 확인

다음 명령어로 확인:
```bash
# DNS 확인
dig solutions.epicstage.co.kr

# 또는
nslookup solutions.epicstage.co.kr
```

예상 결과:
- CNAME: kidp2025-meetup2.pages.dev
- 또는 IP 주소: 172.66.47.83, 172.66.44.173

## 문제 해결

### 문제 1: "사이트에 연결할 수 없음" 에러
- **원인**: DNS 레코드가 없거나 잘못 설정됨
- **해결**: 위의 3-4단계를 따라 DNS 레코드 추가/수정

### 문제 2: SSL 인증서 오류
- **원인**: SSL/TLS 설정이 잘못됨
- **해결**: 5단계의 SSL/TLS 설정 확인

### 문제 3: 도메인이 Cloudflare Pages에 표시되지 않음
- **원인**: 커스텀 도메인이 프로젝트에 연결되지 않음
- **해결**: 1-2단계를 따라 도메인 추가

## 현재 상태 확인

현재 DNS 조회 결과:
- solutions.epicstage.co.kr → kidp2025-meetup2.pages.dev (CNAME)
- IP: 172.66.47.83, 172.66.44.173

기본 도메인은 정상 작동:
- https://kidp2025-meetup2.pages.dev ✅

## 다음 단계

1. Cloudflare Dashboard에서 위의 단계들을 확인
2. DNS 레코드가 올바르게 설정되어 있는지 확인
3. 커스텀 도메인이 Cloudflare Pages 프로젝트에 연결되어 있는지 확인
4. 몇 분 대기 후 다시 접속 시도


