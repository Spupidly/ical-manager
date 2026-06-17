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

## 예정 작업

- [ ] `POST /api/events/:id/analyze` — Claude API 연동 AI 메모 분석
- [ ] 수정 이력 로컬 저장
