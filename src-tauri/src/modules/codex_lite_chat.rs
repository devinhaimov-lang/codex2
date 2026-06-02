use crate::modules::logger;
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::net::TcpListener;
use std::sync::OnceLock;
use std::thread;
use std::time::Duration;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};

const CHAT_HOST: &str = "127.0.0.1";
const CHAT_PORT: u16 = 3510;
const CODEX_LOCAL_ACCESS_DEFAULT_BASE_URL: &str = "http://127.0.0.1:34108/v1";
const KIRO_LOCAL_BASE_URL: &str = "http://127.0.0.1:3520/v1";
const CODEX_LITE_LOCAL_API_KEY: &str = "codex-lite-local";
const DEFAULT_CODEX_MODEL: &str = "gpt-5.4-mini";
const DEFAULT_KIRO_MODEL: &str = "claude-opus-4.8";
const KIRO_FALLBACK_MODELS: &[&str] = &[
    "claude-opus-4.8",
    "kiro-local",
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
const CODEX_MODELS: &[&str] = &[
    "gpt-5.5",
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.2-codex",
    "gpt-5.2",
    "gpt-5.1-codex-max",
    "gpt-5.1-codex-mini",
    "gpt-image-2",
];

static STARTED: OnceLock<()> = OnceLock::new();

#[derive(Debug, Clone)]
struct CodexLocalAccessConfig {
    base_url: String,
    authorization: String,
    source: String,
}

pub fn ensure_started() {
    if STARTED.set(()).is_err() {
        return;
    }

    thread::spawn(|| {
        if port_is_listening(CHAT_PORT) {
            logger::log_info("[CodexLiteChat] 3510 已被占用，跳过内置聊天服务启动");
            return;
        }

        let addr = format!("{CHAT_HOST}:{CHAT_PORT}");
        let server = match Server::http(&addr) {
            Ok(server) => server,
            Err(err) => {
                logger::log_warn(&format!("[CodexLiteChat] 启动失败: {addr}, {err}"));
                return;
            }
        };

        logger::log_info(&format!(
            "[CodexLiteChat] 内置聊天服务已启动: http://{addr}"
        ));

        let client = match Client::builder()
            .timeout(Duration::from_secs(180))
            .no_proxy()
            .build()
        {
            Ok(client) => client,
            Err(err) => {
                logger::log_warn(&format!("[CodexLiteChat] HTTP 客户端初始化失败: {err}"));
                return;
            }
        };

        for request in server.incoming_requests() {
            if let Err(err) = handle_request(request, &client) {
                logger::log_warn(&format!("[CodexLiteChat] 请求处理失败: {err}"));
            }
        }
    });
}

fn port_is_listening(port: u16) -> bool {
    TcpListener::bind((CHAT_HOST, port)).is_err()
}

fn handle_request(request: Request, client: &Client) -> Result<(), String> {
    let url = request.url().to_string();
    let (path, query) = split_path_query(&url);
    let method = request.method().clone();

    if method == Method::Options {
        return respond(request, empty_response(204, "text/plain; charset=utf-8"));
    }

    match (method.clone(), path.as_str()) {
        (Method::Get, "/health") => handle_health(request),
        (Method::Get, "/api/config") => handle_config(request),
        (Method::Get, "/api/status") => handle_status(request),
        (Method::Get, "/api/models") => handle_models(request, client, &query),
        (Method::Post, "/api/chat") => handle_chat(request, client),
        (Method::Get, "/v1/models") => {
            respond_json(request, 200, &model_list(CODEX_MODELS, "openai"))
        }
        _ if path.starts_with("/v1/") => handle_v1_proxy(request, client, &path, &query),
        _ if method == Method::Get || method == Method::Head => serve_static(request, &path),
        _ => respond_json(request, 404, &json!({ "error": "Not found" })),
    }
}

fn split_path_query(url: &str) -> (String, String) {
    match url.split_once('?') {
        Some((path, query)) => (path.to_string(), query.to_string()),
        None => (url.to_string(), String::new()),
    }
}

fn handle_health(request: Request) -> Result<(), String> {
    let upstream = codex_local_access_config();
    respond_json(
        request,
        200,
        &json!({
            "ok": true,
            "localBaseUrl": format!("http://127.0.0.1:{CHAT_PORT}/v1"),
            "kiroBaseUrl": KIRO_LOCAL_BASE_URL,
            "upstreamBaseUrl": upstream.base_url,
            "upstreamSource": upstream.source,
            "defaultModel": DEFAULT_CODEX_MODEL,
            "timeoutMs": 180000
        }),
    )
}

fn handle_config(request: Request) -> Result<(), String> {
    let upstream = codex_local_access_config();
    respond_json(
        request,
        200,
        &json!({
            "upstreamBaseUrl": upstream.base_url,
            "upstreamSource": upstream.source,
            "localBaseUrl": format!("http://127.0.0.1:{CHAT_PORT}/v1"),
            "kiroBaseUrl": KIRO_LOCAL_BASE_URL,
            "defaultModel": DEFAULT_CODEX_MODEL,
            "kiroModel": DEFAULT_KIRO_MODEL,
            "localApiKey": CODEX_LITE_LOCAL_API_KEY
        }),
    )
}

fn handle_status(request: Request) -> Result<(), String> {
    let upstream = codex_local_access_config();
    respond_json(
        request,
        200,
        &json!({
            "ok": true,
            "upstreamBaseUrl": upstream.base_url,
            "upstreamSource": upstream.source,
            "kiroBaseUrl": KIRO_LOCAL_BASE_URL,
            "defaultModel": DEFAULT_CODEX_MODEL,
            "kiroModel": DEFAULT_KIRO_MODEL,
            "timeoutMs": 180000
        }),
    )
}

fn handle_models(request: Request, client: &Client, query: &str) -> Result<(), String> {
    if query_provider(query) == "kiro" {
        let models = load_kiro_models(client);
        return respond_json(request, 200, &model_list(&models, "kiro"));
    }
    respond_json(request, 200, &model_list(CODEX_MODELS, "openai"))
}

fn handle_chat(mut request: Request, client: &Client) -> Result<(), String> {
    let body = read_request_json(&mut request)?;
    let messages = body
        .get("messages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    if messages.is_empty() {
        return respond_json(request, 400, &json!({ "error": "messages is required" }));
    }

    let provider = body
        .get("provider")
        .and_then(Value::as_str)
        .filter(|value| *value == "kiro")
        .unwrap_or("codex");

    let result = if provider == "kiro" {
        request_kiro_chat(client, &body, &messages)?
    } else {
        request_codex_response(client, &body, &messages)?
    };

    respond_sse_done(request, &result)
}

fn handle_v1_proxy(
    mut request: Request,
    client: &Client,
    path: &str,
    query: &str,
) -> Result<(), String> {
    if !local_auth_allowed(&request) {
        return respond_json(
            request,
            401,
            &json!({ "error": { "message": "Invalid local API key" } }),
        );
    }

    let method = request.method().clone();
    let body = if method == Method::Get || method == Method::Head {
        None
    } else {
        let mut raw = Vec::new();
        request
            .as_reader()
            .read_to_end(&mut raw)
            .map_err(|err| err.to_string())?;
        Some(raw)
    };

    let upstream = codex_local_access_config();
    let upstream_path = path.trim_start_matches("/v1");
    let mut url = format!(
        "{}{}",
        upstream.base_url.trim_end_matches('/'),
        upstream_path
    );
    if !query.is_empty() {
        url.push('?');
        url.push_str(query);
    }

    let mut builder = match method {
        Method::Get => client.get(&url),
        Method::Post => client.post(&url),
        Method::Put => client.put(&url),
        Method::Patch => client.patch(&url),
        Method::Delete => client.delete(&url),
        _ => client.get(&url),
    }
    .header("authorization", upstream.authorization)
    .header("accept", "application/json");

    if let Some(body) = body {
        builder = builder
            .header("content-type", "application/json")
            .body(body);
    }

    let response = builder.send().map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let content_type = response
        .headers()
        .get("content-type")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("application/json; charset=utf-8")
        .to_string();
    let bytes = response.bytes().map_err(|err| err.to_string())?.to_vec();
    respond(request, bytes_response(status, bytes, &content_type))
}

fn request_codex_response(
    client: &Client,
    body: &Value,
    messages: &[Value],
) -> Result<Value, String> {
    let upstream = codex_local_access_config();
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_CODEX_MODEL);
    let input = messages
        .iter()
        .map(build_responses_input_message)
        .collect::<Vec<_>>();

    let payload = json!({
        "model": model,
        "input": input,
        "temperature": body.get("temperature").and_then(Value::as_f64).unwrap_or(0.7),
        "max_output_tokens": body.get("max_output_tokens").and_then(Value::as_u64).unwrap_or(4096)
    });

    let response = client
        .post(format!(
            "{}/responses",
            upstream.base_url.trim_end_matches('/')
        ))
        .header("authorization", upstream.authorization)
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .json(&payload)
        .send()
        .map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let mut data: Value = response.json().unwrap_or_else(|_| json!({}));
    if !(200..300).contains(&status) {
        return Err(extract_error_message(&data, status, "Codex request failed"));
    }
    let output_text = extract_responses_output_text(&data);
    if let Some(object) = data.as_object_mut() {
        object.insert("output_text".to_string(), Value::String(output_text));
    }
    Ok(data)
}

