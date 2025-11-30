# Google Apps Script 웹훅 설정 가이드

이 가이드는 KIDP2025 밋업 신청 데이터를 Google Sheets에 자동으로 동기화하는 방법을 설명합니다.
**서비스 계정 키가 필요 없습니다!** Apps Script가 스크립트 소유자의 권한으로 스프레드시트에 쓸 수 있습니다.

## 1단계: Google Apps Script 코드 추가

1. **Google Sheets 열기**: https://docs.google.com/spreadsheets/d/1bxoJ8tWFOMGrOZh6ZS_OUaIQwPtj5zmRBWWWHeDJeWo/edit

2. **확장 프로그램** > **Apps Script** 클릭

3. `google-apps-script-code.js` 파일의 내용을 복사하여 Apps Script 에디터에 붙여넣기

4. **저장** 버튼 클릭 (Ctrl+S 또는 Cmd+S)

## 2단계: 웹 앱 배포

1. Apps Script 에디터에서 **배포** > **새 배포** 클릭

2. **유형 선택** 옆의 톱니바퀴 아이콘 클릭 > **웹 앱** 선택

3. 다음 설정 입력:
   - **설명**: "KIDP2025 밋업 신청 데이터 동기화" (선택사항)
   - **실행 사용자**: **나**
   - **액세스 권한**: **모든 사용자**

4. **배포** 버튼 클릭

5. **권한 확인** 팝업이 나타나면:
   - **권한 확인** 클릭
   - Google 계정 선택
   - **고급** > **안전하지 않은 페이지로 이동** 클릭 (처음 한 번만)
   - **허용** 클릭

6. 배포 완료 후 **웹 앱 URL** 복사
   - 예: `https://script.google.com/macros/s/AKfycby.../exec`
   - ⚠️ 이 URL을 안전하게 보관하세요!

## 3단계: Cloudflare 환경 변수 설정

1. **Cloudflare Dashboard** 접속: https://dash.cloudflare.com

2. **Workers & Pages** > **kidp2025-meetup2** 프로젝트 선택

3. **Settings** > **Variables and Secrets** 클릭

4. **Add variable** 클릭:
   - **Variable name**: `GOOGLE_APPS_SCRIPT_WEBHOOK_URL`
   - **Value**: 2단계에서 복사한 웹 앱 URL
   - **Encrypt** 체크 (선택사항)

5. **Save** 클릭

6. **Deployments** 탭에서 최신 배포를 다시 배포하거나, 자동 배포가 활성화되어 있으면 자동으로 반영됩니다.

## 4단계: 테스트

1. 밋업 신청 페이지에서 기업 카드를 슬롯에 드래그

2. Google Sheets에서 "밋업 신청 데이터" 시트 확인

3. 데이터가 자동으로 추가/업데이트되는지 확인

## 문제 해결

### 데이터가 Sheets에 나타나지 않는 경우

1. Apps Script 에디터에서 **실행** > **test** 함수 실행하여 테스트
2. **실행 로그** 확인 (보기 > 로그)
3. 웹 앱 URL이 올바른지 확인
4. Cloudflare 환경 변수가 올바르게 설정되었는지 확인
5. Cloudflare Dashboard > Workers & Pages > 로그에서 오류 확인

### 권한 오류가 발생하는 경우

1. Apps Script에서 **배포** > **배포 관리** 클릭
2. 최신 배포 옆의 **수정** 클릭
3. **액세스 권한**이 "모든 사용자"로 설정되어 있는지 확인
4. **새 버전**으로 다시 배포

### "스크립트가 실행 시간을 초과했습니다" 오류

- 데이터가 많을 경우 발생할 수 있습니다
- Apps Script의 실행 시간 제한은 6분입니다
- 일반적으로는 문제없지만, 데이터가 매우 많다면 Apps Script 코드를 최적화해야 할 수 있습니다

## 데이터 형식

Google Sheets에 저장되는 데이터 형식:

| 컬럼 | 설명 |
|------|------|
| 타임스탬프 | 데이터가 추가/수정된 시간 |
| 이메일 | 사용자 이메일 |
| 기업명 | 선택한 기업명 |
| 우선순위 | 1-7 |
| 목록 타입 | 'tech' 또는 'design' |
| 기업 데이터 (JSON) | 전체 기업 정보 (JSON 문자열) |
| 생성 시간 | 처음 선택한 시간 |
| 수정 시간 | 마지막 수정 시간 |

## 참고사항

- 데이터는 이메일, 우선순위, 목록 타입 조합으로 중복 체크됩니다
- 같은 조합이 있으면 업데이트, 없으면 새로 추가됩니다
- 데이터는 이메일 > 목록 타입 > 우선순위 순으로 자동 정렬됩니다
- **서비스 계정 키가 필요 없습니다!** Apps Script가 스크립트 소유자의 권한으로 작동합니다.

