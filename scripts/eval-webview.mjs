/**
 * 在真机 WebView 里执行一段 JS 并打印结果，用于排查原生/前端交互问题。
 *
 * 用法：
 *   adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   node scripts/eval-webview.mjs "JSON.stringify(window.Capacitor.getPlatform())"
 */
import { readFileSync } from 'node:fs';

const port = process.env.PORT ?? '9222';
const args = process.argv.slice(2);
const fileFlag = args.indexOf('--file');
const expression = fileFlag >= 0 ? readFileSync(args[fileFlag + 1], 'utf8') : args[0];

if (!expression) {
  console.error('用法：node scripts/eval-webview.mjs "<js 表达式>" 或 --file <路径>');
  process.exit(1);
}

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = targets.find((entry) => entry.type === 'page');
if (!target) {
  console.error('没有找到可调试的页面，先确认 adb forward 与 WebView 调试已开启');
  process.exit(1);
}

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.onopen = resolve;
  socket.onerror = () => reject(new Error('无法连接 WebView 调试通道'));
});

const response = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('执行超时')), 90000);
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.id === 1) {
      clearTimeout(timer);
      resolve(message);
    }
  };
  socket.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression, awaitPromise: true, returnByValue: true },
    }),
  );
});

socket.close();

const result = response.result ?? {};
if (result.exceptionDetails) {
  console.error('异常：', JSON.stringify(result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(typeof result.result?.value === 'string' ? result.result.value : JSON.stringify(result.result?.value, null, 2));
