package com.securechat.pwa;

import android.content.Context;
import android.content.SharedPreferences;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.security.KeyStore;
import java.util.concurrent.Executor;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String AES_MODE = "AES/GCM/NoPadding";
    private static final String PREFS_NAME = "SecureAppLockPrefs";

    @PluginMethod
    public void isBiometricAvailable(PluginCall call) {
        try {
            BiometricManager biometricManager = BiometricManager.from(getContext());
            int authenticators = BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL;
            int result = biometricManager.canAuthenticate(authenticators);

            JSObject ret = new JSObject();
            if (result == BiometricManager.BIOMETRIC_SUCCESS) {
                ret.put("available", true);
                ret.put("code", "SUCCESS");
            } else {
                ret.put("available", false);
                ret.put("code", getAvailabilityCodeString(result));
            }
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to check biometric availability: " + e.getMessage(), e);
        }
    }

    private String getAvailabilityCodeString(int result) {
        switch (result) {
            case BiometricManager.BIOMETRIC_ERROR_NO_HARDWARE:
                return "NO_HARDWARE";
            case BiometricManager.BIOMETRIC_ERROR_HW_UNAVAILABLE:
                return "HW_UNAVAILABLE";
            case BiometricManager.BIOMETRIC_ERROR_NONE_ENROLLED:
                return "NONE_ENROLLED";
            case BiometricManager.BIOMETRIC_ERROR_SECURITY_UPDATE_REQUIRED:
                return "SECURITY_UPDATE_REQUIRED";
            default:
                return "UNKNOWN_ERROR";
        }
    }

    @PluginMethod
    public void authenticate(PluginCall call) {
        final String title = call.getString("title", "App Lock");
        final String subtitle = call.getString("subtitle", "Authenticate to unlock the application");

        getActivity().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                try {
                    Executor executor = ContextCompat.getMainExecutor(getContext());
                    BiometricPrompt.PromptInfo promptInfo = new BiometricPrompt.PromptInfo.Builder()
                        .setTitle(title)
                        .setSubtitle(subtitle)
                        .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.DEVICE_CREDENTIAL)
                        .build();

                    BiometricPrompt biometricPrompt = new BiometricPrompt((FragmentActivity) getActivity(), executor, new BiometricPrompt.AuthenticationCallback() {
                        @Override
                        public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                            super.onAuthenticationError(errorCode, errString);
                            JSObject ret = new JSObject();
                            ret.put("success", false);
                            ret.put("error", errString.toString());
                            ret.put("code", errorCode);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult result) {
                            super.onAuthenticationSucceeded(result);
                            JSObject ret = new JSObject();
                            ret.put("success", true);
                            call.resolve(ret);
                        }

                        @Override
                        public void onAuthenticationFailed() {
                            super.onAuthenticationFailed();
                            // This is called for unrecognized biometrics, but the prompt remains visible.
                            // We don't resolve yet to allow the user to retry.
                        }
                    });

                    biometricPrompt.authenticate(promptInfo);
                } catch (Exception e) {
                    call.reject("Failed to trigger biometric prompt: " + e.getMessage(), e);
                }
            }
        });
    }

    @PluginMethod
    public void setSecureSecret(PluginCall call) {
        String alias = call.getString("alias");
        String secret = call.getString("secret");
        if (alias == null || secret == null) {
            call.reject("Alias and secret are required");
            return;
        }

        try {
            // 1. Generate or load key from AndroidKeyStore
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);

            if (!keyStore.containsAlias(alias)) {
                KeyGenerator keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER);
                KeyGenParameterSpec.Builder builder = new KeyGenParameterSpec.Builder(
                    alias,
                    KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
                )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256);

                keyGenerator.init(builder.build());
                keyGenerator.generateKey();
            }

            SecretKey secretKey = (SecretKey) keyStore.getKey(alias, null);
            if (secretKey == null) {
                call.reject("Failed to generate or retrieve key");
                return;
            }

            // 2. Encrypt the secret
            Cipher cipher = Cipher.getInstance(AES_MODE);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            byte[] iv = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(secret.getBytes("UTF-8"));

            String ciphertextBase64 = Base64.encodeToString(ciphertext, Base64.NO_WRAP);
            String ivBase64 = Base64.encodeToString(iv, Base64.NO_WRAP);

            // 3. Save to SharedPreferences
            SharedPreferences sharedPreferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = sharedPreferences.edit();
            editor.putString(alias + "_ciphertext", ciphertextBase64);
            editor.putString(alias + "_iv", ivBase64);
            editor.apply();

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to store secure secret: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void getSecureSecret(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null) {
            call.reject("Alias is required");
            return;
        }

        try {
            SharedPreferences sharedPreferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            String ciphertextBase64 = sharedPreferences.getString(alias + "_ciphertext", null);
            String ivBase64 = sharedPreferences.getString(alias + "_iv", null);

            if (ciphertextBase64 == null || ivBase64 == null) {
                JSObject ret = new JSObject();
                ret.put("secret", null);
                call.resolve(ret);
                return;
            }

            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            SecretKey secretKey = (SecretKey) keyStore.getKey(alias, null);

            if (secretKey == null) {
                call.reject("Key not found in Keystore");
                return;
            }

            byte[] ciphertext = Base64.decode(ciphertextBase64, Base64.NO_WRAP);
            byte[] iv = Base64.decode(ivBase64, Base64.NO_WRAP);

            Cipher cipher = Cipher.getInstance(AES_MODE);
            GCMParameterSpec spec = new GCMParameterSpec(128, iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);

            byte[] decrypted = cipher.doFinal(ciphertext);
            String decryptedString = new String(decrypted, "UTF-8");

            JSObject ret = new JSObject();
            ret.put("secret", decryptedString);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to decrypt secure secret: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void deleteSecureSecret(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null) {
            call.reject("Alias is required");
            return;
        }

        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            if (keyStore.containsAlias(alias)) {
                keyStore.deleteEntry(alias);
            }

            SharedPreferences sharedPreferences = getContext().getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            SharedPreferences.Editor editor = sharedPreferences.edit();
            editor.remove(alias + "_ciphertext");
            editor.remove(alias + "_iv");
            editor.apply();

            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to delete secure secret: " + e.getMessage(), e);
        }
    }
}
