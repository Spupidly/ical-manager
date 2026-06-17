import EventKit
import Foundation

struct CalendarEvent: Encodable {
    let id: String
    let title: String
    let startTime: String
    let endTime: String
    let calendar: String
    let notes: String?
}

struct ErrorResult: Encodable {
    let error: String
}

struct ModifyResult: Encodable {
    let success: Bool
    let eventId: String
    let startTime: String
    let endTime: String
}

struct DeleteResult: Encodable {
    let success: Bool
    let eventId: String
}

let store = EKEventStore()
let semaphore = DispatchSemaphore(value: 0)
let cliArgs = CommandLine.arguments

let dateFormatter: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd HH:mm"
    f.timeZone = TimeZone.current
    return f
}()

let dateParser: DateFormatter = {
    let f = DateFormatter()
    f.dateFormat = "yyyy-MM-dd"
    f.timeZone = TimeZone.current
    return f
}()

func printJSON<T: Encodable>(_ value: T) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted]
    if let data = try? encoder.encode(value),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

func parseArgs() -> [String: String] {
    var result: [String: String] = [:]
    var i = 2
    while i + 1 < cliArgs.count {
        if cliArgs[i].hasPrefix("--") {
            result[String(cliArgs[i].dropFirst(2))] = cliArgs[i + 1]
            i += 2
        } else {
            i += 1
        }
    }
    return result
}

func listEvents(params: [String: String]) {
    guard let startStr = params["start"], let endStr = params["end"],
          let startDate = dateParser.date(from: startStr),
          let endDate = dateParser.date(from: endStr) else {
        printJSON(ErrorResult(error: "--start and --end (YYYY-MM-DD) are required"))
        return
    }

    var comps = Calendar.current.dateComponents([.year, .month, .day], from: endDate)
    comps.hour = 23; comps.minute = 59; comps.second = 59
    let endInclusive = Calendar.current.date(from: comps) ?? endDate

    let predicate = store.predicateForEvents(withStart: startDate, end: endInclusive, calendars: nil)
    let events = store.events(matching: predicate)
        .filter { !$0.isAllDay }
        .sorted { $0.startDate < $1.startDate }

    let result = events.map { e in
        CalendarEvent(
            id: e.eventIdentifier ?? "",
            title: e.title ?? "",
            startTime: dateFormatter.string(from: e.startDate),
            endTime: dateFormatter.string(from: e.endDate),
            calendar: e.calendar.title,
            notes: e.notes
        )
    }

    printJSON(result)
}

