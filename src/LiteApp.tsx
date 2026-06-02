import { Suspense, lazy, useEffect, useState } from 'react';
import './App.css';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { ChevronDown, Download, MessageSquare, RefreshCw } from 'lucide-react';
import { GlobalModal } from './components/GlobalModal';
import { LiteUnlockGate } from './components/LiteUnlockGate';
import { CodexIcon } from './components/icons/CodexIcon';
import { changeLanguage, getCurrentLanguage, normalizeLanguage, supportedLanguages } from './i18n';

const languageLabels: Record<string, string> = {
  en: 'English',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  ja: '日本語',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  'pt-br': 'Português',
  ru: 'Русский',
  ko: '한국어',
  it: 'Italiano',
  tr: 'Türkçe',
  pl: 'Polski',
  cs: 'Čeština',
  vi: 'Tiếng Việt',
  ar: 'العربية',
  id: 'Bahasa Indonesia',
};

type GeneralConfig = Record<string, any>;
type LiteNavTab = 'accounts' | 'chat' | 'install';
type LiteAccountPlatform = 'codex' | 'kiro';

type CodexLiteExportRequest = {
  type: 'codex-lite-export-chat';
  payload?: string;
  fileName?: string;
};

type CodexLiteExportResult = {
  type: 'codex-lite-export-chat-result';
  status: 'success' | 'cancelled' | 'error';
  message?: string;
  path?: string;
};

type CodexLiteSaveImageRequest = {
  type: 'codex-lite-save-image';
  payload?: string;
  fileName?: string;
  mimeType?: string;
};

type CodexLiteSaveImageResult = {
  type: 'codex-lite-save-image-result';
  status: 'success' | 'cancelled' | 'error';
  message?: string;
  path?: string;
};

type CodexLitePersistChatSaveRequest = {
  type: 'codex-lite-persist-chat-save';
  payload?: string;
};

type CodexLitePersistChatLoadRequest = {
  type: 'codex-lite-persist-chat-load';
};

type CodexLitePersistChatLoadResult = {
  type: 'codex-lite-persist-chat-load-result';
  status: 'success' | 'error';
  payload?: string;
  message?: string;
};

const LITE_SELECTED_TAB_KEY = 'codex-lite.selected-tab';
const LITE_SELECTED_ACCOUNT_PLATFORM_KEY = 'codex-lite.selected-account-platform';
const CODEX_CHAT_URL = 'http://127.0.0.1:3510/';

