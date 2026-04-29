import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export type TokenUsage = {
  input: number;
  output: number;
  totalCostUsd: number;
};

const projectRoot = resolve(import.meta.dirname, '..', '..');

/**
 * Claude Agent SDK が `optionalDependencies` で同梱する claude バイナリを探す。
 * 見つからなければ PATH 上の `claude` にフォールバックする（ユーザーが Claude Code CLI を別途インストール済みの場合）。
 */
function findClaudeBinary(): string {
  const candidates = [
    'node_modules/@anthropic-ai/claude-agent-sdk-darwin-arm64/claude',
    'node_modules/@anthropic-ai/claude-agent-sdk-darwin-x64/claude',
    'node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude',
    'node_modules/@anthropic-ai/claude-agent-sdk-linux-arm64/claude',
  ].map((p) => resolve(projectRoot, p));

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'claude';
}

/**
 * Claude Code CLI を `-p`（print）モードで直接 spawn して呼び出す。
 *
 * Agent SDK の `query()` は stream-json モードでバイナリを動かすが、本ユースケース
 * （ツール無し・1ターンで JSON を返すだけ）では空のステータス待ちでハングしやすい
 * ため、より素直な print モード呼び出しに変更している。
 *
 * 認証は claude CLI 側に委ねる:
 *   - ANTHROPIC_API_KEY が未設定 → サブスクリプションログイン情報を使用
 *   - 設定済み → API キー課金で実行
 *
 * `--setting-sources ""` で CLAUDE.md / プロジェクト設定の読み込みを停止する。
 * `--allowedTools ""` でツールを完全に無効化する。
 * `--output-format json` で 1 通のエンベロープ JSON が返ってくる。
 * `--bare` は使わない（OAuth・キーチェーン読み込みが無効になりサブスクリプション認証が通らないため）。
 */
export async function callViaAgentSdk(args: {
  system: string;
  user: string;
  model: string;
}): Promise<{ text: string; usage: TokenUsage }> {
  const claudeBin = findClaudeBinary();

  return new Promise<{ text: string; usage: TokenUsage }>((resolveOuter, rejectOuter) => {
    const child = spawn(
      claudeBin,
      [
        '-p',
        '--system-prompt',
        args.system,
        '--model',
        args.model,
        '--output-format',
        'json',
        '--input-format',
        'text',
        '--allowedTools',
        '',
        '--setting-sources',
        '',
        '--no-session-persistence',
      ],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      },
    );

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (err) => {
      rejectOuter(new Error(`claude バイナリの起動に失敗しました (${claudeBin}): ${err.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        rejectOuter(
          new Error(
            `claude バイナリが exit ${code} で終了しました。stderr:\n${stderr.slice(0, 2000)}`,
          ),
        );
        return;
      }

      const envelope = parseEnvelope(stdout);
      if (!envelope) {
        rejectOuter(
          new Error(
            `claude の出力 JSON をパースできませんでした。生stdout先頭1000文字:\n${stdout.slice(0, 1000)}`,
          ),
        );
        return;
      }

      const text = typeof envelope.result === 'string' ? envelope.result : '';
      if (!text) {
        rejectOuter(
          new Error(
            `claude のエンベロープに result が含まれていませんでした:\n${JSON.stringify(envelope).slice(0, 1000)}`,
          ),
        );
        return;
      }

      const usage: TokenUsage = {
        input: Number(envelope.usage?.input_tokens ?? 0),
        output: Number(envelope.usage?.output_tokens ?? 0),
        totalCostUsd: Number(envelope.total_cost_usd ?? 0),
      };

      resolveOuter({ text, usage });
    });

    child.stdin.write(args.user, 'utf8');
    child.stdin.end();
  });
}

type Envelope = {
  type?: string;
  subtype?: string;
  result?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
};

function parseEnvelope(raw: string): Envelope | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as Envelope;
  } catch {
    // 念のため、複数JSONや末尾改行などを考慮して最後の '{' から最後の '}' までを試す
    const start = trimmed.indexOf('{');
    const end = trimmed.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(trimmed.slice(start, end + 1)) as Envelope;
      } catch {
        return null;
      }
    }
    return null;
  }
}
