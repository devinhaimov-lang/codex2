//! Kiro 本地 OpenAI 兼容 API。
//!
//! 这是一个轻量网关：每次请求调用本机已登录的 `kiro-cli-chat chat --no-interactive`，
//! 再把结果转换成 OpenAI chat completions 响应。

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::env;
use std::path::Path;
use std::sync::{OnceLock, RwLock};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::logger;

const DEFAULT_KIRO_LOCAL_API_PORT: u16 = 3520;
const PORT_RANGE: u16 = 30;
const MAX_HTTP_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(10);
const KIRO_REQUEST_TIMEOUT: Duration = Duration::from_secs(240);
const MODEL_ID: &str = "kiro-local";
const DEFAULT_KIRO_CLI_MODEL_ID: &str = "claude-opus-4.8";
const KIRO_CLI_MODEL_IDS: &[&str] = &[
    "claude-opus-4.8",
    "auto",
    "claude-opus-4.7",
    "claude-opus-4.6",
    "claude-sonnet-4.6",
    "claude-opus-4.5",
    "claude-sonnet-4.5",
    "claude-sonnet-4",
    "claude-haiku-4.5",
    "deepseek-3.2",
    "minimax-m2.5",
    "minimax-m2.1",
    "glm-5",
    "qwen3-coder-next",
];

static ACTUAL_PORT: OnceLock<RwLock<Option<u16>>> = OnceLock::new();

#[derive(Debug, Clone, Serialize)]
pub struct KiroLocalApiState {
    pub enabled: bool,
    pub port: Option<u16>,
    pub base_url: Option<String>,
    pub model: String,
}

#[derive(Debug, Deserialize)]
struct ChatCompletionRequest {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    messages: Vec<ChatMessage>,
    #[serde(default)]
    stream: bool,
}

#[derive(Debug, Deserialize)]
struct ChatMessage {
    role: String,
    content: Value,
}

#[derive(Debug, Deserialize)]
struct ResponsesRequest {
    #[serde(default)]
    model: Option<String>,
    #[serde(default)]
    input: Value,
    #[serde(default)]
    instructions: Option<String>,
    #[serde(default)]
    stream: bool,
}

fn port_state() -> &'static RwLock<Option<u16>> {
    ACTUAL_PORT.get_or_init(|| RwLock::new(None))
}

fn set_actual_port(port: Option<u16>) {
    if let Ok(mut guard) = port_state().write() {
        *guard = port;
    }
}

pub fn get_state() -> KiroLocalApiState {
    let port = port_state().read().ok().and_then(|guard| *guard);
    KiroLocalApiState {
        enabled: port.is_some(),
        port,
        base_url: port.map(|value| format!("http://127.0.0.1:{}/v1", value)),
        model: DEFAULT_KIRO_CLI_MODEL_ID.to_string(),
    }
}

pub fn supported_model_ids() -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut model_ids = Vec::new();
    for model in [DEFAULT_KIRO_CLI_MODEL_ID, MODEL_ID]
        .into_iter()
        .chain(KIRO_CLI_MODEL_IDS.iter().copied())
    {
        if seen.insert(model) {
            model_ids.push(model.to_string());
        }
    }
    model_ids
}

pub fn is_supported_model_id(model_id: &str) -> bool {
    let normalized = model_id.trim().to_ascii_lowercase();
    normalized == MODEL_ID || KIRO_CLI_MODEL_IDS.iter().any(|model| normalized == *model)
}

fn resolve_kiro_cli_model(model_id: Option<&str>) -> Option<String> {
    let normalized = model_id
        .map(str::trim)
        .unwrap_or_default()
        .to_ascii_lowercase();
    if normalized.is_empty() || normalized == MODEL_ID {
        return Some(DEFAULT_KIRO_CLI_MODEL_ID.to_string());
    }
    Some(normalized)
}

