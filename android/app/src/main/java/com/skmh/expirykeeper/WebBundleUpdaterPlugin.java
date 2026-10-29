package com.skmh.expirykeeper;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * 热更新：把 Web 资源包下载到应用私有目录，校验 SHA-256 后切换 WebView 的资源根目录。
 *
 * 资源包是构建产物 dist 的 zip（根目录直接是 index.html / assets/...），
 * 因此更新只替换界面资源，不需要重新安装 APK，也不需要系统侧权限。
 */
@CapacitorPlugin(name = "WebBundleUpdater")
public class WebBundleUpdaterPlugin extends Plugin {

    private static final String TAG = "WebBundleUpdater";
    private static final String PREFS = "expiry_keeper_updater";
    private static final String KEY_ACTIVE = "active_version";
    private static final String KEY_PREVIOUS = "previous_version";
    private static final String KEY_PENDING = "pending_version";
    private static final String KEY_PENDING_AT = "pending_at";
    private static final String KEY_SOURCE = "source_url";
    private static final String KEY_APK_VERSION = "apk_version";
    /** 切换后至少给界面这么久去上报成功，避免刚重启就被判失败。 */
    private static final long PENDING_GRACE_MS = 15_000L;
    private static final String BUNDLE_ROOT = "bundles";
    private static final String ENTRY_FILE = "index.html";

    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final Handler mainHandler = new Handler(Looper.getMainLooper());

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    private File bundleDir(String version) {
        return new File(new File(getContext().getFilesDir(), BUNDLE_ROOT), version);
    }

    /**
     * 桥接初始化阶段不能调用 Bridge.setServerBasePath：那时 WebViewLocalServer 还没创建。
     * Capacitor 会在建 WebView 前读取 WebView 插件的 serverBasePath 偏好项，
     * 所以这里只改偏好项，由 Capacitor 自己在首屏加载前应用。
     */
    @Override
    public void load() {
        try {
            String apkVersion = appVersionName();
            if (!apkVersion.equals(prefs().getString(KEY_APK_VERSION, ""))) {
                // APK 刚升级：以新安装包内置的资源为准，丢弃上一版的热更新包
                Log.i(TAG, "APK updated to " + apkVersion + ", resetting to bundled assets");
                prefs()
                    .edit()
                    .putString(KEY_APK_VERSION, apkVersion)
                    .remove(KEY_ACTIVE)
                    .remove(KEY_PENDING)
                    .remove(KEY_PENDING_AT)
                    .remove(KEY_PREVIOUS)
                    .apply();
                persistBasePath(null);
                return;
            }

            String active = prefs().getString(KEY_ACTIVE, null);
            String pending = prefs().getString(KEY_PENDING, "");

            // 两阶段确认：上一轮切换后迟迟没有收到界面确认，判定资源包有问题，回滚。
            if (active != null && !active.isEmpty() && active.equals(pending)) {
                long setAt = prefs().getLong(KEY_PENDING_AT, 0L);
                long age = System.currentTimeMillis() - setAt;
                if (age < PENDING_GRACE_MS) {
                    Log.i(TAG, "bundle " + active + " still inside grace window (" + age + "ms), keep it");
                } else {
                    Log.w(TAG, "bundle " + active + " never confirmed (" + age + "ms), rolling back");
                    returnToPrevious(active);
                    return;
                }
            }

            if (active == null || active.isEmpty()) {
                Log.i(TAG, "no downloaded bundle, using bundled assets");
                persistBasePath(null);
                return;
            }
            File dir = bundleDir(active);
            if (new File(dir, ENTRY_FILE).exists()) {
                persistBasePath(dir.getAbsolutePath());
                Log.i(TAG, "will boot from downloaded bundle " + active);
            } else {
                Log.w(TAG, "bundle " + active + " missing " + ENTRY_FILE + ", fallback");
                returnToPrevious(active);
            }
        } catch (Throwable error) {
            // load() 里抛异常会让整个插件注册失败，必须兜住并退回内置资源。
            Log.e(TAG, "load failed: " + error, error);
            persistBasePath(null);
        }
    }

