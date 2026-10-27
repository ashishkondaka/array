// Apple on-device model as an OpenAI-compatible endpoint (OpenBot Bubbles fork, Array).
//
// macOS 26 exposes Apple Intelligence's on-device language model through the FoundationModels
// framework, to Swift only. This small server puts it behind the two HTTP routes OpenCode's
// OpenAI-compatible adapter needs, on the loopback interface, so Array can register it as a custom
// endpoint like a local Ollama. Nothing leaves the Mac: the model runs in the system, and the server
// listens on 127.0.0.1 only.
//
//   GET  /v1/models            → one model, "apple-foundation"
//   POST /v1/chat/completions  → a reply, streamed as SSE when `stream` is true
//   GET  /health               → availability of the model
//
// Usage: apple-model-server [--port N]   (0 or absent: any free port). The first stdout line is
// {"port":N,"available":true|false,"reason":"..."}; the parent reads it and saves the endpoint.
// Tools in the request are ignored: the model answers in text. The context window is about 4 096
// tokens; a request over it answers 400 with the model's own error.

import Foundation
import FoundationModels
import Network

let modelId = "apple-foundation"

// MARK: - Arguments

var requestedPort: UInt16 = 0
var arguments = CommandLine.arguments.dropFirst().makeIterator()
while let argument = arguments.next() {
  if argument == "--port", let value = arguments.next(), let port = UInt16(value) { requestedPort = port }
}

// MARK: - Model

enum ModelState {
  static var availability: String {
    switch SystemLanguageModel.default.availability {
    case .available: return "available"
    case .unavailable(let reason): return "unavailable: \(reason)"
    }
  }
  static var isAvailable: Bool {
    if case .available = SystemLanguageModel.default.availability { return true }
    return false
  }
}

/// One request at a time: the on-device model serves one session well, and two at once only wait on each other.
actor ModelGate {
  private var busy = false
  private var waiters: [CheckedContinuation<Void, Never>] = []
  func enter() async {
    if !busy { busy = true; return }
    await withCheckedContinuation { waiters.append($0) }
  }
  func leave() {
    if waiters.isEmpty { busy = false } else { waiters.removeFirst().resume() }
  }
}
let gate = ModelGate()

struct ChatMessage: Decodable {
  let role: String
  let content: ContentValue?
}

/// OpenAI content is a string or an array of parts; only the text parts are read.
enum ContentValue: Decodable {
  case text(String)
  case parts([Part])
  struct Part: Decodable {
    let type: String
    let text: String?
  }
  init(from decoder: Decoder) throws {
    let container = try decoder.singleValueContainer()
    if let text = try? container.decode(String.self) { self = .text(text); return }
    self = .parts(try container.decode([Part].self))
  }
  var text: String {
    switch self {
    case .text(let text): return text
    case .parts(let parts): return parts.compactMap { $0.type == "text" ? $0.text : nil }.joined(separator: "\n")
    }
  }
}

struct ChatRequest: Decodable {
  let messages: [ChatMessage]
  let stream: Bool?
  let temperature: Double?
  let max_tokens: Int?
  let max_completion_tokens: Int?
}

/// The model's window is small (4 096 tokens on most Macs, 8 192 on some), and the client's
/// instructions alone can be several times that: OpenBot's developer instructions run to tens of
/// thousands of characters. So each part gets a budget, in characters (about four per token): the
/// instructions keep their head, where the agent's identity and rules are; the conversation keeps
/// its tail, where the question is. The cut is said, so the model does not read a sentence as whole.
let instructionBudget = 9_000
let conversationBudget = 7_000
let omitted = "\n[… earlier text omitted to fit this Mac's on-device model …]\n"

func head(_ text: String, _ budget: Int) -> String {
  text.count <= budget ? text : String(text.prefix(budget)) + omitted
}

func tail(_ text: String, _ budget: Int) -> String {
  text.count <= budget ? text : omitted + String(text.suffix(budget))
}

