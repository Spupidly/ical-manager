# 개발 이력

## v0.1.0 — 2026-06-17 (초기 셋업)

### 작업 환경
- Claude Code CLI (claude-sonnet-4-6)
- 이후 작업: VS Code Claude Extension으로 이관

### 생성된 파일
| 파일 | 설명 |
|------|------|
| `swift/Package.swift` | Swift 패키지 정의 (macOS 13+, swift-tools 5.9) |
| `swift/Sources/CalendarCLI/main.swift` | EventKit CLI 본체 |
| `server/package.json` | Node.js 패키지 정의 (express ^4.18.2) |
| `server/server.js` | Express API 서버 |
| `server/public/index.html` | 프론트엔드 UI (단일 파일) |
| `build.sh` | Swift 빌드 + npm install |
| `start.sh` | 서버 시작 스크립트 |

### 구현 내용

**Swift CLI (`CalendarCLI`)**
- `list --start YYYY-MM-DD --end YYYY-MM-DD` — EventKit에서 기간 내 이벤트를 JSON으로 출력
- `modify --id EVENT_ID --endTime HH:mm` — 이벤트 종료시간 수정 후 저장
- macOS 14+ `requestFullAccessToEvents` / 이하 `requestAccess` 분기 처리
- 종일 이벤트 제외, 시작시간 기준 정렬

**Express 서버**
- `GET /api/events` — CLI `list` 호출, JSON 반환
- `PUT /api/events/*` — CLI `modify` 호출 (이벤트 ID의 특수문자 대응을 위해 와일드카드 라우트 사용)
- `POST /api/events/*/analyze` — AI 분석 라우트 예약 (501 반환)
- `execFile` 사용으로 shell injection 방지

**프론트엔드 UI**
- 메모 시간 분석: `HH:mm` 정규식 추출 → 첫/마지막 시간으로 예상 시작/종료 결정
- 3단계 상태 판정: ⚠️ 수정필요 / 📝 메모없음 / ✅ 정상
- 날짜별 그룹 렌더링
- 원클릭 빠른 수정 버튼 (⚠️ 항목만)
- 상세 팝업 모달: 시간 비교 카드, 종료시간 수정 입력, 메모 전체 표시
- 저장 후 다음 ⚠️ 항목 자동 포커스 (startTime 기준 다음 항목 탐색)
- AI 분석 영역 예약 (팝업 하단 점선 박스)
- Toast 알림, ESC 키로 모달 닫기, XSS 방어 처리

### 빌드 결과
- Swift CLI: 릴리즈 빌드 성공 (20.54s)
- npm: 68 packages installed, 0 vulnerabilities

### 알려진 제약
- 최초 실행 시 Terminal.app에서 CalendarCLI를 직접 실행해 권한 다이얼로그를 승인해야 함 (VS Code 터미널에서는 다이얼로그 표시 불가)
- EventKit `eventIdentifier`는 반복 이벤트의 경우 모든 인스턴스가 동일한 ID를 공유함 (단일 이벤트 수정 시 `span: .thisEvent` 적용)

---

## v0.1.1 — 2026-06-17 (CalendarCLI 코드사인 및 Bundle ID 적용)

### 배경
Swift PM으로 빌드한 CLI 바이너리는 Bundle ID가 없어 macOS TCC(권한 관리)가 권한 다이얼로그를 표시하지 않고 자동 거부함.

### 변경 내용

| 파일 | 내용 |
|------|------|
| `swift/Sources/CalendarCLI/Info.plist` | 신규: `CFBundleIdentifier`, `NSCalendarsFullAccessUsageDescription` 포함 |
| `swift/entitlements.plist` | 신규: `com.apple.security.personal-information.calendars` entitlement |
| `swift/Package.swift` | `Info.plist`를 SPM 빌드 대상에서 제외(`exclude`) |
| `build.sh` | `-Xlinker -sectcreate __TEXT __info_plist`로 plist를 바이너리에 삽입 후 `codesign --identifier com.spupidly.CalendarCLI --entitlements`로 서명 |

### 결과
- TCC가 `com.spupidly.CalendarCLI` Bundle ID를 인식
- Terminal.app에서 최초 실행 시 권한 다이얼로그 정상 표시
- 권한 승인 후 Node.js 서버의 child process로 실행 시에도 정상 동작

---

## v0.2.0 — 2026-06-17 (모달 저장 기능 전면 개선 + 모바일 UX)

### 주요 버그 수정

