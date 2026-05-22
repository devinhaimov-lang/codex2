import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Clipboard, Copy, Download, FileJson, Trash2 } from 'lucide-react';

type JsonRecord = Record<string, unknown>;

type NormalizedAccount = {
  index: number;
  displayName: string;
  identity: string;
  warnings: string[];
  account: {
    name: string;
    platform: 'openai';
    type: 'oauth';
    credentials: JsonRecord;
    extra: JsonRecord;
    concurrency: number;
    priority: number;
    rate_multiplier: number;
    auto_pause_on_expired: true;
  };
};

const SESSION_URL = 'https://chatgpt.com/api/auth/session';

const tokenPaths = {
  accessToken: [
    ['tokens', 'access_token'], ['tokens', 'accessToken'], ['auth', 'accessToken'],
    ['access_token'], ['accessToken'], ['token'],
  ],
  refreshToken: [
    ['tokens', 'refresh_token'], ['tokens', 'refreshToken'], ['auth', 'refreshToken'],
    ['refresh_token'], ['refreshToken'],
  ],
  idToken: [
    ['tokens', 'id_token'], ['tokens', 'idToken'], ['auth', 'idToken'],
    ['id_token'], ['idToken'],
  ],
  email: [['email'], ['user', 'email'], ['account', 'email']],
  name: [['name'], ['user', 'name'], ['account', 'name']],
  accountId: [
    ['chatgpt_account_id'], ['chatgptAccountId'], ['account_id'], ['accountId'],
    ['account', 'id'], ['account', 'account_id'], ['account', 'chatgpt_account_id'],
  ],
  userId: [['chatgpt_user_id'], ['chatgptUserId'], ['user_id'], ['userId'], ['user', 'id']],
  planType: [['plan_type'], ['planType'], ['account', 'plan_type'], ['account', 'planType']],
  organizationId: [['organization_id'], ['organizationId'], ['org_id'], ['orgId']],
  expiresAt: [['tokens', 'expires_at'], ['tokens', 'expiresAt'], ['expires_at'], ['expiresAt']],
} as const;

type PathList = readonly (readonly string[])[];

type ConvertSettings = {
  namePrefix: string;
  concurrency: string;
  priority: string;
  rateMultiplier: string;
  dedupe: boolean;
  includeTypeVersion: boolean;
  pretty: boolean;
};

function isRecord(value: unknown): value is JsonRecord {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function looksLikeJson(text: string) {
  const first = text.trim()[0];
  return first === '{' || first === '[';
}

function findJsonEnd(text: string, start: number) {
  const open = text[start];
  const close = open === '{' ? '}' : open === '[' ? ']' : null;
  if (!close) {
    const next = text.indexOf('\n', start);
    return next === -1 ? text.length : next;
  }
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return text.length;
}

function flattenValues(values: unknown[]) {
  const out: unknown[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit);
    else out.push(value);
  };
  values.forEach(visit);
  return out;
}

function parseJsonStream(text: string) {
  const values: unknown[] = [];
  let index = 0;
  while (index < text.length) {
    while (/\s/.test(text[index] || '')) index += 1;
    if (index >= text.length) break;
    const end = findJsonEnd(text, index);
    if (end <= index) throw new Error('JSON 解析失败');
    values.push(JSON.parse(text.slice(index, end)));
    index = end;
  }
  return values;
}

function parseContent(content: string) {
  const trimmed = content.trim();
  if (!trimmed) return [];
  if (looksLikeJson(trimmed)) {
    try {
      return flattenValues(parseJsonStream(trimmed));
    } catch (err) {
      if (!trimmed.includes('\n')) throw err;
    }
  }
  const values: unknown[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    const item = line.trim();
    if (!item) continue;
    if (looksLikeJson(item)) values.push(...flattenValues(parseJsonStream(item)));
    else values.push(item);
  }
  return values;
}

function firstValue(obj: JsonRecord, paths: PathList) {
  for (const path of paths) {
    let cur: unknown = obj;
    let ok = true;
    for (const part of path) {
      if (!isRecord(cur) || !(part in cur)) {
        ok = false;
        break;
      }
      cur = cur[part];
    }
    if (ok && cur !== undefined && cur !== null && cur !== '') return cur;
  }
  return '';
}