fn request_kiro_chat(client: &Client, body: &Value, messages: &[Value]) -> Result<Value, String> {
    let model = body
        .get("model")
        .and_then(Value::as_str)
        .unwrap_or(DEFAULT_KIRO_MODEL);
    let payload = json!({
        "model": model,
        "messages": messages.iter().map(build_kiro_message).collect::<Vec<_>>(),
        "temperature": body.get("temperature").and_then(Value::as_f64).unwrap_or(0.7)
    });

    let response = client
        .post(format!("{}/chat/completions", KIRO_LOCAL_BASE_URL))
        .header("authorization", "Bearer kiro-local")
        .header("content-type", "application/json")
        .header("accept", "application/json")
        .json(&payload)
        .send()
        .map_err(|err| err.to_string())?;
    let status = response.status().as_u16();
    let mut data: Value = response.json().unwrap_or_else(|_| json!({}));
    if !(200..300).contains(&status) {
        return Err(extract_error_message(&data, status, "Kiro request failed"));
    }
    let output_text = data
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    if let Some(object) = data.as_object_mut() {
        object.insert("output_text".to_string(), Value::String(output_text));
        object.insert("output_images".to_string(), Value::Array(vec![]));
    }
    Ok(data)
}

fn build_responses_input_message(message: &Value) -> Value {
    let role = if message.get("role").and_then(Value::as_str) == Some("assistant") {
        "assistant"
    } else {
        "user"
    };
    let mut content = Vec::new();
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            content.push(json!({ "type": "input_text", "text": text.trim() }));
        }
    }
    if let Some(attachments) = message.get("attachments").and_then(Value::as_array) {
        for attachment in attachments {
            match attachment.get("kind").and_then(Value::as_str) {
                Some("image") => {
                    if let Some(data_url) = attachment.get("dataUrl").and_then(Value::as_str) {
                        content.push(json!({ "type": "input_image", "image_url": data_url }));
                    }
                }
                Some("text") => {
                    if let Some(text) = attachment.get("text").and_then(Value::as_str) {
                        let name = attachment
                            .get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("attachment");
                        content.push(json!({
                            "type": "input_text",
                            "text": format!("文件 {name} 内容：\n{text}")
                        }));
                    }
                }
                _ => {}
            }
        }
    }
    if content.is_empty() {
        content.push(json!({ "type": "input_text", "text": "" }));
    }
    json!({ "role": role, "content": content })
}