pub async fn start_server() {
    let mut listener = None;
    let mut port = DEFAULT_KIRO_LOCAL_API_PORT;

    for attempt in 0..PORT_RANGE {
        match TcpListener::bind(("127.0.0.1", port)).await {
            Ok(bound) => {
                listener = Some(bound);
                if attempt > 0 {
                    logger::log_info(&format!(
                        "[KiroLocalAPI] 默认端口 {} 被占用，已切换至 {}",
                        DEFAULT_KIRO_LOCAL_API_PORT, port
                    ));
                }
                break;
            }
            Err(err) => {
                if attempt + 1 >= PORT_RANGE {
                    logger::log_warn(&format!(
                        "[KiroLocalAPI] 无法绑定端口 {}-{}: {}",
                        DEFAULT_KIRO_LOCAL_API_PORT,
                        DEFAULT_KIRO_LOCAL_API_PORT + PORT_RANGE - 1,
                        err
                    ));
                    set_actual_port(None);
                    return;
                }
                port += 1;
            }
        }
    }

    let Some(listener) = listener else {
        set_actual_port(None);
        return;
    };

    set_actual_port(Some(port));
    logger::log_info(&format!(
        "[KiroLocalAPI] 本地 API 已启动: http://127.0.0.1:{}/v1",
        port
    ));

    while let Ok((stream, addr)) = listener.accept().await {
        tokio::spawn(async move {
            if let Err(err) = handle_connection(stream, port).await {
                logger::log_warn(&format!("[KiroLocalAPI] 请求处理失败 {}: {}", addr, err));
            }
        });
    }
}

pub async fn test_api() -> Result<String, String> {
    run_kiro_prompt("请只回复一句：Kiro local API OK", None).await
}

async fn handle_connection(mut stream: TcpStream, port: u16) -> Result<(), String> {
    let raw_request = read_http_request(&mut stream).await?;
    let (method, target, body) = parse_http_request(&raw_request)?;
    let path = parse_path(&target, port)?;

    if method.eq_ignore_ascii_case("OPTIONS") {
        write_text_response(
            &mut stream,
            "204 No Content",
            "text/plain; charset=utf-8",
            "",
        )
        .await?;
        return Ok(());
    }

    match (method.as_str(), path.as_str()) {
        ("GET", "/v1/models") | ("GET", "/models") => {
            let created = chrono::Utc::now().timestamp();
            let models: Vec<Value> = supported_model_ids()
                .into_iter()
                .map(|model_id| {
                    json!({
                        "id": model_id,
                        "slug": model_id,
                        "object": "model",
                        "created": created,
                        "owned_by": "kiro"
                    })
                })
                .collect();
            let body = json!({
                "models": models,
                "object": "list",
                "data": models
            });
            write_json_response(&mut stream, "200 OK", &body).await?;
        }
        ("GET", "/health") | ("GET", "/v1/health") => {
            write_json_response(
                &mut stream,
                "200 OK",
                &json!({"ok": true, "model": MODEL_ID}),
            )
            .await?;
        }
        ("POST", "/v1/chat/completions") | ("POST", "/chat/completions") => {
            let request: ChatCompletionRequest = serde_json::from_str(&body)
                .map_err(|err| format!("解析 chat/completions 请求失败: {}", err))?;
            let prompt = build_prompt(&request)?;
            let model = resolve_kiro_cli_model(request.model.as_deref());
            let answer = run_kiro_prompt(&prompt, model.as_deref()).await?;
            if request.stream {
                write_sse_chat_response(&mut stream, &request, &answer).await?;
            } else {
                write_json_response(
                    &mut stream,
                    "200 OK",
                    &build_chat_response(&request, &answer),
                )
                .await?;
            }
        }
        ("POST", "/v1/responses") | ("POST", "/responses") => {
            let request: ResponsesRequest = serde_json::from_str(&body)
                .map_err(|err| format!("解析 responses 请求失败: {}", err))?;
            let prompt = build_responses_prompt(&request)?;
            let model = resolve_kiro_cli_model(request.model.as_deref());
            let answer = run_kiro_prompt(&prompt, model.as_deref()).await?;
            if request.stream {
                write_sse_responses_response(&mut stream, &request, &answer).await?;
            } else {
                write_json_response(
                    &mut stream,
                    "200 OK",
                    &build_responses_response(&request, &answer),
                )
                .await?;
            }
        }
        _ => {
            write_json_response(
                &mut stream,
                "404 Not Found",
                &json!({"error": {"message": "Not Found", "type": "not_found"}}),
            )
            .await?;
        }
    }

    Ok(())
}