function buildSaveGeneralConfigArgs(config: GeneralConfig, language: string) {
  return {
    language,
    defaultTerminal: config.default_terminal ?? 'system',
    theme: config.theme ?? 'system',
    uiScale: config.ui_scale ?? 1,
    autoRefreshMinutes: config.auto_refresh_minutes ?? 10,
    codexAutoRefreshMinutes: config.codex_auto_refresh_minutes ?? 10,
    ghcpAutoRefreshMinutes: config.ghcp_auto_refresh_minutes ?? 10,
    windsurfAutoRefreshMinutes: config.windsurf_auto_refresh_minutes ?? 10,
    kiroAutoRefreshMinutes: config.kiro_auto_refresh_minutes ?? 10,
    cursorAutoRefreshMinutes: config.cursor_auto_refresh_minutes ?? 10,
    geminiAutoRefreshMinutes: config.gemini_auto_refresh_minutes ?? 10,
    geminiSyncWsl: config.gemini_sync_wsl ?? true,
    codebuddyAutoRefreshMinutes: config.codebuddy_auto_refresh_minutes ?? 10,
    codebuddyCnAutoRefreshMinutes: config.codebuddy_cn_auto_refresh_minutes ?? 10,
    workbuddyAutoRefreshMinutes: config.workbuddy_auto_refresh_minutes ?? 10,
    qoderAutoRefreshMinutes: config.qoder_auto_refresh_minutes ?? 10,
    traeAutoRefreshMinutes: config.trae_auto_refresh_minutes ?? 10,
    zedAutoRefreshMinutes: config.zed_auto_refresh_minutes ?? 10,
    closeBehavior: config.close_behavior ?? 'ask',
    minimizeBehavior: config.minimize_behavior,
    hideDockIcon: config.hide_dock_icon,
    trayIconStyle: config.tray_icon_style,
    floatingCardShowOnStartup: config.floating_card_show_on_startup,
    floatingCardAlwaysOnTop: config.floating_card_always_on_top,
    appAutoLaunchEnabled: config.app_auto_launch_enabled,
    antigravityStartupWakeupEnabled: config.antigravity_startup_wakeup_enabled,
    antigravityStartupWakeupDelaySeconds: config.antigravity_startup_wakeup_delay_seconds,
    codexStartupWakeupEnabled: config.codex_startup_wakeup_enabled,
    codexStartupWakeupDelaySeconds: config.codex_startup_wakeup_delay_seconds,
    floatingCardConfirmOnClose: config.floating_card_confirm_on_close,
    opencodeAppPath: config.opencode_app_path ?? '',
    antigravityAppPath: config.antigravity_app_path ?? '',
    codexAppPath: config.codex_app_path ?? '',
    codexSpecifiedAppPath: config.codex_specified_app_path,
    zedAppPath: config.zed_app_path,
    vscodeAppPath: config.vscode_app_path ?? '',
    windsurfAppPath: config.windsurf_app_path,
    kiroAppPath: config.kiro_app_path,
    cursorAppPath: config.cursor_app_path,
    codebuddyAppPath: config.codebuddy_app_path,
    codebuddyCnAppPath: config.codebuddy_cn_app_path,
    qoderAppPath: config.qoder_app_path,
    traeAppPath: config.trae_app_path,
    workbuddyAppPath: config.workbuddy_app_path,
    opencodeSyncOnSwitch: config.opencode_sync_on_switch ?? false,
    opencodeAuthOverwriteOnSwitch: config.opencode_auth_overwrite_on_switch,
    ghcpOpencodeSyncOnSwitch: config.ghcp_opencode_sync_on_switch,
    ghcpOpencodeAuthOverwriteOnSwitch: config.ghcp_opencode_auth_overwrite_on_switch,
    ghcpLaunchOnSwitch: config.ghcp_launch_on_switch,
    openclawAuthOverwriteOnSwitch: config.openclaw_auth_overwrite_on_switch,
    codexLaunchOnSwitch: config.codex_launch_on_switch ?? true,
    codexRestartSpecifiedAppOnSwitch: config.codex_restart_specified_app_on_switch,
    codexLocalAccessEntryVisible: config.codex_local_access_entry_visible,
    antigravityDualSwitchNoRestartEnabled: config.antigravity_dual_switch_no_restart_enabled,
    autoSwitchEnabled: config.auto_switch_enabled,
    autoSwitchThreshold: config.auto_switch_threshold,
    autoSwitchCreditsEnabled: config.auto_switch_credits_enabled,
    autoSwitchCreditsThreshold: config.auto_switch_credits_threshold,
    autoSwitchScopeMode: config.auto_switch_scope_mode,
    autoSwitchSelectedGroupIds: config.auto_switch_selected_group_ids,
    autoSwitchAccountScopeMode: config.auto_switch_account_scope_mode,
    autoSwitchSelectedAccountIds: config.auto_switch_selected_account_ids,
    codexAutoSwitchEnabled: config.codex_auto_switch_enabled,
    codexAutoSwitchPrimaryThreshold: config.codex_auto_switch_primary_threshold,
    codexAutoSwitchSecondaryThreshold: config.codex_auto_switch_secondary_threshold,
    codexAutoSwitchAccountScopeMode: config.codex_auto_switch_account_scope_mode,
    codexAutoSwitchSelectedAccountIds: config.codex_auto_switch_selected_account_ids,
    quotaAlertEnabled: config.quota_alert_enabled,
    quotaAlertThreshold: config.quota_alert_threshold,
    codexQuotaAlertEnabled: config.codex_quota_alert_enabled,
    codexQuotaAlertThreshold: config.codex_quota_alert_threshold,
    zedQuotaAlertEnabled: config.zed_quota_alert_enabled,
    zedQuotaAlertThreshold: config.zed_quota_alert_threshold,
    codexQuotaAlertPrimaryThreshold: config.codex_quota_alert_primary_threshold,
    codexQuotaAlertSecondaryThreshold: config.codex_quota_alert_secondary_threshold,
    ghcpQuotaAlertEnabled: config.ghcp_quota_alert_enabled,
    ghcpQuotaAlertThreshold: config.ghcp_quota_alert_threshold,
    windsurfQuotaAlertEnabled: config.windsurf_quota_alert_enabled,
    windsurfQuotaAlertThreshold: config.windsurf_quota_alert_threshold,
    kiroQuotaAlertEnabled: config.kiro_quota_alert_enabled,
    kiroQuotaAlertThreshold: config.kiro_quota_alert_threshold,
    cursorQuotaAlertEnabled: config.cursor_quota_alert_enabled,
    cursorQuotaAlertThreshold: config.cursor_quota_alert_threshold,
    geminiQuotaAlertEnabled: config.gemini_quota_alert_enabled,
    geminiQuotaAlertThreshold: config.gemini_quota_alert_threshold,
    codebuddyQuotaAlertEnabled: config.codebuddy_quota_alert_enabled,
    codebuddyQuotaAlertThreshold: config.codebuddy_quota_alert_threshold,
    codebuddyCnQuotaAlertEnabled: config.codebuddy_cn_quota_alert_enabled,
    codebuddyCnQuotaAlertThreshold: config.codebuddy_cn_quota_alert_threshold,
    qoderQuotaAlertEnabled: config.qoder_quota_alert_enabled,
    qoderQuotaAlertThreshold: config.qoder_quota_alert_threshold,
    traeQuotaAlertEnabled: config.trae_quota_alert_enabled,
    traeQuotaAlertThreshold: config.trae_quota_alert_threshold,
    workbuddyQuotaAlertEnabled: config.workbuddy_quota_alert_enabled,
    workbuddyQuotaAlertThreshold: config.workbuddy_quota_alert_threshold,
  };
}