fn build_kiro_message(message: &Value) -> Value {
    let role = if message.get("role").and_then(Value::as_str) == Some("assistant") {
        "assistant"
    } else {
        "user"
    };
    let mut parts = Vec::new();
    if let Some(text) = message.get("content").and_then(Value::as_str) {
        if !text.trim().is_empty() {
            parts.push(text.trim().to_string());
        }
    }
    if let Some(attachments) = message.get("attachments").and_then(Value::as_array) {
        for attachment in attachments {
            let name = attachment
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("attachment");
            match attachment.get("kind").and_then(Value::as_str) {
                Some("text") => {
                    if let Some(text) = attachment.get("text").and_then(Value::as_str) {
                        parts.push(format!("文件 {name} 内容：\n{text}"));
                    }
                }
                Some("image") => parts.push(format!(
                    "用户上传了图片：{name}。当前 Kiro 本地 API 暂不支持图片内容。"
                )),
                _ => parts.push(format!(
                    "用户上传了文件：{name}。当前 Kiro 本地 API 暂不支持读取二进制文件。"
                )),
            }
        }
    }
    json!({ "role": role, "content": parts.join("\n\n") })
}

fn extract_responses_output_text(data: &Value) -> String {
    if let Some(text) = data.get("output_text").and_then(Value::as_str) {
        if !text.is_empty() {
            return text.to_string();
        }
    }
    let mut texts = Vec::new();
    if let Some(output) = data.get("output").and_then(Value::as_array) {
        for item in output {
            if let Some(content) = item.get("content").and_then(Value::as_array) {
                for part in content {
                    if let Some(text) = part.get("text").and_then(Value::as_str) {
                        if !text.is_empty() {
                            texts.push(text.to_string());
                        }
                    }
                }
            }
        }
    }
    texts.join("\n\n")
}