async fn read_http_request(stream: &mut TcpStream) -> Result<Vec<u8>, String> {
    let mut buffer = Vec::with_capacity(8192);
    let mut chunk = [0u8; 8192];

    loop {
        let bytes_read = timeout(REQUEST_READ_TIMEOUT, stream.read(&mut chunk))
            .await
            .map_err(|_| "读取请求超时".to_string())?
            .map_err(|err| format!("读取请求失败: {}", err))?;
        if bytes_read == 0 {
            break;
        }
        buffer.extend_from_slice(&chunk[..bytes_read]);
        if buffer.len() > MAX_HTTP_REQUEST_BYTES {
            return Err("请求过大".to_string());
        }
        if let Some((header_end, content_length)) = header_end_and_content_length(&buffer) {
            let needed = header_end + content_length;
            if buffer.len() >= needed {
                break;
            }
        }
    }

    if buffer.is_empty() {
        return Err("请求为空".to_string());
    }
    Ok(buffer)
}

fn header_end_and_content_length(buffer: &[u8]) -> Option<(usize, usize)> {
    let header_end = buffer
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map(|index| index + 4)?;
    let header = String::from_utf8_lossy(&buffer[..header_end]);
    let content_length = header
        .lines()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            if name.trim().eq_ignore_ascii_case("content-length") {
                value.trim().parse::<usize>().ok()
            } else {
                None
            }
        })
        .unwrap_or(0);
    Some((header_end, content_length))
}

fn parse_http_request(raw: &[u8]) -> Result<(String, String, String), String> {
    let (header_end, content_length) =
        header_end_and_content_length(raw).ok_or_else(|| "缺少请求头结束标记".to_string())?;
    let header = String::from_utf8_lossy(&raw[..header_end]);
    let request_line = header
        .lines()
        .next()
        .ok_or_else(|| "请求行为空".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "缺少 method".to_string())?
        .to_string();
    let target = parts
        .next()
        .ok_or_else(|| "缺少 path".to_string())?
        .to_string();
    let body_end = (header_end + content_length).min(raw.len());
    let body = String::from_utf8_lossy(&raw[header_end..body_end]).into_owned();
    Ok((method, target, body))
}

fn parse_path(target: &str, port: u16) -> Result<String, String> {
    if target.starts_with("http://") || target.starts_with("https://") {
        let url = url::Url::parse(target).map_err(|err| format!("解析 URL 失败: {}", err))?;
        return Ok(url.path().to_string());
    }
    let base = format!("http://127.0.0.1:{}", port);
    let url = url::Url::parse(&format!("{}{}", base, target))
        .map_err(|err| format!("解析 path 失败: {}", err))?;
    Ok(url.path().to_string())
}

fn build_prompt(request: &ChatCompletionRequest) -> Result<String, String> {
    let parts: Vec<String> = request
        .messages
        .iter()
        .filter_map(|message| {
            let content = extract_content_text(&message.content);
            if content.trim().is_empty() {
                None
            } else {
                Some(format!("{}: {}", message.role, content.trim()))
            }
        })
        .collect();
    if parts.is_empty() {
        return Err("messages 不能为空".to_string());
    }
    Ok(parts.join("\n"))
}

fn build_responses_prompt(request: &ResponsesRequest) -> Result<String, String> {
    let mut parts = Vec::new();
    if let Some(instructions) = request
        .instructions
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("system: {}", instructions));
    }

    match &request.input {
        Value::String(text) => {
            if !text.trim().is_empty() {
                parts.push(format!("user: {}", text.trim()));
            }
        }
        Value::Array(items) => {
            for item in items {
                let role = item
                    .get("role")
                    .and_then(Value::as_str)
                    .unwrap_or("user")
                    .to_string();
                let content = item
                    .get("content")
                    .map(extract_content_text)
                    .unwrap_or_default();
                if !content.trim().is_empty() {
                    parts.push(format!("{}: {}", role, content.trim()));
                }
            }
        }
        _ => {}
    }

    if parts.is_empty() {
        return Err("input 不能为空".to_string());
    }
    Ok(parts.join("\n"))
}

fn extract_content_text(content: &Value) -> String {
    if let Some(text) = content.as_str() {
        return text.to_string();
    }
    if let Some(items) = content.as_array() {
        return items
            .iter()
            .filter_map(|item| match item.get("type").and_then(Value::as_str) {
                Some("text") | Some("input_text") | Some("output_text") => {
                    item.get("text").and_then(Value::as_str).map(str::to_string)
                }
                Some("input_image") => Some(
                    "[用户上传了一张图片，当前 Kiro Codex CLI 网关暂不支持图片内容]".to_string(),
                ),
                Some("input_file") => Some(
                    "[用户上传了一个文件，当前 Kiro Codex CLI 网关暂不支持二进制文件内容]"
                        .to_string(),
                ),
                _ => None,
            })
            .collect::<Vec<_>>()
            .join("\n");
    }
    String::new()
}

