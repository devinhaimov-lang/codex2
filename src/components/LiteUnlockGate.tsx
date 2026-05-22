import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, LockKeyhole, RefreshCw } from "lucide-react";
import codexLiteQrCode from "../assets/codex-lite-qrcode.png";
import { CodexIcon } from "./icons/CodexIcon";

type LiteUnlockChallenge = {
  machineCode: string;
};

type LiteUnlockGateProps = {
  children: ReactNode;
};

type SavedUnlockCode = {
  machineCode: string;
  code: string;
};

const UNLOCK_CODE_KEY = "codex-lite.unlock.saved-code.v1";

function readSavedUnlockCode(): SavedUnlockCode | null {
  try {
    const raw = localStorage.getItem(UNLOCK_CODE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SavedUnlockCode>;
    if (!parsed.machineCode || !parsed.code) return null;
    return { machineCode: parsed.machineCode, code: parsed.code };
  } catch {
    return null;
  }
}

function saveUnlockCode(machineCode: string, code: string) {
  try {
    localStorage.setItem(UNLOCK_CODE_KEY, JSON.stringify({ machineCode, code }));
  } catch {}
}

export function LiteUnlockGate({ children }: LiteUnlockGateProps) {
  const [unlocked, setUnlocked] = useState(false);
  const [machineCode, setMachineCode] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const normalizedCode = useMemo(() => code.trim().toUpperCase(), [code]);

  const loadChallenge = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const challenge = await invoke<LiteUnlockChallenge>("get_lite_unlock_challenge");
      const saved = readSavedUnlockCode();
      setMachineCode(challenge.machineCode);
      setCode(saved?.machineCode === challenge.machineCode ? saved.code : "");
    } catch (err) {
      setError(`读取机器码失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChallenge();
  }, [loadChallenge]);

  const handleCopyMachineCode = useCallback(async () => {
    if (!machineCode) return;
    try {
      await navigator.clipboard.writeText(machineCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {}
  }, [machineCode]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!normalizedCode || submitting) return;
    setSubmitting(true);
    setError("");
    try {
      const ok = await invoke<boolean>("verify_lite_unlock_code", { code: normalizedCode });
      if (!ok) {
        setError("验证码不正确");
        return;
      }
      saveUnlockCode(machineCode, normalizedCode);
      setUnlocked(true);
    } catch (err) {
      setError(`验证失败：${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  };

  if (unlocked) return <>{children}</>;

  return (
    <div className="lite-unlock-screen">
      <form className="lite-unlock-panel" onSubmit={handleSubmit}>
        <div className="lite-unlock-brand">
          <CodexIcon size={32} />
          <div>
            <h1>Codex Lite</h1>
            <p>请输入验证码后继续</p>
          </div>
        </div>

        <div className="lite-unlock-notice">
          <div className="lite-unlock-notice-text">
            <strong>关注“小怪不懂经典”公众号</strong>
            <span>发送机器码获取验证码</span>
          </div>
          <img className="lite-unlock-qr" src={codexLiteQrCode} alt="小怪不懂经典公众号二维码" />
        </div>

        <div className="lite-unlock-field">
          <label>机器码</label>
          <div className="lite-unlock-copy-row">
            <input value={loading ? "正在生成..." : machineCode} readOnly />
            <button
              type="button"
              className="lite-unlock-icon-btn"
              onClick={() => void handleCopyMachineCode()}
              disabled={!machineCode || loading}
              title={copied ? "已复制" : "复制机器码"}
              aria-label={copied ? "已复制" : "复制机器码"}
            >
              {copied ? <Check size={16} /> : <Copy size={16} />}
            </button>
          </div>
        </div>

        <div className="lite-unlock-field">
          <label>验证码</label>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="输入解码器生成的验证码"
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        {error && <div className="lite-unlock-error">{error}</div>}

        <button
          type="submit"
          className="lite-unlock-submit"
          disabled={loading || submitting || !normalizedCode || !machineCode}
        >
          {submitting ? <RefreshCw size={16} className="loading-spinner" /> : <LockKeyhole size={16} />}
          进入
        </button>
      </form>
    </div>
  );
}