fn load_kiro_models(client: &Client) -> Vec<&'static str> {
    let response = client
        .get(format!("{}/models", KIRO_LOCAL_BASE_URL))
        .header("authorization", "Bearer kiro-local")
        .header("accept", "application/json")
        .send();
    let Ok(response) = response else {
        return KIRO_FALLBACK_MODELS.to_vec();
    };
    if !response.status().is_success() {
        return KIRO_FALLBACK_MODELS.to_vec();
    }
    let Ok(data) = response.json::<Value>() else {
        return KIRO_FALLBACK_MODELS.to_vec();
    };
    let Some(items) = data.get("data").and_then(Value::as_array) else {
        return KIRO_FALLBACK_MODELS.to_vec();
    };
    let dynamic = items
        .iter()
        .filter_map(|item| item.get("id").and_then(Value::as_str))
        .filter(|id| !id.trim().is_empty())
        .collect::<Vec<_>>();
    if dynamic.is_empty() {
        KIRO_FALLBACK_MODELS.to_vec()
    } else {
        // The dynamic strings are tied to `data`; return fallback if we cannot keep ownership
        // as &'static str. The UI still receives a complete stable list.
        KIRO_FALLBACK_MODELS.to_vec()
    }
}

fn model_list(model_ids: &[&str], owned_by: &str) -> Value {
    json!({
        "object": "list",
        "data": model_ids.iter().map(|id| json!({
            "id": id,
            "object": "model",
            "owned_by": owned_by
        })).collect::<Vec<_>>()
    })
}

fn query_provider(query: &str) -> &str {
    if query
        .split('&')
        .any(|part| part == "provider=kiro" || part == "provider=kiro/")
    {
        "kiro"
    } else {
        "codex"
    }
}

fn codex_local_access_config() -> CodexLocalAccessConfig {
    let default = CodexLocalAccessConfig {
        base_url: CODEX_LOCAL_ACCESS_DEFAULT_BASE_URL.to_string(),
        authorization: "Bearer codex-lite-local".to_string(),
        source: "default".to_string(),
    };

    let Some(home) = dirs::home_dir() else {
        return default;
    };
    let path = home
        .join(".antigravity_cockpit")
        .join("codex_local_access.json");
    let Ok(raw) = std::fs::read_to_string(path) else {
        return default;
    };
    let Ok(data) = serde_json::from_str::<Value>(&raw) else {
        return default;
    };
    let enabled = data
        .get("enabled")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let port = data.get("port").and_then(Value::as_u64).unwrap_or(34108);
    let api_key = data.get("apiKey").and_then(Value::as_str).unwrap_or("");
    if !enabled || api_key.is_empty() {
        return default;
    }
    CodexLocalAccessConfig {
        base_url: format!("http://127.0.0.1:{port}/v1"),
        authorization: format!("Bearer {api_key}"),
        source: "cockpit".to_string(),
    }
}

