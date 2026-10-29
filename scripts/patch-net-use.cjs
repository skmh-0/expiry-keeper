/**
 * Vite 启动前置补丁（通过 node --require 加载）。
 *
 * Windows 上 Vite 会执行 `net use` 探测映射网络盘，受限环境里 spawn 被拒绝并直接
 * 中断配置加载。这里把该探测替换为「没有映射盘」的等价结果，与 Vite 原本的失败
 * 回落分支一致，其余行为不变。
 *
 * 注意：必须用 CJS require 取到真实模块对象再改写。若先用 ESM import 建立
 * node:child_process 的命名空间，快照会固定住原始 exec，改写不再生效。
 */
const cp = require('node:child_process');

const originalExec = cp.exec;

function patchedExec(command, options, callback) {
  const done = typeof options === 'function' ? options : callback;
  if (typeof command === 'string' && /^net\s+use\b/i.test(command.trim())) {
    if (typeof done === 'function') {
      queueMicrotask(() => done(new Error('net use probe skipped'), '', ''));
    }
    return { on() {}, once() {}, kill() {}, unref() {}, removeListener() {} };
  }
  return originalExec.call(cp, command, options, callback);
}

patchedExec[Symbol.for('nodejs.util.promisify.custom')] =
  originalExec[Symbol.for('nodejs.util.promisify.custom')];

cp.exec = patchedExec;
