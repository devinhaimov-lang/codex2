import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Download, Loader2 } from 'lucide-react';

type ToolId = 'codex' | 'claude' | 'kiro';

interface ToolDef {
  id: ToolId;
  name: string;
  desc: string;
}

const TOOLS: ToolDef[] = [
  { id: 'codex', name: 'Codex CLI', desc: 'npm install -g @openai/codex' },
  { id: 'claude', name: 'Claude Code', desc: 'npm install -g @anthropic-ai/claude-code' },
  { id: 'kiro', name: 'Kiro CLI', desc: 'curl -fsSL https://cli.kiro.dev/install | bash' },
];

export function InstallToolsPage() {
  const [busy, setBusy] = useState<ToolId | null>(null);
  const [status, setStatus] = useState<{ tool: ToolId; ok: boolean; msg: string } | null>(null);

  const handleInstall = async (tool: ToolId) => {
    setBusy(tool);
    setStatus(null);
    try {
      const msg = await invoke<string>('install_cli_tool', { tool });
      setStatus({ tool, ok: true, msg });
    } catch (error) {
      setStatus({ tool, ok: false, msg: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="lite-embedded-page">
      <header className="lite-embedded-toolbar">
        <div className="lite-embedded-toolbar-copy">
          <strong>一键安装 CLI 工具</strong>
          <span>点击下方按钮，将在终端中自动执行官方安装命令。安装需要本机已具备 Node.js / npm（Codex、Claude Code）或 curl（Kiro）。</span>
        </div>
      </header>

      <div className="lite-install-grid">
        {TOOLS.map((tool) => (
          <div key={tool.id} className="lite-install-card">
            <div className="lite-install-card-info">
              <strong>{tool.name}</strong>
              <code>{tool.desc}</code>
            </div>
            <button
              type="button"
              className="lite-toolbar-btn"
              disabled={busy !== null}
              onClick={() => void handleInstall(tool.id)}
            >
              {busy === tool.id ? <Loader2 size={16} className="lite-spin" /> : <Download size={16} />}
              <span>{busy === tool.id ? '安装中…' : '安装'}</span>
            </button>
          </div>
        ))}
      </div>

      {status && (
        <div className={`lite-install-status ${status.ok ? 'ok' : 'error'}`}>{status.msg}</div>
      )}
    </section>
  );
}
