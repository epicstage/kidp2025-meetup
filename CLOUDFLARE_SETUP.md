# kidp2025-meetup2 Cloudflare Pages 설정 가이드

## 프로젝트 생성 및 GitHub 연결

### 1. Dashboard 접속
👉 https://dash.cloudflare.com/302d0c397fc8af9f8ec5744c45329f5c/pages

### 2. 새 프로젝트 생성
1. **Create application** 버튼 클릭
2. **Pages** 선택
3. **Connect to Git** 버튼 클릭 ⭐

### 3. GitHub 연결
1. **GitHub** 선택
2. GitHub 계정 인증
3. 리포지토리 선택: **epicstage/kidp2025-meetup**
4. **Begin setup** 클릭

### 4. 프로젝트 설정

#### 기본 설정
- **Project name**: `kidp2025-meetup2`
- **Production branch**: `main`
- **Framework preset**: **None** 또는 **Other**

#### 빌드 설정 ⭐
- **Build command**: `npm install`
- **Build output directory**: `public`
- **Root directory**: `/` (기본값)

### 5. 환경 변수 설정

**Settings** → **Environment variables**에서 다음 변수 추가:

#### Production 환경 변수
```
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
OAUTH_REDIRECT_URI=https://kidp2025-meetup2.pages.dev/api/auth/callback
JWT_SECRET=your_jwt_secret_key
ADMIN_EMAILS=admin1@example.com,admin2@example.com
ALLOWED_ORIGINS=https://kidp2025-meetup2.pages.dev,https://solutions.epicstage.co.kr
```

#### 선택사항
```
GOOGLE_APPS_SCRIPT_WEBHOOK_URL=https://script.google.com/...
```

### 6. D1 데이터베이스 연결

**Settings** → **Functions** → **D1 database bindings**:
- `wrangler.toml`에 설정된 D1 데이터베이스가 자동으로 연결됩니다
- 데이터베이스 ID: `2502a8e9-5138-4f22-84ef-0787d97b75e6`
- 데이터베이스 이름: `kidp2025-meetup-db`

### 7. 배포 시작
- **Save and Deploy** 버튼 클릭
- 첫 배포가 자동으로 시작됩니다! 🎉

## 빌드 설정 요약

| 항목 | 값 |
|------|-----|
| **Build command** | `npm install` |
| **Build output directory** | `public` |
| **Root directory** | `/` |
| **Framework preset** | None |

## 확인 사항

✅ `package.json`에 `hono` 의존성 포함  
✅ `functions/` 폴더에 `_middleware.ts` 존재  
✅ `wrangler.toml`에 D1 데이터베이스 설정 포함  
✅ `public/` 폴더에 정적 파일 존재

## 배포 URL

연결 완료 후:
- **Production**: https://kidp2025-meetup2.pages.dev
- **Custom Domain**: https://solutions.epicstage.co.kr (기존 도메인 연결)

## 문제 해결

### 빌드 실패 시
1. Build command가 `npm install`인지 확인
2. Build output directory가 `public`인지 확인
3. 배포 로그에서 에러 메시지 확인

### Functions 빌드 실패 시
- `hono` 패키지가 설치되지 않았을 수 있음
- Build command에 `npm install`이 포함되어 있는지 확인

## 자동 배포

연결 완료 후:
- ✅ GitHub에 푸시하면 자동 배포
- ✅ Pull Request마다 Preview 배포 생성
- ✅ 배포 상태가 GitHub에 표시됨

