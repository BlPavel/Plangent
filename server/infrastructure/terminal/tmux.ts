import { exec, execSync } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class TmuxManager {
  constructor(private sessionName: string) {}

  async create(): Promise<void> {
    try {
      // Kill existing session with same name if any
      await execAsync(`tmux kill-session -t "${this.sessionName}" 2>/dev/null || true`);
    } catch {}
    await execAsync(`tmux new-session -d -s "${this.sessionName}"`);
  }

  async sendKeys(keys: string, enter = true): Promise<void> {
    const escaped = keys.replace(/"/g, '\\"');
    const suffix = enter ? ' Enter' : '';
    await execAsync(`tmux send-keys -t "${this.sessionName}" "${escaped}"${suffix}`);
  }

  async sendInput(text: string): Promise<void> {
    // For raw input without Enter
    await this.sendKeys(text, false);
    await execAsync(`tmux send-keys -t "${this.sessionName}" "" Enter`);
  }

  async capturePane(lines = 1000): Promise<string> {
    const { stdout } = await execAsync(
      `tmux capture-pane -t "${this.sessionName}" -p -S -${lines}`
    );
    return stdout;
  }

  async kill(): Promise<void> {
    try {
      await execAsync(`tmux kill-session -t "${this.sessionName}"`);
    } catch {}
  }

  async exists(): Promise<boolean> {
    try {
      await execAsync(`tmux has-session -t "${this.sessionName}"`);
      return true;
    } catch {
      return false;
    }
  }

  static listSessions(): string[] {
    try {
      const out = execSync('tmux list-sessions -F "#{session_name}" 2>/dev/null').toString();
      return out.trim().split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }

  static isTmuxAvailable(): boolean {
    try {
      execSync('which tmux', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
}
