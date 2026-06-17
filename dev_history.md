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

## 예정 작업

- [ ] `POST /api/events/:id/analyze` — Claude API 연동 AI 메모 분석
- [ ] 이벤트 시작시간 수정 기능 추가
- [ ] 수정 이력 로컬 저장