/// System messages become the session's instructions; the rest becomes one prompt that carries the
/// conversation, since each request is complete in itself (the adapter sends the whole history).
func sessionAndPrompt(for request: ChatRequest) -> (LanguageModelSession, String) {
  let instructions = head(request.messages.filter { $0.role == "system" || $0.role == "developer" }
    .compactMap { $0.content?.text }.joined(separator: "\n\n"), instructionBudget)
  let turns = request.messages.filter { $0.role != "system" && $0.role != "developer" }
  var prompt = ""
  if turns.count > 1 {
    for turn in turns.dropLast() {
      let who = turn.role == "assistant" ? "Assistant" : "User"
      prompt += "\(who): \(turn.content?.text ?? "")\n\n"
    }
    prompt += "User: \(turns.last?.content?.text ?? "")\n\nAssistant:"
  } else {
    prompt = turns.last?.content?.text ?? ""
  }
  prompt = tail(prompt, conversationBudget)
  let session = instructions.isEmpty ? LanguageModelSession() : LanguageModelSession(instructions: instructions)
  return (session, prompt)
}

func generationOptions(for request: ChatRequest) -> GenerationOptions {
  var options = GenerationOptions()
  if let temperature = request.temperature { options.temperature = temperature }
  if let max = request.max_completion_tokens ?? request.max_tokens { options.maximumResponseTokens = max }
  return options
}

// MARK: - HTTP

struct HTTPRequest {
  let method: String
  let path: String
  let body: Data
}

func parseRequest(_ data: Data) -> (HTTPRequest, Int)? {
  guard let headerEnd = data.range(of: Data("\r\n\r\n".utf8)) else { return nil }
  guard let head = String(data: data[data.startIndex..<headerEnd.lowerBound], encoding: .utf8) else { return nil }
  let lines = head.components(separatedBy: "\r\n")
  guard let requestLine = lines.first else { return nil }
  let parts = requestLine.split(separator: " ")
  guard parts.count >= 2 else { return nil }
  var contentLength = 0
  for line in lines.dropFirst() {
    let pair = line.split(separator: ":", maxSplits: 1)
    if pair.count == 2, pair[0].trimmingCharacters(in: .whitespaces).lowercased() == "content-length" {
      contentLength = Int(pair[1].trimmingCharacters(in: .whitespaces)) ?? 0
    }
  }
  let bodyStart = headerEnd.upperBound
  let total = (bodyStart - data.startIndex) + contentLength
  guard data.count >= total else { return nil }
  let body = data[bodyStart..<(bodyStart + contentLength)]
  return (HTTPRequest(method: String(parts[0]), path: String(parts[1]), body: Data(body)), total)
}

func json(_ value: Any) -> Data {
  (try? JSONSerialization.data(withJSONObject: value)) ?? Data("{}".utf8)
}

func response(status: Int, reason: String, contentType: String, body: Data, extraHeaders: [String] = []) -> Data {
  var head = "HTTP/1.1 \(status) \(reason)\r\nContent-Type: \(contentType)\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n"
  for header in extraHeaders { head += header + "\r\n" }
  head += "Content-Length: \(body.count)\r\n\r\n"
  return Data(head.utf8) + body
}

func send(_ connection: NWConnection, _ data: Data, close: Bool) {
  connection.send(content: data, completion: .contentProcessed { _ in
    if close { connection.cancel() }
  })
}

func completionId() -> String { "chatcmpl-" + UUID().uuidString.replacingOccurrences(of: "-", with: "").prefix(24) }
func now() -> Int { Int(Date().timeIntervalSince1970) }

