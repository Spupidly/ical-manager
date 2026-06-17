# iCal Manager

macOS 캘린더의 출퇴근 이벤트를 웹 브라우저에서 조회하고, 메모에 기록된 실제 시간과 캘린더 등록 시간의 불일치를 감지·수정하는 도구.

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| 캘린더 읽기/쓰기 | Swift + macOS EventKit |
| 백엔드 서버 | Node.js + Express (포트 3000) |
| 프론트엔드 | HTML / CSS / Vanilla JS |

## 시작하기

### 1. 빌드 (최초 1회)
```bash
cd src
./build.sh
```

### 2. 캘린더 권한 부여 (최초 1회, Terminal.app에서 실행)
```bash
./swift/.build/release/CalendarCLI list --start 2026-06-01 --end 2026-06-01
```
시스템 권한 다이얼로그가 표시되면 **허용**을 선택합니다.  
이후에는 서버 기동 시 자동으로 캘린더에 접근합니다.

> VS Code 통합 터미널에서는 권한 다이얼로그가 표시되지 않으므로 반드시 Terminal.app을 사용하세요.

### 3. 서버 시작
```bash
./start.sh
# → http://localhost:3000
```

## 주요 기능

### ⚠️ 불일치 감지
이벤트 메모에서 `HH:mm` 패턴을 추출해 캘린더 종료시간과 비교한다.  
불일치 항목은 ⚠️로 표시되며 원클릭으로 수정 가능하다.

### 상태 아이콘
- ⚠️ **수정필요** — 메모 종료시간 ≠ 캘린더 종료시간
- 📝 **메모없음** — 메모가 없거나 시간 패턴이 없음
- ✅ **정상** — 메모와 캘린더 시간 일치

### UI 기능
- 기간 선택 조회 / ⚠️ 건수 뱃지
- ⚠️ 항목만 필터링 토글
- 원클릭 빠른 수정 (모달 없이 즉시 적용)
- 상세 팝업: 시간 비교, 종료시간 직접 수정, 메모 전체 보기
- 저장 후 다음 ⚠️ 항목 자동 포커스

## API

```
GET  /api/events?start=YYYY-MM-DD&end=YYYY-MM-DD
PUT  /api/events/:id   { "endTime": "HH:mm" }
POST /api/events/:id/analyze   (예약, 미구현)
```

## 개발 이력

[dev_history.md](dev_history.md) 참고