async fn run_kiro_prompt(prompt: &str, model: Option<&str>) -> Result<String, String> {
    let binary = find_kiro_cli().ok_or_else(|| {
        "未找到 kiro-cli-chat，请确认 /home/kang/.local/bin/kiro-cli-chat 可用".to_string()
    })?;

    let mut command = Command::new(&binary);
    command
        .arg("chat")
        .arg("--no-interactive")
        .arg("--wrap")
        .arg("never");
    if let Some(model) = model {
        command.arg("--model").arg(model);
    }
    command
        .arg(prompt)
        .current_dir(env::var("HOME").unwrap_or_else(|_| "/home/kang".to_string()))
        .env("KIRO_AGENT_PATH", &binary)
        .kill_on_drop(true);

    let output = timeout(KIRO_REQUEST_TIMEOUT, command.output())
        .await
        .map_err(|_| "Kiro 响应超时".to_string())?
        .map_err(|err| format!("启动 Kiro CLI 失败: {}", err))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() {
        let err = clean_kiro_output(&format!("{}\n{}", stdout, stderr));
        return Err(if err.trim().is_empty() {
            format!("Kiro CLI 退出失败: {}", output.status)
        } else {
            err
        });
    }

    let answer = clean_kiro_output(&stdout);
    if answer.trim().is_empty() {
        let err = clean_kiro_output(&stderr);
        if err.trim().is_empty() {
            Err("Kiro CLI 未返回内容".to_string())
        } else {
            Err(err)
        }
    } else {
        Ok(answer)
    }
}

fn find_kiro_cli() -> Option<String> {
    let candidates = [
        env::var("KIRO_AGENT_PATH").ok(),
        Some("/home/kang/.local/bin/kiro-cli-chat".to_string()),
        env::var("HOME")
            .ok()
            .map(|home| format!("{}/.local/bin/kiro-cli-chat", home)),
    ];
    candidates
        .into_iter()
        .flatten()
        .find(|path| Path::new(path).is_file())
}

fn clean_kiro_output(raw: &str) -> String {
    let without_ansi = strip_ansi(raw);
    let lines: Vec<String> = without_ansi
        .lines()
        .map(|line| line.trim_matches(|ch: char| ch.is_control()).trim())
        .filter(|line| {
            !line.is_empty()
                && !line.starts_with('▸')
                && !line.starts_with("Credits:")
                && !line.contains("All tools are now trusted")
                && !line.contains("Learn more at https://kiro.dev/")
                && !line.contains("Agents can sometimes do unexpected things")
        })
        .map(|line| line.trim_start_matches("> ").trim().to_string())
        .filter(|line| !line.is_empty())
        .collect();
    lines.join("\n").trim().to_string()
}

fn strip_ansi(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                let _ = chars.next();
                for next in chars.by_ref() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            continue;
        }
        output.push(ch);
    }
    output
}

fn build_chat_response(request: &ChatCompletionRequest, answer: &str) -> Value {
    let model = request.model.as_deref().unwrap_or(MODEL_ID);
    json!({
        "id": format!("chatcmpl-{}", uuid::Uuid::new_v4()),
        "object": "chat.completion",
        "created": chrono::Utc::now().timestamp(),
        "model": model,
        "choices": [{
            "index": 0,
            "message": {
                "role": "assistant",
                "content": answer
            },
            "finish_reason": "stop"
        }],
        "usage": {
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0
        }
    })
}

fn build_response_object(request: &ResponsesRequest, answer: &str, status: &str) -> Value {
    json!({
        "id": format!("resp_{}", uuid::Uuid::new_v4()),
        "object": "response",
        "created_at": chrono::Utc::now().timestamp(),
        "status": status,
        "model": request.model.as_deref().unwrap_or(MODEL_ID),
        "output": [{
            "id": format!("msg_{}", uuid::Uuid::new_v4()),
            "type": "message",
            "status": status,
            "role": "assistant",
            "content": [{
                "type": "output_text",
                "text": answer,
                "annotations": []
            }]
        }],
        "usage": {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0
        }
    })
}

fn build_responses_response(request: &ResponsesRequest, answer: &str) -> Value {
    build_response_object(request, answer, "completed")
}

