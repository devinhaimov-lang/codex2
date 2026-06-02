const storeKey = "codex-lite:messages";
const providerStoreKey = "codex-lite:provider";
const modelStoreKey = "codex-lite:selected-models";
const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const TEXT_ATTACHMENT_BYTES = 512 * 1024;
const textMimePrefixes = ["text/", "application/json", "application/xml", "application/javascript"];
const textExtensions = [
  ".txt",
  ".md",
  ".markdown",
  ".json",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rs",
  ".go",
  ".java",
  ".c",
  ".cc",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".toml",
  ".ini",
  ".sh",
  ".sql",
  ".csv",
  ".log",
  ".xml",
];
const dataUrlPattern = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/i;

function hydrateMessage(message) {
  if (!message || typeof message !== "object") return null;
  return {
    role: message.role === "assistant" ? "assistant" : "user",
    content: typeof message.content === "string" ? message.content : "",
    provider: message.provider === "kiro" ? "kiro" : message.provider === "codex" ? "codex" : undefined,
    attachments: Array.isArray(message.attachments)
      ? message.attachments
          .filter((item) => item && typeof item === "object")
          .map((item, index) => ({
            id: typeof item.id === "string" ? item.id : `att-${Date.now()}-${index}`,
            name: typeof item.name === "string" ? item.name : "attachment",
            mimeType: typeof item.mimeType === "string" ? item.mimeType : "application/octet-stream",
            size: Number.isFinite(item.size) ? item.size : 0,
            kind: item.kind === "image" ? "image" : item.kind === "text" ? "text" : "file",
            dataUrl: typeof item.dataUrl === "string" ? item.dataUrl : undefined,
            text: typeof item.text === "string" ? item.text : undefined,
          }))
      : [],
  };
}

const initialMessages = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem(storeKey) || "[]");
    return Array.isArray(raw)
      ? raw.map(hydrateMessage).filter(Boolean)
      : [];
  } catch {
    return [];
  }
})();

const state = {
  messages: initialMessages,
  config: null,
  pendingAttachments: [],
  provider: localStorage.getItem(providerStoreKey) === "kiro" ? "kiro" : "codex",
  selectedModels: (() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(modelStoreKey) || "{}");
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  })(),
};

const els = {
  endpoint: document.querySelector("#endpoint"),
  providerSwitch: document.querySelector("#providerSwitch"),
  providerButtons: Array.from(document.querySelectorAll("#providerSwitch [data-provider]")),
  modelSelect: document.querySelector("#modelSelect"),
  messages: document.querySelector("#messages"),
  form: document.querySelector("#chatForm"),
  input: document.querySelector("#promptInput"),
  sendBtn: document.querySelector("#sendBtn"),
  newChatBtn: document.querySelector("#newChatBtn"),
  exportChatBtn: document.querySelector("#exportChatBtn"),
  importChatBtn: document.querySelector("#importChatBtn"),
  importChatInput: document.querySelector("#importChatInput"),
  copyApiBtn: document.querySelector("#copyApiBtn"),
  statusDot: document.querySelector("#statusDot"),
  statusText: document.querySelector("#statusText"),
  template: document.querySelector("#messageTemplate"),
  attachmentInput: document.querySelector("#attachmentInput"),
  attachBtn: document.querySelector("#attachBtn"),
  attachmentList: document.querySelector("#attachmentList"),
  composerPanel: document.querySelector("#composerPanel"),
};

function setStatus(text, type = "") {
  els.statusText.textContent = text;
  els.statusDot.className = `dot ${type}`.trim();
}

function setProvider(provider, { persist = true, refresh = true } = {}) {
  state.provider = provider === "kiro" ? "kiro" : "codex";
  if (persist) {
    localStorage.setItem(providerStoreKey, state.provider);
  }
  for (const button of els.providerButtons) {
    const active = button.dataset.provider === state.provider;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", active ? "true" : "false");
  }
  state.pendingAttachments = [];
  renderPendingAttachments();
  if (state.provider === "kiro") {
    setStatus("已切换到 Kiro", "ready");
  }
  if (refresh) {
    void loadModels().catch((error) => {
      setStatus(error.message || "切换来源失败", "error");
    });
  }
}

