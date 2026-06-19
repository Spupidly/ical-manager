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

## v0.5.0 — 2026-06-18 (UX 개선 + 버그 수정)

### 신규 기능

#### 이벤트 카드 시간 막대
각 카드 상단에 24시간 기준 위치/길이로 5px 시간 막대 표시.  
색상: ✅ ok → 초록, ⚠️ warning → 주황, 📝 no-memo → 회색. 최소 15분 폭 보장.

#### 상세 모달 이전/다음 이동

| 환경 | 조작 |
|------|------|
| PC 버튼 | 모달 헤더 `‹` `›` 버튼 |
| 키보드 | `←` `→` 방향키 (INPUT/TEXTAREA 포커스 중 무시) |
| 모바일 | 모달 위 좌/우 스와이프 (60px 이상, 수평 우세) |

⚠️만 보기 필터 적용 중이면 필터된 목록 기준으로 이동. 양 끝에서 버튼 비활성화.

#### 저장 후 카드 강조 표시
저장 완료 후 모달 닫힘 → 해당 카드 파란 배경으로 3초간 강조, 화면 밖이면 자동 스크롤.

#### 자정 넘는 종료 시간 지원
메모 시간이 시작 시간보다 이른 경우(`memoEnd < memoStart`) 다음날로 판정.  
목록 힌트에 "다음날 HH:MM" 표시, 빠른 수정 시 캘린더 종료일도 +1일로 저장.

| 변경 파일 | 내용 |
|-----------|------|
| `server/public/index.html` | `memoEndNextDay` 감지, 힌트/quickFix 처리 |
| `server/server.js` | `endTimeNextDay` → `--endDay 1` 전달 |
| `swift/Sources/CalendarCLI/main.swift` | `--endDay` 옵션: endDate에 N일 추가 |

### 버그 수정

| 버그 | 원인 | 수정 |
|------|------|------|
| 방향키로 모달 이동 (메모 입력 중) | keydown 핸들러에 포커스 타입 검사 없음 | `INPUT`/`TEXTAREA` 포커스 중 방향키 무시 |
| 삭제 후 다른 모달에서 '삭제 중…' 표시 | 성공 경로에서 버튼 상태 미복원 | `finally` 블록으로 항상 초기화 |
| 메모 첫 줄이 날짜 헤더가 아닌 경우 날짜 필터 미적용 | `DATE_HEADER_RE`에 `m` 플래그 누락 | `/m` 추가 |
| `2026/05/ 22` 형식 날짜 헤더 미인식 | 정규식이 공백 미허용 | `/ ?\d{1,2}` + `normDateHeader()` 적용 |
| 다음 날짜 섹션 시간이 현재 일자 종료 시간으로 잡힘 | 위 두 버그의 복합 영향 | 동일 수정으로 해결 |

### 기타 변경

- 모달 날짜 표시: `2026-05-11` → `2026-05-11 (월)` (`formatDateLabel` 재사용)
- 저장 후 모달 즉시 닫힘 (기존 동작 복원)

---

## v0.5.1 — 2026-06-18 (자정 넘는 시간 처리 보완)

### 버그 수정

**모달 저장 시 `endTimeNextDay` 누락**  
`saveTime`에서 `changes.endTime` 설정 시 `endTimeNextDay`를 포함하지 않아, 모달에서 직접 저장할 때 자정 넘는 종료 시간이 동일 날짜에 설정되어 "The Start Date must be before the end time" 오류 발생.  
→ `toMinutes(et) < toMinutes(st || calStart)` 조건 시 `changes.endTimeNextDay = true` 포함.

### 신규 기능

**24시+ 표기 지원**  
방송/일정 관리에서 자주 쓰이는 `24:10`, `25:30` 등 24시 이상 표기를 정상 처리.

