/**
 * providers/python-bridge.ts — TypeScript ⇄ Python 子进程通信桥梁
 *
 * Day 1 T1.6: Python Bridge 基础设施。
 * 所有 Python 连接器通过此桥梁调用。
 */
import { spawn } from 'child_process';
import { createLogger } from '@synova/logger';
import * as crypto from 'crypto';
import { buildSubprocessEnv } from '../security/subprocess-env';

const log = createLogger('providers/python-bridge');

export class PythonBridge {
  private pythonPath: string;

  constructor(pythonPath = 'python3') {
    this.pythonPath = pythonPath;
  }

  async run<T = Record<string, unknown>>(module: string, command: string, params: unknown): Promise<T> {
    return new Promise((resolve, reject) => {
      // 确保 synova_worker 在 PYTHONPATH 中
      // #1209：不再全量继承父进程 env（原实现把父进程 env 全量继承 ⇒ JWT_SECRET 等机密会交给子进程）。
      // Python 侧真正需要的就是下面两个键 —— 其余按白名单透传，见 src/security/subprocess-env.ts。
      const pythonEnv = buildSubprocessEnv({
        parent: process.env,
        declared: {
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: `${process.cwd()};${process.env.PYTHONPATH || ''}`,
        },
      });
      // 始终运行 synova_worker 主模块 (__main__.py 负责 JSON 路由)
      // module + command 通过 JSON body 传递
      const fullCommand = module ? `${module}:${command}` : command;
      const proc = spawn(this.pythonPath, ['-m', 'synova_worker'], {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
        env: pythonEnv,
      });

      const requestId = crypto.randomUUID();
      const input = JSON.stringify({ command: fullCommand, params, requestId });
      let output = '';
      let errorOutput = '';

      proc.stdin.write(input + '\n');
      proc.stdin.end();

      proc.stdout.on('data', (chunk: Buffer) => { output += chunk.toString(); });
      proc.stderr.on('data', (chunk: Buffer) => { errorOutput += chunk.toString(); });

      proc.on('close', (code) => {
        if (code !== 0) {
          log.warn({ code, stderr: errorOutput.slice(0, 200) }, 'Python 进程异常退出');
          reject(new Error(`Python 进程退出码 ${code}: ${errorOutput.slice(0, 200)}`));
          return;
        }
        try {
          const result = JSON.parse(output);
          if (!result.success) {
            reject(new Error(result.error?.message || 'Python 进程返回错误'));
          } else {
            resolve(result.result as T);
          }
        } catch (err: any) {
          log.warn({ output: output.slice(0, 200) }, 'Python 输出 JSON 解析失败');
          reject(new Error(`Python JSON 解析失败: ${err.message}`));
        }
      });

      proc.on('error', (err) => {
        log.warn({ err }, 'Python 进程启动失败');
        reject(new Error(`Python 进程不可用 (${this.pythonPath}): ${err.message}`));
      });
    });
  }

  /** Health check — can Python be called? */
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.run<{ status: string }>('', 'ping', {});
      return result.status === 'ok';
    } catch (err: any) {
      log.debug({ err: err.message }, 'Python bridge health check failed');
      return false;
    }
  }
}

// Singleton
let _bridge: PythonBridge | null = null;
export function getPythonBridge(inject?: PythonBridge): PythonBridge {
  if (inject) { _bridge = inject; return inject; }
  if (!_bridge) _bridge = new PythonBridge();
  return _bridge;
}