function saveMessages() {
  try {
    localStorage.setItem(storeKey, JSON.stringify(state.messages));
  } catch {
    setStatus("聊天记录过大，已跳过本地保存", "error");
  }

  if (window.parent && window.parent !== window) {
    window.parent.postMessage(
      {
        type: "codex-lite-persist-chat-save",
        payload: JSON.stringify(state.messages),
      },
      "*",
    );
  }
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function createAttachmentBadge(attachment) {
  const chip = document.createElement("div");
  chip.className = "attachment-chip";

  const text = document.createElement("div");
  text.className = "attachment-chip-text";

  const name = document.createElement("strong");
  name.textContent = attachment.name;
  text.appendChild(name);

  const meta = document.createElement("span");
  meta.textContent = `${attachment.kind === "image" ? "图片" : attachment.kind === "text" ? "文本" : "文件"} · ${formatBytes(attachment.size)}`;
  text.appendChild(meta);

  chip.appendChild(text);
  return chip;
}

function createImagePreview(attachment) {
  if (attachment.kind !== "image" || typeof attachment.dataUrl !== "string" || !attachment.dataUrl) {
    return null;
  }
  const wrapper = document.createElement("div");
  wrapper.className = "message-image-preview";

  const image = document.createElement("img");
  image.src = attachment.dataUrl;
  image.alt = attachment.name || "generated image";
  image.loading = "lazy";
  wrapper.appendChild(image);

  const actions = document.createElement("div");
  actions.className = "message-image-actions";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "message-image-save";
  saveBtn.textContent = "保存图片";
  saveBtn.addEventListener("click", () => {
    void saveImageAttachment(attachment);
  });
  actions.appendChild(saveBtn);

  wrapper.appendChild(actions);

  return wrapper;
}

function parseDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(dataUrlPattern);
  if (!match) return null;
  const mimeType = match[1] || "application/octet-stream";
  const data = match[2] || "";
  const isBase64 = /;base64,/i.test(dataUrl);
  return {
    mimeType,
    data: isBase64 ? data : btoa(decodeURIComponent(data)),
  };
}

async function saveImageAttachment(attachment) {
  const parsed = parseDataUrl(attachment.dataUrl);
  if (!parsed) {
    setStatus("图片数据无效，无法保存", "error");
    return;
  }

  const extension = (() => {
    switch (parsed.mimeType) {
      case "image/jpeg":
        return "jpg";
      case "image/webp":
        return "webp";
      case "image/gif":
        return "gif";
      default:
        return "png";
    }
  })();
  const defaultFileName = attachment.name && /\.[a-z0-9]+$/i.test(attachment.name)
    ? attachment.name
    : `${attachment.name || "codex-lite-image"}.${extension}`;

  if (window.parent && window.parent !== window) {
    setStatus("正在请求保存位置...", "ready");
    window.parent.postMessage(
      {
        type: "codex-lite-save-image",
        payload: parsed.data,
        fileName: defaultFileName,
        mimeType: parsed.mimeType,
      },
      "*",
    );
    return;
  }

  const link = document.createElement("a");
  link.href = attachment.dataUrl;
  link.download = defaultFileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setStatus("已使用浏览器下载图片", "ready");
}

function addMessage(role, message, scroll = true) {
  const normalized = hydrateMessage({ role, ...message }) || { role, content: "", attachments: [] };
  const node = els.template.content.firstElementChild.cloneNode(true);
  node.classList.add(role);
  node.querySelector(".meta").textContent = role === "user"
    ? "你"
    : normalized.provider === "kiro"
      ? "Kiro"
      : "Codex";
  node.querySelector(".body").textContent = normalized.content || (normalized.attachments.length ? "" : "-");

  if (normalized.attachments.length) {
    const attachmentRow = document.createElement("div");
    attachmentRow.className = "message-attachments";
    for (const attachment of normalized.attachments) {
      const imagePreview = createImagePreview(attachment);
      if (imagePreview) {
        attachmentRow.appendChild(imagePreview);
      } else {
        attachmentRow.appendChild(createAttachmentBadge(attachment));
      }
    }
    node.appendChild(attachmentRow);
  }

  els.messages.appendChild(node);
  if (scroll) els.messages.scrollTop = els.messages.scrollHeight;
  return node;
}

function renderMessages() {
  els.messages.innerHTML = "";
  if (!state.messages.length) {
    addMessage("assistant", { content: "你好主人，有什么不开心的事就跟我说说" }, false);
    return;
  }
  for (const message of state.messages) addMessage(message.role, message, false);
  els.messages.scrollTop = els.messages.scrollHeight;
}

function renderPendingAttachments() {
  els.attachmentList.innerHTML = "";
  if (!state.pendingAttachments.length) {
    els.attachmentList.hidden = true;
    return;
  }
  els.attachmentList.hidden = false;

  for (const attachment of state.pendingAttachments) {
    const row = createAttachmentBadge(attachment);
    row.classList.add("pending");

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "attachment-remove";
    removeBtn.textContent = "移除";
    removeBtn.addEventListener("click", () => {
      state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== attachment.id);
      renderPendingAttachments();
    });

    row.appendChild(removeBtn);
    els.attachmentList.appendChild(row);
  }
}