| 처리 | 내용 |
|------|------|
| 추출 | `TIME_RAW_RE`: `2[0-9]`로 확장, `normalizeTimeStr()`으로 24+ → 정규 HH:MM 변환 |
| 다음날 감지 | 정규화 후 `toMinutes(memoEnd) < toMinutes(memoStart)` 로직 그대로 동작 |
| 힌트 표시 | `findMemoEndLine()`에서 정규화 시간(`00:10`)과 원본 표기(`24:10`) 모두 검색 → 원본 메모 텍스트 그대로 표시 |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | `TIME_RAW_RE`, `normalizeTimeStr()`, `extractRawTimes()`, `findMemoEndLine` 양방향 검색, `saveTime` endTimeNextDay 추가 |

---

## v0.5.2 — 2026-06-19 (로그아웃 + 인증 로그)

### 로그아웃 기능

- 헤더 우측에 **로그아웃** 버튼 추가 (호버 시 빨간색)
- `doLogout()` — `/api/logout` POST 후 localStorage 토큰 삭제 → 로그인 화면 표시
- `POST /api/logout` 엔드포인트: 서버 측 `validTokens`에서 토큰 제거, IP 기록
- `/api/logout`은 Bearer 검증 미들웨어 예외 처리 (`/login`과 동일)  
  (만료된 토큰으로도 로그아웃 화면 진입 가능)

### 인증 이벤트 로그 (`auth.log`)

모든 인증 이벤트를 `server/auth.log`에 JSON 라인 형식으로 기록.  
서버 콘솔에도 동시 출력.

```json
{"time":"2026-06-19T10:30:00.000Z","event":"LOGIN_SUCCESS","ip":"192.168.1.1","user":"admin","pass":"my******"}
{"time":"2026-06-19T10:31:00.000Z","event":"LOGIN_FAIL","ip":"1.2.3.4","user":"admin","pass":"wrongpass"}
{"time":"2026-06-19T11:00:00.000Z","event":"LOGOUT","ip":"192.168.1.1"}
```

| 이벤트 | 기록 항목 |
|--------|-----------|
| `LOGIN_SUCCESS` | IP, user, pass (앞 2자리 + `*` 마스킹) |
| `LOGIN_FAIL` | IP, user, pass (평문 — 공격 패턴 분석용) |
| `LOGOUT` | IP |