    private void returnToPrevious(String brokenVersion) {
        String previous = prefs().getString(KEY_PREVIOUS, "");
        prefs().edit().remove(KEY_ACTIVE).remove(KEY_PENDING).remove(KEY_PENDING_AT).remove(KEY_PREVIOUS).apply();
        if (brokenVersion != null && !brokenVersion.isEmpty()) {
            deleteRecursive(bundleDir(brokenVersion));
        }
        if (previous != null && !previous.isEmpty() && new File(bundleDir(previous), ENTRY_FILE).exists()) {
            prefs().edit().putString(KEY_ACTIVE, previous).apply();
            persistBasePath(bundleDir(previous).getAbsolutePath());
            Log.i(TAG, "rolled back to " + previous);
        } else {
            persistBasePath(null);
            Log.i(TAG, "rolled back to bundled assets");
        }
    }

    /** 写 Capacitor 的 serverBasePath 偏好项，path 为 null 表示回到内置资源。 */
    private void persistBasePath(String path) {
        SharedPreferences webViewPrefs = getContext()
            .getSharedPreferences(com.getcapacitor.plugin.WebView.WEBVIEW_PREFS_NAME, Context.MODE_PRIVATE);
        SharedPreferences.Editor editor = webViewPrefs.edit();
        if (path == null) {
            editor.remove(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH);
        } else {
            editor.putString(com.getcapacitor.plugin.WebView.CAP_SERVER_PATH, path);
        }
        editor.apply();
    }

    /** 运行时切换（localServer 已就绪），只用在 apply/reset。 */
    private void switchNow(String path) {
        try {
            if (path == null) {
                getBridge().setServerAssetPath(com.getcapacitor.Bridge.DEFAULT_WEB_ASSET_DIR);
            } else {
                getBridge().setServerBasePath(path);
            }
        } catch (Throwable error) {
            Log.e(TAG, "switch failed, reload manually: " + error, error);
            try {
                getBridge().reload();
            } catch (Throwable ignored) {
                // 忽略：重启应用后会按偏好项加载
            }
        }
    }