async fn write_sse_chat_response(
    stream: &mut TcpStream,
    request: &ChatCompletionRequest,
    answer: &str,
) -> Result<(), String> {
    let id = format!("chatcmpl-{}", uuid::Uuid::new_v4());
    let created = chrono::Utc::now().timestamp();
    let model = request.model.as_deref().unwrap_or(MODEL_ID);
    let chunk = json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": { "role": "assistant", "content": answer },
            "finish_reason": null
        }]
    });
    let final_chunk = json!({
        "id": id,
        "object": "chat.completion.chunk",
        "created": created,
        "model": model,
        "choices": [{
            "index": 0,
            "delta": {},
            "finish_reason": "stop"
        }]
    });
    let body = format!(
        "data: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
        chunk, final_chunk
    );
    write_raw_response(
        stream,
        "200 OK",
        "text/event-stream; charset=utf-8",
        body.as_bytes(),
    )
    .await
}

async fn write_sse_responses_response(
    stream: &mut TcpStream,
    request: &ResponsesRequest,
    answer: &str,
) -> Result<(), String> {
    let response_id = format!("resp_{}", uuid::Uuid::new_v4());
    let message_id = format!("msg_{}", uuid::Uuid::new_v4());
    let created = chrono::Utc::now().timestamp();
    let model = request.model.as_deref().unwrap_or(MODEL_ID);
    let completed_response = json!({
        "id": response_id,
        "object": "response",
        "created_at": created,
        "status": "completed",
        "model": model,
        "output": [{
            "id": message_id,
            "type": "message",
            "status": "completed",
            "role": "assistant",
            "content": [{
                "type": "output_text",
                "text": answer,
                "annotations": []
            }]
        }],
        "usage": {
            "input_tokens": 0,
            "output_tokens": 0,
            "total_tokens": 0
        }
    });
    let events = [
        json!({
            "type": "response.created",
            "response": {
                "id": response_id,
                "object": "response",
                "created_at": created,
                "status": "in_progress",
                "model": model,
                "output": []
            }
        }),
        json!({
            "type": "response.output_item.added",
            "output_index": 0,
            "item": {
                "id": message_id,
                "type": "message",
                "status": "in_progress",
                "role": "assistant",
                "content": []
            }
        }),
        json!({
            "type": "response.content_part.added",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "part": {
                "type": "output_text",
                "text": "",
                "annotations": []
            }
        }),
        json!({
            "type": "response.output_text.delta",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "delta": answer
        }),
        json!({
            "type": "response.output_text.done",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "text": answer
        }),
        json!({
            "type": "response.content_part.done",
            "item_id": message_id,
            "output_index": 0,
            "content_index": 0,
            "part": {
                "type": "output_text",
                "text": answer,
                "annotations": []
            }
        }),
        json!({
            "type": "response.output_item.done",
            "output_index": 0,
            "item": {
                "id": message_id,
                "type": "message",
                "status": "completed",
                "role": "assistant",
                "content": [{
                    "type": "output_text",
                    "text": answer,
                    "annotations": []
                }]
            }
        }),
        json!({
            "type": "response.completed",
            "response": completed_response
        }),
    ];

    let mut body = String::new();
    for event in events {
        let event_type = event
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or("response.event");
        body.push_str(&format!("event: {}\n", event_type));
        body.push_str(&format!("data: {}\n\n", event));
    }
    body.push_str("data: [DONE]\n\n");
    write_raw_response(
        stream,
        "200 OK",
        "text/event-stream; charset=utf-8",
        body.as_bytes(),
    )
    .await
}

async fn write_json_response(
    stream: &mut TcpStream,
    status: &str,
    body: &Value,
) -> Result<(), String> {
    let body = serde_json::to_vec(body).map_err(|err| format!("序列化响应失败: {}", err))?;
    write_raw_response(stream, status, "application/json; charset=utf-8", &body).await
}

async fn write_text_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &str,
) -> Result<(), String> {
    write_raw_response(stream, status, content_type, body.as_bytes()).await
}

async fn write_raw_response(
    stream: &mut TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
) -> Result<(), String> {
    let header = format!(
        "HTTP/1.1 {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Headers: authorization, content-type\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n",
        status,
        content_type,
        body.len()
    );
    stream
        .write_all(header.as_bytes())
        .await
        .map_err(|err| format!("写响应头失败: {}", err))?;
    stream
        .write_all(body)
        .await
        .map_err(|err| format!("写响应体失败: {}", err))?;
    stream
        .flush()
        .await
        .map_err(|err| format!("刷新响应失败: {}", err))
}
