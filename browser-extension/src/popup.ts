import { i18n, isRecord } from './core.js';
import { UiStatus } from './storage.js';

interface PopupState {
  ok: true;
  account: { accountName: string } | null;
  status: UiStatus;
  activePrint: boolean;
}

const account = document.querySelector<HTMLElement>('#account-name')!;
const connect = document.querySelector<HTMLButtonElement>('#connect')!;
const disconnect = document.querySelector<HTMLButtonElement>('#disconnect')!;
const inbox = document.querySelector<HTMLButtonElement>('#open-inbox')!;
const status = document.querySelector<HTMLElement>('#status')!;
const controls = [connect, disconnect, inbox];

function localize(): void {
  document.documentElement.lang = chrome.i18n.getUILanguage();
  document.documentElement.dir = ['ar', 'fa', 'he', 'ur'].some((code) =>
    document.documentElement.lang.toLowerCase().startsWith(code),
  )
    ? 'rtl'
    : 'ltr';
  document.title = i18n('extensionName');
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((element) => {
    element.textContent = i18n(element.dataset['i18n']!);
  });
}

async function command(name: string): Promise<PopupState> {
  const response: unknown = await chrome.runtime.sendMessage({ command: name });
  if (!isRecord(response) || response['ok'] !== true) {
    throw new Error(isRecord(response) ? String(response['errorCode']) : 'NO_RESPONSE');
  }
  return response as unknown as PopupState;
}

function render(state: PopupState): void {
  const connected = Boolean(state.account);
  account.textContent = state.account?.accountName ?? i18n('notConnected');
  account.closest<HTMLElement>('.account')!.hidden = !connected;
  connect.hidden = connected;
  disconnect.hidden = !connected;
  inbox.hidden = !connected;
  status.textContent = i18n(connected ? state.status.messageKey : 'statusConnectFirst');
  status.dataset['kind'] = state.status.kind;
}

async function run(name: string): Promise<void> {
  controls.forEach((button) => (button.disabled = true));
  status.textContent = i18n(name === 'connect' ? 'statusConnecting' : 'statusWorking');
  try {
    render(await command(name));
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    status.textContent = i18n(
      code === 'OAUTH_CANCELLED' ? 'statusConnectCancelled' : 'statusActionFailed',
    );
    status.dataset['kind'] = 'error';
  } finally {
    controls.forEach((button) => (button.disabled = false));
  }
}

connect.addEventListener('click', () => void run('connect'));
disconnect.addEventListener('click', () => void run('disconnect'));
inbox.addEventListener('click', () => void run('openInbox'));
chrome.storage.onChanged.addListener(() => void command('getState').then(render));

localize();
void run('reconcileState');
