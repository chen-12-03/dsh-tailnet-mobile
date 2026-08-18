package com.chen1.dshmobile;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Base64;

import com.jcraft.jsch.HostKey;
import com.jcraft.jsch.HostKeyRepository;
import com.jcraft.jsch.JSchException;
import com.jcraft.jsch.UserInfo;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.nio.charset.StandardCharsets;

final class PinnedHostKeyRepository implements HostKeyRepository {
    interface Confirmation {
        boolean confirm(String host, String keyType, String fingerprint);
    }

    private final SharedPreferences preferences;
    private final String hostId;
    private final Confirmation confirmation;

    PinnedHostKeyRepository(Context context, String hostId, Confirmation confirmation) {
        this.preferences = context.getSharedPreferences("ssh_host_keys", Context.MODE_PRIVATE);
        this.hostId = hostId;
        this.confirmation = confirmation;
    }

    @Override
    public int check(String host, byte[] key) {
        String stored = preferences.getString(storageKey(), null);
        String incoming = Base64.encodeToString(key, Base64.NO_WRAP);
        if (stored != null) {
            return MessageDigest.isEqual(
                    stored.getBytes(StandardCharsets.US_ASCII),
                    incoming.getBytes(StandardCharsets.US_ASCII)) ? OK : CHANGED;
        }

        String type = "unknown";
        try {
            type = new HostKey(host, key).getType();
        } catch (JSchException ignored) {
            // Fingerprint confirmation remains available even if the type label is unknown.
        }
        if (!confirmation.confirm(hostId, type, fingerprint(key))) {
            return NOT_INCLUDED;
        }
        preferences.edit().putString(storageKey(), incoming).apply();
        return OK;
    }

    void clear() {
        preferences.edit().remove(storageKey()).apply();
    }

    private String storageKey() {
        return "host-key:" + hostId;
    }

    private static String fingerprint(byte[] key) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256").digest(key);
            return "SHA256:" + Base64.encodeToString(digest, Base64.NO_WRAP | Base64.NO_PADDING);
        } catch (NoSuchAlgorithmException impossible) {
            return "SHA256 unavailable";
        }
    }

    @Override
    public void add(HostKey hostkey, UserInfo ui) {
        // The key is persisted only after the explicit confirmation in check().
    }

    @Override
    public void remove(String host, String type) {
        clear();
    }

    @Override
    public void remove(String host, String type, byte[] key) {
        clear();
    }

    @Override
    public String getKnownHostsRepositoryID() {
        return "DSH Mobile pinned host key";
    }

    @Override
    public HostKey[] getHostKey() {
        return new HostKey[0];
    }

    @Override
    public HostKey[] getHostKey(String host, String type) {
        return new HostKey[0];
    }
}