#### 1. EventKit 메모 저장 누락 (Swift CLI)
**증상**: 시간 + 메모를 동시에 저장할 때 시간은 반영되지만 메모는 무시됨.  
**원인**: EventKit의 `.thisEvent` span 저장 시 내부 처리 과정에서 notes 할당이 무시되는 버그.  
**수정**: 2단계 저장으로 우회.
1. 시간만 먼저 `store.save()` (첫 번째)
2. 이벤트 재조회 (detach 후 새 ID 대응) → 메모 설정 → `store.save()` (두 번째)  
메모만 변경할 경우는 단일 저장으로 유지.

#### 2. ⚠️ 이벤트에서 저장 안 됨 (프론트엔드)
**증상**: 캘린더 종료시간이 메모 시간과 달라 ⚠️ 표시된 이벤트에서, 입력란에 메모 시간이 미리 채워진 상태로 저장을 눌러도 "변경 없음"으로 처리됨.  
**원인**: 변경 비교 기준이 `initEnd`(= memoEnd로 사전 채워진 값)였기 때문.  
**수정**: 비교 기준을 캘린더 실제 시간(`calEnd`)으로 변경. memoEnd ≠ calEnd이면 저장 포함.

#### 3. 저장 성공 토스트 후 실제 미반영
**증상**: "✅ 저장" 토스트가 떴지만 캘린더 앱에는 반영 안 됨.  
**원인**: EventKit 저장 버그(위 1번)로 인한 무음 실패.  
**수정**: `verifyAfterSave()` — 저장 1초 후 EventKit 재조회, 불일치 시 경고 토스트 표시.

#### 4. 변경 없이 저장 시 조용히 모달 닫힘
**증상**: 변경 사항 없이 저장 버튼을 눌렀을 때 모달이 조용히 닫혀 저장됐다고 착각.  
**수정**: "변경 사항 없음 (시작 동일 / 종료 동일 / 메모 동일)" 토스트 + 모달 유지.

### 기능 추가 및 개선

| 항목 | 내용 |
|------|------|
| 시작 시간 수정 | 시간 수정 영역에 시작 시간 입력란 추가 (기존 종료만 가능) |
| 시간 수정 표시 형식 | `input[type="time"]`을 투명 오버레이로, 24시간제 `span`을 표시용으로 분리 (iOS 12시간제 표시 문제 해결) |
| 시간 변경 하이라이트 | 변경된 시간 입력란을 파란 배경·텍스트로 강조 |
| 모바일 시간 적용 UX | 시간 입력란 포커스 상태에서 메모 탭 → 해당 줄 시간 즉시 적용 (notes-tap 기능) |
| 에러 토스트 | 에러 토스트 6초 유지 (기존 2.5초), 재발화 시 애니메이션 리셋 |
| 메모 줄바꿈 정규화 | `\r\n` → `\n` 변환 후 비교 (iOS-macOS 줄바꿈 차이 방어) |
| iOS 값 형식 방어 | `input[type="time"]` 값 `.slice(0, 5)`로 HH:MM:SS 반환 케이스 대응 |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `swift/Sources/CalendarCLI/main.swift` | 시간+메모 2단계 저장, `eventIdentifier` null 안전 처리 |
| `server/server.js` | PUT 처리 시 args·결과 콘솔 로그 추가 |
| `server/public/index.html` | 저장 로직·비교 기준·UX 전면 개선, 24시간 표시 분리 |

---

## v0.2.1 — 2026-06-17 (Mac Safari 호환성 개선 + 이벤트 목록 힌트 개선)

### 버그 수정

#### 1. Mac Safari 시간 수정 영역 — 클릭해도 반응 없음
**증상**: Mac Safari에서 "시간 수정" 카드를 클릭해도 시간 피커가 나타나지 않음.  
**원인**: `input[type="time"]`이 `opacity: 0; position: absolute`로 숨겨져 있어, iOS에선 네이티브 다이얼이 뜨지만 macOS Safari에선 아무 피드백 없음.  
**수정**: `@media (hover: hover) and (pointer: fine)` — 포커스 시(`input:focus`)에만 `opacity: 1; background: #f8f9fa`로 전환. 평소에는 24h span 표시, 클릭하면 네이티브 time picker 표시, blur 시 span이 24h로 복귀.  
**이전 시도**: `position: static; opacity: 1`로 항상 표시 → 가로 오버플로우로 화면 잘림 → 폐기.

#### 2. Mac Safari 모달 하단 잘림
**증상**: 모달 하단(저장/닫기 버튼 영역)이 뷰포트 밖으로 잘려 접근 불가.  
**원인**: `.modal-overlay`에 `overflow-y`가 없고 `align-items: center`로 인해 모달이 뷰포트를 넘어도 스크롤 불가.  
**수정**: overlay에 `overflow-y: auto; padding: 20px` 추가, `align-items: flex-start`로 변경. `.modal`에 `margin: auto 0` 추가하고 `max-height: 90vh` 제거 — 모달이 짧으면 수직 중앙, 길면 오버레이가 스크롤.

