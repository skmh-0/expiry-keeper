import { useCallback, useEffect, useState } from 'react';
import type { UpdateManifest } from './native';
import {
  compareVersion,
  isNative,
  updaterApply,
  updaterCheck,
  updaterDownload,
  updaterInfo,
  updaterReset,
  updaterSetSource,
} from './native';
import { DEFAULT_UPDATE_SOURCE } from './config';
import { APP_VERSION } from '../version';

export type UpdaterMessage = { text: string; tone: 'ok' | 'warn' | 'error' };

const UPDATE_PORT = 5276;
const DEFAULT_PREFIXES = [
  '192.168.0',
  '192.168.1',
  '192.168.2',
  '192.168.3',
  '192.168.4',
  '192.168.5',
  '192.168.6',
  '192.168.7',
  '192.168.8',
  '10.0.0',
  '172.16.0',
];

/**
 * 电脑的局域网地址会被路由器换掉（实测见过 .110 → .112 → .109）。
 * 没有可用地址时扫常见私有网段的 5276 端口，谁能返回 version.json 就用谁。
 */
async function discoverSource(seed: string): Promise<string | undefined> {
  const matched = /^(https?:\/\/)(\d+\.\d+\.\d+)\.(\d+)(?::(\d+))?/.exec(seed || '');
  const scheme = matched?.[1] ?? 'http://';
  const port = `:${matched?.[4] ?? UPDATE_PORT}`;
  const prefixes = matched ? [matched[2]] : DEFAULT_PREFIXES;
  const lastHost = matched ? Number(matched[3]) : 0;
  const hosts = new Set<number>();
  if (matched) {
    for (let host = Math.max(2, lastHost - 8); host <= Math.min(254, lastHost + 8); host += 1) hosts.add(host);
  }
  for (let host = 100; host <= 125; host += 1) hosts.add(host);
  for (let host = 2; host <= 20; host += 1) hosts.add(host);
  const list = [...hosts];
  if (!list.length) return undefined;
  return new Promise((resolve) => {
    let pending = list.length * prefixes.length;
    let settled = false;
    const finish = (value: string | undefined) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    for (const prefix of prefixes) {
      for (const host of list) {
        const base = `${scheme}${prefix}.${host}${port}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 800);
        fetch(`${base}/version.json`, { signal: controller.signal, cache: 'no-store' })
          .then((response) => (response.ok ? response.json() : undefined))
          .then((json: { version?: string } | undefined) => {
            if (json && typeof json.version === 'string' && json.version) finish(base);
          })
          .catch(() => undefined)
          .finally(() => {
            clearTimeout(timer);
            pending -= 1;
            if (pending === 0) finish(undefined);
          });
      }
    }
  });
}

export function useUpdater() {
  const native = isNative();
  const [ready, setReady] = useState(!native);
  const [bundledVersion, setBundledVersion] = useState(APP_VERSION);
  const [activeVersion, setActiveVersion] = useState('');
  const [source, setSource] = useState(DEFAULT_UPDATE_SOURCE);
  const [manifest, setManifest] = useState<UpdateManifest>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<UpdaterMessage>();

  useEffect(() => {
    if (!native) return;
    let cancelled = false;
    void (async () => {
      try {
        const info = await updaterInfo();
        if (cancelled || !info) return;
        setBundledVersion(info.bundledVersion || APP_VERSION);
        setActiveVersion(info.activeVersion);
        if (info.sourceUrl) setSource(info.sourceUrl);
        else await updaterSetSource(DEFAULT_UPDATE_SOURCE);
      } catch {
        // 读取更新信息失败时按内置版本处理
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [native]);

  const currentVersion = activeVersion || bundledVersion;

  const check = useCallback(
    async (verbose = true) => {
      if (!native) {
        if (verbose) setMessage({ text: '浏览器里没有应用更新，装成 APK 后才可用', tone: 'warn' });
        return;
      }
      setBusy(true);
      if (verbose) setMessage(undefined);
      // 电脑的局域网地址会被路由器换掉：先试当前源，失败就回退到内置默认源
      const candidates = [source, DEFAULT_UPDATE_SOURCE].filter(
        (value, index, list) => Boolean(value) && list.indexOf(value) === index,
      );
      let failure: unknown;
      for (const candidate of candidates) {
        try {
          await updaterSetSource(candidate);
          const next = await updaterCheck(candidate);
          if (!next) {
            failure = new Error('更新源没有返回内容');
            continue;
          }
          if (candidate !== source) {
            // 换到能用的那个地址，下次就不用再试错的
            setSource(candidate);
            setMessage({ text: `原更新源连不上，已自动换到 ${candidate}`, tone: 'warn' });
          }
          setManifest(next);
          if (verbose) {
            setMessage(
              compareVersion(next.version, currentVersion) > 0
                ? { text: `发现新版本 ${next.version}${next.notes ? `：${next.notes}` : ''}`, tone: 'ok' }
                : { text: `已是最新版本（${currentVersion}）`, tone: 'warn' },
            );
          }
          setBusy(false);
          return;
        } catch (error) {
          failure = error;
        }
      }
      // 两个地址都不通：扫同网段把服务找出来（电脑 IP 被路由器换掉时用）
      try {
        const found = (await discoverSource(source || DEFAULT_UPDATE_SOURCE)) ?? (await discoverSource(''));
        if (found) {
          await updaterSetSource(found);
          const next = await updaterCheck(found);
          if (next) {
            setSource(found);
            setManifest(next);
            setMessage({ text: `已在局域网里找到更新服务：${found}`, tone: 'ok' });
            if (verbose) {
              setMessage(
                compareVersion(next.version, currentVersion) > 0
                  ? { text: `已在局域网里找到更新服务 ${found}，新版本 ${next.version}：${next.notes ?? ''}`, tone: 'ok' }
                  : { text: `已在局域网里找到更新服务 ${found}，已是最新版本（${currentVersion}）`, tone: 'warn' },
              );
            }
            setBusy(false);
            return;
          }
        }
      } catch (error) {
        failure = error;
      }
      if (verbose) {
        setMessage({ text: failure instanceof Error ? failure.message : '检查更新失败', tone: 'error' });
      }
      setBusy(false);
    },
    [currentVersion, native, source],
  );

  const install = useCallback(async () => {
    if (!manifest) return;
    setBusy(true);
    try {
      setMessage({ text: `正在下载 ${manifest.version}…`, tone: 'warn' });
      await updaterDownload(manifest);
      setMessage({ text: '校验通过，正在切换并重启界面', tone: 'ok' });
      await updaterApply(manifest.version);
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : '更新失败', tone: 'error' });
      setBusy(false);
    }
  }, [manifest]);

  const rollback = useCallback(async () => {
    setBusy(true);
    try {
      await updaterReset();
      setMessage({ text: '已回滚到内置版本，正在重启界面', tone: 'ok' });
    } catch (error) {
      setMessage({ text: error instanceof Error ? error.message : '回滚失败', tone: 'error' });
      setBusy(false);
    }
  }, []);

  const outdated = !!manifest && compareVersion(manifest.version, currentVersion) > 0;

  return {
    native,
    ready,
    bundledVersion,
    currentVersion,
    activeVersion,
    source,
    setSource,
    manifest,
    outdated,
    busy,
    message,
    check,
    install,
    rollback,
  };
}

export type Updater = ReturnType<typeof useUpdater>;