async function exportMessages() {
  const payload = {
    exportedAt: new Date().toISOString(),
    version: 1,
    messages: state.messages,
  };
  const payloadText = JSON.stringify(payload, null, 2);
  const blob = new Blob([payloadText], { type: "application/json" });
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `codex-lite-chat-${timestamp}.json`;

  if (window.parent && window.parent !== window) {
    setStatus("正在请求保存位置...", "ready");
    window.parent.postMessage(
      {
        type: "codex-lite-export-chat",
        payload: payloadText,
        fileName,
      },
      "*",
    );
    return;
  }

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fileName,
        types: [
          {
            description: "JSON Files",
            accept: { "application/json": [".json"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      setStatus("已导出聊天记录", "ready");
      return;
    } catch (error) {
      if (error && error.name === "AbortError") {
        setStatus("已取消导出", "ready");
        return;
      }
      console.warn("[CodexLite] showSaveFilePicker failed, fallback to download", error);
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("当前环境不支持自定义路径，已使用默认下载", "ready");
}

async function importMessages(file) {
  const raw = await file.text();
  const parsed = JSON.parse(raw);
  const candidateMessages = Array.isArray(parsed) ? parsed : parsed?.messages;
  if (!Array.isArray(candidateMessages)) {
    throw new Error("导入文件格式不正确，需要包含 messages 数组");
  }
  const nextMessages = candidateMessages.map(hydrateMessage).filter(Boolean);
  state.messages = nextMessages;
  state.pendingAttachments = [];
  saveMessages();
  renderMessages();
  renderPendingAttachments();
  setStatus(`已导入 ${nextMessages.length} 条消息`, "ready");
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || data.error || "请求失败");
  return data;
}


function createAssistantAttachments(result) {
  return Array.isArray(result?.output_images)
    ? result.output_images
        .filter((item) => item && typeof item === "object" && typeof item.data_url === "string")
        .map((item, index) => ({
          id: `${Date.now()}-generated-${index}`,
          name: item.revised_prompt ? `generated-${index + 1}.png` : `image-${index + 1}.png`,
          mimeType: typeof item.mime_type === "string" ? item.mime_type : "image/png",
          size: 0,
          kind: "image",
          dataUrl: item.data_url,
          text: typeof item.revised_prompt === "string" ? item.revised_prompt : undefined,
        }))
    : [];
}

function appendAssistantAttachments(node, attachments) {
  if (!attachments.length) return;
  const attachmentRow = document.createElement("div");
  attachmentRow.className = "message-attachments";
  for (const attachment of attachments) {
    const imagePreview = createImagePreview(attachment);
    if (imagePreview) attachmentRow.appendChild(imagePreview);
  }
  node.appendChild(attachmentRow);
}

function createSseTextParser(onEvent) {
  let buffer = "";
  let currentEvent = "message";
  let dataLines = [];

  function emit() {
    if (!dataLines.length) {
      currentEvent = "message";
      return;
    }
    onEvent(currentEvent, dataLines.join("\n"));
    currentEvent = "message";
    dataLines = [];
  }

  return {
    push(text) {
      buffer += text;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line) {
          emit();
          continue;
        }
        if (line.startsWith("event:")) {
          currentEvent = line.slice(6).trim() || "message";
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    },
    end() {
      if (buffer) {
        const line = buffer;
        buffer = "";
        if (line.startsWith("event:")) currentEvent = line.slice(6).trim() || "message";
        if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      emit();
    },
  };
}

async function requestChatStream(payload, onDelta) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      accept: "text/event-stream",
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok || !response.body) {
    let data = null;
    try {
      data = await response.json();
    } catch {}
    throw new Error(data?.error?.message || data?.error || "请求失败");
  }

  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  let finalData = null;
  let streamError = null;
  const parser = createSseTextParser((event, rawData) => {
    let data;
    try {
      data = JSON.parse(rawData);
    } catch {
      return;
    }
    if (event === "delta" && typeof data.text === "string") {
      onDelta(data.text);
      return;
    }
    if (event === "done") {
      finalData = data;
      return;
    }
    if (event === "error") {
      streamError = new Error(data?.error || "请求失败");
    }
  });

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    parser.push(decoder.decode(value, { stream: true }));
  }
  parser.push(decoder.decode());
  parser.end();

  if (streamError) throw streamError;
  return finalData || { output_text: "" };
}

async function loadConfig() {
  const config = await requestJson("/api/config");
  state.config = config;
  await loadModels();
}

async function loadModels() {
  if (!state.config) return;
  const provider = state.provider === "kiro" ? "kiro" : "codex";
  const endpoint = provider === "kiro" ? state.config.kiroBaseUrl : state.config.localBaseUrl;
  els.endpoint.textContent = `${provider === "kiro" ? "Kiro" : "Codex"} · ${endpoint || "未启动"}`;

  const models = await requestJson(`/api/models?provider=${encodeURIComponent(provider)}`);
  const modelIds = (models.data || []).map((model) => model.id);
  const rawStoredModel = typeof state.selectedModels[provider] === "string" ? state.selectedModels[provider] : "";
  const storedModel = provider === "kiro" && rawStoredModel === "kiro-local" ? "" : rawStoredModel;
  const preferred = provider === "kiro"
    ? [storedModel, state.config.kiroModel || "claude-opus-4.8", "kiro-local"]
    : [storedModel, state.config.defaultModel, "gpt-5.4-mini"];
  const ordered = [...new Set([...preferred, ...modelIds])].filter(Boolean);
  const selected = ordered.includes(storedModel) ? storedModel : ordered[0] || "";

  els.modelSelect.innerHTML = "";
  for (const id of ordered) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    if (id === selected) option.selected = true;
    els.modelSelect.appendChild(option);
  }
  setStatus(`已连接 ${provider === "kiro" ? "Kiro" : "Codex"}，模型 ${modelIds.length || ordered.length} 个`, "ready");
}