#### 3. Mac Safari 메모 클릭으로 시간 적용 안 됨
**증상**: 시간 입력란 포커스 후 메모 클릭 시 해당 줄 시간이 적용되지 않음.  
**원인**: 기존 코드가 `touchstart`만 처리 — macOS Safari는 터치 이벤트가 없음.  
**수정**: `mousedown` 핸들러 추가. `mousedown`은 `click`과 달리 focus 이동 전에 발생하므로 `document.activeElement`로 어느 시간 입력란이 선택됐는지 확인 가능. `e.preventDefault()`로 textarea 포커스 이동 차단 후 클릭 Y좌표로 줄 계산 → 시간 추출 → 적용.

#### 4. 팝업으로 시간 적용 후 표시 미갱신 (`applyNoteTime`)
**증상**: 더블클릭 팝업에서 "시작 시간으로" / "종료 시간으로" 클릭 후 입력란 값은 변경되나, 24h span과 파란 강조 스타일이 갱신되지 않음.  
**원인**: `applyNoteTime`이 `input.value`만 설정하고 `change` 이벤트를 발생시키지 않아 리스너(`syncChangedStyle`, `updateTimeDisplay`)가 미실행.  
**수정**: `inp.dispatchEvent(new Event('change'))` 추가.

#### 5. `memoEndLine` 변수 미선언 오류
**증상**: 이벤트 목록 조회 시 "Can't find variable: memoEndLine" 오류로 렌더링 실패.  
**원인**: `renderEventRow`에서 `analyzeEvent` 반환값 구조분해 시 `memoEndLine` 누락.  
**수정**: `const { status, memoEnd, memoEndLine, calEnd } = analysis;`로 추가.

### 기능 개선

| 항목 | 내용 |
|------|------|
| 이벤트 행 힌트 | `메모 종료: 20:15 / 캘린더 종료: 08:40` → `메모 종료: 20:15 귀가 / 3,869보` (실제 메모 줄 표시) |
| `findMemoEndLine()` 추가 | 날짜 섹션 필터 적용 후 memoEnd 시간이 포함된 마지막 줄 반환 |
| 힌트 CSS | `text-overflow: ellipsis` 추가 — 긴 메모 줄도 행 밖으로 넘치지 않음 |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | Mac Safari 호환성 (시간 피커·모달·메모 클릭), 힌트 개선, 버그 수정 |

---

## v0.3.0 — 2026-06-18 (조회 방식 개편 + 기간 네비게이션 + 이벤트 제목 수정)

### 조회 방식 개편

#### 모드 탭 (헤더 타이틀 줄 배치, 모바일 우측 정렬)

| 모드 | 동작 |
|------|------|
| 월별 | 선택 월 전체 (`input[type="month"]`로 연/월만 표시) |
| 주별 | 선택 일자가 속한 월요일~일요일 |
| 일별 | 선택 일자 하루 |
| 기간 | 시작~종료 날짜 직접 입력 |

#### 좌/우 기간 네비게이션

| 환경 | 방식 |
|------|------|
| PC | 화면 좌/우 고정 `‹` `›` 버튼 (`position: fixed; z-index: 150`) |
| 모바일 | 이벤트 목록 좌/우 스와이프 (60px 이상, 수평 변위 > 수직 × 1.5) |

이동 단위: 월별→1개월, 주별→1주(7일), 일별→1일, 기간→시작·종료 모두 1개월  
(기간 말일 초과 시 해당 월 말일로 클램핑)  
이동 시 날짜 입력값도 함께 변경, 자동 재조회.

#### 날짜 피커 빠른 선택 패널 (모바일 전용)

날짜 입력 탭 시 헤더 하단에 패널 표시 (`pointerdown + preventDefault`로 input blur 없이 처리):
- 월별/기간 → **이번달** 버튼
- 주별/일별 → **오늘** 버튼

버튼 탭 → 날짜 설정 + 피커 닫기 + 자동 재조회.

### 이벤트 제목 수정

상세 모달에서 이벤트 제목 직접 편집 가능.

