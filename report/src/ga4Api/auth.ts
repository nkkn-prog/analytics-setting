import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { platform } from 'node:os';
import { dirname, resolve } from 'node:path';
import { OAuth2Client, type Credentials } from 'google-auth-library';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const TOKEN_PATH = resolve(projectRoot, '.cache', 'ga4-token.json');
const SCOPES = ['https://www.googleapis.com/auth/analytics.readonly'];

function readStoredToken(): Credentials | null {
  if (!existsSync(TOKEN_PATH)) return null;
  try {
    return JSON.parse(readFileSync(TOKEN_PATH, 'utf8')) as Credentials;
  } catch {
    return null;
  }
}

function writeStoredToken(token: Credentials): void {
  mkdirSync(dirname(TOKEN_PATH), { recursive: true });
  writeFileSync(TOKEN_PATH, JSON.stringify(token, null, 2), 'utf8');
}

function buildOAuthClient(redirectUri: string): OAuth2Client {
  // GA4_OAUTH_* を優先し、無ければ親プロジェクト互換の GOOGLE_CLIENT_* にフォールバック
  const clientId =
    process.env.GA4_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const clientSecret =
    process.env.GA4_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      'GA4 Data API を使うには .env に GA4_OAUTH_CLIENT_ID / GA4_OAUTH_CLIENT_SECRET\n' +
        '（または互換の GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET）を設定してください。\n' +
        'GCP Console → API とサービス → 認証情報 → OAuth クライアント ID（タイプ: デスクトップアプリ）で発行できます。',
    );
  }
  return new OAuth2Client({ clientId, clientSecret, redirectUri });
}

async function openInBrowser(url: string): Promise<void> {
  const p = platform();
  const cmd =
    p === 'darwin'
      ? 'open'
      : p === 'win32'
        ? 'start ""'
        : 'xdg-open';
  await new Promise<void>((res) => {
    exec(`${cmd} "${url}"`, () => res());
  });
}

/**
 * 対話的 OAuth フロー: ローカル loopback サーバを起動し、ブラウザを開いて
 * Google ログインに誘導し、コールバックで code → tokens を交換する。
 * 成功すると tokens を .cache/ga4-token.json に保存する。
 */
export async function loginInteractive(): Promise<Credentials> {
  const server = createServer();
  await new Promise<void>((res, rej) => {
    server.once('error', rej);
    server.listen(0, '127.0.0.1', () => res());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    server.close();
    throw new Error('ローカルOAuthサーバの起動に失敗しました');
  }
  const port = addr.port;
  const redirectUri = `http://localhost:${port}/oauth-callback`;
  const oauthClient = buildOAuthClient(redirectUri);

  const authUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent',
  });

  console.log('\n[GA4 OAuth] ブラウザで以下のURLを開いてログインしてください:');
  console.log('  ' + authUrl + '\n');
  await openInBrowser(authUrl).catch(() => {
    console.log('(ブラウザの自動オープンに失敗しました。上記URLを手動で開いてください)');
  });

  return new Promise<Credentials>((resolveOuter, rejectOuter) => {
    const timer = setTimeout(() => {
      server.close();
      rejectOuter(new Error('OAuth 認証がタイムアウトしました（5分）。再実行してください。'));
    }, 5 * 60 * 1000);

    server.on('request', async (req, res) => {
      const reqUrl = new URL(req.url ?? '/', `http://localhost:${port}`);
      if (reqUrl.pathname !== '/oauth-callback') {
        res.writeHead(404);
        res.end();
        return;
      }
      const code = reqUrl.searchParams.get('code');
      const error = reqUrl.searchParams.get('error');
      if (error) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`認証エラー: ${error}`);
        clearTimeout(timer);
        server.close();
        rejectOuter(new Error(`認証エラー: ${error}`));
        return;
      }
      if (!code) {
        res.writeHead(400);
        res.end('code がありません');
        clearTimeout(timer);
        server.close();
        rejectOuter(new Error('OAuth コールバックに code が含まれていません'));
        return;
      }
      try {
        const { tokens } = await oauthClient.getToken(code);
        writeStoredToken(tokens);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(
          '<html><body style="font-family:sans-serif;text-align:center;padding-top:60px;"><h2>認証完了 ✓</h2><p>このタブを閉じてターミナルに戻ってください。</p></body></html>',
        );
        clearTimeout(timer);
        server.close();
        resolveOuter(tokens);
      } catch (e) {
        res.writeHead(500);
        res.end((e as Error).message);
        clearTimeout(timer);
        server.close();
        rejectOuter(e);
      }
    });
  });
}

/**
 * GA4 Data API 呼び出し用のアクセストークンを取得する。
 * 保存済みトークンがあれば必要に応じてリフレッシュし、無ければ対話的ログインを起動する。
 */
export async function getAccessToken(): Promise<string> {
  let stored = readStoredToken();
  if (!stored?.refresh_token) {
    console.log('[GA4 OAuth] 保存済みトークンが見つからないため、ログインを開始します。');
    stored = await loginInteractive();
  }

  const oauthClient = buildOAuthClient('http://localhost/unused');
  oauthClient.setCredentials(stored);
  oauthClient.on('tokens', (newTokens) => {
    const merged: Credentials = { ...readStoredToken(), ...newTokens };
    writeStoredToken(merged);
  });

  const { token } = await oauthClient.getAccessToken();
  if (!token) {
    throw new Error('アクセストークンの取得に失敗しました');
  }
  return token;
}