async function persistLanguage(language: string) {
  try {
    const config = await invoke<GeneralConfig>('get_general_config');
    await invoke('save_general_config', buildSaveGeneralConfigArgs(config, language));
  } catch (error) {
    console.warn('[LiteApp] Failed to persist language to general config:', error);
  }
}

const CodexAccountsPage = lazy(() =>
  import('./pages/CodexAccountsPage').then((module) => ({ default: module.CodexAccountsPage })),
);
const KiroAccountsPage = lazy(() =>
  import('./pages/KiroAccountsPage').then((module) => ({ default: module.KiroAccountsPage })),
);
const InstallToolsPage = lazy(() =>
  import('./pages/InstallToolsPage').then((module) => ({ default: module.InstallToolsPage })),
);

const suspenseFallback = (
  <div className="loading-container">
    <div className="loading-spinner" />
  </div>
);

export default function LiteApp() {
  const [language, setLanguage] = useState(getCurrentLanguage());
  const [activeTab, setActiveTab] = useState<LiteNavTab>(() => {
    if (typeof window === 'undefined') return 'accounts';
    const saved = localStorage.getItem(LITE_SELECTED_TAB_KEY);
    return saved === 'chat' || saved === 'install' ? saved : 'accounts';
  });
  const [accountPlatform, setAccountPlatform] = useState<LiteAccountPlatform>(() => {
    if (typeof window === 'undefined') return 'codex';
    return localStorage.getItem(LITE_SELECTED_ACCOUNT_PLATFORM_KEY) === 'kiro' ? 'kiro' : 'codex';
  });
  const [chatFrameKey, setChatFrameKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncInitialLanguage = async () => {
      try {
        const config = await invoke<GeneralConfig>('get_general_config');
        const nextLanguage = normalizeLanguage(String(config.language || ''));
        if (!disposed && nextLanguage) {
          await changeLanguage(nextLanguage);
          setLanguage(nextLanguage);
        }
      } catch (error) {
        console.warn('[LiteApp] Failed to load saved language:', error);
      }
    };

    void syncInitialLanguage();

    listen<string>('settings:language_changed', (event) => {
      const nextLanguage = normalizeLanguage(String(event.payload || ''));
      if (!nextLanguage) return;
      void changeLanguage(nextLanguage).then(() => {
        setLanguage(nextLanguage);
        window.dispatchEvent(
          new CustomEvent('general-language-updated', { detail: { language: nextLanguage } }),
        );
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(LITE_SELECTED_TAB_KEY, activeTab);
  }, [activeTab]);

  useEffect(() => {
    localStorage.setItem(LITE_SELECTED_ACCOUNT_PLATFORM_KEY, accountPlatform);
  }, [accountPlatform]);

  useEffect(() => {
    const handleMessage = async (
      event: MessageEvent<
        | CodexLiteExportRequest
        | CodexLiteSaveImageRequest
        | CodexLitePersistChatSaveRequest
        | CodexLitePersistChatLoadRequest
      >,
    ) => {
      const replyTarget = event.source as Window | null;
      const postResult = (
        result: CodexLiteExportResult | CodexLiteSaveImageResult | CodexLitePersistChatLoadResult,
      ) => {
        replyTarget?.postMessage(result, '*');
      };

      try {
        if (event.data?.type === 'codex-lite-persist-chat-save') {
          await invoke('save_codex_lite_chat', {
            content: typeof event.data.payload === 'string' ? event.data.payload : '[]',
          });
          return;
        }

        if (event.data?.type === 'codex-lite-persist-chat-load') {
          const payload = await invoke<string>('load_codex_lite_chat');
          postResult({
            type: 'codex-lite-persist-chat-load-result',
            status: 'success',
            payload,
          });
          return;
        }

        if (event.data?.type === 'codex-lite-save-image') {
          const payload = typeof event.data.payload === 'string' ? event.data.payload : '';
          if (!payload) {
            postResult({
              type: 'codex-lite-save-image-result',
              status: 'error',
              message: '缺少图片内容',
            });
            return;
          }

          const extensions = (() => {
            switch (event.data.mimeType) {
              case 'image/jpeg':
                return ['jpg', 'jpeg'];
              case 'image/webp':
                return ['webp'];
              case 'image/gif':
                return ['gif'];
              default:
                return ['png'];
            }
          })();

          const targetPath = await save({
            defaultPath: event.data.fileName || `codex-lite-image.${extensions[0]}`,
            filters: [{ name: 'Image', extensions }],
          });
          if (!targetPath) {
            postResult({
              type: 'codex-lite-save-image-result',
              status: 'cancelled',
            });
            return;
          }

          await invoke('save_binary_file', {
            path: targetPath,
            base64Content: payload,
          });
          postResult({
            type: 'codex-lite-save-image-result',
            status: 'success',
            path: targetPath,
          });
          return;
        }

        if (event.data?.type !== 'codex-lite-export-chat') return;
        const payload = typeof event.data.payload === 'string' ? event.data.payload : '';
        if (!payload) {
          postResult({
            type: 'codex-lite-export-chat-result',
            status: 'error',
            message: '缺少导出内容',
          });
          return;
        }
        const targetPath = await save({
          defaultPath: event.data.fileName || 'codex-lite-chat.json',
          filters: [{ name: 'JSON', extensions: ['json'] }],
        });
        if (!targetPath) {
          postResult({
            type: 'codex-lite-export-chat-result',
            status: 'cancelled',
          });
          return;
        }
        await invoke('save_text_file', {
          path: targetPath,
          content: payload,
        });
        postResult({
          type: 'codex-lite-export-chat-result',
          status: 'success',
          path: targetPath,
        });
      } catch (error) {
        if (event.data?.type === 'codex-lite-persist-chat-load') {
          postResult({
            type: 'codex-lite-persist-chat-load-result',
            status: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
          return;
        }
        postResult({
          type:
            event.data?.type === 'codex-lite-save-image'
              ? 'codex-lite-save-image-result'
              : 'codex-lite-export-chat-result',
          status: 'error',
          message: error instanceof Error ? error.message : String(error),
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

  const handleLanguageChange = async (value: string) => {
    const nextLanguage = normalizeLanguage(value);
    setLanguage(nextLanguage);
    await changeLanguage(nextLanguage);
    window.dispatchEvent(
      new CustomEvent('general-language-updated', { detail: { language: nextLanguage } }),
    );
    void persistLanguage(nextLanguage);
  };

  return (
    <LiteUnlockGate>
      <div className="lite-app-shell">
        <aside className="lite-sidebar">
          <div className="lite-brand">
            <CodexIcon size={24} />
            <div>
              <div className="lite-brand-title">Codex Lite</div>
              <div className="lite-brand-subtitle">Account Manager</div>
            </div>
          </div>

          <label
            className={`lite-nav-select ${activeTab === 'accounts' ? 'active' : ''}`}
            onClick={() => setActiveTab('accounts')}
          >
            <div className="lite-nav-select-header">
              <div className="lite-nav-select-label">
                <CodexIcon size={18} />
                <span>账号</span>
              </div>
              <span className="lite-nav-select-badge">
                {accountPlatform === 'codex' ? 'Codex' : 'Kiro'}
              </span>
            </div>
            <div className="lite-nav-select-control">
              <select
                value={accountPlatform}
                onChange={(event) => {
                  setActiveTab('accounts');
                  setAccountPlatform(event.target.value as LiteAccountPlatform);
                }}
              >
                <option value="codex">Codex 账号</option>
                <option value="kiro">Kiro 账号</option>
              </select>
              <ChevronDown size={15} className="lite-nav-select-chevron" />
            </div>
          </label>

          <button
            type="button"
            className={`lite-nav-item ${activeTab === 'chat' ? 'active' : ''}`}
            onClick={() => setActiveTab('chat')}
          >
            <MessageSquare size={18} />
            <span>聊天</span>
          </button>

          <button
            type="button"
            className={`lite-nav-item ${activeTab === 'install' ? 'active' : ''}`}
            onClick={() => setActiveTab('install')}
          >
            <Download size={18} />
            <span>安装工具</span>
          </button>

          <label className="lite-language-select">
            <span>Language</span>
            <select value={language} onChange={(e) => void handleLanguageChange(e.target.value)}>
              {supportedLanguages.map((item) => (
                <option key={item} value={item}>
                  {languageLabels[item] || item}
                </option>
              ))}
            </select>
          </label>
        </aside>

        <main className="lite-main">
          {activeTab === 'accounts' ? (
            <Suspense fallback={suspenseFallback}>
              {accountPlatform === 'codex' ? <CodexAccountsPage /> : <KiroAccountsPage />}
            </Suspense>
          ) : activeTab === 'install' ? (
            <Suspense fallback={suspenseFallback}>
              <InstallToolsPage />
            </Suspense>
          ) : (
            <section className="lite-embedded-page">
              <header className="lite-embedded-toolbar">
                <div className="lite-embedded-ad-placeholder" aria-hidden="true" />
                <div className="lite-embedded-toolbar-actions">
                  <button
                    type="button"
                    className="lite-toolbar-btn"
                    onClick={() => setChatFrameKey((value) => value + 1)}
                  >
                    <RefreshCw size={16} />
                    <span>刷新</span>
                  </button>
                </div>
              </header>

              <div className="lite-embedded-frame-shell">
                <iframe
                  key={chatFrameKey}
                  className="lite-embedded-frame"
                  src={CODEX_CHAT_URL}
                  title="Codex Lite Chat"
                />
              </div>
            </section>
          )}
        </main>

        <GlobalModal />
      </div>
    </LiteUnlockGate>
  );
}