func handleChat(_ connection: NWConnection, _ request: HTTPRequest) {
  guard let chat = try? JSONDecoder().decode(ChatRequest.self, from: request.body) else {
    send(connection, response(status: 400, reason: "Bad Request", contentType: "application/json",
      body: json(["error": ["message": "The body is not an OpenAI chat completion request.", "type": "invalid_request_error"]])), close: true)
    return
  }
  guard ModelState.isAvailable else {
    send(connection, response(status: 503, reason: "Service Unavailable", contentType: "application/json",
      body: json(["error": ["message": "The Apple on-device model is not available: \(ModelState.availability)", "type": "server_error"]])), close: true)
    return
  }
  let id = completionId()
  let created = now()
  let (session, prompt) = sessionAndPrompt(for: chat)
  let options = generationOptions(for: chat)
  let streaming = chat.stream ?? false
  Task {
    await gate.enter()
    defer { Task { await gate.leave() } }
    do {
      if streaming {
        let head = "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
        send(connection, Data(head.utf8), close: false)
        func chunk(_ delta: [String: Any], finish: String? = nil) -> Data {
          let payload: [String: Any] = [
            "id": id, "object": "chat.completion.chunk", "created": created, "model": modelId,
            "choices": [["index": 0, "delta": delta, "finish_reason": finish as Any]],
          ]
          return Data("data: ".utf8) + json(payload) + Data("\n\n".utf8)
        }
        send(connection, chunk(["role": "assistant", "content": ""]), close: false)
        var sent = ""
        let stream = session.streamResponse(to: prompt, options: options)
        for try await snapshot in stream {
          let text = snapshot.content
          guard text.hasPrefix(sent) else { continue }
          let delta = String(text.dropFirst(sent.count))
          if delta.isEmpty { continue }
          sent = text
          send(connection, chunk(["content": delta]), close: false)
        }
        send(connection, chunk([:], finish: "stop") + Data("data: [DONE]\n\n".utf8), close: true)
      } else {
        let reply = try await session.respond(to: prompt, options: options)
        let payload: [String: Any] = [
          "id": id, "object": "chat.completion", "created": created, "model": modelId,
          "choices": [["index": 0, "message": ["role": "assistant", "content": reply.content], "finish_reason": "stop"]],
          "usage": ["prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0],
        ]
        send(connection, response(status: 200, reason: "OK", contentType: "application/json", body: json(payload)), close: true)
      }
    } catch {
      let message = "The Apple on-device model could not answer: \(error)"
      if streaming {
        send(connection, Data("data: ".utf8) + json(["error": ["message": message]]) + Data("\n\ndata: [DONE]\n\n".utf8), close: true)
      } else {
        send(connection, response(status: 400, reason: "Bad Request", contentType: "application/json",
          body: json(["error": ["message": message, "type": "invalid_request_error"]])), close: true)
      }
    }
  }
}

func handle(_ connection: NWConnection, _ request: HTTPRequest) {
  let path = request.path.split(separator: "?").first.map(String.init) ?? request.path
  switch (request.method, path) {
  case ("OPTIONS", _):
    send(connection, response(status: 204, reason: "No Content", contentType: "text/plain", body: Data(),
      extraHeaders: ["Access-Control-Allow-Methods: GET, POST, OPTIONS", "Access-Control-Allow-Headers: *"]), close: true)
  case ("GET", "/health"):
    send(connection, response(status: 200, reason: "OK", contentType: "application/json",
      body: json(["available": ModelState.isAvailable, "status": ModelState.availability])), close: true)
  case ("GET", "/v1/models"), ("GET", "/models"):
    let body = json(["object": "list", "data": [["id": modelId, "object": "model", "created": now(), "owned_by": "apple"]]])
    send(connection, response(status: 200, reason: "OK", contentType: "application/json", body: body), close: true)
  case ("POST", "/v1/chat/completions"), ("POST", "/chat/completions"):
    handleChat(connection, request)
  default:
    send(connection, response(status: 404, reason: "Not Found", contentType: "application/json",
      body: json(["error": ["message": "No such route: \(request.method) \(path)", "type": "invalid_request_error"]])), close: true)
  }
}

func serve(_ connection: NWConnection) {
  var buffer = Data()
  func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { data, _, complete, error in
      if let data { buffer.append(data) }
      if let (request, _) = parseRequest(buffer) {
        handle(connection, request)
        return
      }
      if error != nil || complete || buffer.count > (8 << 20) { connection.cancel(); return }
      receive()
    }
  }
  connection.start(queue: .global())
  receive()
}

// MARK: - Listener

let parameters = NWParameters.tcp
parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: requestedPort) ?? .any)
guard let listener = try? NWListener(using: parameters) else {
  FileHandle.standardError.write(Data("Could not listen on 127.0.0.1\n".utf8))
  exit(1)
}
listener.newConnectionHandler = { serve($0) }
listener.stateUpdateHandler = { state in
  switch state {
  case .ready:
    let port = listener.port?.rawValue ?? 0
    let line = json(["port": Int(port), "available": ModelState.isAvailable, "reason": ModelState.availability])
    FileHandle.standardOutput.write(line + Data("\n".utf8))
  case .failed(let error):
    FileHandle.standardError.write(Data("The listener failed: \(error)\n".utf8))
    exit(1)
  default:
    break
  }
}
listener.start(queue: .main)

// The parent owns the lifetime: when its pipe closes, the server exits with it.
DispatchQueue.global().async {
  while let _ = readLine() {}
  exit(0)
}
dispatchMain()
