import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Check, Copy, LockKeyhole, RefreshCw } from 'lucide-react';
import { CodexIcon } from './icons/CodexIcon';

type LiteUnlockChallenge = {
  machineCode: string;
};

type LiteUnlockGateProps = {
  children: ReactNode;
};

const UNLOCK_SESSION_KEY = 'codex-lite.unlock.accepted.v1';

export function LiteUnlockGate({ children }: LiteUnlockGateProps) {
  const [unlocked, setUnlocked] = useState(() => sessionStorage.getItem(UNLOCK_SESSION_KEY) === '1');
  const [machineCode, setMachineCode] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(!unlocked);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const normalizedCode = useMemo(() => code.trim().toUpperCase(), [code]);

  const loadChallenge = useCallback(async () => {
    if (unlocked) return;
    setLoading(true);
    setError('');
    try {
      const challenge = await invoke<LiteUnlockChallenge>('get_lite_unlock_challenge');
      setMachineCode(challenge.machineCode);
    } catch (err) {
      setError(`读取机器码失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [unlocked]);

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
    setError('');
    try {
      const ok = await invoke<boolean>('verify_lite_unlock_code', { code: normalizedCode });
      if (!ok) {
        setError('验证码不正确');
        return;
      }
      sessionStorage.setItem(UNLOCK_SESSION_KEY, '1');
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

        <div className="lite-unlock-field">
          <label>机器码</label>
          <div className="lite-unlock-copy-row">
            <input value={loading ? '正在生成...' : machineCode} readOnly />
            <button
              type="button"
              className="lite-unlock-icon-btn"
              onClick={() => void handleCopyMachineCode()}
              disabled={!machineCode || loading}
              title={copied ? '已复制' : '复制机器码'}
              aria-label={copied ? '已复制' : '复制机器码'}
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
          disabled={loading || submitting || !normalizedCode}
        >
          {submitting ? <RefreshCw size={16} className="loading-spinner" /> : <LockKeyhole size={16} />}
          进入
        </button>
      </form>
    </div>
  );
}
