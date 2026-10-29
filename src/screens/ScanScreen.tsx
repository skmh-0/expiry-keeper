import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Check, Image as ImageIcon, Keyboard, ScanLine, Sparkles, X } from 'lucide-react';
import type { PhotoRole, PhotoShot, RecognizeOutcome } from '../types';
import { isEngineConfigured, recognize } from '../lib/engine';
import { useStore } from '../lib/store';
import { captureNativePhoto, isNative } from '../lib/native';
import { downscale, readAsDataUrl } from '../lib/image';
import { isValidGtin, normalizeGtin } from '../lib/gtin';
import { Notice, Segmented, TextInput } from '../components/ui';
import { CatMascot } from '../components/Cat';
import { libraryOutcome, lookupProduct } from '../lib/productApi';

const PIPELINE_STEPS = ['查询商品库', '图像质量检测', '条码与背标解析', '规则校验 GTIN / SC / 保质期', '生成商品记录'];

/** 照片角色：告诉模型哪张是喷码特写、哪张是配料表特写，比一堆无标注的图准得多 */
const ROLE_TEXT: Record<PhotoRole, string> = {
  back: '整张背标',
  ingredients: '配料表特写',
  date: '喷码日期特写',
  front: '包装正面',
};
/** 分段控件上用短标签，避免在小屏上折行 */
const ROLE_SHORT: Record<PhotoRole, string> = {
  back: '背标',
  date: '喷码',
  ingredients: '配料表',
  front: '正面',
};
const ROLE_ORDER: PhotoRole[] = ['back', 'date', 'ingredients', 'front'];
/** 拍完一张后自动切到下一件通常还要拍的东西 */
const ROLE_NEXT: Record<PhotoRole, PhotoRole> = {
  back: 'date',
  date: 'ingredients',
  ingredients: 'front',
  front: 'front',
};
const MAX_SHOTS = 5;

type ScanState = 'idle' | 'starting' | 'scanning' | 'error';