    private String appVersionName() {
        try {
            return getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0).versionName;
        } catch (Exception error) {
            return "";
        }
    }

    @PluginMethod
    public void getInfo(PluginCall call) {
        JSObject result = new JSObject();
        result.put("activeVersion", prefs().getString(KEY_ACTIVE, ""));
        result.put("previousVersion", prefs().getString(KEY_PREVIOUS, ""));
        result.put("sourceUrl", prefs().getString(KEY_SOURCE, ""));
        result.put("bundledVersion", appVersionName());
        call.resolve(result);
    }

    @PluginMethod
    public void setSource(PluginCall call) {
        String url = call.getString("url", "");
        prefs().edit().putString(KEY_SOURCE, url == null ? "" : url.trim()).apply();
        call.resolve();
    }

    /** 读取更新源里的 version.json。 */
    @PluginMethod
    public void checkSource(PluginCall call) {
        String source = call.getString("url", prefs().getString(KEY_SOURCE, ""));
        if (source == null || source.trim().isEmpty()) {
            call.reject("未配置更新源");
            return;
        }
        final String base = source.trim();
        executor.execute(() -> {
            try {
                String body = readToString(openConnection(joinUrl(base, "version.json")));
                JSONObject json = new JSONObject(body);
                JSObject result = new JSObject();
                String version = json.optString("version", "");
                result.put("version", version);
                result.put("url", joinUrl(base, json.optString("url", "")));
                result.put("sha256", json.optString("sha256", ""));
                result.put("notes", json.optString("notes", ""));
                result.put("size", json.optLong("size", 0));
                if (version.isEmpty()) {
                    throw new IOException("version.json 缺少 version 字段");
                }
                resolveOnMain(call, result);
            } catch (Exception error) {
                rejectOnMain(call, "检查更新失败：" + describe(error));
            }
        });
    }

    /** 下载并解包到 bundles/<version>，校验通过才落盘，不切换。 */
    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String version = call.getString("version", "");
        String sha256 = call.getString("sha256", "");
        if (url == null || url.trim().isEmpty() || version == null || version.trim().isEmpty()) {
            call.reject("缺少更新地址或版本号");
            return;
        }
        final String source = url.trim();
        final String target = version.trim();
        final String expected = sha256 == null ? "" : sha256.trim();

        executor.execute(() -> {
            File staging = new File(new File(getContext().getFilesDir(), BUNDLE_ROOT), ".staging-" + target);
            File zipFile = new File(getContext().getCacheDir(), "bundle-" + target + ".zip");
            try {
                deleteRecursive(staging);
                if (!staging.mkdirs()) {
                    throw new IOException("无法创建更新目录");
                }
                downloadTo(source, zipFile);
                if (!expected.isEmpty()) {
                    String actual = sha256Of(zipFile);
                    if (!actual.equalsIgnoreCase(expected)) {
                        throw new IOException("校验失败，期望 " + expected + "，实际 " + actual);
                    }
                }
                unzip(zipFile, staging);
                if (!new File(staging, ENTRY_FILE).exists()) {
                    throw new IOException("更新包缺少 " + ENTRY_FILE);
                }
                File finalDir = bundleDir(target);
                deleteRecursive(finalDir);
                if (!staging.renameTo(finalDir)) {
                    throw new IOException("更新目录替换失败");
                }
                JSObject result = new JSObject();
                result.put("version", target);
                result.put("path", finalDir.getAbsolutePath());
                resolveOnMain(call, result);
            } catch (Exception error) {
                deleteRecursive(staging);
                rejectOnMain(call, "下载更新失败：" + describe(error));
            } finally {
                //noinspection ResultOfMethodCallIgnored
                zipFile.delete();
            }
        });
    }

    /** 切换到已下载的资源包并重载 WebView。 */
    @PluginMethod
    public void apply(PluginCall call) {
        String version = call.getString("version", "");
        if (version == null || version.trim().isEmpty()) {
            call.reject("缺少版本号");
            return;
        }
        final String target = version.trim();
        File dir = bundleDir(target);
        if (!new File(dir, ENTRY_FILE).exists()) {
            call.reject("更新包未就绪，请先下载");
            return;
        }
        String current = prefs().getString(KEY_ACTIVE, "");
        prefs()
            .edit()
            .putString(KEY_ACTIVE, target)
            .putString(KEY_PREVIOUS, current)
            .putString(KEY_PENDING, target)
            .putLong(KEY_PENDING_AT, System.currentTimeMillis())
            .apply();
        persistBasePath(dir.getAbsolutePath());
        JSObject result = new JSObject();
        result.put("version", target);
        call.resolve(result);
        Log.i(TAG, "switching to bundle " + target);
        switchNow(dir.getAbsolutePath());
    }

    /** 界面上报「已成功启动」，清掉待确认标记，避免下次启动误判回滚。 */
    @PluginMethod
    public void confirmBoot(PluginCall call) {
        String active = prefs().getString(KEY_ACTIVE, "");
        String pending = prefs().getString(KEY_PENDING, "");
        if (!active.isEmpty() && active.equals(pending)) {
            prefs().edit().remove(KEY_PENDING).remove(KEY_PENDING_AT).apply();
            Log.i(TAG, "bundle " + active + " confirmed by UI");
        }
        call.resolve();
    }


    /** 回滚：删除当前热更新资源包，回到 APK 内置资源。 */
    @PluginMethod
    public void reset(PluginCall call) {
        String active = prefs().getString(KEY_ACTIVE, "");
        prefs().edit().remove(KEY_ACTIVE).remove(KEY_PENDING).remove(KEY_PENDING_AT).remove(KEY_PREVIOUS).apply();
        if (active != null && !active.isEmpty()) {
            deleteRecursive(bundleDir(active));
        }
        persistBasePath(null);
        call.resolve();
        Log.i(TAG, "reset to bundled assets");
        switchNow(null);
    }

    // ---------- 内部工具 ----------

    private void resolveOnMain(PluginCall call, JSObject result) {
        mainHandler.post(() -> call.resolve(result));
    }

    private void rejectOnMain(PluginCall call, String message) {
        mainHandler.post(() -> call.reject(message));
    }

    private HttpURLConnection openConnection(String url) throws IOException {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(20000);
        connection.setInstanceFollowRedirects(true);
        connection.setRequestProperty("User-Agent", "ExpiryKeeperUpdater/1.0");
        return connection;
    }

    private void downloadTo(String url, File target) throws IOException {
        HttpURLConnection connection = openConnection(url);
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            throw new IOException("服务器返回 " + code);
        }
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             FileOutputStream output = new FileOutputStream(target)) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
            }
        } finally {
            connection.disconnect();
        }
    }

    private String readToString(HttpURLConnection connection) throws IOException {
        int code = connection.getResponseCode();
        if (code < 200 || code >= 300) {
            connection.disconnect();
            throw new IOException("服务器返回 " + code);
        }
        try (InputStream input = new BufferedInputStream(connection.getInputStream());
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) > 0) {
                output.write(buffer, 0, read);
            }
            return output.toString("UTF-8");
        } finally {
            connection.disconnect();
        }
    }


    private void unzip(File zipFile, File targetDir) throws IOException {
        String root = targetDir.getCanonicalPath();
        try (ZipInputStream stream = new ZipInputStream(new BufferedInputStream(new FileInputStream(zipFile)))) {
            ZipEntry entry;
            byte[] buffer = new byte[16 * 1024];
            while ((entry = stream.getNextEntry()) != null) {
                File out = new File(targetDir, entry.getName());
                if (!out.getCanonicalPath().startsWith(root + File.separator)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    //noinspection ResultOfMethodCallIgnored
                    out.mkdirs();
                    continue;
                }
                File parent = out.getParentFile();
                if (parent != null && !parent.exists()) {
                    //noinspection ResultOfMethodCallIgnored
                    parent.mkdirs();
                }
                try (FileOutputStream output = new FileOutputStream(out)) {
                    int read;
                    while ((read = stream.read(buffer)) > 0) {
                        output.write(buffer, 0, read);
                    }
                }
            }
        }
    }

    private String sha256Of(File file) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = new BufferedInputStream(new FileInputStream(file))) {
            byte[] buffer = new byte[16 * 1024];
            int read;
            while ((read = input.read(buffer)) > 0) {
                digest.update(buffer, 0, read);
            }
        }
        StringBuilder builder = new StringBuilder();
        for (byte value : digest.digest()) {
            builder.append(String.format(Locale.US, "%02x", value));
        }
        return builder.toString();
    }

    private void deleteRecursive(File file) {
        if (file == null || !file.exists()) {
            return;
        }
        File[] children = file.listFiles();
        if (children != null) {
            for (File child : children) {
                deleteRecursive(child);
            }
        }
        //noinspection ResultOfMethodCallIgnored
        file.delete();
    }

    private String joinUrl(String base, String path) {
        if (path == null || path.isEmpty()) {
            return base;
        }
        if (path.startsWith("http://") || path.startsWith("https://")) {
            return path;
        }
        String left = base.endsWith("/") ? base.substring(0, base.length() - 1) : base;
        String right = path.startsWith("/") ? path.substring(1) : path;
        return left + "/" + right;
    }

    private String describe(Exception error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }
}
