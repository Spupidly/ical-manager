# CLAUDE.md — iCal Manager

## 프로젝트 개요
macOS 캘린더(EventKit)의 출퇴근 이벤트를 웹 UI로 조회하고, 메모에 기록된 실제 시간과 등록 시간의 불일치를 감지·수정하는 도구.

## 디렉토리 구조
```
src/
├── swift/
│   ├── Package.swift
│   ├── entitlements.plist                ← 코드사인용 캘린더 entitlement
│   └── Sources/CalendarCLI/
│       ├── main.swift                    ← EventKit CLI (Swift)
│       └── Info.plist                    ← Bundle ID + 권한 설명 문자열
├── server/
│   ├── server.js                         ← Express API 서버 (Node.js, 포트 3000)
│   ├── package.json
│   └── public/
│       └── index.html                    ← 프론트엔드 UI (HTML/CSS/JS 단일 파일)
├── build.sh                              ← Swift 빌드 + Info.plist 삽입 + 코드사인 + npm install
├── start.sh                              ← 서버 시작
├── CLAUDE.md                             ← 이 파일
├── README.md
└── dev_history.md                        ← 작업 이력
```

## 빌드 및 실행
```bash
./build.sh    # Swift CLI 빌드 + npm install (최초 1회 또는 Swift 코드 변경 시)
./start.sh    # 서버 시작 → http://localhost:3000
```

## macOS 캘린더 권한
CalendarCLI는 Bundle ID(`com.spupidly.CalendarCLI`)와 entitlements를 포함해 코드사인됩니다.  
**최초 1회** Terminal.app에서 직접 실행하면 시스템 권한 다이얼로그가 표시됩니다:
```bash
./swift/.build/release/CalendarCLI list --start YYYY-MM-DD --end YYYY-MM-DD
```
허용 후에는 어디서 실행(서버의 child process 포함)해도 권한이 유지됩니다.

> VS Code 통합 터미널 / Claude Code Bash 도구는 TCC 다이얼로그를 띄울 수 없으므로
> 최초 권한 승인은 반드시 Terminal.app에서 해야 합니다.

## API 엔드포인트
| 메서드 | 경로 | 설명 |
|--------|------|------|
| GET | `/api/events?start=YYYY-MM-DD&end=YYYY-MM-DD` | 기간 내 이벤트 목록 |
| PUT | `/api/events/:id` body: `{ endTime: "HH:mm" }` | 이벤트 종료시간 수정 |
| POST | `/api/events/:id/analyze` | AI 분석 (미구현, 라우트 예약) |

## Swift CLI 사용법
```bash
# 이벤트 목록 조회 (JSON 출력)
./swift/.build/release/CalendarCLI list --start 2026-06-01 --end 2026-06-30

# 이벤트 종료시간 수정
./swift/.build/release/CalendarCLI modify --id "EVENT_ID" --endTime 18:30
```

## 이벤트 상태 판정 로직 (프론트엔드)
1. 이벤트 메모에서 `HH:mm` 패턴 전체 추출
2. 첫 번째 = 예상 시작시간, 마지막 = 예상 종료시간
3. 메모가 없거나 시간 패턴이 없으면 → 📝 메모없음
4. 메모 종료시간 ≠ 캘린더 종료시간 → ⚠️ 수정필요
5. 일치 → ✅ 정상

## 향후 작업 예정
- `POST /api/events/:id/analyze` — Claude API를 활용한 AI 메모 분석 기능
- 기타 개선사항은 `dev_history.md` 참고
