package com.skmh.expirykeeper;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/**
 * API Key 只以 AES-GCM 密文存进应用私有目录，密钥在 Android Keystore 里，
 * 不出现在 IndexedDB / localStorage / 备份导出文件里。
 */
@CapacitorPlugin(name = "SecureKeyStore")
public class SecureKeyStorePlugin extends Plugin {

    private static final String PREFS = "expiry_keeper_secure";
    private static final String PREF_CIPHER = "api_key_cipher";
    private static final String KEY_ALIAS = "expiry_keeper_api_key";
    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int GCM_TAG_BITS = 128;

    private SharedPreferences prefs() {
        return getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject result = new JSObject();
        result.put("available", true);
        call.resolve(result);
    }

    @PluginMethod
    public void getKey(PluginCall call) {
        JSObject result = new JSObject();
        String encrypted = prefs().getString(PREF_CIPHER, "");
        if (encrypted == null || encrypted.isEmpty()) {
            result.put("key", "");
            call.resolve(result);
            return;
        }
        try {
            result.put("key", decrypt(encrypted));
        } catch (Throwable error) {
            // Keystore 密钥失效（例如恢复备份到新机）时，清掉无法解密的密文
            prefs().edit().remove(PREF_CIPHER).apply();
            result.put("key", "");
        }
        call.resolve(result);
    }

    @PluginMethod
    public void setKey(PluginCall call) {
        String key = call.getString("key", "");
        if (key == null) key = "";
        key = key.trim();
        if (key.isEmpty()) {
            prefs().edit().remove(PREF_CIPHER).apply();
            deleteKey();
            call.resolve();
            return;
        }
        try {
            prefs().edit().putString(PREF_CIPHER, encrypt(key)).apply();
            call.resolve();
        } catch (Throwable error) {
            call.reject("保存 API Key 失败：" + describe(error));
        }
    }

    @PluginMethod
    public void clearKey(PluginCall call) {
        prefs().edit().remove(PREF_CIPHER).apply();
        deleteKey();
        call.resolve();
    }

    private SecretKey getOrCreateKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore");
        store.load(null);
        if (store.containsAlias(KEY_ALIAS)) {
            return ((KeyStore.SecretKeyEntry) store.getEntry(KEY_ALIAS, null)).getSecretKey();
        }
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(
            new KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .build()
        );
        return generator.generateKey();
    }

    private String encrypt(String plain) throws Exception {
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey());
        byte[] iv = cipher.getIV();
        byte[] body = cipher.doFinal(plain.getBytes(StandardCharsets.UTF_8));
        byte[] combined = new byte[iv.length + body.length];
        System.arraycopy(iv, 0, combined, 0, iv.length);
        System.arraycopy(body, 0, combined, iv.length, body.length);
        return Base64.encodeToString(combined, Base64.NO_WRAP);
    }

    private String decrypt(String encoded) throws Exception {
        byte[] combined = Base64.decode(encoded, Base64.NO_WRAP);
        if (combined.length <= 12) throw new IllegalStateException("密文长度不正确");
        byte[] iv = new byte[12];
        byte[] body = new byte[combined.length - 12];
        System.arraycopy(combined, 0, iv, 0, 12);
        System.arraycopy(combined, 12, body, 0, body.length);
        Cipher cipher = Cipher.getInstance(TRANSFORMATION);
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), new GCMParameterSpec(GCM_TAG_BITS, iv));
        return new String(cipher.doFinal(body), StandardCharsets.UTF_8);
    }

    private void deleteKey() {
        try {
            KeyStore store = KeyStore.getInstance("AndroidKeyStore");
            store.load(null);
            if (store.containsAlias(KEY_ALIAS)) store.deleteEntry(KEY_ALIAS);
        } catch (Throwable ignored) {
            // 删除失败时密文已清空，不影响安全
        }
    }

    private String describe(Throwable error) {
        String message = error.getMessage();
        return message == null || message.isEmpty() ? error.getClass().getSimpleName() : message;
    }
}
