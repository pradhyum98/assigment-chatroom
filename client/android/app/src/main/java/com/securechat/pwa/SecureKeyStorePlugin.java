package com.securechat.pwa;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;

import java.security.KeyStore;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

@CapacitorPlugin(name = "SecureKeyStore")
public class SecureKeyStorePlugin extends Plugin {
    private static final String KEYSTORE_PROVIDER = "AndroidKeyStore";
    private static final String AES_MODE = "AES/GCM/NoPadding";

    @PluginMethod
    public void generateKey(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null) {
            call.reject("Alias is required");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            
            SecretKey secretKey = null;
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
                secretKey = keyGenerator.generateKey();
            } else {
                secretKey = (SecretKey) keyStore.getKey(alias, null);
            }

            // Expose actual protection level: SOFTWARE, TEE, or STRONGBOX
            String protectionLevel = "TEE"; // Default fallback
            try {
                android.content.pm.PackageManager pm = getContext().getPackageManager();
                boolean hasStrongBox = false;
                if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.P) {
                    hasStrongBox = pm.hasSystemFeature(android.content.pm.PackageManager.FEATURE_STRONGBOX_KEYSTORE);
                }

                if (secretKey != null) {
                    try {
                        javax.crypto.SecretKeyFactory factory = javax.crypto.SecretKeyFactory.getInstance(secretKey.getAlgorithm(), KEYSTORE_PROVIDER);
                        android.security.keystore.KeyInfo keyInfo = (android.security.keystore.KeyInfo) factory.getKeySpec(secretKey, android.security.keystore.KeyInfo.class);
                        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.S) {
                            int level = keyInfo.getSecurityLevel();
                            if (level == android.security.keystore.KeyProperties.SECURITY_LEVEL_STRONGBOX) {
                                protectionLevel = "STRONGBOX";
                            } else if (level == android.security.keystore.KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT) {
                                protectionLevel = "TEE";
                            } else {
                                protectionLevel = "SOFTWARE";
                            }
                        } else {
                            if (keyInfo.isInsideSecureHardware()) {
                                protectionLevel = "TEE";
                            } else {
                                protectionLevel = "SOFTWARE";
                            }
                        }
                    } catch (Exception ex) {
                        if (hasStrongBox) {
                            protectionLevel = "STRONGBOX";
                        } else {
                            protectionLevel = "TEE";
                        }
                    }
                }
            } catch (Exception e) {
                protectionLevel = "SOFTWARE";
            }

            JSObject ret = new JSObject();
            ret.put("success", true);
            ret.put("protectionLevel", protectionLevel);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to generate key: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void encrypt(PluginCall call) {
        String alias = call.getString("alias");
        String plaintext = call.getString("plaintext");
        String aad = call.getString("aad");
        if (alias == null || plaintext == null) {
            call.reject("Alias and plaintext are required");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            SecretKey secretKey = (SecretKey) keyStore.getKey(alias, null);
            if (secretKey == null) {
                call.reject("Key not found");
                return;
            }
            Cipher cipher = Cipher.getInstance(AES_MODE);
            cipher.init(Cipher.ENCRYPT_MODE, secretKey);
            if (aad != null) {
                cipher.updateAAD(aad.getBytes("UTF-8"));
            }
            byte[] iv = cipher.getIV();
            byte[] ciphertext = cipher.doFinal(plaintext.getBytes("UTF-8"));
            
            JSObject ret = new JSObject();
            ret.put("ciphertext", Base64.encodeToString(ciphertext, Base64.NO_WRAP));
            ret.put("iv", Base64.encodeToString(iv, Base64.NO_WRAP));
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Encryption failed: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void decrypt(PluginCall call) {
        String alias = call.getString("alias");
        String ciphertextStr = call.getString("ciphertext");
        String ivStr = call.getString("iv");
        String aad = call.getString("aad");
        if (alias == null || ciphertextStr == null || ivStr == null) {
            call.reject("Alias, ciphertext, and iv are required");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            SecretKey secretKey = (SecretKey) keyStore.getKey(alias, null);
            if (secretKey == null) {
                call.reject("Key not found");
                return;
            }
            byte[] ciphertext = Base64.decode(ciphertextStr, Base64.NO_WRAP);
            byte[] iv = Base64.decode(ivStr, Base64.NO_WRAP);
            
            Cipher cipher = Cipher.getInstance(AES_MODE);
            GCMParameterSpec spec = new GCMParameterSpec(128, iv);
            cipher.init(Cipher.DECRYPT_MODE, secretKey, spec);
            if (aad != null) {
                cipher.updateAAD(aad.getBytes("UTF-8"));
            }
            byte[] plaintextBytes = cipher.doFinal(ciphertext);
            
            JSObject ret = new JSObject();
            ret.put("plaintext", new String(plaintextBytes, "UTF-8"));
            call.resolve(ret);
        } catch (android.security.keystore.KeyPermanentlyInvalidatedException e) {
            JSObject ret = new JSObject();
            ret.put("error", "KEY_INVALIDATED");
            call.resolve(ret);
        } catch (Exception e) {
            String msg = e.getMessage() != null ? e.getMessage() : "";
            if (msg.contains("mac failed") || msg.contains("BadTag")) {
                JSObject ret = new JSObject();
                ret.put("error", "KEY_INVALIDATED");
                call.resolve(ret);
            } else {
                call.reject("Decryption failed: " + e.getMessage(), e);
            }
        }
    }

    @PluginMethod
    public void deleteKey(PluginCall call) {
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
            JSObject ret = new JSObject();
            ret.put("success", true);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to delete key: " + e.getMessage(), e);
        }
    }

    @PluginMethod
    public void hasKey(PluginCall call) {
        String alias = call.getString("alias");
        if (alias == null) {
            call.reject("Alias is required");
            return;
        }
        try {
            KeyStore keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER);
            keyStore.load(null);
            boolean exists = keyStore.containsAlias(alias);
            JSObject ret = new JSObject();
            ret.put("exists", exists);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Failed to check key existence: " + e.getMessage(), e);
        }
    }
}