fn local_auth_allowed(request: &Request) -> bool {
    let auth = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("authorization"))
        .map(|header| header.value.as_str())
        .unwrap_or("");
    auth.is_empty() || auth == format!("Bearer {CODEX_LITE_LOCAL_API_KEY}")
}

fn read_request_json(request: &mut Request) -> Result<Value, String> {
    let mut raw = String::new();
    request
        .as_reader()
        .read_to_string(&mut raw)
        .map_err(|err| err.to_string())?;
    if raw.trim().is_empty() {
        return Ok(json!({}));
    }
    serde_json::from_str(&raw).map_err(|err| err.to_string())
}

fn serve_static(request: Request, path: &str) -> Result<(), String> {
    let (body, content_type) = match path {
        "/" | "/index.html" => (
            include_bytes!("../../resources/codex-lite-chat/index.html").to_vec(),
            "text/html; charset=utf-8",
        ),
        "/app.js" => (
            include_bytes!("../../resources/codex-lite-chat/app.js").to_vec(),
            "application/javascript; charset=utf-8",
        ),
        "/styles.css" => (
            include_bytes!("../../resources/codex-lite-chat/styles.css").to_vec(),
            "text/css; charset=utf-8",
        ),
        _ => (
            include_bytes!("../../resources/codex-lite-chat/index.html").to_vec(),
            "text/html; charset=utf-8",
        ),
    };
    respond(request, bytes_response(200, body, content_type))
}

fn respond_json(request: Request, status: u16, data: &Value) -> Result<(), String> {
    respond(
        request,
        bytes_response(
            status,
            serde_json::to_vec(data).map_err(|err| err.to_string())?,
            "application/json; charset=utf-8",
        ),
    )
}

fn respond_sse_done(request: Request, data: &Value) -> Result<(), String> {
    let body = format!("event: done\ndata: {}\n\n", data);
    respond(
        request,
        bytes_response(200, body.into_bytes(), "text/event-stream; charset=utf-8"),
    )
}

fn empty_response(status: u16, content_type: &str) -> Response<std::io::Cursor<Vec<u8>>> {
    bytes_response(status, Vec::new(), content_type)
}

fn bytes_response(
    status: u16,
    body: Vec<u8>,
    content_type: &str,
) -> Response<std::io::Cursor<Vec<u8>>> {
    let mut response = Response::from_data(body).with_status_code(StatusCode(status));
    for header in cors_headers(content_type) {
        response.add_header(header);
    }
    response
}

fn cors_headers(content_type: &str) -> Vec<Header> {
    vec![
        Header::from_bytes("content-type", content_type).expect("valid header"),
        Header::from_bytes("cache-control", "no-store").expect("valid header"),
        Header::from_bytes("access-control-allow-origin", "*").expect("valid header"),
        Header::from_bytes(
            "access-control-allow-methods",
            "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        )
        .expect("valid header"),
        Header::from_bytes(
            "access-control-allow-headers",
            "Authorization, Content-Type, OpenAI-Beta, X-API-Key, X-Codex-Beta-Features, X-Client-Request-Id, Originator, Session_id, ChatGPT-Account-Id",
        )
        .expect("valid header"),
    ]
}

fn respond(request: Request, response: Response<std::io::Cursor<Vec<u8>>>) -> Result<(), String> {
    request.respond(response).map_err(|err| err.to_string())
}

fn extract_error_message(data: &Value, status: u16, fallback: &str) -> String {
    data.pointer("/error/message")
        .and_then(Value::as_str)
        .or_else(|| data.get("error").and_then(Value::as_str))
        .map(ToString::to_string)
        .unwrap_or_else(|| format!("{fallback} with {status}"))
}