function clean(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function firstString(obj: JsonRecord, paths: PathList) {
  return clean(firstValue(obj, paths));
}

function deepFindString(value: unknown, names: string[], seen = new Set<object>()): string {
  if (!value || typeof value !== 'object' || seen.has(value)) return '';
  seen.add(value);
  const record = value as JsonRecord;
  for (const name of names) {
    if (typeof record[name] === 'string' && record[name].trim()) return record[name].trim();
  }
  for (const item of Object.values(record)) {
    const found = deepFindString(item, names, seen);
    if (found) return found;
  }
  return '';
}

function decodeJwt(token: string) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const json = decodeURIComponent(Array.from(atob(padded), (ch) => (
      `%${ch.charCodeAt(0).toString(16).padStart(2, '0')}`
    )).join(''));
    return JSON.parse(json) as JsonRecord;
  } catch {
    return null;
  }
}

function normalizeDate(value: unknown) {
  if (!value) return '';
  if (typeof value === 'number') {
    const ms = value > 100000000000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }
  const text = String(value).trim();
  if (!text) return '';
  if (/^\d+$/.test(text)) return normalizeDate(Number(text));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function numberValue(value: string, fallback: number) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function tokenFingerprint(value: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    h1 ^= value.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= value.charCodeAt(value.length - 1 - i);
    h2 = Math.imul(h2, 0x811c9dc5);
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
}

function buildName(name: string, email: string, accountId: string, userId: string, index: number, prefix: string) {
  const base = clean(name) || clean(email) || clean(accountId) || clean(userId) || `账号 ${index}`;
  return prefix.trim() ? `${prefix.trim()} - ${base}` : base;
}

function normalizeEntry(raw: unknown, index: number, settings: ConvertSettings): NormalizedAccount {
  const warnings: string[] = [];
  const extra: JsonRecord = {
    import_source: 'chatgpt_web_session',
    imported_at: new Date().toISOString(),
  };
  let accessToken = '';
  let refreshToken = '';
  let idToken = '';
  let email = '';
  let name = '';
  let accountId = '';
  let userId = '';
  let planType = '';
  let organizationId = '';
  let expiresAt = '';

  if (typeof raw === 'string') {
    accessToken = raw.trim();
  } else if (isRecord(raw)) {
    accessToken = firstString(raw, tokenPaths.accessToken) || deepFindString(raw, ['access_token', 'accessToken']);
    refreshToken = firstString(raw, tokenPaths.refreshToken) || deepFindString(raw, ['refresh_token', 'refreshToken']);
    idToken = firstString(raw, tokenPaths.idToken) || deepFindString(raw, ['id_token', 'idToken']);
    email = firstString(raw, tokenPaths.email);
    name = firstString(raw, tokenPaths.name);
    accountId = firstString(raw, tokenPaths.accountId);
    userId = firstString(raw, tokenPaths.userId);
    planType = firstString(raw, tokenPaths.planType);
    organizationId = firstString(raw, tokenPaths.organizationId);
    expiresAt = normalizeDate(firstValue(raw, tokenPaths.expiresAt));
    if (firstString(raw, [['session_token'], ['sessionToken']])) {
      extra.session_token_present = true;
      warnings.push('sessionToken 已忽略；sub2api OAuth 账号需要 accessToken/refreshToken');
    }
    const authProvider = firstString(raw, [['auth_provider'], ['authProvider']]);
    if (authProvider) extra.auth_provider = authProvider;
  } else {
    throw new Error(`第 ${index} 条不是可支持的 session 格式`);
  }

  if (!accessToken) throw new Error(`第 ${index} 条缺少 accessToken/access_token`);

  const accessClaims = decodeJwt(accessToken);
  if (accessClaims) {
    if (accessClaims.exp && !expiresAt) expiresAt = new Date(Number(accessClaims.exp) * 1000).toISOString();
    if (!email && accessClaims.email) email = String(accessClaims.email);
    const auth = accessClaims['https://api.openai.com/auth'];
    if (isRecord(auth)) {
      if (!accountId) accountId = clean(auth.chatgpt_account_id);
      if (!userId) userId = clean(auth.chatgpt_user_id || auth.user_id);
      if (!planType) planType = clean(auth.chatgpt_plan_type);
      if (!organizationId) organizationId = clean(auth.poid);
      const organizations = auth.organizations;
      if (!organizationId && Array.isArray(organizations) && organizations.length) {
        const defaultOrg = organizations.find((item) => isRecord(item) && item.is_default);
        const org = isRecord(defaultOrg) ? defaultOrg : organizations.find(isRecord);
        organizationId = clean(org?.id);
      }
    } else if (!userId && accessClaims.sub) {
      userId = String(accessClaims.sub).trim();
    }
  } else {
    warnings.push('accessToken 不是可解析 JWT，无法自动读取过期时间和账号身份');
  }

  const idClaims = decodeJwt(idToken);
  if (idClaims) {
    if (!email && idClaims.email) email = String(idClaims.email);
    const auth = idClaims['https://api.openai.com/auth'];
    if (isRecord(auth)) {
      if (!accountId) accountId = clean(auth.chatgpt_account_id);
      if (!userId) userId = clean(auth.chatgpt_user_id || auth.user_id);
      if (!planType) planType = clean(auth.chatgpt_plan_type);
      if (!organizationId) organizationId = clean(auth.poid);
    }
  }

  const credentials: JsonRecord = { access_token: accessToken };
  if (refreshToken) {
    credentials.refresh_token = refreshToken;
    credentials.client_id = '04f0c124-f2bc-4f24-85d9-91335d81a9e2';
  } else {
    warnings.push('未包含 refresh_token，accessToken 过期后无法自动续期');
  }
  if (idToken) credentials.id_token = idToken;
  if (expiresAt) credentials.expires_at = expiresAt;
  if (email) credentials.email = email;
  if (accountId) credentials.chatgpt_account_id = accountId;
  if (userId) credentials.chatgpt_user_id = userId;
  if (organizationId) credentials.organization_id = organizationId;
  if (planType) credentials.plan_type = planType;

  extra.access_token_fingerprint = tokenFingerprint(accessToken);
  const displayName = buildName(name, email, accountId, userId, index, settings.namePrefix);

  return {
    index,
    displayName,
    identity: [email, accountId, userId, extra.access_token_fingerprint].filter(Boolean).join('|'),
    warnings,
    account: {
      name: displayName,
      platform: 'openai',
      type: 'oauth',
      credentials,
      extra,
      concurrency: numberValue(settings.concurrency, 3),
      priority: numberValue(settings.priority, 50),
      rate_multiplier: numberValue(settings.rateMultiplier, 1),
      auto_pause_on_expired: true,
    },
  };
}

function convertInput(input: string, settings: ConvertSettings) {
  const values = parseContent(input);
  const messages: string[] = [];
  const normalized: NormalizedAccount[] = [];
  const seen = new Set<string>();

  values.forEach((value, idx) => {
    try {
      const item = normalizeEntry(value, idx + 1, settings);
      if (settings.dedupe && item.identity && seen.has(item.identity)) {
        messages.push(`第 ${idx + 1} 条与前面重复，已跳过`);
        return;
      }
      if (item.identity) seen.add(item.identity);
      normalized.push(item);
      messages.push(...item.warnings.map((warning) => `${item.displayName}: ${warning}`));
    } catch (err) {
      messages.push(err instanceof Error ? err.message : String(err));
    }
  });

  const payload: JsonRecord = {
    exported_at: new Date().toISOString(),
    proxies: [],
    accounts: normalized.map((item) => item.account),
  };
  if (settings.includeTypeVersion) {
    payload.type = 'sub2api-data';
    payload.version = 1;
  }

  return {
    values,
    accounts: normalized,
    messages,
    output: JSON.stringify(payload, null, settings.pretty ? 2 : 0),
  };
}

export function SessionJsonToolPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [status, setStatus] = useState('等待输入');
  const [dragging, setDragging] = useState(false);
  const [settings, setSettings] = useState<ConvertSettings>({
    namePrefix: 'ChatGPT Web',
    concurrency: '3',
    priority: '50',
    rateMultiplier: '1',
    dedupe: true,
    includeTypeVersion: true,
    pretty: true,
  });
  const [autoConvert, setAutoConvert] = useState(true);
  const [summary, setSummary] = useState<{ sourceTotal: number; accounts: NormalizedAccount[]; messages: string[] }>({
    sourceTotal: 0,
    accounts: [],
    messages: [],
  });

  const runConvert = useCallback(() => {
    try {
      const result = convertInput(input, settings);
      setOutput(result.output);
      setSummary({ sourceTotal: result.values.length, accounts: result.accounts, messages: result.messages });
      setStatus(result.accounts.length ? `已转换 ${result.accounts.length} 个账号` : '没有可转换账号');
    } catch (err) {
      setOutput('');
      setSummary({ sourceTotal: 0, accounts: [], messages: [`JSON 解析失败：${err instanceof Error ? err.message : String(err)}`] });
      setStatus('解析失败');
    }
  }, [input, settings]);

  useEffect(() => {
    if (!autoConvert) return undefined;
    const timer = window.setTimeout(runConvert, 220);
    return () => window.clearTimeout(timer);
  }, [autoConvert, runConvert]);

  const readFiles = useCallback(async (files: FileList | File[]) => {
    const chunks = await Promise.all(Array.from(files).map((file) => file.text()));
    setInput((current) => [current.trim(), ...chunks].filter(Boolean).join('\n'));
    setStatus(`已读取 ${chunks.length} 个文件`);
  }, []);

  const copyText = useCallback(async (text: string, okText: string) => {
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setStatus(okText);
  }, []);

  const downloadOutput = useCallback(() => {
    if (!output) return;
    const blob = new Blob([output], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sub2api-import-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, [output]);

  const handleDrop = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    if (event.dataTransfer.files.length) void readFiles(event.dataTransfer.files);
  }, [readFiles]);

  const messagePreview = useMemo(() => summary.messages.slice(0, 18), [summary.messages]);

  return (
    <main className="session-json-page">
      <header className="session-json-header">
        <div>
          <h1>Session JSON 转 sub2api 导入 JSON</h1>
          <p>粘贴 ChatGPT Web / Codex session，或拖入一个或多个 JSON 文件。当前输出为 sub2api 账号数据导入 JSON。</p>
        </div>
        <div className="session-json-top-actions">
          <div className="session-json-url">
            <span>{SESSION_URL}</span>
            <button type="button" className="session-json-btn" onClick={() => void copyText(SESSION_URL, '已复制 session 网址')}>
              <Copy size={14} />
              复制网址
            </button>
          </div>
          <div className="session-json-status">{status}</div>
        </div>
      </header>

      <section className="session-json-steps">
        <div className="session-json-steps-title">操作步骤</div>
        <ol>
          <li>用 Chrome 无痕窗口登录 GPT 账号。</li>
          <li>再打开一个新窗口，输入 https://chatgpt.com/api/auth/session。</li>
          <li>复制页面里的 session JSON，粘贴到下面的转 JSON 工具。</li>
          <li>点击转换，复制右侧生成的 JSON。</li>
          <li>回到 Codex 账号页，添加账号时粘贴这个 JSON。</li>
        </ol>
      </section>

      <section className="session-json-grid">
        <section className="session-json-panel">
          <div className="session-json-panel-head">
            <div>
              <div className="session-json-panel-title">Session JSON</div>
              <div className="session-json-panel-note">支持单个 JSON、数组、JSONL，或纯 accessToken 每行一个</div>
            </div>
            <div className="session-json-actions">
              <button type="button" className="session-json-btn" onClick={() => fileInputRef.current?.click()}>
                <FileJson size={15} />
                选择文件
              </button>
              <button
                type="button"
                className="session-json-btn session-json-btn-danger"
                onClick={() => {
                  setInput('');
                  setOutput('');
                  setSummary({ sourceTotal: 0, accounts: [], messages: [] });
                  setStatus('等待输入');
                }}
              >
                <Trash2 size={15} />
                清空
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json,.txt"
                multiple
                hidden
                onChange={(event) => {
                  if (event.currentTarget.files) void readFiles(event.currentTarget.files);
                  event.currentTarget.value = '';
                }}
              />
            </div>
          </div>
          <div
            className={`session-json-dropzone${dragging ? ' dragging' : ''}`}
            onDragEnter={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={handleDrop}
          >
            <div>
              <strong>拖入 JSON 文件</strong>
              <span>或直接在下方粘贴 session 内容</span>
            </div>
          </div>
          <textarea
            className="session-json-textarea"
            spellCheck={false}
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder='示例：{"accessToken":"...","refreshToken":"...","idToken":"..."}'
          />
        </section>

        <aside className="session-json-panel">
          <div className="session-json-panel-head">
            <div>
              <div className="session-json-panel-title">转换设置</div>
              <div className="session-json-panel-note">用于生成 sub2api DataPayload</div>
            </div>
          </div>
          <div className="session-json-settings">
            <label>
              <span>账号名前缀</span>
              <input value={settings.namePrefix} onChange={(event) => setSettings({ ...settings, namePrefix: event.target.value })} />
            </label>
            <label>
              <span>并发数</span>
              <input type="number" min="0" step="1" value={settings.concurrency} onChange={(event) => setSettings({ ...settings, concurrency: event.target.value })} />
            </label>
            <label>
              <span>优先级</span>
              <input type="number" min="0" step="1" value={settings.priority} onChange={(event) => setSettings({ ...settings, priority: event.target.value })} />
            </label>
            <label>
              <span>账号计费倍率</span>
              <input type="number" min="0" step="0.0001" value={settings.rateMultiplier} onChange={(event) => setSettings({ ...settings, rateMultiplier: event.target.value })} />
            </label>
            <label className="session-json-check"><input type="checkbox" checked={settings.dedupe} onChange={(event) => setSettings({ ...settings, dedupe: event.target.checked })} />按邮箱、账号 ID、token 指纹去重</label>
            <label className="session-json-check"><input type="checkbox" checked={settings.includeTypeVersion} onChange={(event) => setSettings({ ...settings, includeTypeVersion: event.target.checked })} />输出 type/version 标记</label>
            <label className="session-json-check"><input type="checkbox" checked={settings.pretty} onChange={(event) => setSettings({ ...settings, pretty: event.target.checked })} />格式化 JSON</label>
            <label className="session-json-check"><input type="checkbox" checked={autoConvert} onChange={(event) => setAutoConvert(event.target.checked)} />输入变化后自动转换</label>
            <button type="button" className="session-json-btn session-json-btn-primary" onClick={runConvert}>转换</button>
          </div>
          <div className="session-json-summary">
            <div className="session-json-pill-row">
              <span>输入 {summary.sourceTotal}</span>
              <span>账号 {summary.accounts.length}</span>
              <span>提示 {summary.messages.length}</span>
            </div>
            <div className="session-json-account-list">
              {summary.accounts.map((item) => {
                const c = item.account.credentials;
                const meta = [c.email, c.plan_type, c.expires_at ? `过期 ${c.expires_at}` : ''].filter(Boolean).join(' · ');
                return (
                  <div className="session-json-account" key={`${item.index}-${item.identity}`}>
                    <strong>{item.account.name}</strong>
                    <span>{meta || '未识别邮箱/套餐/过期时间'}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="session-json-messages">
            {messagePreview.map((message, index) => (
              <div className="session-json-msg" key={`${index}-${message}`}>{message}</div>
            ))}
          </div>
        </aside>

        <section className="session-json-panel">
          <div className="session-json-panel-head">
            <div>
              <div className="session-json-panel-title">转换结果</div>
              <div className="session-json-panel-note">在 sub2api 管理后台账号导入处选择此 JSON</div>
            </div>
            <div className="session-json-actions">
              <button type="button" className="session-json-btn" disabled={!output} onClick={() => void copyText(output, '已复制结果')}>
                <Clipboard size={15} />
                复制
              </button>
              <button type="button" className="session-json-btn" disabled={!output} onClick={downloadOutput}>
                <Download size={15} />
                下载 JSON
              </button>
            </div>
          </div>
          <textarea className="session-json-textarea" spellCheck={false} readOnly value={output} />
        </section>
      </section>
    </main>
  );
}