- IP 추출: `X-Forwarded-For` 헤더 우선, 없으면 `req.ip`
- `auth.log`는 `.gitignore`의 `*.log` 패턴으로 Git 제외

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/server.js` | `fs` 모듈 추가, `writeAuthLog()`, `getClientIp()`, 로그인/로그아웃 로그, `POST /api/logout` 엔드포인트, 미들웨어 예외 추가 |
| `server/public/index.html` | 로그아웃 버튼 CSS/HTML, `doLogout()` 함수 |

---

## v0.5.3 — 2026-06-19 (모바일 UX 버그 수정)

### 로그아웃 확인 다이얼로그

`doLogout()` 호출 시 `confirm()` 으로 재확인 후 진행.

### 모바일 로그아웃 UX

- 모바일(`hover: none and pointer: coarse`)에서 로그아웃 버튼 숨김 → 레이아웃 줄바꿈 방지
- 대신 타이틀(`📅 iCal 관리`) 탭 → `doLogout()` 호출
- `handleTitleClick()` — `matchMedia`로 터치 기기 판별, 데스크탑에서는 타이틀 탭 무반응

### 버그 수정

#### 로그인 후 헤더 타이틀 행 미표시 (iOS Safari sticky 미동작)

**증상**: 빈 화면(이벤트 미조회 상태)에서 헤더 타이틀 행이 스크롤 시 위로 사라지고 컨트롤 행만 고정됨. 이벤트 목록 로드 후에는 정상.  
**원인**: 페이지 콘텐츠 높이 < 뷰포트 높이일 때 iOS Safari에서 `position: sticky`가 제대로 동작하지 않음.  
**수정**: `.event-list`에 `min-height: calc(100vh + 1px)` 추가 → 항상 스크롤 컨텍스트 확보.

추가로 로그인 오버레이 표시 중 배경 스크롤 방지 (`body.overflow = 'hidden'`), 로그인 완료 시 `setTimeout(() => scrollTo(0, 0), 0)` 으로 스크롤 위치 초기화.

#### 로그인 후 화면 확대 (iOS Safari 자동 줌)

**증상**: 로그인 후 메인 화면이 확대된 채로 표시되고 좌우 스크롤 발생.  
**원인**: `font-size < 16px`인 `input`에 포커스 시 iOS Safari가 자동 줌인, blur 후 복원 안 됨.  
**수정**: `.login-input`을 모바일 `font-size: 16px` 규칙에 추가.

> **원칙**: 모바일 `input` 폰트 크기는 항상 16px 이상 유지 (iOS 자동 줌 방지).

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | 로그아웃 confirm, 모바일 타이틀 탭 로그아웃, `.event-list min-height`, 로그인 오버레이 body overflow 처리, `.login-input` 16px |

---

## v0.6.0 — 2026-06-19 (요약 보기 + 레이아웃 시프트 방지 + 모바일 헤더 반응형)

### 요약 보기 (Summary View)

#### 모드 전환 토글
- 헤더 우측에 **요약** 버튼 추가 (활성 시 파란 배경)
- 클릭 시 목록 뷰 ↔ 요약 뷰 전환. 조회 데이터는 유지됨.
- 전환 시 화면 중앙 날짜를 기억(`getCenterVisibleDate()`), 전환 후 동일 날짜로 스크롤(`scrollToDateInView()`)

#### 요약 뷰 레이아웃

조회 기간 내 **모든 날짜**를 한 행씩 표시 (이벤트 없는 날 포함):

```
[날짜 레이블] [━━━━━━━ 24시간 타임라인 ━━━━━━━] [건수]
```

- 타임라인 바: 각 일정을 24시간 축 위치에 맞춰 컬러 세그먼트로 표시
  - ✅ ok → 초록, ⚠️ warning → 주황, 📝 no-memo → 회색
  - 다음날 걸치는 일정은 오늘 끝(`eh = 1440`)까지 표시
  - 최소 30분 폭으로 가시성 보장
- 우측 메타: `⚠️ N/총건`(경고 있음) / `✅ N`(정상) / `─`(이벤트 없음)
- 이벤트 없는 날: 배경 투명, 테두리 연회색

#### 일별 상세 팝업

- 이벤트 있는 날짜 → 클릭 가능 (포인터 커서, hover 그림자)
- ⚠️ 경고 있는 날짜 → 추가로 주황 왼쪽 테두리 강조
- 클릭 시 해당 날짜의 이벤트 카드 목록을 팝업(z-index 200)으로 표시
- 카드 클릭 → 기존 편집 모달(z-index 250) 열림 (팝업 위에 표시)
- 저장 후 요약 뷰 + 팝업 내용 자동 갱신
- ESC 키, 바깥 클릭, ✕ 버튼으로 닫기

### 모달 열림 시 레이아웃 시프트 방지

**증상**: 스크롤바 있는 상태에서 팝업이 열리면 `overflow: hidden`으로 스크롤바가 사라지며 콘텐츠 폭이 증가 → 헤더·카드가 우측으로 밀림.

**수정**: `lockScroll()` / `unlockScroll()` 헬퍼 추가.

```javascript
function lockScroll() {
  const sw = window.innerWidth - document.documentElement.clientWidth;
  if (sw > 0) document.body.style.paddingRight = sw + 'px'; // 스크롤바 너비 보정
  document.body.style.overflow = 'hidden';
}
function unlockScroll() {
  // 세 오버레이(로그인·편집모달·일별팝업) 모두 닫혔을 때만 해제
  if (!loginOpen && !modalOpen && !detailOpen) { overflow = ''; paddingRight = ''; }
}
```

모든 오버레이 open/close 함수에 적용. 중첩 오버레이(팝업 + 편집 모달)에서 먼저 닫히는 쪽이 잘못 해제하지 않음.

### 모바일 헤더 탭 반응형 축소

요약 버튼 추가로 iPhone 16 Pro Max(440px) 등에서 타이틀 행 줄바꿈 발생 → 미디어쿼리로 탭 크기 단계적 축소.

| 화면 폭 | 탭 레이블 | 패딩 / 폰트 |
|---------|----------|------------|
| > 600px | 월별 / 주별 / 일별 / 기간 | 6px 11px / 13px (기존) |
| ≤ 600px | 월별 / 주별 / 일별 / 기간 | 4px 7px / 12px |
| ≤ 390px | 월 / 주 / 일 / 기간 | 4px 5px / 11px |

- `<span class="tab-l">` (일반) / `<span class="tab-s">` (소형 화면) 두 벌을 HTML에 유지, CSS `display`로 전환 → JS 없이 즉각 반응
- ≤ 390px: `.header-title-row gap: 5px`, `.btn-view-toggle` 패딩·폰트도 축소

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | 요약 뷰 CSS/HTML/JS, 일별 상세 팝업, lockScroll/unlockScroll, 탭 반응형 미디어쿼리 |

---

## v0.6.1 — 2026-06-19 (장기 조회 오류 수정 — 월 단위 청크 병렬 조회)

### 문제

조회 기간이 길 때(예: 1년 이상) 아래 오류 발생:

```
오류: CLI output parse failed: [ { "notes" : "2025\/01\/01...
```

### 원인

`execFile`의 기본 `maxBuffer`(1MB)를 단일 CLI 호출이 초과할 경우, stdout이 중간에 잘린 채 전달되어 `JSON.parse()` 실패. 메모가 긴 이벤트가 많은 장기 범위에서 재현.

### 수정

#### 1. `maxBuffer` 상향 (server.js)

```javascript
execFile(CLI_PATH, args, { timeout: 30000, maxBuffer: 50 * 1024 * 1024 }, ...)
```

단일 월 범위 등 소규모 호출에 대한 방어 목적으로 유지.

#### 2. 월 단위 청크 병렬 조회 (근본 해결, index.html)

`dateRangeToMonthChunks(start, end)` — 조회 범위를 월 경계로 분할:

```
1년 조회 → [1월] [2월] ... [12월]  ← Promise.all 병렬 실행
             각 CLI 호출은 1개월치만 처리 (수 KB 이하)
           ↓
        results.flat().sort(startTime)  →  allEvents
```

| 항목 | 기존 | 변경 후 |
|------|------|---------|
| API 호출 횟수 | 1회 | N회 (월 수만큼) |
| 실행 방식 | 단일 순차 | `Promise.all` 병렬 |
| 단기 조회 | — | 청크 1개 → 동작 동일 |
| 버퍼 위험 | 범위 비례 | 항상 1개월치 이하 |

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/server.js` | `execFile maxBuffer: 50MB` 추가 |
| `server/public/index.html` | `dateRangeToMonthChunks()` 추가, `fetchEvents()` → 청크 병렬 조회로 교체 |

---

## v0.6.2 — 2026-06-19 (연별 조회 추가 + 모바일 탭 개선)

### 변경 내용

#### 1. 연별(year) 조회 모드 추가

- 모드 탭 맨 앞에 **연별** 추가 → 탭 순서: 연별 / 월별 / 주별 / 일별 / 기간
- 연도 선택 컨트롤: `<select>` 사용 → **iOS에서 네이티브 드럼롤(다이얼) 피커**로 표시
  - 옵션 범위: 2000년~2040년
  - ‹/› 네비게이션 버튼으로도 연도 이동 가능
- `getDateRange()` — year 모드: `YYYY-01-01 ~ YYYY-12-31` 반환
- `switchMode()` — `singleYear` 표시/숨김 처리 추가
- `initDates()` — 옵션 생성 및 초기값(올해) 설정

#### 2. 모바일 세로 모드에서 '기간' 탭 숨김

```css
@media (max-width: 600px) and (orientation: portrait) {
  .mode-tab[data-mode="range"] { display: none; }
}
```

사용 빈도가 낮은 '기간' 탭을 모바일 세로 모드에서 제거해 헤더 줄바꿈 방지. 가로 모드에서는 그대로 표시.

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | 연별 탭·`<select>` 컨트롤 추가, 기간 탭 모바일 세로 숨김, year 모드 JS 전반 |

---

## v0.6.3 — 2026-06-20 (로그인 브루트포스 방어)

### 배경

외부 접속 환경에서 비밀번호 반복 시도(브루트포스) 공격 방어 필요. IP 화이트리스트는 모바일 환경에서 IP가 수시로 바뀌어 관리 불가 → 실패 누적 기반 블랙리스트 방식 채택.

### 동작 흐름

```
로그인 요청
  ├─ 블랙리스트 IP?  → 403 즉시 거부 (LOGIN_BLOCKED)
  ├─ 인증 비활성화?  → 토큰 발급 (개발 모드, 변경 없음)
  ├─ 비밀번호 일치?  → 카운터 리셋 + 토큰 발급 (LOGIN_SUCCESS)
  └─ 불일치
       ├─ 누적 10회  → blacklist.json 등록 → 403 (LOGIN_BLACKLISTED)
       ├─ 5~9회      → 30초 대기 → 401 (LOGIN_FAIL, delay:30000)
       ├─ 3~4회      → 5초 대기  → 401 (LOGIN_FAIL, delay:5000)
       └─ 1~2회      → 즉시      → 401 (LOGIN_FAIL, delay:0)
```

- 로그인 성공 시 해당 IP 카운터 리셋
- 마지막 실패로부터 1시간 경과 시 카운터 자동 리셋 (정상 사용자 구제)
- 카운터는 메모리 보관 (서버 재시작 시 초기화), 블랙리스트는 파일 영구 보존

### 블랙리스트 해제

`server/blacklist.json`에서 해당 IP 줄 삭제 후 서버 재시작.

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/server.js` | `blacklist` Set + `blacklist.json` 로드/저장, `loginAttempts` Map, `loginDelay()`, `/api/login` 핸들러에 차단·지연 로직 추가 |

---

## v0.6.4 — 2026-06-20 (기본 포트 변경)

- `PORT` 기본값 3000 → **8765** 변경
- 환경변수 `PORT`로 오버라이드 가능: `const PORT = process.env.PORT || 8765`

---

## v0.6.5 — 2026-06-20 (지오블록 — 허용 국가 외 접근 차단)

### 변경 내용

- `geoip-lite` 패키지 추가 (로컬 GeoIP DB, 외부 API 호출 없음)
- `/api/*` 미들웨어에서 허용 국가 외 IP 403 차단, `GEO_BLOCKED` 로그 기록
- 로컬/사설 IP(`geoip.lookup()` → null)는 항상 허용
- 허용 국가 목록을 환경변수로 관리: `ALLOWED_COUNTRIES=KR` (콤마 구분으로 확장 가능)
- `AUTH_ENABLED=false`(개발 모드)일 때는 지오블록 비활성화

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/server.js` | `geoip-lite` import, `ALLOWED_COUNTRIES` Set 구성, 지오블록 미들웨어 추가 |
| `server/.env` | `ALLOWED_COUNTRIES=KR` 추가 |
| `server/package.json` | `geoip-lite` 의존성 추가 |
| `CLAUDE.md` | 환경변수 표, 보안 섹션, API 표 업데이트 |
| `README.md` | 포트·환경변수 설정·보안·API 섹션 업데이트 |

---

## v0.6.6 — 2026-06-20 (검색 UI 개선 — 월별 select, 높이 통일, 접속 표시)

### 변경 내용

#### 1. 월별 검색 컨트롤을 `<select>` 두 개로 교체

- `<input type="month">` 제거 → `<select id="singleMonthYear">` + `<select id="singleMonthMonth">`
- 연별(singleYear)과 동일한 스타일 → iOS 드럼롤 피커로 통일
- 관련 JS 전반 업데이트: `getDateRange()`, `switchMode()`, `navigatePeriod()`, `gotoThisMonth()`, `gotoToday()`, `initDates()`
- `.controls select` 공통 CSS로 통합 (`#singleYear` 개별 규칙 제거)

#### 2. 모바일 controls 라인 높이 통일

- `@media (max-width: 768px)`: `select`, `input[type="date"]`, `.btn-search` 모두 `height: 34px; box-sizing: border-box`
- 폰트 16px 유지하면서 버튼과 입력창 높이 동일하게 맞춤

#### 3. 로컬/외부 접속 표시 개선

- 기존: controls 라인에 `🏠 로컬 · host:port` 텍스트 표시
- 변경: 아이콘(🏠/🌐)만 표시, 클릭 시 `🏠 로컬 — host:port` 팝업
- 외부 클릭 시 팝업 자동 닫힘

#### 4. 경고 뱃지 위치 변경

- 조회 버튼 뒤 → 검색 입력창 앞으로 이동

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | 월별 select 교체, 높이 통일 CSS, 접속 아이콘 팝업, 뱃지 위치 |

---

## v0.6.7 — 2026-06-20 (버그 수정 + UX 개선)

### 변경 내용

#### 1. `initDates()` 크래시 버그 수정

`singleMonthMonth.value` 초기화 시 `t.getMonth()` → `today.getMonth()` 오타 수정.  
`t`가 미정의(undefined)여서 IIFE가 크래시되었고, 이후 `const DATE_HEADER_RE` 선언이 실행되지 않아 이벤트 리스너 미등록 + `DATE_HEADER_RE` TDZ 오류가 연쇄 발생.

#### 2. 일별/주별 date picker 자동 닫힘

`singleDate` 의 `change` 이벤트에서 `this.blur()` 호출.  
iOS Safari는 날짜 선택 즉시 `change`가 발생하지만 picker는 Done을 눌러야 닫히는 문제 해결.

#### 3. 조회 버튼 폭 고정

- 로딩 텍스트: `'조회 중...'` → `'…'`
- `initDates()` 마지막에 `btn.style.width = btn.offsetWidth + 'px'` — 실제 렌더링 폭을 고정해 텍스트 변경 시 레이아웃 변동 방지

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | `today.getMonth()` 수정, blur(), 버튼 폭 고정 |

---

## v0.6.8 — 2026-06-20 (로그인 비밀번호 저장 지원)

### 문제

`fetch()` 기반 SPA 로그인은 브라우저가 로그인 성공을 감지하지 못해 "비밀번호를 저장하시겠습니까?" 팝업이 뜨지 않음.

### 변경 내용

- 로그인 입력 필드를 `<form autocomplete="on">` 으로 감싸고 버튼을 `type="submit"`으로 변경
- 로그인 성공 시 Credential Management API 호출 → 브라우저에 자격증명 명시적 전달

```javascript
if (window.PasswordCredential) {
  const cred = new PasswordCredential({ id: user, password: pass });
  navigator.credentials.store(cred);
}
```

- `input[type=password]` + `autocomplete="username/current-password"` 는 이미 설정되어 있었음
- Chrome/Edge: `PasswordCredential`로 저장 팝업 동작
- Safari: `<form>` 구조로 감지 (지원 범위 제한적)
- `.login-card form { display: flex; flex-direction: column; gap: 14px; }` — form 감싸기로 깨진 간격 복구

### 변경 파일

| 파일 | 변경 내용 |
|------|-----------|
| `server/public/index.html` | `<form>` 래핑, `PasswordCredential` 저장, form gap CSS |

---

## 예정 작업

- [ ] `POST /api/events/:id/analyze` — Claude API 연동 AI 메모 분석
- [ ] 수정 이력 로컬 저장
