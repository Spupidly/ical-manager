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
    let endTime: String
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
    guard let id = params["id"], let endTimeStr = params["endTime"] else {
        printJSON(ErrorResult(error: "--id and --endTime are required"))
        return
    }

    guard let event = store.event(withIdentifier: id) else {
        printJSON(ErrorResult(error: "Event not found: \(id)"))
        return
    }

    let parts = endTimeStr.split(separator: ":")
    guard parts.count == 2,
          let hour = Int(parts[0]),
          let minute = Int(parts[1]),
          hour >= 0, hour < 24,
          minute >= 0, minute < 60 else {
        printJSON(ErrorResult(error: "Invalid endTime format. Use HH:mm"))
        return
    }

    var comps = Calendar.current.dateComponents([.year, .month, .day], from: event.startDate)
    comps.hour = hour; comps.minute = minute; comps.second = 0

    guard let newEnd = Calendar.current.date(from: comps) else {
        printJSON(ErrorResult(error: "Failed to compute new end date"))
        return
    }

    event.endDate = newEnd

    do {
        try store.save(event, span: .thisEvent, commit: true)
        printJSON(ModifyResult(success: true, eventId: id, endTime: endTimeStr))
    } catch {
        printJSON(ErrorResult(error: error.localizedDescription))
    }
}

guard cliArgs.count >= 2 else {
    printJSON(ErrorResult(error: "Usage: CalendarCLI <list|modify> [options]"))
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
    default:
        printJSON(ErrorResult(error: "Unknown command: \(cliArgs[1])"))
    }
}

semaphore.wait()