func modifyEvent(params: [String: String]) {
    guard let id = params["id"] else {
        printJSON(ErrorResult(error: "--id is required"))
        return
    }
    guard params["startTime"] != nil || params["endTime"] != nil || params["notes"] != nil || params["title"] != nil else {
        printJSON(ErrorResult(error: "--startTime, --endTime, --notes, or --title is required"))
        return
    }
    guard let event = store.event(withIdentifier: id) else {
        printJSON(ErrorResult(error: "Event not found: \(id)"))
        return
    }

    func parseTime(_ s: String, base: Date) -> Date? {
        let p = s.split(separator: ":")
        guard p.count == 2, let h = Int(p[0]), let m = Int(p[1]),
              (0..<24).contains(h), (0..<60).contains(m) else { return nil }
        var c = Calendar.current.dateComponents([.year, .month, .day], from: base)
        c.hour = h; c.minute = m; c.second = 0
        return Calendar.current.date(from: c)
    }

    let hasTimeChange = params["startTime"] != nil || params["endTime"] != nil
    let notesValue    = params["notes"]

    if let t = params["title"], !t.isEmpty { event.title = t }

    if let s = params["startTime"] {
        guard let d = parseTime(s, base: event.startDate) else {
            printJSON(ErrorResult(error: "Invalid startTime format. Use HH:mm")); return
        }
        event.startDate = d
    }
    if let s = params["endTime"] {
        guard let d = parseTime(s, base: event.startDate) else {
            printJSON(ErrorResult(error: "Invalid endTime format. Use HH:mm")); return
        }
        event.endDate = d
    }

    // 시간과 메모를 동시에 저장 시 EventKit이 메모를 무시하는 경우가 있으므로
    // 시간 변경이 있을 때는 먼저 시간만 저장 → 이벤트 재조회 → 메모 별도 저장
    if hasTimeChange {
        if let n = notesValue { event.notes = n.isEmpty ? nil : n }
        do {
            try store.save(event, span: .thisEvent, commit: true)
        } catch {
            printJSON(ErrorResult(error: error.localizedDescription)); return
        }

        // 메모도 변경이 있다면: 재조회 후 메모만 따로 저장 (detach 후 새 ID 대응)
        if let n = notesValue {
            let currentId = event.eventIdentifier ?? id
            if let refreshed = store.event(withIdentifier: currentId) {
                refreshed.notes = n.isEmpty ? nil : n
                do {
                    try store.save(refreshed, span: .thisEvent, commit: true)
                } catch {
                    printJSON(ErrorResult(error: error.localizedDescription)); return
                }
                let startStr = String(dateFormatter.string(from: refreshed.startDate).suffix(5))
                let endStr   = String(dateFormatter.string(from: refreshed.endDate).suffix(5))
                printJSON(ModifyResult(success: true, eventId: refreshed.eventIdentifier ?? currentId, startTime: startStr, endTime: endStr))
                return
            }
        }

        let startStr = String(dateFormatter.string(from: event.startDate).suffix(5))
        let endStr   = String(dateFormatter.string(from: event.endDate).suffix(5))
        printJSON(ModifyResult(success: true, eventId: event.eventIdentifier ?? id, startTime: startStr, endTime: endStr))
    } else {
        // 메모만 변경
        if let n = notesValue { event.notes = n.isEmpty ? nil : n }
        do {
            try store.save(event, span: .thisEvent, commit: true)
            let startStr = String(dateFormatter.string(from: event.startDate).suffix(5))
            let endStr   = String(dateFormatter.string(from: event.endDate).suffix(5))
            printJSON(ModifyResult(success: true, eventId: event.eventIdentifier ?? id, startTime: startStr, endTime: endStr))
        } catch {
            printJSON(ErrorResult(error: error.localizedDescription))
        }
    }
}

func deleteEvent(params: [String: String]) {
    guard let id = params["id"] else {
        printJSON(ErrorResult(error: "--id is required")); return
    }
    guard let event = store.event(withIdentifier: id) else {
        printJSON(ErrorResult(error: "Event not found: \(id)")); return
    }
    do {
        try store.remove(event, span: .thisEvent, commit: true)
        printJSON(DeleteResult(success: true, eventId: id))
    } catch {
        printJSON(ErrorResult(error: error.localizedDescription))
    }
}

guard cliArgs.count >= 2 else {
    printJSON(ErrorResult(error: "Usage: CalendarCLI <list|modify|delete> [options]"))
    exit(1)
}

func requestCalendarAccess(_ completion: @escaping (Bool, Error?) -> Void) {
    if #available(macOS 14.0, *) {
        store.requestFullAccessToEvents(completion: completion)
    } else {
        store.requestAccess(to: .event, completion: completion)
    }
}

requestCalendarAccess { granted, error in
    defer { semaphore.signal() }

    guard granted else {
        printJSON(ErrorResult(error: "Calendar access denied. Grant access in System Settings > Privacy & Security > Calendars."))
        return
    }

    let params = parseArgs()
    switch cliArgs[1] {
    case "list":
        listEvents(params: params)
    case "modify":
        modifyEvent(params: params)
    case "delete":
        deleteEvent(params: params)
    default:
        printJSON(ErrorResult(error: "Unknown command: \(cliArgs[1])"))
    }
}

semaphore.wait()