- 제목 표시를 `div` → `input[type="text"]`로 변경 (포커스 시 파란 밑줄 표시)
- 저장 시 시간·메모 변경과 함께 또는 단독 저장
- `verifyAfterSave`에서 제목 불일치 검증 포함

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | 조회 모드 탭, 헤더 레이아웃, 기간 네비게이션, 빠른 선택 패널, 제목 편집 UI |
| `server/server.js` | `title` 파라미터 추가 (유효성 검사 + CLI 전달) |
| `swift/Sources/CalendarCLI/main.swift` | `--title` 파라미터 처리 (`event.title = t`) |

---

## v0.3.1 — 2026-06-18 (UX 개선: 자동 재조회, 배지, 헤더 레이아웃, 기간 이동)

### 날짜 변경 시 자동 재조회

`singleMonth`, `singleDate`, `startDate`, `endDate` 모두 `change` 이벤트에 `fetchEvents()` 연결.  
일별/주별 모드에서 날짜를 직접 바꿔도 조회 버튼 없이 자동 재조회.

### 이벤트 건수 배지 포맷 변경

`⚠️ 5건` → `⚠️ 5건 / 총 20건` (경고 건수 + 전체 건수 함께 표시)

### 헤더 레이아웃 재배치

- `⚠️만 보기` 체크박스: `.controls` 줄 → 타이틀 줄의 모드탭 앞으로 이동
- `.controls` 줄 (날짜 입력, 조회 버튼, 건수 배지): `justify-content: flex-end` 우측 정렬

### 기간 조회 이동 단위 변경

기존: 시작/종료 모두 1개월 이동 (`addMonths`)  
변경: 조회 기간(일수)만큼 정확히 쉬프트

| 방향 | 동작 |
|------|------|
| 다음 (좌→우 스와이프 / `›`) | 새 시작 = 기존 종료 + 1일, 새 종료 = 새 시작 + (기간-1일) |
| 이전 (우→좌 스와이프 / `‹`) | 새 종료 = 기존 시작 - 1일, 새 시작 = 새 종료 - (기간-1일) |

예: 6/1~6/10(10일) → 다음 이동 → 6/11~6/20

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | 자동 재조회, 배지 포맷, 헤더 레이아웃, 기간 이동 로직 |

---

## v0.4.0 — 2026-06-18 (로그인 인증 추가)

### 인증 방식

비밀번호 로그인 페이지 + Bearer 토큰 방식.  
HTTP Basic Auth는 모바일에서 팝업 지연이 심해 채택하지 않음.

### 흐름

1. 접속 시 localStorage에 토큰 없으면 로그인 화면 즉시 표시
2. 아이디/비밀번호 입력 → `POST /api/login`
3. 서버가 `.env` 값과 비교 → 일치 시 랜덤 토큰(`crypto.randomBytes(32)`) 발급
4. 토큰 localStorage 저장, 메인 화면 표시
5. 이후 모든 API 요청에 `Authorization: Bearer <token>` 자동 포함
6. 서버에서 토큰 불일치/없음 → 401 → 프론트에서 로그인 화면으로 복귀

서버 재시작 시 메모리 내 토큰 초기화 → 재로그인 필요.  
`.env` 미설정 시 인증 없이 실행 (개발 편의).

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/server.js` | `dotenv` 로드, `POST /api/login`, Bearer 토큰 검증 미들웨어 |
| `server/public/index.html` | 로그인 화면 HTML/CSS, 토큰 관리 JS, `apiFetch()` 래퍼로 fetch 교체 |
| `server/package.json` | `dotenv` 의존성 추가 |
| `server/.env.example` | 신규 생성 (Git 포함, 실제 값 없음) |
| `server/.env` | 신규 생성 (Git 제외, 실제 인증 정보) |

---

## v0.4.1 — 2026-06-18 (이벤트 삭제 기능 추가)

상세 모달에서 이벤트를 삭제할 수 있는 기능 추가.

### 흐름

1. 모달 하단 좌측 `삭제` 버튼 클릭
2. 이벤트 제목 포함 confirm 다이얼로그로 재확인
3. `DELETE /api/events/:id` 요청 → Swift `delete` 커맨드 실행
4. 삭제 성공 시 목록에서 즉시 제거, 모달 닫기, 토스트 알림

반복 이벤트의 경우 `span: .thisEvent`로 해당 회차만 삭제.

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `swift/Sources/CalendarCLI/main.swift` | `DeleteResult` struct, `deleteEvent()` 함수, `case "delete"` 추가 |
| `server/server.js` | `DELETE /api/events/*` 엔드포인트 추가 |
| `server/public/index.html` | `.btn-danger` CSS, 삭제 버튼, `deleteEvent()` JS 함수 |

---

## 예정 작업

- [ ] `POST /api/events/:id/analyze` — Claude API 연동 AI 메모 분석
- [ ] 수정 이력 로컬 저장