function isTextAttachment(file) {
  if (textMimePrefixes.some((prefix) => file.type.startsWith(prefix))) return true;
  const lowerName = file.name.toLowerCase();
  return textExtensions.some((ext) => lowerName.endsWith(ext));
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.readAsDataURL(file);
  });
}

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error(`读取文件失败：${file.name}`));
    reader.readAsText(file);
  });
}

async function normalizeAttachment(file) {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} 超过 ${formatBytes(MAX_ATTACHMENT_BYTES)} 限制`);
  }

  const base = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    size: file.size,
  };

  if (file.type.startsWith("image/")) {
    return {
      ...base,
      kind: "image",
      dataUrl: await readFileAsDataUrl(file),
    };
  }

  if (isTextAttachment(file) && file.size <= TEXT_ATTACHMENT_BYTES) {
    return {
      ...base,
      kind: "text",
      text: await readFileAsText(file),
    };
  }

  return {
    ...base,
    kind: "file",
    dataUrl: await readFileAsDataUrl(file),
  };
}

async function addAttachments(fileList) {
  const files = Array.from(fileList || []);
  if (!files.length) return;

  try {
    const attachments = [];
    for (const file of files) {
      attachments.push(await normalizeAttachment(file));
    }
    state.pendingAttachments = [...state.pendingAttachments, ...attachments];
    renderPendingAttachments();
    setStatus(`已添加 ${attachments.length} 个附件`, "ready");
  } catch (error) {
    setStatus(error.message || "添加附件失败", "error");
  } finally {
    els.attachmentInput.value = "";
  }
}

async function sendMessage(content, attachments) {
  const provider = state.provider === "kiro" ? "kiro" : "codex";
  const userMessage = {
    content,
    attachments,
    provider,
  };
  state.messages.push({ role: "user", ...userMessage });
  saveMessages();
  renderMessages();

  els.sendBtn.disabled = true;
  els.input.disabled = true;
  els.attachBtn.disabled = true;
  setStatus(`${provider === "kiro" ? "Kiro" : "Codex"} 正在回复...`);
  const pending = addMessage("assistant", { content: "生成中...", provider });

  try {
    let streamedReply = "";
    const body = pending.querySelector(".body");
    body.textContent = "";
    const result = await requestChatStream({
      provider,
      model: els.modelSelect.value,
      messages: state.messages,
      temperature: 0.7,
      max_output_tokens: 4096,
    }, (delta) => {
      streamedReply += delta;
      body.textContent = streamedReply;
      els.messages.scrollTop = els.messages.scrollHeight;
    });
    const reply = result.output_text || streamedReply || "没有返回内容。";
    body.textContent = reply;
    const assistantAttachments = createAssistantAttachments(result);
    state.messages.push({ role: "assistant", content: reply, provider, attachments: assistantAttachments });
    appendAssistantAttachments(pending, assistantAttachments);
    saveMessages();
    setStatus("回复完成", "ready");
  } catch (error) {
    pending.querySelector(".body").textContent = `请求失败：${error.message}`;
    setStatus(error.message, "error");
  } finally {
    els.sendBtn.disabled = false;
    els.input.disabled = false;
    els.attachBtn.disabled = false;
    els.input.focus();
  }
}

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = els.input.value.trim();
  const attachments = [...state.pendingAttachments];
  if (!content && !attachments.length) return;
  els.input.value = "";
  state.pendingAttachments = [];
  renderPendingAttachments();
  void sendMessage(content, attachments);
});

els.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    els.form.requestSubmit();
  }
});

els.attachBtn.addEventListener("click", () => {
  els.attachmentInput.click();
});

els.attachmentInput.addEventListener("change", (event) => {
  void addAttachments(event.target.files);
});

els.exportChatBtn.addEventListener("click", () => {
  void exportMessages();
});
els.importChatBtn.addEventListener("click", () => {
  els.importChatInput.click();
});
els.importChatInput.addEventListener("change", async (event) => {
  const [file] = Array.from(event.target.files || []);
  if (!file) return;
  try {
    await importMessages(file);
  } catch (error) {
    setStatus(error.message || "导入聊天记录失败", "error");
  } finally {
    els.importChatInput.value = "";
  }
});

for (const button of els.providerButtons) {
  button.addEventListener("click", () => {
    setProvider(button.dataset.provider || "codex");
  });
}

els.modelSelect.addEventListener("change", () => {
  const provider = state.provider === "kiro" ? "kiro" : "codex";
  state.selectedModels = {
    ...state.selectedModels,
    [provider]: els.modelSelect.value,
  };
  localStorage.setItem(modelStoreKey, JSON.stringify(state.selectedModels));
  setStatus(`已选择 ${provider === "kiro" ? "Kiro" : "Codex"} 模型：${els.modelSelect.value}`, "ready");
});

els.newChatBtn.addEventListener("click", () => {
  state.messages = [];
  state.pendingAttachments = [];
  saveMessages();
  renderMessages();
  renderPendingAttachments();
  setStatus("已开始新对话", "ready");
});

els.copyApiBtn.addEventListener("click", async () => {
  if (!state.config) return;
  const isKiro = state.provider === "kiro";
  await navigator.clipboard.writeText([
    `OPENAI_BASE_URL=${isKiro ? state.config.kiroBaseUrl : state.config.localBaseUrl}`,
    `OPENAI_API_KEY=${isKiro ? "kiro-local" : state.config.localApiKey}`,
    `OPENAI_MODEL=${els.modelSelect.value}`,
  ].join("\n"));
  setStatus(`已复制 ${isKiro ? "Kiro" : "Codex"} API 配置`, "ready");
});

els.composerPanel.addEventListener("dragenter", (event) => {
  event.preventDefault();
  els.composerPanel.classList.add("drag-active");
});

els.composerPanel.addEventListener("dragover", (event) => {
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
});

els.composerPanel.addEventListener("dragleave", (event) => {
  if (event.target === els.composerPanel) {
    els.composerPanel.classList.remove("drag-active");
  }
});

window.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "codex-lite-persist-chat-load-result") {
    if (data.status === "success" && typeof data.payload === "string" && data.payload.trim()) {
      try {
        const parsed = JSON.parse(data.payload);
        if (Array.isArray(parsed)) {
          state.messages = parsed.map(hydrateMessage).filter(Boolean);
          renderMessages();
          saveMessages();
        }
      } catch {}
    }
    return;
  }

  if (data.type === "codex-lite-export-chat-result") {
    if (data.status === "success") {
      setStatus(data.path ? `已导出聊天记录：${data.path}` : "已导出聊天记录", "ready");
      return;
    }
    if (data.status === "cancelled") {
      setStatus("已取消导出", "ready");
      return;
    }
    if (data.status === "error") {
      setStatus(data.message || "导出聊天记录失败", "error");
    }
    return;
  }

  if (data.type !== "codex-lite-save-image-result") return;
  if (data.status === "success") {
    setStatus(data.path ? `图片已保存：${data.path}` : "图片已保存", "ready");
    return;
  }
  if (data.status === "cancelled") {
    setStatus("已取消保存图片", "ready");
    return;
  }
  if (data.status === "error") {
    setStatus(data.message || "保存图片失败", "error");
  }
});

els.composerPanel.addEventListener("drop", (event) => {
  event.preventDefault();
  els.composerPanel.classList.remove("drag-active");
  void addAttachments(event.dataTransfer.files);
});

renderMessages();
renderPendingAttachments();
setProvider(state.provider, { persist: false, refresh: false });
if (window.parent && window.parent !== window) {
  window.parent.postMessage({ type: "codex-lite-persist-chat-load" }, "*");
}
loadConfig().catch((error) => {
  setStatus(`连接失败：${error.message}`, "error");
});
