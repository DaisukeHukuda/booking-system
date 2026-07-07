import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { passwordMatches, signSession, verifySession } from '../auth/session';
import type { Bindings } from '../types';
import { calendar } from './admin/calendar';
import { plans } from './admin/plans';

const COOKIE_NAME = 'admin_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30日

const LoginPage = (props: { error: string | null }) => (
  <html lang="ja">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>管理者ログイン</title>
    </head>
    <body>
      <h1>管理者ログイン</h1>
      {props.error && <p style="color: red">{props.error}</p>}
      <form method="post" action="/admin/login">
        <label>
          パスワード: <input type="password" name="password" required />
        </label>
        <button type="submit">ログイン</button>
      </form>
    </body>
  </html>
);

export const admin = new Hono<{ Bindings: Bindings }>();

// ログイン画面・処理は認証ミドルウェアより先に登録する（未ログインで到達可能にするため）
admin.get('/login', (c) => c.html(<LoginPage error={null} />));

admin.post('/login', async (c) => {
  const form = await c.req.parseBody();
  const password = typeof form.password === 'string' ? form.password : '';
  if (!(await passwordMatches(c.env.SESSION_SECRET, password, c.env.ADMIN_PASSWORD))) {
    return c.html(<LoginPage error="パスワードが違います" />, 401);
  }
  const token = await signSession(c.env.SESSION_SECRET, Date.now() + SESSION_TTL_MS);
  setCookie(c, COOKIE_NAME, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000
  });
  return c.redirect('/admin');
});

admin.post('/logout', (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  return c.redirect('/admin/login');
});

// これ以降に登録するルートはすべて認証必須
admin.use('*', async (c, next) => {
  if (!(await verifySession(c.env.SESSION_SECRET, getCookie(c, COOKIE_NAME)))) {
    return c.redirect('/admin/login');
  }
  await next();
});

// 注意: /plans や /settings のルータはこの行より前にマウントすること
admin.route('/plans', plans);
admin.route('/', calendar);