export function ScanScreen({
  onScanned,
  onOpenSettings,
}: {
  onScanned: (payload: { outcome: RecognizeOutcome; photo?: string }) => void;
  onOpenSettings: () => void;
}) {
  const { settings, makers } = useStore();
  const engineReady = isEngineConfigured(settings);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const rafRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const aliveRef = useRef(true);
  const captureInputRef = useRef<HTMLInputElement | null>(null);
  const albumInputRef = useRef<HTMLInputElement | null>(null);
  /** 托盘同时用 state 和 ref：加图、删图、换标签都要立刻拿到最新值 */
  const shotsRef = useRef<PhotoShot[]>([]);

  const [state, setState] = useState<ScanState>('idle');
  const [message, setMessage] = useState('');
  const [manual, setManual] = useState('');
  const [shots, setShots] = useState<PhotoShot[]>([]);
  const [role, setRole] = useState<PhotoRole>('back');
  const [step, setStep] = useState(-1);
  const [elapsed, setElapsed] = useState(0);
  const runTokenRef = useRef(0);

  const applyShots = useCallback((next: PhotoShot[]) => {
    shotsRef.current = next;
    setShots(next);
  }, []);

  const stopCamera = useCallback(() => {
    aliveRef.current = false;
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      controlsRef.current?.stop();
    } catch {
      // 忽略停止扫描器时的异常
    }
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setState('idle');
  }, []);

  const runPipeline = useCallback(
    async (input: { gtin?: string; shots?: PhotoShot[]; evidence?: string }) => {
      if (busyRef.current) return;
      const taken = input.shots ?? [];
      const scanned = normalizeGtin(input.gtin ?? '');
      const badGtin = Boolean(scanned) && !isValidGtin(scanned);
      // 扫到的码校验位就不对、又没拍背标：别让用户白等一遍解析
      if (badGtin && !taken.length) {
        setMessage('条码校验位不通过，先带你进确认页手工核对');
        const outcome = await recognize({ settings, gtin: scanned, shots: [], makers });
        outcome.notices = [
          `条码校验位不通过：${scanned}。先看看是不是扫错了一位，也可以直接按包装手工填写`,
          ...outcome.notices,
        ];
        onScanned({ outcome });
        return;
      }
      // 有商品库时先查库；命中直接填充，2 秒超时或未命中再降级到 AI。
      if (scanned && !badGtin && settings.productApiUrl?.trim()) {
        busyRef.current = true;
        setStep(0);
        setMessage('正在查询商品库…');
        const library = await lookupProduct(settings, scanned);
        busyRef.current = false;
        setStep(-1);
        if (library.status === 'hit') {
          setMessage('');
          stopCamera();
          applyShots([]);
          onScanned({
            outcome: libraryOutcome(library.product, scanned),
            photo: input.evidence ?? taken[0]?.dataUrl,
          });
          return;
        }
        setMessage(
          library.status === 'timeout'
            ? '商品库查询超过 2 秒，改用 AI 识别'
            : '商品库未命中，改用 AI 识别',
        );
      }
      if (import.meta.env.DEV) {
        console.info(
          `[scan] 开始解析：${taken.length ? taken.map((shot) => ROLE_TEXT[shot.role]).join(' + ') : ''}${input.gtin ? ` 条码 ${input.gtin}` : ''}`,
        );
      }
      const token = runTokenRef.current + 1;
      runTokenRef.current = token;
      busyRef.current = true;
      aliveRef.current = false;
      setStep(0);
      setElapsed(0);
      const started = Date.now();
      const advance = window.setInterval(
        () => setStep((current) => (current < PIPELINE_STEPS.length - 1 ? current + 1 : current)),
        320,
      );
      const ticker = window.setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 1000);
      let outcome: RecognizeOutcome | undefined;
      let failure = '';
      try {
        outcome = await recognize({ settings, gtin: input.gtin, shots: taken, makers });
        if (badGtin) {
          outcome.notices = [
            `扫到的条码校验位不通过（${scanned}），已改用图片上读到的条码，请核对`,
            ...outcome.notices,
          ];
        }
        const spent = Date.now() - started;
        if (spent < 1100) await new Promise((resolve) => setTimeout(resolve, 1100 - spent));
      } catch (error) {
        failure = error instanceof Error ? error.message : '识别失败';
      }
      window.clearInterval(advance);
      window.clearInterval(ticker);
      if (runTokenRef.current !== token) return;
      setStep(-1);
      busyRef.current = false;
      if (!outcome) {
        setMessage(failure || '识别失败');
        return;
      }
      stopCamera();
      // 识别完就清空托盘，避免回到扫码页后误把上次的照片再识别一遍
      applyShots([]);
      onScanned({ outcome, photo: input.evidence ?? taken[0]?.dataUrl });
    },
    [applyShots, makers, onScanned, settings, stopCamera],
  );

  const cancelPipeline = useCallback(() => {
    runTokenRef.current += 1;
    busyRef.current = false;
    setStep(-1);
    setMessage('已取消本次识别');
  }, []);

  const handleCode = useCallback(
    (code: string) => {
      if (busyRef.current) return;
      void runPipeline({ gtin: code });
    },
    [runPipeline],
  );

  const startDecode = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const Detector = (window as unknown as { BarcodeDetector?: new (options?: unknown) => { detect: (source: unknown) => Promise<{ rawValue: string }[]> } })
      .BarcodeDetector;

    if (typeof Detector === 'function') {
      let detector: { detect: (source: unknown) => Promise<{ rawValue: string }[]> };
      try {
        detector = new Detector({
          formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'itf', 'qr_code', 'data_matrix'],
        });
      } catch {
        detector = new Detector();
      }
      const tick = async () => {
        if (!aliveRef.current) return;
        try {
          const codes = await detector.detect(video);
          const first = codes.find((code) => code.rawValue);
          if (first) {
            handleCode(first.rawValue);
            return;
          }
        } catch {
          // 单帧识别失败继续下一帧
        }
        if (aliveRef.current) rafRef.current = requestAnimationFrame(() => void tick());
      };
      void tick();
      return;
    }

    void import('@zxing/browser').then(async ({ BrowserMultiFormatReader }) => {
      const reader = new BrowserMultiFormatReader();
      try {
        const controls = await reader.decodeFromVideoElement(video, (result) => {
          if (result) handleCode(result.getText());
        });
        controlsRef.current = controls;
      } catch {
        setMessage('条码解码器启动失败，可改用拍背标或手动输入');
        setState('error');
      }
    });
  }, [handleCode]);

  const startCamera = useCallback(async () => {
    setMessage('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setState('error');
      setMessage('当前页面不是安全上下文，实时扫码需要 HTTPS 访问；拍背标与手动输入仍可用。');
      return;
    }
    setState('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      streamRef.current = stream;
      aliveRef.current = true;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      setState('scanning');
      startDecode();
    } catch (error) {
      setState('error');
      const name = error instanceof Error ? error.name : '';
      if (name === 'NotAllowedError') setMessage('摄像头权限被拒绝，可在浏览器地址栏重新授权。');
      else if (name === 'NotFoundError') setMessage('没有找到可用摄像头，可改用拍背标或手动输入。');
      else setMessage('无法启动摄像头，可改用拍背标或手动输入。');
    }
  }, [startDecode]);

  useEffect(() => {
    return () => {
      aliveRef.current = false;
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      try {
        controlsRef.current?.stop();
      } catch {
        // 卸载时忽略
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const addPhoto = useCallback(
    async (dataUrl: string) => {
      const photo = await downscale(dataUrl);
      if (shotsRef.current.length >= MAX_SHOTS) {
        setMessage(`最多一次识别 ${MAX_SHOTS} 张，先移除一张再加`);
        return;
      }
      applyShots([...shotsRef.current, { dataUrl: photo, role }]);
      setRole(ROLE_NEXT[role]);
    },
    [applyShots, role],
  );

  const handlePhotoFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      try {
        await addPhoto(await readAsDataUrl(file));
      } catch {
        setMessage('这张图片读取失败，换一张试试');
      }
    },
    [addPhoto],
  );

  const captureFrame = useCallback(async () => {
    if (isNative()) {
      try {
        const native = await captureNativePhoto();
        if (native) await addPhoto(native);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        // 用户自己按返回取消拍照不算失败，不要弹提示
        if (/cancel/i.test(reason)) return;
        setMessage('调用系统相机失败，可改用相册选择或手动输入');
      }
      return;
    }
    const video = videoRef.current;
    if (state !== 'scanning' || !video || !video.videoWidth) {
      captureInputRef.current?.click();
      return;
    }
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d')?.drawImage(video, 0, 0);
    await addPhoto(canvas.toDataURL('image/jpeg', 0.8));
  }, [addPhoto, state]);

  return (
    <div className="screen">
      <div className={`scan-stage ${state === 'scanning' ? 'live' : ''}`}>
        <video ref={videoRef} className="scan-video" playsInline muted />
        {state !== 'scanning' ? (
          <div className="scan-placeholder">
            <CatMascot size={54} />
            <p>对准包装上的商品条码</p>
            <p className="muted small">整张平铺、避开反光；配料表和喷码各拍一张特写最准</p>
          </div>
        ) : null}
        <div className="scan-frame" aria-hidden="true">
          <span className="corner tl" />
          <span className="corner tr" />
          <span className="corner bl" />
          <span className="corner br" />
          {state === 'scanning' ? <span className="laser" /> : null}
        </div>
        {state === 'starting' ? <p className="scan-status">正在启动摄像头…</p> : null}
        {state === 'scanning' ? <p className="scan-status">正在识别条码…对准后保持稳定</p> : null}
      </div>

      {message ? <Notice level="warn">{message}</Notice> : null}
      {engineReady ? null : (
        <Notice level="warn">未填写 DeepSeek API Key：扫码只记录条码，商品信息需手工填写。</Notice>
      )}

      <button type="button" className="btn btn-primary btn-block" onClick={() => (state === 'scanning' ? stopCamera() : void startCamera())}>
        <ScanLine size={18} />
        {state === 'scanning' ? '停止扫码' : '开始实时扫码'}
      </button>

      <div className="card">
        <p className="block-label">这张拍的是</p>
        <Segmented<PhotoRole>
          value={role}
          onChange={setRole}
          options={ROLE_ORDER.map((value) => ({ value, label: ROLE_SHORT[value] }))}
        />
        <p className="muted tiny">
          喷码和配料表小字单独拍特写，模型才看得清；拍完会自动切到下一项。整张背标也建议拍一张，用来对条码和厂家。
        </p>
      </div>

      <div className="action-row">
        <button type="button" className="btn btn-outline" onClick={() => void captureFrame()}>
          <Camera size={16} />
          拍这张
        </button>
        <button type="button" className="btn btn-outline" onClick={() => albumInputRef.current?.click()}>
          <ImageIcon size={16} />
          从相册选
        </button>
      </div>

      {shots.length ? (
        <div className="card">
          <p className="block-label">已拍 {shots.length} 张 · 最多 {MAX_SHOTS} 张 · 点照片上的标签可以改这张的用途</p>
          <div className="tray">
            {shots.map((shot, index) => (
              <div className="tray-item" key={`${index}-${shot.dataUrl.slice(-24)}`}>
                <img src={shot.dataUrl} alt={`第 ${index + 1} 张：${ROLE_TEXT[shot.role]}`} />
                <button
                  type="button"
                  className="tray-role"
                  title="切换这张照片的用途"
                  onClick={() =>
                    applyShots(
                      shots.map((item, position) =>
                        position === index
                          ? { ...item, role: ROLE_ORDER[(ROLE_ORDER.indexOf(item.role) + 1) % ROLE_ORDER.length] }
                          : item,
                      ),
                    )
                  }
                >
                  {ROLE_TEXT[shot.role]}
                </button>
                <button
                  type="button"
                  className="tray-remove"
                  aria-label={`移除第 ${index + 1} 张`}
                  onClick={() => applyShots(shots.filter((_, position) => position !== index))}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="btn btn-primary btn-block"
            disabled={step >= 0}
            onClick={() => void runPipeline({ gtin: manual.trim(), shots })}
          >
            <Sparkles size={16} />
            识别这 {shots.length} 张
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-block"
            disabled={step >= 0}
            onClick={() => {
              const evidence = shots[0]?.dataUrl;
              applyShots([]);
              void runPipeline({ gtin: manual.trim(), evidence });
            }}
          >
            不识别，直接手填
          </button>
        </div>
      ) : null}

      <div className="card">
        <p className="block-label">手动输入条码</p>
        <div className="inline">
          <TextInput
            value={manual}
            inputMode="numeric"
            placeholder="13 位商品条码"
            onChange={(event) => setManual(event.target.value.replace(/\D+/g, ''))}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && manual.length >= 8) void runPipeline({ gtin: manual });
            }}
          />
          <button
            type="button"
            className="btn btn-outline"
            disabled={manual.length < 8}
            onClick={() => void runPipeline({ gtin: manual })}
          >
            <Keyboard size={16} />
            查询
          </button>
        </div>
      </div>

      {engineReady ? null : (
        <button type="button" className="btn btn-outline btn-block" onClick={onOpenSettings}>
          去设置识别引擎
        </button>
      )}

      <input
        ref={captureInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(event) => {
          void handlePhotoFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
      <input
        ref={albumInputRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(event) => {
          void handlePhotoFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />

      {step >= 0 ? (
        <div className="processing">
          <div className="processing-card">
            <p className="processing-title">正在解析</p>
            <ul className="step-list">
              {PIPELINE_STEPS.map((label, index) => (
                <li key={label} className={index < step ? 'done' : index === step ? 'active' : ''}>
                  <span className="step-dot">{index < step ? <Check size={12} /> : null}</span>
                  {label}
                </li>
              ))}
            </ul>
            {step >= PIPELINE_STEPS.length - 1 ? (
              <p className="muted small processing-wait">等待模型返回，已等待 {elapsed} 秒</p>
            ) : null}
            <button type="button" className="btn btn-ghost btn-block" onClick={cancelPipeline}>
              取消
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
